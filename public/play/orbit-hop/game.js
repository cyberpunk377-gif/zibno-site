// ORBIT HOP — one-tap space hopper. Everything (art, sound) is generated in code; no asset files.
'use strict';

const TAU = Math.PI * 2;
const W = 720;               // logical width; height follows the screen shape
const PR = 16;               // player radius
const LAUNCH = 760;          // launch speed px/s
const GRAV = 1.4e7;          // planet pull strength (scaled by planet size)
const SAVE_KEY = 'orbithop_v1';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- YouTube Playables
// Only talk to the SDK inside Playables; everywhere else these are no-ops.
const YT = (typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) ? ytgame : null;
const yt = {
  call(fn) { if (!YT) return undefined; try { return fn(YT); } catch (e) { return undefined; } },
  async load() { const s = await this.call((y) => y.game.loadData()); try { return s ? JSON.parse(s) : null; } catch { return null; } },
  save(obj) { this.call((y) => y.game.saveData(JSON.stringify(obj))?.catch(() => {})); },
  score(n) { this.call((y) => y.engagement.sendScore({ value: Math.floor(n) })?.catch(() => {})); },
  async interstitial() { await this.call((y) => y.ads.requestInterstitialAd()?.catch(() => {})); },
  async rewarded(id) { return !!(await this.call((y) => y.ads.requestRewardedAd(id)?.catch(() => false))); },
};

// ---------------------------------------------------------------- save
const save = Object.assign({ best: 0, stars: 0, skins: [0], skin: 0, muted: false },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch { return {}; } })());
const persist = () => {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
  yt.save(save); // cloud save inside Playables
};
// host audio switch (YouTube's mute) is separate from the in-game SOUND toggle; both must be on
let hostAudio = YT ? !!yt.call((y) => y.system.isAudioEnabled()) : true;

const SKINS = [
  { name: 'NOVA', body: '#ff8a3d', dark: '#b4400e', visor: '#8ff4ff', trail: '255,150,70', cost: 0 },
  { name: 'MINT', body: '#3ee6a8', dark: '#127a55', visor: '#e8fff6', trail: '80,255,180', cost: 25 },
  { name: 'RUBY', body: '#ff3d6e', dark: '#8a0f30', visor: '#ffe0ea', trail: '255,70,120', cost: 60 },
  { name: 'GOLD', body: '#ffd23d', dark: '#9a6a00', visor: '#fff8d8', trail: '255,215,80', cost: 120 },
  { name: 'VOID', body: '#9a6bff', dark: '#3a1a8a', visor: '#c8f0ff', trail: '170,120,255', cost: 200 },
];

// ---------------------------------------------------------------- canvas
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
let H = 1280, scale = 1;
function resize() {
  const ch = innerHeight || 1, cw = Math.min(innerWidth || 1, ch * 9 / 16 * 1.0001);
  if (!innerWidth || !innerHeight) return; // host iframe still laying out
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cvs.style.width = cw + 'px';
  cvs.style.height = ch + 'px';
  cvs.width = Math.round(cw * dpr);
  cvs.height = Math.round(ch * dpr);
  scale = cvs.width / W;
  H = cvs.height / scale;
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- sound (synthesised)
const sfx = {
  ctx: null, out: null, noise: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(this.ctx.destination);
    const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.6, this.ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  },
  tone(f0, f1, vol, dur, type = 'sine', delay = 0) {
    if (!this.ctx || save.muted || !hostAudio) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  hiss(freq, vol, dur, type = 'lowpass') {
    if (!this.ctx || save.muted || !hostAudio) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + dur + 0.05);
  },
  jump() { this.tone(260, 720, 0.25, 0.16, 'triangle'); this.hiss(3000, 0.12, 0.12, 'bandpass'); },
  land(n) { this.tone(180 + n * 18, 120, 0.3, 0.12, 'sine'); this.hiss(900, 0.15, 0.08); },
  star(k) { this.tone(990 + k * 120, 1320 + k * 120, 0.16, 0.12, 'square'); },
  skip() { [660, 880, 1100].forEach((f, i) => this.tone(f, f, 0.14, 0.1, 'triangle', i * 0.06)); },
  die() { this.tone(400, 40, 0.4, 0.7, 'sawtooth'); this.hiss(600, 0.4, 0.5); },
  best() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.16, 0.18, 'triangle', i * 0.09)); },
  click() { this.tone(700, 900, 0.12, 0.05, 'square'); },
};

