const fs = require('fs');
const path = require('path');

const citiesRaw = fs.readFileSync('cities.js', 'utf8');
const jsonStr = citiesRaw.replace(/^\s*const\s+CITIES_DATA\s*=\s*/, '').replace(/;\s*$/, '');
const CITIES_DATA = JSON.parse(jsonStr);

const TOTAL_ROUNDS = 5;
const EPOCH = new Date('2026-06-22T00:00:00');
const SNAPSHOT_FILE = path.join(__dirname, 'checks.snapshot.json');
const SNAPSHOT_DAYS = 3;

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function haversine(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pickTargets(dayOffset) {
  const rng = seededRandom((dayOffset * 2654435761 + 42) ^ 0xdeadbeef);
  const picked = [];
  const used = new Set();
  while (picked.length < TOTAL_ROUNDS) {
    const idx = Math.floor(rng() * CITIES_DATA.length);
    if (used.has(idx)) continue;
    if (parseInt(CITIES_DATA[idx].code.slice(0, 2)) >= 97) continue;
    const [lon, lat] = CITIES_DATA[idx].centre.coordinates;
    const tooClose = picked.some(c => {
      const [lo, la] = c.centre.coordinates;
      return haversine(lo, la, lon, lat) < 150;
    });
    if (!tooClose) { used.add(idx); picked.push(CITIES_DATA[idx]); }
  }
  return picked;
}

function computeSnapshot() {
  const snap = {};
  for (let d = 0; d < SNAPSHOT_DAYS; d++) {
    snap[d] = pickTargets(d).map(c => c.code);
  }
  return snap;
}

const [,, command] = process.argv;

if (command === '--update') {
  const snap = computeSnapshot();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  console.log(`Snapshot updated (${SNAPSHOT_DAYS} days, ${CITIES_DATA.length} cities).`);

} else {
  // ── Seeding snapshot check ─────────────────────────────────────────────────
  process.stdout.write('Seeding snapshot... ');
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    console.log('SKIP (no snapshot file — run with --update to create it)');
    process.exit(0);
  }
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  const actual = computeSnapshot();
  const failures = [];
  for (let d = 0; d < SNAPSHOT_DAYS; d++) {
    const e = expected[d], a = actual[d];
    if (!e || !a || e.join() !== a.join()) {
      failures.push({ day: d + 1, expected: e, actual: a });
    }
  }
  if (failures.length === 0) {
    console.log('OK');
  } else {
    console.log('FAIL');
    failures.forEach(f => {
      console.log(`  Day ${f.day}: expected [${f.expected}], got [${f.actual}]`);
    });
    process.exit(1);
  }
}
