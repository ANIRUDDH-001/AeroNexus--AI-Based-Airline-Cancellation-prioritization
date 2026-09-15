// Builds public/geo/south-asia.json — the land behind the network map.
//
// Boundaries follow the Government of India's depiction (Survey of India): the whole of Jammu & Kashmir and
// Ladakh, Aksai Chin and Arunachal Pradesh inside India. Source: Natural Earth 10m "admin_0_countries_ind"
// (India point-of-view variant, public domain). Never use the default "admin_0_countries" file — it draws the
// de-facto lines and cuts Kashmir at the Line of Control.
//
//   node scripts/build-geo.mjs            # downloads ~13 MB, writes public/geo/south-asia.json (~47 KB)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson";
const KEEP = new Set(["India", "Pakistan", "China", "Nepal", "Bhutan", "Bangladesh", "Myanmar", "Sri Lanka", "Afghanistan"]);
const OUT = "public/geo/south-asia.json";

const work = mkdtempSync(join(tmpdir(), "aeronexus-geo-"));
console.log("downloading", SRC);
const world = await (await fetch(SRC)).json();
const raw = { type: "FeatureCollection", features: world.features.filter((f) => KEEP.has(f.properties.ADMIN)).map((f) => ({ type: "Feature", properties: { name: f.properties.ADMIN }, geometry: f.geometry })) };
if (raw.features.length !== KEEP.size) throw new Error(`expected ${KEEP.size} countries, got ${raw.features.length}`);
const rawPath = join(work, "raw.geojson");
writeFileSync(rawPath, JSON.stringify(raw));

// joint simplification keeps shared borders identical; tiny islands of the neighbours go, India keeps all of hers
const simplified = join(work, "simplified.geojson");
execFileSync("npx", ["-y", "mapshaper@0.6.102", rawPath, "-simplify", "6%", "keep-shapes", "-filter-islands", "min-area=200km2", "-o", "format=geojson", "precision=0.001", simplified], { stdio: "inherit", shell: process.platform === "win32" });
const out = JSON.parse(readFileSync(simplified, "utf8"));

const polys = (g) => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]);
const bbox = (p) => { const xs = p.flat().map((q) => q[0]); const ys = p.flat().map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.08);
const india = out.features.find((f) => f.properties.name === "India");
const kept = polys(india.geometry);
let added = 0;
for (const p of polys(raw.features.find((f) => f.properties.name === "India").geometry)) {
  if (kept.some((q) => near(bbox(p), bbox(q)))) continue;
  const ring = [];
  for (const [x, y] of p[0]) { const pt = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]; if (!ring.length || ring.at(-1)[0] !== pt[0] || ring.at(-1)[1] !== pt[1]) ring.push(pt); }
  if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push(ring[0]);
  if (ring.length >= 4) { kept.push([ring]); added += 1; }
}
india.geometry = { type: "MultiPolygon", coordinates: kept };

// d3-geo wants clockwise exterior rings (RFC 7946 output is counter-clockwise); holes the other way
const signed = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
let flipped = 0;
for (const f of out.features) for (const poly of polys(f.geometry)) poly.forEach((ring, i) => { if ((signed(ring) < 0) !== (i === 0)) { ring.reverse(); flipped += 1; } });

writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${out.features.length} countries, India ${kept.length} polygons (+${added} islands), ${flipped} rings rewound, ${readFileSync(OUT).length} bytes`);