// ---------------------------------------------------------------- generated art
function sprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  draw(c.getContext('2d'), c.width, c.height);
  return c;
}

const glowCache = new Map();
function glow(rgb, size) {
  const k = rgb + size;
  if (!glowCache.has(k)) {
    glowCache.set(k, sprite(size, size, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      r.addColorStop(0, `rgba(${rgb},0.55)`);
      r.addColorStop(0.35, `rgba(${rgb},0.18)`);
      r.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = r;
      g.fillRect(0, 0, w, w);
    }));
  }
  return glowCache.get(k);
}

const PALETTES = [
  { a: '#ff9a5a', b: '#7a2a10', rim: '255,150,90', kind: 'rock' },
  { a: '#6ad6ff', b: '#123a6a', rim: '110,210,255', kind: 'ice' },
  { a: '#b38bff', b: '#2c1460', rim: '180,140,255', kind: 'gas' },
  { a: '#7dff9a', b: '#0f4a28', rim: '120,255,160', kind: 'rock' },
  { a: '#ffd36a', b: '#6a3a08', rim: '255,210,110', kind: 'gas' },
  { a: '#ff6a8a', b: '#5a0f24', rim: '255,110,140', kind: 'ice' },
];

function planetSprite(r, pal) {
  const pad = 6, s = r * 2 + pad * 2;
  return sprite(s, s, (g) => {
    const c = s / 2;
    g.save();
    g.beginPath();
    g.arc(c, c, r, 0, TAU);
    g.clip();
    const base = g.createRadialGradient(c - r * 0.4, c - r * 0.45, r * 0.1, c, c, r * 1.05);
    base.addColorStop(0, pal.a);
    base.addColorStop(1, pal.b);
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    if (pal.kind === 'gas') {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(255,255,255,${rand(0.05, 0.14)})`;
        const y = c - r + (i + 0.5) * (r * 2 / 6) + rand(-4, 4);
        g.beginPath();
        g.ellipse(c, y, r * 1.1, rand(3, 7), rand(-0.08, 0.08), 0, TAU);
        g.fill();
      }
    } else {
      // craters (rock) or cracks (ice); they make the spin readable
      for (let i = 0; i < 7; i++) {
        const a = rand(0, TAU), d = rand(0, r * 0.75), cr = rand(r * 0.08, r * 0.22);
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
        g.fillStyle = pal.kind === 'ice' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)';
        g.beginPath();
        g.arc(x, y, cr, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.arc(x - cr * 0.25, y - cr * 0.25, cr * 0.55, 0, TAU);
        g.fill();
      }
    }
    // terminator shadow + rim light
    const sh = g.createRadialGradient(c + r * 0.5, c + r * 0.55, r * 0.2, c + r * 0.3, c + r * 0.3, r * 1.4);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(0.6, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(0, 0, s, s);
    g.restore();
    g.strokeStyle = `rgba(${pal.rim},0.9)`;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(c, c, r - 1, 0, TAU);
    g.stroke();
  });
}

const starSprite = sprite(48, 48, (g) => {
  g.translate(24, 24);
  g.fillStyle = '#ffe27a';
  g.strokeStyle = '#fff6c8';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 7.5 : 17;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.stroke();
});

function asteroidSprite(r) {
  return sprite(r * 2 + 6, r * 2 + 6, (g, w) => {
    const c = w / 2;
    g.beginPath();
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * TAU, rr = r * rand(0.72, 1);
      g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
    }
    g.closePath();
    const gr = g.createRadialGradient(c - r * 0.3, c - r * 0.3, 1, c, c, r);
    gr.addColorStop(0, '#9a8f8a');
    gr.addColorStop(1, '#3a3230');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = '#ff5a3a';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(c + r * 0.2, c + r * 0.1, r * 0.25, 0, TAU);
    g.fill();
  });
}

// two nebula backdrops, cross-faded as you climb
function nebula(hues) {
  return sprite(W, 1400, (g, w, h) => {
    g.fillStyle = '#04050d';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = rand(-100, w + 100), y = rand(0, h), r = rand(160, 380), hue = hues[i % hues.length];
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `hsla(${hue},80%,45%,0.22)`);
      gr.addColorStop(1, `hsla(${hue},80%,30%,0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    // make the top and bottom match so it tiles vertically
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(4,5,13,0.9)');
    fade.addColorStop(0.12, 'rgba(4,5,13,0)');
    fade.addColorStop(0.88, 'rgba(4,5,13,0)');
    fade.addColorStop(1, 'rgba(4,5,13,0.9)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
  });
}
const NEBULAS = [nebula([220, 260, 200]), nebula([300, 330, 260]), nebula([170, 190, 140])];
const STARFIELD = [0.15, 0.35, 0.6].map((depth) => ({
  depth,
  pts: Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, 1400), s: rand(0.8, 2.2) * (0.6 + depth), tw: rand(0, TAU) })),
}));

