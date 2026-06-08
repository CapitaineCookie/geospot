// ---- PRNG (self-contained, no dependency on seed.js) ----
function seedFromDate(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function makePrng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function challengeNumber() {
  const origin = new Date("2026-06-08");
  const today = new Date(todayString());
  return Math.floor((today - origin) / 86400000) + 1;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

// ---- Cities ----
const CITIES = CITIES_DATA.map(c => [
  c.centre.coordinates[1],
  c.centre.coordinates[0],
  c.nom,
  c.code,
]);

// Pick 5 distinct cities for today, seeded by date
function pickTodaysCities() {
  const today = todayString();
  const rng = makePrng(seedFromDate("gespot-v2:" + today));
  const candidates = CITIES.filter(c => c);
  // Fisher-Yates shuffle using the seeded PRNG
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Greedy pass: take any city at least 150 km from all already chosen
  const chosen = [];
  for (const city of shuffled) {
    if (chosen.every(c => haversineKm(c, city) >= 150)) chosen.push(city);
    if (chosen.length === 5) break;
  }

  // Fallback (dataset too small to satisfy constraint): fill with any unchosen city
  if (chosen.length < 5) {
    for (const city of shuffled) {
      if (!chosen.includes(city)) chosen.push(city);
      if (chosen.length === 5) break;
    }
  }
  return chosen;
}

// ---- Projection ----
const BOUNDS = { lonMin: -5.2, lonMax: 9.6, latMin: 41.3, latMax: 51.2 };
const PADDING = 40;
let SVG_W = 0, SVG_H = 0;
let _scale = 1, _offX = 0, _offY = 0;
let _vbAnimId = null;
let _currentVB = { x: 0, y: 0, w: 0, h: 0 };

function computeProjection() {
  const COS = Math.cos((46.5 * Math.PI) / 180);
  const mapW = (BOUNDS.lonMax - BOUNDS.lonMin) * COS * 111.32;
  const mapH = (BOUNDS.latMax - BOUNDS.latMin) * 111.32;
  const availW = SVG_W - PADDING * 2;
  const availH = SVG_H - PADDING * 2;
  _scale = Math.min(availW / mapW, availH / mapH);
  _offX = (SVG_W - mapW * _scale) / 2;
  _offY = (SVG_H - mapH * _scale) / 2;
}

function project(lat, lon) {
  const COS = Math.cos((46.5 * Math.PI) / 180);
  return {
    x: (lon - BOUNDS.lonMin) * COS * 111.32 * _scale + _offX,
    y: (BOUNDS.latMax - lat) * 111.32 * _scale + _offY,
  };
}

function fullViewBox() {
  return { x: 0, y: 0, w: SVG_W, h: SVG_H };
}

function setViewBox(vb) {
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  _currentVB = { ...vb };
}

function animateViewBox(from, to, duration, onDone) {
  if (_vbAnimId) cancelAnimationFrame(_vbAnimId);
  const start = performance.now();
  function frame(now) {
    let t = Math.min((now - start) / duration, 1);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const vb = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      w: from.w + (to.w - from.w) * t,
      h: from.h + (to.h - from.h) * t,
    };
    setViewBox(vb);
    if (t < 1) {
      _vbAnimId = requestAnimationFrame(frame);
    } else {
      _vbAnimId = null;
      if (onDone) onDone();
    }
  }
  _vbAnimId = requestAnimationFrame(frame);
}

function zoomToPoints(points, holdMs) {
  const PAD = 80;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  let minX = Math.min(...xs) - PAD;
  let maxX = Math.max(...xs) + PAD;
  let minY = Math.min(...ys) - PAD;
  let maxY = Math.max(...ys) + PAD;

  const svgAspect = SVG_W / SVG_H;
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW / boxH > svgAspect) {
    const extraH = (boxW / svgAspect - boxH) / 2;
    minY -= extraH; maxY += extraH;
  } else {
    const extraW = (boxH * svgAspect - boxW) / 2;
    minX -= extraW; maxX += extraW;
  }

  const target = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const full = fullViewBox();
  animateViewBox(full, target, 600, () => {
    setTimeout(() => animateViewBox(target, full, 600), holdMs);
  });
}

