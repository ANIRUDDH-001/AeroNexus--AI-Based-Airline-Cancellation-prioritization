from __future__ import annotations


def _gen(c, **kw):
    body = {"size": "small", "seed": 1, "disruptions": ["fog:DEL:300:240:0.4"]}
    body.update(kw)
    r = c.post("/data/generate", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_timeline_recommend_runs_and_decision(api_client):
    iid = _gen(api_client)
    tl = api_client.get("/timeline", params={"instance_id": iid, "t": 300}).json()
    assert tl["summary"]["flights"] > 50 and tl["summary"]["at_risk"] >= 1
    assert any(f["at_risk"] for f in tl["flights"]) and tl["rotations"]
    r = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 300, "seed": 1})
    assert r.status_code == 200, r.text
    run = r.json()
    assert 1 <= len(run["plans"]) <= 3 and run["config_hash"] and run["latency_ms"] > 0
    top = run["plans"][0]
    assert top["explanation"]["reasons"] and "confidence" in top["explanation"]
    runs = api_client.get("/runs", params={"instance_id": iid}).json()
    assert runs[0]["id"] == run["id"] and runs[0]["top_plan"] == top["explanation"]["actions"]
    got = api_client.get(f"/runs/{run['id']}").json()
    assert got["plans"][0]["nis"] == top["nis"]
    d = api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": 2, "override_reason": "crew preference"}).json()
    assert d["accepted_plan"] == 2 and d["override_reason"] == "crew preference"
    # hysteresis path: pass previous run id
    r2 = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 300, "seed": 1, "previous_run_id": run["id"]})
    assert r2.status_code == 200


def test_whatif_endpoint(api_client):
    iid = _gen(api_client)
    tl = api_client.get("/timeline", params={"instance_id": iid, "t": 300}).json()
    fid = tl["at_risk"][0]["flight"]
    r = api_client.post("/whatif", json={"instance_id": iid, "decision_time": 300,
                                         "actions": [{"type": "CANCEL_LEG", "target_flights": [fid]}]})
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["whatif"] and run["whatif"][0]["rank"] >= 1 and "what-if evaluation" in run["notes"]
    # infeasible what-if (delay beyond bound) -> 422
    r = api_client.post("/whatif", json={"instance_id": iid, "decision_time": 300,
                                         "actions": [{"type": "DELAY", "target_flights": [fid], "params": {"delay_min": 999}}]})
    assert r.status_code == 422


def test_tables_patch_add_column_and_disruptions(api_client):
    iid = _gen(api_client, disruptions=[])
    t = api_client.get(f"/data/instances/{iid}/table/flights").json()
    assert t["key"] == "id" and "booked_pax" in t["columns"] and t["rows"]
    fid = t["rows"][0]["id"]
    # patch: protect a flight and add an attribute
    r = api_client.patch(f"/data/instances/{iid}/flights/{fid}",
                         json={"fields": {"protected": True, "protection_reason": "VIP"}, "attributes": {"vip_count": 12}})
    assert r.status_code == 200 and r.json()["issues"] == []
    row = next(x for x in api_client.get(f"/data/instances/{iid}/table/flights").json()["rows"] if x["id"] == fid)
    assert row["protected"] is True and row["attr:vip_count"] == 12
    # invalid patch rejected
    assert api_client.patch(f"/data/instances/{iid}/flights/{fid}", json={"fields": {"booked_pax": 99999}}).status_code == 422
    # add a column -> every row has it, parameter registered, config hash bumps
    before = api_client.get("/config").json()["hash"]
    r = api_client.post(f"/data/instances/{iid}/columns", json={"entity": "flights", "name": "cargo_priority", "default": 0})
    assert r.status_code == 200 and r.json()["config_version"] >= 2
    t2 = api_client.get(f"/data/instances/{iid}/table/flights").json()
    assert "cargo_priority" in t2["attribute_columns"] and all(x["attr:cargo_priority"] == 0 for x in t2["rows"])
    cfg = api_client.get("/config").json()
    assert cfg["hash"] != before and any(p["name"] == "cargo_priority" and p["scope"] == "flight" for p in cfg["config"]["parameters"])
    # a term can now use it
    terms = cfg["config"]["objective_terms"] + [{"name": "cargo_impact", "level": "L2", "expression": "sum_affected('cargo_priority') * 5", "weight": 1}]
    assert api_client.put("/config/terms", json=terms).status_code == 200
    # disruptions: add by spec, add duplicate -> 409, remove
    r = api_client.post(f"/data/instances/{iid}/disruptions", json={"spec": "aog:" + t["rows"][0]["tail"] + ":600"})
    assert r.status_code == 200 and r.json()["summary"]["disruptions"] == 1
    did = api_client.get(f"/data/instances/{iid}").json()["disruptions"][0]["id"]
    assert api_client.post(f"/data/instances/{iid}/disruptions", json={"spec": "aog:" + t["rows"][0]["tail"] + ":600"}).status_code == 409
    assert api_client.delete(f"/data/instances/{iid}/disruptions/{did}").json()["summary"]["disruptions"] == 0
    assert api_client.get(f"/data/instances/{iid}").json()["aircraft"][0]["status"] == "OK"