// ---------------------------------------------------------------- world state
let state = 'menu';          // menu | skins | play | dead | over | paused
let planets = [], asteroids = [], pickups = [], parts = [], texts = [];
let player, camY = 0, shake = 0, time = 0, score = 0, runStars = 0, maxId = 0, nextId = 0, newBest = false, overT = 0;
let revived = false, lastSafe = null, gamesOver = 0, adBusy = false;

function makePlanet(x, y, r, id) {
  const pal = PALETTES[id % PALETTES.length];
  const diff = Math.min(1, id / 60);
  const moving = id > 12 && Math.random() < 0.22 + diff * 0.3;
  return {
    id, x, y, r, baseX: x, pal,
    spin: rand(1.0, 1.7) * (1 + diff * 0.7) * (Math.random() < 0.5 ? -1 : 1),
    ang: rand(0, TAU),
    amp: moving ? rand(50, 130) : 0, phase: rand(0, TAU), freq: rand(0.6, 1.1),
    img: planetSprite(r, pal), glowImg: glow(pal.rim, r * 4.4),
  };
}

function addPlanet() {
  const p = planets[planets.length - 1];
  const id = ++nextId;
  const diff = Math.min(1, id / 60);
  const r = rand(36, 60) * (1 - diff * 0.28);
  const y = p.y - rand(240, 320) - diff * 70;
  let x = p.baseX + (Math.random() < 0.5 ? -1 : 1) * rand(110, 300);
  x = clamp(x, 80 + r, W - 80 - r);
  const n = makePlanet(x, y, r, id);
  planets.push(n);
  // a line of stars rewards a clean jump between the two
  if (Math.random() < 0.55) {
    for (const t of [0.32, 0.5, 0.68]) pickups.push({ x: lerp(p.baseX, n.baseX, t), y: lerp(p.y, n.y, t) - 30, got: false, ph: rand(0, TAU) });
  }
  if (id > 5 && Math.random() < 0.25 + diff * 0.4) {
    const ar = rand(14, 22);
    asteroids.push({ x: rand(0, W), y: lerp(p.y, n.y, rand(0.35, 0.65)), r: ar, vx: rand(70, 170) * (1 + diff) * (Math.random() < 0.5 ? -1 : 1), rot: 0, vr: rand(-3, 3), img: asteroidSprite(ar) });
  }
}

function newRun() {
  planets = [];
  asteroids = [];
  pickups = [];
  parts = [];
  texts = [];
  nextId = 0;
  planets.push(makePlanet(W / 2, 0, 58, 0));
  planets[0].amp = 0;
  for (let i = 0; i < 8; i++) addPlanet();
  player = { state: 'orbit', planet: planets[0], ang: -Math.PI / 2, x: 0, y: 0, vx: 0, vy: 0, flyT: 0, from: null, squash: 0, trail: [] };
  camY = planets[0].y - H * 0.7;
  score = 0;
  runStars = 0;
  maxId = 0;
  newBest = false;
  shake = 0;
  revived = false;
  lastSafe = planets[0];
}

function burst(x, y, n, rgb, speed = 260, size = 5, life = 0.6) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(0.3, 1) * speed;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(0.5, 1) * size, rgb });
  }
}
function popText(x, y, s, color = '#fff') { texts.push({ x, y, s, color, t: 0 }); }