function geoJsonToSvgPath(coords) {
  return coords.map((c, i) => {
    const { x, y } = project(c[1], c[0]);
    return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ") + " Z";
}

// ---- SVG helpers ----
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ---- Normalize ----
function normalize(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-\s]/g, "").toLowerCase();
}
function normalizeNoArticle(str) {
  return normalize(str).replace(/^(le|la|les|l)/, "");
}

// ---- Color by distance ----
function guessColor(km) {
  if (km < 50)  return "#f59e0b";
  if (km < 150) return "#94a3b8";
  return "#e05a2b";
}

// ---- Persistence ----
const dateStr = todayString();
const [_y, _m, _d] = dateStr.split("-");
const displayStr = `${_d}/${_m}/${_y}`;

function saveState() {
  localStorage.setItem("gespot_state", JSON.stringify({
    date: dateStr,
    round: currentRound,
    totalKm,
    results: roundResults.map(r => ({ targetCode: r.target[3], guessCode: r.guess[3], km: r.km })),
    introDismissed,
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem("gespot_state");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.date === dateStr ? data : null;
  } catch { return null; }
}

// ---- State ----
let svg;
const todaysCities = pickTodaysCities();
let currentRound = 0;       // 0-based index into todaysCities
let totalKm = 0;
const roundResults = [];    // { target, guess, km }
let activeIndex = -1;
let awaitingNextRound = false;
let currentRoundLayer = null;
let targetDotShown = false;
let introDismissed = false;


// ---- Init ----
function init() {
  svg = document.getElementById("map-svg");

  function resize() {
    if (_vbAnimId) { cancelAnimationFrame(_vbAnimId); _vbAnimId = null; }
    const rect = svg.getBoundingClientRect();
    SVG_W = rect.width;
    SVG_H = rect.height;
    computeProjection();
    setViewBox(fullViewBox());
    redrawAll();
  }
  new ResizeObserver(resize).observe(svg);
  resize();

  svg.addEventListener("mousemove", onSvgMouseMove);
  svg.addEventListener("mouseleave", () => {
    svg.querySelectorAll(".hover-label").forEach(l => l.classList.remove("visible"));
  });

  document.getElementById("date-display").textContent = displayStr;
  document.getElementById("header-num").textContent = "#" + challengeNumber();
  document.getElementById("intro-challenge").textContent = `Daily challenge #${challengeNumber()}`;
  document.getElementById("intro-date").textContent = displayStr;

  const saved = loadState();
  if (saved) {
    if (saved.introDismissed) {
      restoreState(saved);
    } else {
      showIntro();
    }
  } else {
    showIntro();
  }

  const input = document.getElementById("city-input");
  input.addEventListener("focus", () => { window.scrollTo(0, 0); }, { passive: true });
  input.addEventListener("input", () => { activeIndex = -1; updateSuggestions(); });
  input.addEventListener("keydown", onKeyDown);
  document.getElementById("submit-btn").addEventListener("click", submitGuess);
  document.addEventListener("click", e => {
    if (!e.target.closest(".search-wrapper")) hideSuggestions();
  });
}

// ---- Restore ----
function restoreState(saved) {
  introDismissed = true;
  currentRound = saved.round;
  totalKm = saved.totalKm;

  for (const r of saved.results) {
    const target = CITIES.find(c => c[3] === r.targetCode);
    const guess  = CITIES.find(c => c[3] === r.guessCode);
    if (target && guess) roundResults.push({ target, guess, km: r.km });
  }

  redrawAll();

  document.querySelector(".guess-overlay").classList.add("fade-in");
  document.getElementById("total-score").textContent = totalKm + " km";

  for (const r of roundResults) {
    const kmEl = addGuessRow(r.guess[2], r.km);
    kmEl.style.opacity = "1";
  }

  document.querySelector(".search-wrapper").classList.add("fade-in");

  if (currentRound >= 5) {
    document.getElementById("round-current").textContent = 5;
    document.getElementById("city-input").disabled = true;
    document.getElementById("submit-btn").disabled = true;
    document.getElementById("share-row").classList.remove("hidden");
    document.getElementById("share-row").classList.add("fade-in");
  } else {
    document.getElementById("round-current").textContent = currentRound + 1;
    document.querySelector(".search-wrapper").classList.add("fade-in");
    document.getElementById("city-input").focus();
    showTargetDot(todaysCities[currentRound]);
  }
}

// ---- France outline ----
function redrawFrance() {
  svg.innerHTML = "";
  const defs = svgEl("defs");
  const filter = svgEl("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  const blur = svgEl("feGaussianBlur", { stdDeviation: "3", result: "coloredBlur" });
  const merge = svgEl("feMerge");
  merge.appendChild(svgEl("feMergeNode", { in: "coloredBlur" }));
  merge.appendChild(svgEl("feMergeNode", { in: "SourceGraphic" }));
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const g = svgEl("g");
  const geom = FRANCE_GEOJSON.geometry || FRANCE_GEOJSON.features[0].geometry;
  const multiPoly = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  for (const polygon of multiPoly) {
    const d = polygon.map(ring => geoJsonToSvgPath(ring)).join(" ");
    g.appendChild(svgEl("path", {
      d, fill: "#e8e0d0", stroke: "#b5a98a",
      "stroke-width": "0.8", "fill-rule": "evenodd",
    }));
  }
  svg.appendChild(g);
}

// ---- Redraw on resize — only what's currently visible ----
function redrawAll() {
  redrawFrance();

  if (currentRound >= 5 && roundResults.length === 5) {
    drawSummary();
  } else if (awaitingNextRound && roundResults.length > 0) {
    // Redraw the current round's reveal (no animation)
    const r = roundResults[roundResults.length - 1];
    currentRoundLayer = drawRevealedRound(r.target, r.guess, r.km, false);
  } else if (!awaitingNextRound && currentRound < 5 && introDismissed) {
    showTargetDot(todaysCities[currentRound]);
  }
}

// ---- Nearest-dot hover logic ----
function onSvgMouseMove(e) {
  const rect = svg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const dots = svg.querySelectorAll(".hover-dot");
  let closest = null, closestDist = Infinity;

  for (const g of dots) {
    const circle = g.querySelector("circle");
    if (!circle) continue;
    const cx = parseFloat(circle.getAttribute("cx"));
    const cy = parseFloat(circle.getAttribute("cy"));
    const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
    if (dist < closestDist) {
      closestDist = dist;
      closest = g;
    }
  }

  for (const g of dots) {
    const lbl = g.querySelector(".hover-label");
    if (lbl) lbl.classList.toggle("visible", g === closest && closestDist < 40);
  }
}

// ---- Hover label helper ----
function makeHoverDot(p, fill, stroke, r, label, labelColor, above, strokeWidth = 1.5, alwaysShow = false) {
  const g = svgEl("g");
  g.classList.add("hover-dot");
  const dot = svgEl("circle", { cx: p.x, cy: p.y, r, fill, stroke, "stroke-width": strokeWidth });
  g.appendChild(dot);
  // Transparent larger circle expands the hover hit area
  g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 14, fill: "transparent", stroke: "none" }));
  const lbl = makeSvgLabel(label, p, labelColor, 12, above);
  if (!alwaysShow) lbl.classList.add("hover-label");
  g.appendChild(lbl);
  return { g, dot };
}

