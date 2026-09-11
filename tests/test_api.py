from __future__ import annotations


def test_health_and_config(api_client):
    h = api_client.get("/health").json()
    assert h["status"] == "ok" and len(h["config_hash"]) == 16 and h["config_version"] == 1
    cfg = api_client.get("/config").json()
    assert cfg["hash"] == h["config_hash"]
    assert len(cfg["config"]["objective_terms"]) == 18
    assert len(api_client.get("/config/plugins").json()) >= 17
    assert "pax_cancelled" in api_client.get("/config/metrics").json()["metrics"]


def test_generate_state_and_instances(api_client):
    r = api_client.post("/data/generate", json={"size": "small", "seed": 2, "disruptions": ["fog:DEL", "crew:DEL:3:420"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["issues"] == [] and body["summary"]["flights"] > 50
    iid = body["id"]
    assert [i["id"] for i in api_client.get("/data/instances").json()] == [iid]
    st = api_client.get("/state", params={"instance_id": iid, "t": 400}).json()
    assert st["clock"] == 400 and len(st["instance"]["disruptions"]) == 2
    full = api_client.get(f"/data/instances/{iid}").json()
    assert full["name"] == "synthetic-small-seed2"
    # import roundtrip
    r2 = api_client.post("/data/import", json=full)
    assert r2.status_code == 200 and r2.json()["id"] != iid
    assert api_client.delete(f"/data/instances/{iid}").json() == {"deleted": iid}
    assert api_client.get(f"/data/instances/{iid}").status_code == 404
    assert api_client.post("/data/generate", json={"size": "small", "disruptions": ["volcano:DEL"]}).status_code == 422


def test_config_edit_versioning_and_validation(api_client):
    cfg = api_client.get("/config").json()
    terms = cfg["config"]["objective_terms"]
    terms[0]["weight"] += 1
    r = api_client.put("/config/terms", json=terms)
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["hash"] != cfg["hash"]
    assert api_client.get("/health").json()["config_version"] == 2
    # add a user term referencing an attribute column (the §15.2 flow)
    terms.append({"name": "vip_impact", "level": "L2", "expression": "sum_affected('vip_count') * 300", "weight": 1})
    assert api_client.put("/config/terms", json=terms).status_code == 200
    # unsafe / unknown expressions are rejected and nothing is saved
    bad = [dict(terms[0], name="evil", expression="__import__('os').system('x')")]
    assert api_client.put("/config/terms", json=bad).status_code == 422
    unknown = [dict(terms[0], name="unknown", expression="not_a_metric + 1")]
    r = api_client.put("/config/terms", json=unknown)
    assert r.status_code == 422 and "unknown" in str(r.json()["detail"])
    assert api_client.get("/config").json()["version"] == 3
    # search settings and presets
    s = api_client.get("/config").json()["config"]["search"]
    s["K"] = 7
    assert api_client.put("/config/search", json=s).json()["config"]["search"]["K"] == 7
    assert api_client.post("/config/presets/demo").status_code == 200
    names = {p["name"] for p in api_client.get("/config/presets").json()}
    assert names == {"current", "demo"}
    s["K"] = 1
    api_client.put("/config/search", json=s)
    assert api_client.post("/config/presets/demo/load").json()["config"]["search"]["K"] == 7
    assert api_client.post("/config/presets/nope/load").status_code == 404
    # dry-run validation endpoint
    v = api_client.post("/config/validate", json={"terms": unknown}).json()
    assert v["ok"] is False and "objective_terms" in v["problems"]
    assert api_client.post("/config/reset").json()["version"] > 1