// ---------------------------------------------------------------- game flow
// the menu frames the home planet between the title and the PLAY button
function toMenu() {
  newRun();
  camY = planets[0].y - H * 0.47;
  state = 'menu';
}

function startGame() {
  sfx.unlock();
  newRun();
  camY = planets[0].y - H * 0.47; // continue from the menu framing; the play camera eases up from here
  state = 'play';
}

function jump() {
  if (state !== 'play' || player.state !== 'orbit') return;
  const p = player.planet;
  const nx = Math.cos(player.ang), ny = Math.sin(player.ang);
  player.state = 'fly';
  player.from = p;
  player.flyT = 0;
  player.vx = nx * LAUNCH + (p.amp ? Math.cos(time * p.freq + p.phase) * p.amp * p.freq : 0);
  player.vy = ny * LAUNCH;
  sfx.jump();
  burst(player.x - nx * 10, player.y - ny * 10, 10, SKINS[save.skin].trail, 180, 4, 0.35);
}

function land(p) {
  player.state = 'orbit';
  player.planet = p;
  lastSafe = p;
  player.ang = Math.atan2(player.y - p.y, player.x - p.x);
  player.squash = 1;
  shake = Math.max(shake, 0.25);
  burst(player.x, player.y, 12, p.pal.rim, 200, 4, 0.45);
  if (p.id > maxId) {
    const gained = p.id - maxId;
    maxId = p.id;
    score += gained;
    if (gained > 1) { popText(p.x, p.y - p.r - 50, `SKIP +${gained}`, '#ffd36a'); sfx.skip(); }
    else sfx.land(Math.min(score, 20));
    if (score > save.best && !newBest && save.best > 0) { newBest = true; popText(W / 2, camY + H * 0.3, 'NEW BEST!', '#7dff9a'); sfx.best(); }
  } else sfx.land(0);
}

function die() {
  if (player.state === 'dead') return;
  player.state = 'dead';
  state = 'dead';
  overT = 1.1;
  shake = 1;
  burst(player.x, player.y, 40, SKINS[save.skin].trail, 420, 7, 0.9);
  burst(player.x, player.y, 20, '255,255,255', 300, 4, 0.6);
  sfx.die();
  if (score > save.best) save.best = score;
  persist();
  yt.score(score);
}

// stars are banked when the run really ends (a revive keeps them in play)
function endRun() {
  save.stars += runStars;
  runStars = 0;
  persist();
  gamesOver++;
  // a short ad break every third finished run, never in the middle of play
  if (gamesOver % 3 === 0) { adBusy = true; yt.interstitial().finally(() => { adBusy = false; }); }
}

// rewarded ad: one second chance per run, back on the last planet reached
async function revive() {
  if (revived || adBusy) return;
  adBusy = true;
  const ok = await yt.rewarded('revive_once_per_run');
  adBusy = false;
  if (!ok) return;
  revived = true;
  const p = planets.includes(lastSafe) ? lastSafe : planets.find((q) => q.id === maxId) || planets[0];
  player.state = 'orbit';
  player.planet = p;
  player.ang = -Math.PI / 2;
  player.trail.length = 0;
  for (const a of asteroids) if (Math.abs(a.y - p.y) < 200) a.x = a.vx > 0 ? -40 : W + 40;
  camY = p.y - H * 0.68;
  state = 'play';
}

// ---------------------------------------------------------------- update
function update(dt) {
  time += dt;
  shake = Math.max(0, shake - dt * 2.5);
  for (const p of planets) {
    p.ang += p.spin * dt;
    p.x = p.baseX + (p.amp ? Math.sin(time * p.freq + p.phase) * p.amp : 0);
  }
  for (const a of asteroids) {
    a.x += a.vx * dt;
    a.rot += a.vr * dt;
    if (a.x < -40) a.x += W + 80;
    if (a.x > W + 40) a.x -= W + 80;
  }
  for (const k of pickups) k.ph += dt * 3;

  if (state === 'menu' || state === 'skins') {
    // attract mode: the astronaut rides the home planet behind the menu
    if (player) { player.ang += player.planet.spin * dt; placeOnPlanet(); }
  } else if (state === 'play') {
    stepPlayer(dt);
  } else if (state === 'dead') {
    overT -= dt;
    if (overT <= 0) { state = 'over'; if (!YT || revived) endRun(); }
  }

  for (const q of parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; }
  parts = parts.filter((q) => q.life > 0);
  for (const t of texts) { t.t += dt; t.y -= 40 * dt; }
  texts = texts.filter((t) => t.t < 1.2);
}