// ---- Target dot (anonymous, hollow, no label) ----
function showTargetDot(city, animate = true) {
  const old = document.getElementById("target-layer");
  if (old) old.remove();

  const g = svgEl("g");
  g.id = "target-layer";
  const p = project(city[0], city[1]);
  const dot = svgEl("circle", { cx: p.x, cy: p.y, r: TARGET_R, fill: "none", stroke: "#3b82f6", "stroke-width": "3" });
  if (animate && !targetDotShown) {
    dot.classList.add("dot-anim");
    targetDotShown = true;
  }
  g.appendChild(dot);
  svg.appendChild(g);
}

// ---- Draw a revealed round's elements ----
const ANIM_MS = 1200; // must match draw-line CSS animation duration
const TARGET_R = 4;   // radius of the hollow target dot

function drawRevealedRound(target, guess, km, animate) {
  const color = guessColor(km);
  const pT = project(target[0], target[1]);
  const pG = project(guess[0], guess[1]);

  const g = svgEl("g");
  g.classList.add("round-layer");

  const dx = pG.x - pT.x, dy = pG.y - pT.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Line starts from the border of the target dot, not its center
  const ux = dx / len, uy = dy / len;
  const lineX1 = pT.x + ux * TARGET_R, lineY1 = pT.y + uy * TARGET_R;

  if (animate) {
    const exact = target[3] === guess[3];

    if (exact) {
      // No line, instant reveal
      const { g: tHg } = makeHoverDot(pT, "none", "#3b82f6", TARGET_R, target[2], "#3b82f6", true, 3);
      svg.appendChild(g);
      g.appendChild(tHg);
      const { g: gHg, dot: gDot } = makeHoverDot(pG, color, color, 5, guess[2], color, true, 1.5, true);
      gDot.classList.add("dot-anim");
      g.appendChild(gHg);
      flashKm(km, color);
      return g;
    }

    // Start gold, schedule color swaps at the exact moment the line reaches 50km / 150km
    const lineLen = len - TARGET_R;
    const line = svgEl("line", {
      x1: lineX1, y1: lineY1, x2: pG.x, y2: pG.y,
      stroke: "#f59e0b", "stroke-width": "2", "stroke-dasharray": `${lineLen}`, opacity: "0.9",
    });
    line.style.setProperty("--line-len", lineLen);
    line.classList.add("line-draw");
    g.appendChild(line);
    const { g: tHgAnim } = makeHoverDot(pT, "none", "#3b82f6", TARGET_R, target[2], "#3b82f6", true, 3);
    g.appendChild(tHgAnim);
    svg.appendChild(g);

    if (km > 50)  setTimeout(() => line.setAttribute("stroke", "#94a3b8"), ANIM_MS * (50  / km));
    if (km > 150) setTimeout(() => line.setAttribute("stroke", "#e05a2b"), ANIM_MS * (150 / km));

    setTimeout(() => {
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-dasharray", "4 3");
      line.style.removeProperty("--line-len");

        const { g: gHg, dot: gDot } = makeHoverDot(pG, color, color, 5, guess[2], color, true, 1.5, true);
      gDot.classList.add("dot-anim");
      g.appendChild(gHg);

      drawNearbyLandmarks(g, [target[0], target[1]], km, [[target[0], target[1]], [guess[0], guess[1]]]);
      flashKm(km, color);
      // zoomToPoints([pT, pG], 1800);
    }, 1300);

    return g;

  } else {
    g.appendChild(svgEl("line", {
      x1: lineX1, y1: lineY1, x2: pG.x, y2: pG.y,
      stroke: color, "stroke-width": "2", "stroke-dasharray": "4 3", opacity: "0.9",
    }));
    const { g: tHg } = makeHoverDot(pT, "none", "#3b82f6", TARGET_R, target[2], "#3b82f6", true, 3);
    g.appendChild(tHg);
    const { g: gHg } = makeHoverDot(pG, color, color, 5, guess[2], color, true, 1.5, true);
    g.appendChild(gHg);
    svg.appendChild(g);
    return g;
  }
}