function placeOnPlanet() {
  const p = player.planet;
  player.x = p.x + Math.cos(player.ang) * (p.r + PR);
  player.y = p.y + Math.sin(player.ang) * (p.r + PR);
}

function stepPlayer(dt) {
  const pl = player;
  pl.squash = Math.max(0, pl.squash - dt * 5);
  if (pl.state === 'orbit') {
    pl.ang += pl.planet.spin * dt;
    placeOnPlanet();
    camY = lerp(camY, Math.min(camY, pl.planet.y - H * 0.68), Math.min(1, dt * 3));
  } else if (pl.state === 'fly') {
    pl.flyT += dt;
    // a few sub-steps keep fast hops from tunnelling through small planets
    const steps = 3, h = dt / steps;
    for (let s = 0; s < steps && pl.state === 'fly'; s++) {
      for (const p of planets) {
        if (p === pl.from && pl.flyT < 0.18) continue;
        const dx = p.x - pl.x, dy = p.y - pl.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
        if (d < p.r * 3.4) {
          const acc = GRAV * (p.r / 50) / Math.max(d2, 400);
          pl.vx += dx / d * acc * h;
          pl.vy += dy / d * acc * h;
        }
        if (d <= p.r + PR && (p !== pl.from || pl.flyT > 0.3)) { land(p); break; }
      }
      const sp = Math.hypot(pl.vx, pl.vy);
      if (sp > 1150) { pl.vx *= 1150 / sp; pl.vy *= 1150 / sp; }
      pl.x += pl.vx * h;
      pl.y += pl.vy * h;
    }
    pl.trail.push({ x: pl.x, y: pl.y });
    if (pl.trail.length > 18) pl.trail.shift();
    camY = lerp(camY, Math.min(camY, pl.y - H * 0.55), Math.min(1, dt * 3));
    for (const a of asteroids) if (Math.hypot(a.x - pl.x, a.y - pl.y) < a.r + PR * 0.8) { die(); return; }
    if (pl.x < -60 || pl.x > W + 60 || pl.y > camY + H + 80 || pl.flyT > 3.2) { die(); return; }
  }
  if (pl.state === 'orbit') pl.trail.length = 0;
  for (const k of pickups) {
    if (!k.got && Math.hypot(k.x - pl.x, k.y - pl.y) < 34) {
      k.got = true;
      runStars++;
      sfx.star(runStars % 5);
      burst(k.x, k.y, 10, '255,226,122', 220, 4, 0.5);
      popText(k.x, k.y - 24, '+1', '#ffe27a');
    }
  }
  // keep the world ahead of the camera, drop what fell far below
  while (planets[planets.length - 1].y > camY - 500) addPlanet();
  const cut = camY + H + 400;
  planets = planets.filter((p) => p.y < cut || p === pl.planet);
  asteroids = asteroids.filter((a) => a.y < cut);
  pickups = pickups.filter((k) => k.y < cut && !k.got);
}

// ---------------------------------------------------------------- draw
function drawBackground() {
  const prog = Math.min(1, score / 40) * (NEBULAS.length - 1);
  const i = Math.floor(prog), f = prog - i;
  for (const [img, a] of [[NEBULAS[i], 1], [NEBULAS[Math.min(i + 1, NEBULAS.length - 1)], f]]) {
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    const off = ((-camY * 0.12) % 1400 + 1400) % 1400;
    for (let y = off - 1400; y < H; y += 1400) ctx.drawImage(img, 0, y);
  }
  ctx.globalAlpha = 1;
  for (const layer of STARFIELD) {
    const off = -camY * layer.depth;
    for (const s of layer.pts) {
      const y = ((s.y + off) % 1400 + 1400) % 1400;
      if (y > H) continue;
      ctx.globalAlpha = 0.45 + 0.4 * Math.sin(time * 2 + s.tw);
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, y, s.s, s.s);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const pl = player, sk = SKINS[save.skin];
  if (!pl || pl.state === 'dead') return;
  for (let i = 0; i < pl.trail.length; i++) {
    const t = pl.trail[i], a = i / pl.trail.length;
    ctx.fillStyle = `rgba(${sk.trail},${a * 0.5})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, PR * a * 0.9, 0, TAU);
    ctx.fill();
  }
  const g = glow(sk.trail, 120);
  ctx.drawImage(g, pl.x - 60, pl.y - 60);
  // body faces away from the planet while orbiting, along velocity while flying
  const ang = pl.state === 'orbit' ? pl.ang : Math.atan2(pl.vy, pl.vx);
  ctx.save();
  ctx.translate(pl.x, pl.y);
  ctx.rotate(ang + Math.PI / 2);
  const sq = 1 - pl.squash * 0.28;
  ctx.scale(1 / sq, sq);
  const body = ctx.createRadialGradient(-5, -6, 2, 0, 0, PR);
  body.addColorStop(0, '#fff');
  body.addColorStop(0.25, sk.body);
  body.addColorStop(1, sk.dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, PR, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0b0f1e';
  ctx.beginPath();
  ctx.ellipse(0, -4, 10, 7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = sk.visor;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(-3, -6, 5, 3, -0.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // little backpack thruster
  ctx.fillStyle = sk.dark;
  ctx.fillRect(-6, PR - 5, 12, 6);
  ctx.restore();
}

function drawAim() {
  const pl = player;
  if (state !== 'play' || pl.state !== 'orbit') return;
  const nx = Math.cos(pl.ang), ny = Math.sin(pl.ang);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 10]);
  ctx.lineDashOffset = -time * 40;
  ctx.beginPath();
  ctx.moveTo(pl.x + nx * 22, pl.y + ny * 22);
  ctx.lineTo(pl.x + nx * 95, pl.y + ny * 95);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWorld() {
  ctx.save();
  const s = shake * shake * 14;
  ctx.translate(rand(-s, s), -camY + rand(-s, s));
  for (const p of planets) {
    if (p.y < camY - 200 || p.y > camY + H + 200) continue;
    ctx.drawImage(p.glowImg, p.x - p.glowImg.width / 2, p.y - p.glowImg.height / 2);
    // faint gravity ring shows where the pull starts
    ctx.strokeStyle = `rgba(${p.pal.rim},0.08)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3.4, 0, TAU);
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    ctx.drawImage(p.img, -p.img.width / 2, -p.img.height / 2);
    ctx.restore();
  }
  for (const k of pickups) {
    if (k.got) continue;
    const b = 1 + Math.sin(k.ph) * 0.12;
    ctx.drawImage(glow('255,220,110', 70), k.x - 35, k.y - 35);
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(Math.sin(k.ph * 0.7) * 0.4);
    ctx.scale(b, b);
    ctx.drawImage(starSprite, -24, -24);
    ctx.restore();
  }
  for (const a of asteroids) {
    ctx.drawImage(glow('255,80,50', a.r * 4), a.x - a.r * 2, a.y - a.r * 2);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rot);
    ctx.drawImage(a.img, -a.img.width / 2, -a.img.height / 2);
    ctx.restore();
  }
  drawAim();
  drawPlayer();
  for (const q of parts) {
    ctx.fillStyle = `rgba(${q.rgb},${q.life / q.max})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.size * (0.4 + q.life / q.max), 0, TAU);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.globalAlpha = 1 - t.t / 1.2;
    text(t.s, t.x, t.y, 34, t.color);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function text(s, x, y, size, color = '#fff', align = 'center') {
  ctx.font = `900 ${size}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(s, x + 3, y + 4);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// ---------------------------------------------------------------- UI
let buttons = [];
function button(id, label, x, y, w, h, opts = {}) {
  buttons.push({ id, x, y, w, h });
  const r = h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  if (opts.ghost) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, opts.c1 || '#ffb15a');
    g.addColorStop(1, opts.c2 || '#ff5a1f');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(255,120,40,0.6)';
    ctx.shadowBlur = 24;
    ctx.fill();
  }
  ctx.restore();
  text(label, x, y + 2, opts.size || 40, '#fff');
}