function flashKm(km, color) {
  const el = document.getElementById("km-flash-html");
  el.textContent = `${Math.round(km)} km`;
  el.style.color = color;
  el.classList.remove("playing");
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add("playing");
}

function drawNearbyLandmarks(g, targetLatLon, guessKm, excludeLatLons = []) {
  const nearby = LANDMARKS
    .filter(([lat, lon]) =>
      haversineKm([lat, lon], targetLatLon) < guessKm &&
      !excludeLatLons.some(([elat, elon]) => elat === lat && elon === lon)
    )
    .sort(([latA, lonA], [latB, lonB]) =>
      haversineKm([latA, lonA], targetLatLon) - haversineKm([latB, lonB], targetLatLon)
    )
    .slice(0, 2);
  for (const [lat, lon, name] of nearby) {
    const p = project(lat, lon);
    const color = guessColor(haversineKm([lat, lon], targetLatLon));
    const { g: hg } = makeHoverDot(p, color, color, 4, name, color, true);
    hg.style.opacity = "0.8";
    g.appendChild(hg);
  }
}

function makeSvgLabel(name, p, color, size, above = false) {
  const lbl = svgEl("text", {
    x: p.x, y: above ? p.y - 10 : p.y + 18,
    "text-anchor": "middle",
    fill: color,
    "font-size": "12",
    "font-family": "Segoe UI, system-ui, sans-serif",
    "font-weight": "700",
    "paint-order": "stroke",
    stroke: "#111827",
    "stroke-width": "3",
  });
  lbl.textContent = name;
  return lbl;
}