function coinPill(x, y, n) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(x - 92, y - 26, 184, 52, 26);
  ctx.fill();
  ctx.drawImage(starSprite, x - 86, y - 24);
  text(String(n), x + 16, y + 2, 30, '#ffe27a');
}

function drawTitle(y) {
  const pulse = 1 + Math.sin(time * 2) * 0.02;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.scale(pulse, pulse);
  ctx.drawImage(glow('255,140,60', 520), -260, -200);
  text('ORBIT', 0, -50, 112, '#ffffff');
  const g = ctx.createLinearGradient(0, 20, 0, 120);
  g.addColorStop(0, '#ffd27a');
  g.addColorStop(1, '#ff5a1f');
  text('HOP', 0, 62, 140, g);
  ctx.restore();
}

function drawUI() {
  buttons = [];
  if (state === 'play' || state === 'dead') {
    text(String(score), W / 2, 110, 96, '#fff');
    coinPill(W - 110, 60, runStars);
    if (score === 0 && player.state === 'orbit') {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4);
      text('TAP TO HOP', W / 2, H - 170, 40, '#fff');
      ctx.globalAlpha = 1;
    }
    button('pause', 'II', 64, 60, 72, 64, { ghost: true, size: 28 });
  } else if (state === 'menu') {
    ctx.fillStyle = 'rgba(4,5,13,0.35)';
    ctx.fillRect(0, 0, W, H);
    drawTitle(H * 0.24);
    if (location.hash === '#art') return; // store-art render: title only, no buttons
    text(`BEST ${save.best}`, W / 2, H * 0.24 + 190, 34, '#9fb4ff');
    button('play', 'PLAY', W / 2, H * 0.66, 340, 120, { size: 60 });
    button('skins', 'SKINS', W / 2, H * 0.66 + 130, 260, 84, { ghost: true, size: 34 });
    coinPill(W - 110, 60, save.stars);
    button('mute', save.muted ? 'SOUND OFF' : 'SOUND ON', 130, 60, 220, 60, { ghost: true, size: 22 });
  } else if (state === 'skins') {
    ctx.fillStyle = 'rgba(4,5,13,0.75)';
    ctx.fillRect(0, 0, W, H);
    text('SKINS', W / 2, 150, 80, '#fff');
    coinPill(W - 110, 60, save.stars);
    SKINS.forEach((sk, i) => {
      const x = W / 2 + ((i % 2) - 0.5) * 300 * (i === 4 ? 0 : 1), y = 330 + Math.floor(i / 2) * 230;
      const owned = save.skins.includes(i), sel = save.skin === i;
      buttons.push({ id: 'skin' + i, x, y, w: 260, h: 200 });
      ctx.fillStyle = sel ? 'rgba(255,140,60,0.25)' : 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = sel ? '#ff9a4a' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x - 130, y - 100, 260, 200, 22);
      ctx.fill();
      ctx.stroke();
      ctx.drawImage(glow(sk.trail, 140), x - 70, y - 100);
      const b = ctx.createRadialGradient(x - 8, y - 38, 3, x, y - 30, 34);
      b.addColorStop(0, '#fff');
      b.addColorStop(0.25, sk.body);
      b.addColorStop(1, sk.dark);
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.arc(x, y - 30, 34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0b0f1e';
      ctx.beginPath();
      ctx.ellipse(x, y - 38, 21, 14, 0, 0, TAU);
      ctx.fill();
      text(sk.name, x, y + 30, 30, '#fff');
      text(sel ? 'EQUIPPED' : owned ? 'TAP TO USE' : `★ ${sk.cost}`, x, y + 70, 22, sel ? '#ff9a4a' : owned ? '#9fb4ff' : save.stars >= sk.cost ? '#ffe27a' : '#777');
    });
    button('back', 'BACK', W / 2, H - 120, 260, 84, { ghost: true, size: 34 });
  } else if (state === 'over') {
    ctx.fillStyle = 'rgba(4,5,13,0.72)';
    ctx.fillRect(0, 0, W, H);
    text('LOST IN SPACE', W / 2, H * 0.2, 64, '#ff6a5a');
    text(String(score), W / 2, H * 0.34, 170, '#fff');
    text(newBest ? 'NEW BEST!' : `BEST ${save.best}`, W / 2, H * 0.34 + 120, 38, newBest ? '#7dff9a' : '#9fb4ff');
    coinPill(W / 2, H * 0.52, '+' + runStars);
    if (YT && !revived) {
      button('revive', '▶ CONTINUE', W / 2, H * 0.62, 400, 100, { size: 40, c1: '#7dff9a', c2: '#18a85a' });
      text('watch an ad to keep going', W / 2, H * 0.62 + 70, 22, '#9fb4ff');
      button('retry', 'RETRY', W / 2, H * 0.62 + 160, 300, 96, { size: 44 });
      button('menu', 'MENU', W / 2, H * 0.62 + 270, 240, 76, { ghost: true, size: 30 });
    } else {
      button('retry', 'RETRY', W / 2, H * 0.66, 340, 120, { size: 56 });
      button('menu', 'MENU', W / 2, H * 0.66 + 130, 260, 84, { ghost: true, size: 34 });
    }
  } else if (state === 'paused') {
    ctx.fillStyle = 'rgba(4,5,13,0.7)';
    ctx.fillRect(0, 0, W, H);
    text('PAUSED', W / 2, H * 0.36, 90, '#fff');
    button('resume', 'RESUME', W / 2, H * 0.55, 340, 120, { size: 52 });
    button('menu', 'MENU', W / 2, H * 0.55 + 130, 260, 84, { ghost: true, size: 34 });
  }
}

function onButton(id) {
  sfx.unlock();
  sfx.click();
  if (adBusy) return;
  if (id === 'revive') { revive(); return; }
  // leaving the game-over screen without reviving banks the run's stars
  if (state === 'over' && YT && !revived && (id === 'retry' || id === 'menu')) endRun();
  if (id === 'play' || id === 'retry') startGame();
  else if (id === 'skins') state = 'skins';
  else if (id === 'back' || id === 'menu') toMenu();
  else if (id === 'pause') state = 'paused';
  else if (id === 'resume') state = 'play';
  else if (id === 'mute') { save.muted = !save.muted; persist(); }
  else if (id.startsWith('skin')) {
    const i = +id.slice(4), sk = SKINS[i];
    if (save.skins.includes(i)) save.skin = i;
    else if (save.stars >= sk.cost) { save.stars -= sk.cost; save.skins.push(i); save.skin = i; sfx.best(); }
    persist();
  }
}

// ---------------------------------------------------------------- input
cvs.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const r = cvs.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  for (const b of buttons) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2) { onButton(b.id); return; }
  if (state === 'play') { sfx.unlock(); jump(); }
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (state === 'play') jump();
    else if (state === 'menu') startGame();
    else if (state === 'over') onButton('retry');
    else if (state === 'paused') state = 'play';
  }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') state = 'paused'; });

// ---------------------------------------------------------------- Playables lifecycle
if (YT) {
  yt.call((y) => y.system.onAudioEnabledChange((on) => { hostAudio = on; }));
  yt.call((y) => y.system.onPause(() => {
    if (state === 'play') state = 'paused';
    if (state === 'over' && !revived && runStars) endRun();
    persist();
    if (sfx.ctx) sfx.ctx.suspend();
  }));
  yt.call((y) => y.system.onResume(() => { if (sfx.ctx) sfx.ctx.resume(); }));
}
let firstFrame = true;

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (state !== 'paused') update(dt);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBackground();
  drawWorld();
  drawUI();
  if (firstFrame) {
    firstFrame = false;
    // nothing to download: the menu is playable as soon as it is drawn
    yt.call((y) => y.game.firstFrameReady());
    yt.call((y) => y.game.gameReady());
  }
  requestAnimationFrame(frame);
}
toMenu();
// cloud save wins when it holds more progress than this device
yt.load().then((cloud) => {
  if (cloud && (cloud.best || 0) + (cloud.stars || 0) >= save.best + save.stars) { Object.assign(save, cloud); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* */ } }
});
requestAnimationFrame(frame);
window.__orbit = { get state() { return state; }, get score() { return score; }, get player() { return player; }, get planets() { return planets; }, startGame, jump };