// ---- Start a round ----
function startRound() {
  targetDotShown = false;
  document.getElementById("round-current").textContent = currentRound + 1;

  if (currentRound === 0) {
    document.querySelector(".guess-overlay").classList.add("fade-in");
    document.querySelector(".search-wrapper").classList.add("fade-in");
    document.getElementById("city-input").focus();
    setTimeout(() => showTargetDot(todaysCities[0]), 400);
  } else {
    showTargetDot(todaysCities[currentRound]);
    document.getElementById("city-input").disabled = false;
    document.getElementById("submit-btn").disabled = false;
    document.getElementById("city-input").focus();
  }
}

// ---- Keyboard ----
function onKeyDown(e) {
  const items = document.querySelectorAll("#suggestions li");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    updateActive(items);
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && items[activeIndex]) {
      document.getElementById("city-input").value = items[activeIndex].textContent;
      hideSuggestions();
      activeIndex = -1;
      submitGuess();
    } else {
      submitGuess();
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
    activeIndex = -1;
  }
}

function updateActive(items) {
  items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
}

// ---- Autocomplete ----
function updateSuggestions() {
  const val = normalize(document.getElementById("city-input").value.trim());
  const box = document.getElementById("suggestions");
  box.innerHTML = "";
  if (val.length < 2) { hideSuggestions(); return; }

  const valNoArticle = normalizeNoArticle(val);
  const matches = CITIES
    .filter(c => {
      const n = normalize(c[2]);
      const nna = normalizeNoArticle(c[2]);
      // Only match if the city itself (or stripped of article) starts with what the user typed
      // This prevents "Le Pertuis" appearing when typing "pertuis"
      return n.startsWith(val) || (nna !== n && nna.startsWith(valNoArticle));
    })
    .slice(0, 6);

  if (!matches.length) { hideSuggestions(); return; }

  matches.forEach(c => {
    const li = document.createElement("li");
    li.textContent = c[2];
    li.addEventListener("mousedown", () => {
      document.getElementById("city-input").value = c[2];
      hideSuggestions();
      activeIndex = -1;
    });
    box.appendChild(li);
  });
  box.style.display = "block";
}

function hideSuggestions() {
  document.getElementById("suggestions").style.display = "none";
}

// ---- Submit guess ----
function submitGuess() {
  if (awaitingNextRound || currentRound >= 5) return;
  const input = document.getElementById("city-input");
  const raw = input.value.trim();
  if (!raw) return;

  const norm = normalize(raw);
  const normNoArt = normalizeNoArticle(raw);
  const target = todaysCities[currentRound];

  // Prefer exact name match; only fall back to no-article match if nothing exact found
  let candidates = CITIES.filter(c => normalize(c[2]) === norm);
  if (!candidates.length) {
    candidates = CITIES.filter(c => {
      const n = normalize(c[2]);
      const nna = normalizeNoArticle(c[2]);
      return nna !== n && nna === normNoArt;
    });
  }

  const guess = candidates.length > 1
    ? candidates.reduce((best, c) => haversineKm(c, target) < haversineKm(best, target) ? c : best)
    : candidates[0];

  if (!guess) { showMessage("City not found.", "error"); return; }

  input.value = "";
  hideSuggestions();
  awaitingNextRound = true;
  document.getElementById("city-input").disabled = true;
  document.getElementById("submit-btn").disabled = true;

  const km = Math.round(haversineKm(guess, target));
  totalKm += km;
  roundResults.push({ target, guess, km });

  // Remove anonymous target dot
  const tLayer = document.getElementById("target-layer");
  if (tLayer) tLayer.remove();

  // Animate reveal — store reference so advanceRound() can remove it
  currentRoundLayer = drawRevealedRound(target, guess, km, true);

  const exact = target[3] === guess[3];
  const revealDelay = exact ? 0 : 1300;
  const nextDelay   = exact ? 300 : 1600;

  // Update score overlay
  const kmEl = addGuessRow(guess[2], km);
  setTimeout(() => {
    kmEl.style.opacity = "1";
    document.getElementById("total-score").textContent = totalKm + " km";
  }, revealDelay);

  currentRound++;
  saveState();

  setTimeout(() => {
    const nextRow = document.getElementById("next-row");
    const nextBtn = document.getElementById("next-btn");
    if (currentRound >= 5) {
      nextBtn.textContent = "Results →";
      nextBtn.onclick = endGame;
    }
    nextRow.classList.remove("hidden");
    nextRow.classList.add("fade-in");
  }, nextDelay);
}

function showIntro() {
  document.getElementById("intro-overlay").classList.remove("hidden");
}

function closeIntro() {
  introDismissed = true;
  document.getElementById("intro-overlay").classList.add("hidden");
  saveState();
  startRound();
}

function advanceRound() {
  document.getElementById("next-row").classList.add("hidden");

  if (currentRoundLayer) {
    currentRoundLayer.remove();
    currentRoundLayer = null;
  }

  document.getElementById("round-current").textContent = currentRound + 1;
  awaitingNextRound = false;
  startRound();
}

// ---- Guess row in overlay ----
function addGuessRow(guessName, km) {
  const color = guessColor(km);
  const li = document.createElement("li");
  li.className = "guess-row";
  li.innerHTML = `
    <span class="guess-city">${guessName}</span>
    <span class="guess-dist" style="color:${color};opacity:0">${km} km</span>`;
  document.getElementById("guess-list").appendChild(li);
  return li.querySelector(".guess-dist");
}

// ---- Summary map (end of game) ----
function drawSummary() {
  const old = document.getElementById("summary-layer");
  if (old) old.remove();

  const g = svgEl("g");
  g.id = "summary-layer";

  for (const { target, guess, km } of roundResults) {
    const color = guessColor(km);
    const pT = project(target[0], target[1]);
    const pG = project(guess[0], guess[1]);
    const exact = target[3] === guess[3];

    if (!exact) {
      const sdx = pG.x - pT.x, sdy = pG.y - pT.y;
      const slen = Math.sqrt(sdx * sdx + sdy * sdy);
      const sux = sdx / slen, suy = sdy / slen;
      g.appendChild(svgEl("line", {
        x1: pT.x + sux * TARGET_R, y1: pT.y + suy * TARGET_R, x2: pG.x, y2: pG.y,
        stroke: color, "stroke-width": "2", "stroke-dasharray": "4 3", opacity: "0.9",
      }));
    }
    const { g: tHg } = makeHoverDot(pT, "none", "#3b82f6", TARGET_R, target[2], "#3b82f6", true, 3);
    g.appendChild(tHg);
    const { g: gHg } = makeHoverDot(pG, color, color, 5, guess[2], color, true, 1.5, true);
    g.appendChild(gHg);
  }

  svg.appendChild(g);
}

// ---- End game ----
function endGame() {
  document.getElementById("next-row").classList.add("hidden");

  if (currentRoundLayer) {
    currentRoundLayer.remove();
    currentRoundLayer = null;
  }
  drawSummary();

  const banner = document.getElementById("celebration-banner");
  document.getElementById("celebration-text").textContent = `🎉 Total: ${totalKm} km`;
  banner.classList.remove("hidden");
  banner.classList.add("banner-in");
  setTimeout(() => {
    banner.classList.add("banner-out");
    setTimeout(() => banner.classList.add("hidden"), 500);
  }, 2500);

  document.getElementById("share-row").classList.remove("hidden");
  document.getElementById("share-row").classList.add("fade-in");
}

// ---- Share ----
function shareEmoji(km) {
  if (km < 50)  return "🟡";
  if (km < 150) return "⚪";
  return "🟠";
}

function shareScore() {
  const lines = roundResults.map(({ km }) => `${shareEmoji(km)} ${km} km`).join("\n");
  const text = `GeoSpot #${challengeNumber()} — ${displayStr}\nhttps://capitainecookie.github.io/geospot/\n\n${lines}\n\nTotal: ${totalKm} km`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("share-btn");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Share your score"; }, 2000);
  });
}

function showMessage(text, type) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ""; el.className = "msg"; }, 2500);
}

window.addEventListener("load", init);

// Keep search bar above keyboard on mobile
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const wrapper = document.querySelector(".search-wrapper");
    if (!wrapper) return;
    const offsetFromBottom = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
    wrapper.style.bottom = offsetFromBottom > 0 ? offsetFromBottom + "px" : "";
  });
}
