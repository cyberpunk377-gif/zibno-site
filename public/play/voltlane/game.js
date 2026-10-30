// VOLTLANE — a 60-second neon score attack. Steer through gates, chain cores for a multiplier, graze walls to charge DASH.
// Everything (art, sound, music) is generated in code; no asset files, no network, no eval.
// Fair play: fixed 720x1280 playfield, fixed-timestep simulation, and a track that depends only on the seed and the
// distance travelled (never on the frame rate, the screen shape, or visual-effect randomness).
'use strict';

const W = 720, H = 1280;          // the playfield, scaled to fit any screen
const SHIP_Y = 1030, SHIP_R = 15;
const DT = 1 / 120;               // simulation step
const ROUND = 60;                 // seconds
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const vr = Math.random;           // visual randomness ONLY; gameplay uses the seeded rng below
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const C = { bg: '#06021a', mag: '#ff2e93', cyan: '#37f7ff', lime: '#a6ff3d', gold: '#ffd23d', vio: '#8a5bff', white: '#ffffff' };

// ---------------------------------------------------------------- YouTube Playables
// Only talk to the SDK inside Playables; everywhere else these are no-ops.
const YT = (typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV) ? ytgame : null;
const yt = {
  call(fn) { if (!YT) return undefined; try { return fn(YT); } catch (e) { return undefined; } },
  async load() { try { const s = await this.call((y) => y.game.loadData()); return s ? JSON.parse(s) : null; } catch { return null; } },
  save(obj) { this.call((y) => y.game.saveData(JSON.stringify(obj))?.catch(() => {})); },
  score(n) { this.call((y) => y.engagement.sendScore({ value: Math.floor(n) })?.catch(() => {})); },
  async interstitial() { await this.call((y) => y.ads.requestInterstitialAd()?.catch(() => {})); },
  async rewarded(id) { return !!(await this.call((y) => y.ads.requestRewardedAd(id)?.catch(() => false))); },
};
// an ad request that never answers must not leave the buttons dead
const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

// ---------------------------------------------------------------- save (Playables cloud save only; tiny)
// saveData must wait for loadData, so anything saved before the load finishes is held back (dirty) and flushed after.
const save = { best: 0, plays: 0, ship: 0, d: { day: 0, best: 0, ghost: '' } };
let loaded = !YT, dirty = false;
const persist = () => {
  if (!loaded) { dirty = true; return; }
  yt.save(save);
};
// the host's audio switch (YouTube's mute button) is the only sound control
let hostAudio = YT ? !!yt.call((y) => y.system.isAudioEnabled()) : true;

// ---------------------------------------------------------------- ranks and the daily rival bots
const TIERS = [['BRONZE', 0, '#d99a5b'], ['SILVER', 8000, '#cfd8e3'], ['GOLD', 20000, C.gold], ['PLATINUM', 40000, '#7df3e1'], ['DIAMOND', 65000, '#6ab7ff'], ['APEX', 95000, C.mag]];
const tierOf = (s) => { let t = TIERS[0]; for (const x of TIERS) if (s >= x[1]) t = x; return t; };
const tierIdx = (s) => TIERS.indexOf(tierOf(s));
// Flight styles: six ships, one unlocked per rank tier. They differ in hull, trail and dash aura ONLY. Hitbox, speed and
// steering are identical for every ship, so the leaderboard stays fair and nobody can buy or grind an edge.
const SHIPS = [
  { n: 'STRIKER', col: '#ff9a3d', trail: 'dots', hull: [[0, -24], [17, 18], [0, 9], [-17, 18]] },
  { n: 'WRAITH', col: '#cfd8e3', trail: 'ribbon', hull: [[0, -32], [8, 4], [15, 20], [0, 12], [-15, 20], [-8, 4]] },
  { n: 'SOLAR', col: C.gold, trail: 'sparks', hull: [[0, -22], [18, 15], [7, 10], [0, 21], [-7, 10], [-18, 15]] },
  { n: 'GLACIER', col: '#7df3e1', trail: 'snow', hull: [[0, -27], [13, -5], [10, 19], [0, 10], [-10, 19], [-13, -5]] },
  { n: 'VORTEX', col: '#6ab7ff', trail: 'twin', hull: [[-7, -27], [0, -14], [7, -27], [18, 16], [0, 6], [-18, 16]] },
  { n: 'APEX', col: C.mag, trail: 'rainbow', hull: [[0, -27], [7, -11], [19, -17], [16, 16], [0, 8], [-16, 16], [-19, -17], [-7, -11]] },
];
const shipUnlocked = (i) => save.best >= TIERS[i][1];
const curShip = () => (shipUnlocked(save.ship | 0) ? save.ship | 0 : 0);
// a flawless run scores about 120k, so the ladder tops out below that
const RIVALS = [['ARC-7', 8000], ['KILO', 20000], ['VANTA', 40000], ['ZENITH', 65000]];
const today = () => Math.floor(Date.now() / 86400000);
// rival bots (not real players): their targets change every day, so there is always someone to chase
function rivalsFor(day) { const r = mulberry32(day * 31 + 7); return RIVALS.map(([n, s]) => ({ n, s: Math.round(s * (0.85 + 0.3 * r()) / 10) * 10 })); }
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// ---------------------------------------------------------------- canvas: fit the playfield, centred
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
let bs = 1; // backing-store pixels per logical pixel
function resize() {
  if (!innerWidth || !innerHeight) return; // host iframe still laying out
  const fit = Math.min(innerWidth / W, innerHeight / H);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cvs.style.width = W * fit + 'px';
  cvs.style.height = H * fit + 'px';
  cvs.width = Math.round(W * fit * dpr);
  cvs.height = Math.round(H * fit * dpr);
  bs = cvs.width / W;
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- sound (synthesised) + music
const sfx = {
  ctx: null, out: null, noise: null, quiet: false, // quiet = the menu's demo flight makes no sound
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !hostPaused) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = hostAudio ? 0.5 : 0;
    this.out.connect(this.ctx.destination);
    const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  },
  setHost(on) { hostAudio = on; if (this.out) this.out.gain.setValueAtTime(on ? 0.5 : 0, this.ctx.currentTime); },
  tone(f0, f1, vol, dur, type = 'sine', delay = 0) {
    if (!this.ctx || !hostAudio || this.quiet) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  hiss(freq, vol, dur, type = 'highpass', delay = 0) {
    if (!this.ctx || !hostAudio || this.quiet) return;
    const t = this.ctx.currentTime + delay, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + dur + 0.05);
  },
  core(combo) { const k = Math.min(combo, 24); this.tone(700 + k * 38, 1100 + k * 52, 0.14, 0.09, 'square'); },
  graze() { this.hiss(4200, 0.13, 0.16, 'bandpass'); this.tone(900, 1700, 0.08, 0.1, 'triangle'); },
  hit() { this.tone(220, 40, 0.4, 0.5, 'sawtooth'); this.hiss(700, 0.35, 0.4, 'lowpass'); },
  dash() { this.tone(180, 1400, 0.22, 0.45, 'sawtooth'); this.hiss(2500, 0.18, 0.45, 'bandpass'); },
  ready() { [880, 1320].forEach((f, i) => this.tone(f, f, 0.14, 0.12, 'triangle', i * 0.07)); },
  shield() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.15, 0.14, 'triangle', i * 0.06)); },
  best() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.16, 0.18, 'triangle', i * 0.09)); },
  deny() { this.tone(160, 120, 0.2, 0.12, 'square'); },
  click() { this.tone(700, 900, 0.12, 0.05, 'square'); },
};
// a small procedural beat that gets busier with the combo; scheduled from the game loop so pausing stops it
const music = {
  next: 0, i: 0,
  reset() { this.next = 0; this.i = 0; },
  update(combo) {
    const a = sfx.ctx;
    if (!a || !hostAudio || a.state !== 'running') return;
    if (this.next < a.currentTime) this.next = a.currentTime + 0.05;
    while (this.next < a.currentTime + 0.18) {
      const s = this.i % 16, bar = Math.floor(this.i / 16) % 4, dly = this.next - a.currentTime;
      if (s % 4 === 0) sfx.tone(130, 42, 0.3, 0.14, 'sine', dly);
      if (s % 4 === 2) sfx.hiss(7000, 0.05, 0.04, 'highpass', dly);
      const root = 55 * Math.pow(2, [0, 0, 3, 5][bar] / 12);
      if ([0, 3, 6, 10, 12].includes(s)) sfx.tone(root, root * 0.98, 0.14, 0.16, 'triangle', dly);
      if (combo >= 6 && s % 2 === 0) { const n = [0, 3, 7, 10, 12, 10, 7, 3][(s / 2) % 8]; sfx.tone(root * 4 * Math.pow(2, n / 12), root * 4 * Math.pow(2, n / 12), 0.045, 0.07, 'square', dly); }
      this.next += 0.1; this.i++;
    }
  },
};

// ---------------------------------------------------------------- the run (pure simulation: seed + inputs -> score)
const speedAt = (d) => 560 + 700 * clamp(d / 52000, 0, 1);
const diffAt = (d) => clamp(d / 45000, 0, 1);
const multOf = (c) => Math.min(8, 1 + Math.floor(c / 6));
const SLOTS = [100, 235, 360, 485, 620];

function newRun(mode, seed) {
  return {
    mode, seed, ship: curShip(), rng: mulberry32(seed), t: 0, dist: 0, pts: 0, dpts: 0, combo: 0, maxCombo: 0, hp: 3, meter: 0, dashT: 0, inv: 0,
    x: W / 2, tx: W / 2, vx: 0, objs: [], items: [], nextGen: 900, lastGap: W / 2, patIdx: 0,
    grazes: 0, cores: 0, hits: 0, over: null, revived: false, ghostRec: [], ghostPlay: null, step: 0,
    // effects (visual only)
    fx: { parts: [], pops: [], shake: 0, flash: 0, flashCol: C.mag, trail: [] },
  };
}
const scoreOf = (r) => Math.floor(r.pts + r.dpts);

// ---- the track: patterns placed in WORLD distance, generated ahead of the ship
function gapWall(r, wy, cx, gapW, h = 44) { r.objs.push({ k: 'wall', wy, h, gl: cx - gapW / 2, gr: cx + gapW / 2, gz: [false, false] }); }
function genPattern(r) {
  const rng = r.rng, y = r.nextGen, d = diffAt(y), v = speedAt(y);
  let kind;
  if (r.patIdx < 3) kind = 'gap';
  else if (r.patIdx % 12 === 9) kind = 'gap';
  else { const x = rng(); kind = x < 0.40 ? 'gap' : x < 0.60 ? 'posts' : x < 0.80 ? 'slalom' : 'double'; }
  const spacing = v * lerp(0.62, 0.5, d);
  let len = 0;
  if (kind === 'gap') {
    const gapW = r.patIdx < 3 ? 400 : lerp(340, 190, d), shift = lerp(240, 430, d);
    const cx = clamp(r.lastGap + (rng() * 2 - 1) * shift, gapW / 2 + 30, W - gapW / 2 - 30);
    gapWall(r, y, cx, gapW);
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: cx, wy: y - 60 - 62 * i, got: false });
    if (r.patIdx % 12 === 9) r.items.push({ k: 'shield', x: cx, wy: y - 330, got: false });
    r.lastGap = cx; len = 44;
  } else if (kind === 'posts') {
    const pick = () => { const idx = [0, 1, 2, 3, 4]; for (let i = 4; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return { occ: idx.slice(0, 3), free: idx.slice(3) }; };
    const a = pick();
    let b = pick();
    for (let tries = 0; tries < 8; tries++) { if (a.free.some((f) => b.free.some((g) => Math.abs(SLOTS[f] - SLOTS[g]) <= 270))) break; b = pick(); }
    for (const s of a.occ) r.objs.push({ k: 'post', x: SLOTS[s], wy: y, r: 34, gz: [false] });
    for (const s of b.occ) r.objs.push({ k: 'post', x: SLOTS[s], wy: y + 170, r: 34, gz: [false] });
    const fa = SLOTS[a.free[0]], fb = SLOTS[b.free.find((g) => Math.abs(SLOTS[g] - fa) <= 270) ?? b.free[0]];
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: lerp(fa, fb, i / 3), wy: y + 40 + 40 * i, got: false });
    r.lastGap = fb; len = 238;
  } else if (kind === 'slalom') {
    const gapW = lerp(320, 230, d), A = lerp(150, 215, d), ph = rng() * TAU, c = [];
    for (let i = 0; i < 5; i++) { c.push(clamp(W / 2 + A * Math.sin(ph + i * 1.15), gapW / 2 + 30, W - gapW / 2 - 30)); gapWall(r, y + i * 200, c[i], gapW, 36); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) r.items.push({ k: 'core', x: lerp(c[i], c[i + 1], (j + 0.5) / 2), wy: y + i * 200 + 36 + 55 + j * 55, got: false });
    r.lastGap = c[4]; len = 4 * 200 + 36;
  } else { // double: two gaps on opposite sides, with a line of cores between
    const gapW = lerp(300, 200, d), left = rng() < 0.5;
    const c1 = left ? 180 + rng() * 120 : 420 + rng() * 120, c2 = left ? 420 + rng() * 120 : 180 + rng() * 120;
    gapWall(r, y, c1, gapW); gapWall(r, y + 330, c2, gapW);
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: lerp(c1, c2, (i + 0.5) / 4), wy: y + 44 + 55 + 55 * i, got: false });
    r.lastGap = c2; len = 330 + 44;
  }
  r.patIdx++;
  r.nextGen = y + len + spacing;
}

const sy = (r, wy) => SHIP_Y - (wy - r.dist); // world distance -> screen y
function pop(r, x, y, txt, col, size = 30) { r.fx.pops.push({ x, y, txt, col, size, age: 0 }); }
function burst(r, x, y, n, col, speed, size = 5, life = 0.6) {
  const P = r.fx.parts;
  for (let i = 0; i < n && P.length < 500; i++) { const a = vr() * TAU, s = speed * (0.3 + vr() * 0.7); P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, col, size }); }
}
function hurt(r) {
  if (r.inv > 0 || r.dashT > 0) return;
  r.hp--; r.hits++; r.combo = 0; r.inv = 1.3;
  r.fx.shake = 1; r.fx.flash = 0.5; r.fx.flashCol = C.mag;
  burst(r, r.x, SHIP_Y, 30, C.mag, 520, 6, 0.7);
  sfx.hit();
  if (r.hp <= 0) { r.hp = 0; r.over = 'dead'; r.fx.shake = 1.4; burst(r, r.x, SHIP_Y, 60, C.white, 700, 7, 1); }
}
function graze(r, x, y) {
  const m = multOf(r.combo);
  r.pts += 25 * m; r.grazes++;
  if (r.dashT <= 0) r.meter = Math.min(100, r.meter + 22);
  pop(r, x, y, '+' + 25 * m, C.cyan, 26);
  burst(r, x, y, 6, C.cyan, 260, 3, 0.35);
  sfx.graze();
  if (r.meter >= 100 && !r.ready) { r.ready = true; sfx.ready(); pop(r, r.x, SHIP_Y - 70, 'DASH READY', C.lime, 30); }
}
function dist2rect(px, py, x0, y0, x1, y1) { const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1); return Math.hypot(dx, dy); }

/** one fixed simulation step. inp = { key: -1..1, dash: boolean } */
function step(r, inp) {
  if (r.over) { stepFx(r, 0, false); return; }
  r.t += DT; r.step++;
  const dashing = r.dashT > 0;
  const v = speedAt(r.dist) * (dashing ? 1.8 : 1);
  r.dist += v * DT;
  r.dpts += v * DT / 16;
  if (inp.dash && r.meter >= 100 && r.dashT <= 0) { r.dashT = 0.85; r.meter = 0; r.ready = false; r.fx.flash = 0.35; r.fx.flashCol = C.cyan; sfx.dash(); }
  if (r.dashT > 0) r.dashT = Math.max(0, r.dashT - DT);
  r.inv = Math.max(0, r.inv - DT);
  // steering: the target follows touch / mouse drag / keys; the ship chases it at a capped speed
  r.tx = clamp(r.tx + inp.key * 1800 * DT, 24, W - 24);
  const dx = clamp(r.tx - r.x, -2200 * DT, 2200 * DT);
  r.x += dx; r.vx = dx / DT;
  // generate ahead
  while (r.nextGen - r.dist < SHIP_Y + 260) genPattern(r);
  const dashNow = r.dashT > 0, m = multOf(r.combo);
  // walls and posts
  for (const o of r.objs) {
    const y1 = sy(r, o.wy);
    if (o.k === 'wall') {
      const top = y1 - o.h, bot = y1;
      if (bot < SHIP_Y - 80 || top > SHIP_Y + 80) continue;
      const dl = dist2rect(r.x, SHIP_Y, 0, top, o.gl, bot), dr = dist2rect(r.x, SHIP_Y, o.gr, top, W, bot);
      for (let s = 0; s < 2; s++) {
        const d = s ? dr : dl;
        if (d < SHIP_R && !dashNow) hurt(r);
        else if (d < SHIP_R + 26 && !o.gz[s]) { o.gz[s] = true; graze(r, r.x + (s ? 30 : -30), SHIP_Y - 30); }
      }
    } else if (o.k === 'post') {
      if (y1 < SHIP_Y - 100 || y1 > SHIP_Y + 100) continue;
      const d = Math.hypot(r.x - o.x, SHIP_Y - y1) - o.r;
      if (d < SHIP_R && !dashNow) hurt(r);
      else if (d < SHIP_R + 26 && !o.gz[0]) { o.gz[0] = true; graze(r, o.x, y1 - 40); }
    }
  }
  // cores and pickups (dash pulls them in)
  for (const it of r.items) {
    if (it.got) continue;
    const y = sy(r, it.wy);
    if (y < SHIP_Y - 190 || y > SHIP_Y + 60) continue;
    const reach = dashNow ? 150 : it.k === 'shield' ? 40 : 34;
    if (Math.hypot(r.x - it.x, SHIP_Y - y) < reach) {
      it.got = true;
      if (it.k === 'core') {
        r.combo++; r.cores++; r.maxCombo = Math.max(r.maxCombo, r.combo);
        const gain = 50 * multOf(r.combo) * (dashNow ? 2 : 1);
        r.pts += gain; if (!dashNow) r.meter = Math.min(100, r.meter + 3);
        if (multOf(r.combo) > m) { pop(r, r.x, SHIP_Y - 90, 'x' + multOf(r.combo), C.gold, 44); r.fx.flash = 0.18; r.fx.flashCol = C.gold; }
        else if (r.combo % 3 === 0) pop(r, it.x, y - 30, '+' + gain, C.cyan, 24);
        burst(r, it.x, y, 5, C.cyan, 220, 3, 0.35);
        sfx.core(r.combo);
      } else {
        if (r.hp < 3) { r.hp++; pop(r, r.x, SHIP_Y - 90, '+1 SHIELD', C.lime, 32); } else { r.pts += 300; pop(r, r.x, SHIP_Y - 90, '+300', C.lime, 32); }
        burst(r, it.x, y, 20, C.lime, 380, 4, 0.6); sfx.shield();
      }
    }
  }
  // cull what is behind the ship
  if (r.step % 60 === 0) {
    r.objs = r.objs.filter((o) => sy(r, o.wy) < H + 120);
    r.items = r.items.filter((it) => !it.got && sy(r, it.wy) < H + 80);
  }
  // ghost: the ship's x at 30 Hz, one byte each
  if (r.step % 4 === 0) r.ghostRec.push(Math.round(r.x / W * 255));
  stepFx(r, v, true);
  if (r.t >= ROUND) r.over = 'time';
}
// visual effects (never feed back into the simulation); they keep playing for a moment after the run ends
function stepFx(r, v, emit) {
  const F = r.fx;
  F.shake = Math.max(0, F.shake - DT * 2.6); F.flash = Math.max(0, F.flash - DT * 1.6);
  if (emit && r.step % 2 === 0 && F.trail.length < 40) F.trail.push({ x: r.x, y: SHIP_Y + 16, life: 0.32 });
  if (emit && r.step % 3 === 0) {
    const k = SHIPS[r.ship | 0].trail;
    if (k === 'sparks') F.parts.length < 500 && F.parts.push({ x: r.x + (vr() - 0.5) * 12, y: SHIP_Y + 18, vx: (vr() - 0.5) * 120, vy: 160 + vr() * 160, life: 0.45, max: 0.45, col: vr() < 0.5 ? C.gold : '#ff8a3d', size: 4 });
    else if (k === 'snow') F.parts.length < 500 && F.parts.push({ x: r.x + (vr() - 0.5) * 30, y: SHIP_Y + 14, vx: (vr() - 0.5) * 60, vy: 90 + vr() * 90, life: 0.7, max: 0.7, col: '#e8fffb', size: 3 });
  }
  for (const t of F.trail) { t.life -= DT * 2; t.y += v * DT * 2; }
  F.trail = F.trail.filter((t) => t.life > 0);
  for (const p of F.parts) { p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.985; p.vy *= 0.985; p.life -= DT; }
  F.parts = F.parts.filter((p) => p.life > 0);
  for (const p of F.pops) { p.age += DT; p.y -= 60 * DT; }
  F.pops = F.pops.filter((p) => p.age < 0.8);
}

// headless harness for tests (no rendering): same seed + same policy -> same score
function runHeadless(seed, policy, maxSteps = ROUND / DT + 5) {
  const r = newRun('free', seed);
  for (let i = 0; i < maxSteps && !r.over; i++) { const inp = { key: 0, dash: false }; policy(r, inp); step(r, inp); }
  return { score: scoreOf(r), over: r.over, t: r.t, cores: r.cores, grazes: r.grazes, hits: r.hits, maxCombo: r.maxCombo };
}

// ---------------------------------------------------------------- menu autopilot (attract mode)
let demo = null;
function botSteer(r, inp) {
  const ys = (wy) => SHIP_Y - (wy - r.dist);
  let target = r.x, best = 1e9;
  const rows = {};
  for (const o of r.objs) {
    const y = ys(o.wy);
    if (y > SHIP_Y + 40 || y < SHIP_Y - 560) continue;
    const d = SHIP_Y - y;
    if (o.k === 'wall') { if (d < best) { best = d; target = (o.gl + o.gr) / 2; } } else (rows[o.wy] = rows[o.wy] || []).push(o.x);
  }
  for (const wy in rows) {
    const d = SHIP_Y - ys(+wy);
    if (d >= best) continue;
    const free = SLOTS.filter((s) => !rows[wy].includes(s)).sort((a, b) => Math.abs(a - r.x) - Math.abs(b - r.x));
    best = d; target = free[0];
  }
  if (best >= 520) {
    let cd = 1e9;
    for (const it of r.items) { if (it.got) continue; const y = ys(it.wy); if (y > SHIP_Y || y < SHIP_Y - 420) continue; const d = SHIP_Y - y; if (d < cd) { cd = d; target = it.x; } }
  }
  if (r.meter >= 100 && best < 300) inp.dash = true;
  r.tx = target;
}

// ---------------------------------------------------------------- game flow
let state = 'menu';               // menu | play | over | paused
let run = null, last = null;      // last = the finished run's summary for the results screen
let gamesOver = 0, adBusy = false, hostPaused = false, looping = false;
let time = 0;                     // wall-ish clock for menu animation (advances in frame)
let keys = { l: false, r: false };
let steerId = null, steerX0 = 0, steerTx0 = 0, dashQueued = false;
let newBest = false, bestBefore = 0;

function startRun(mode) {
  const day = today();
  const seed = mode === 'daily' ? day * 7919 + 12345 : (Math.random() * 2147483647) | 0;
  run = newRun(mode, seed);
  if (mode === 'daily' && save.d.day === day && save.d.ghost) {
    try { const s = atob(save.d.ghost); run.ghostPlay = Uint8Array.from(s, (c) => c.charCodeAt(0)); } catch { run.ghostPlay = null; }
  }
  run.rivals = rivalsFor(day);
  steerId = null; dashQueued = false; newBest = false; bestBefore = save.best;
  music.reset();
  state = 'play';
}
function finishRun() {
  const r = run, sc = scoreOf(r);
  save.plays++;
  newBest = sc > save.best;
  if (newBest) { save.best = sc; sfx.best(); }
  // reaching a new rank unlocks (and equips) that rank's flight style
  const unlock = newBest && tierIdx(sc) > tierIdx(bestBefore) ? tierIdx(sc) : -1;
  if (unlock >= 0) { save.ship = unlock; view = unlock; }
  const day = today();
  if (r.mode === 'daily') {
    if (save.d.day !== day) save.d = { day, best: 0, ghost: '' };
    if (sc > save.d.best) {
      save.d.best = sc;
      let s = ''; for (const b of r.ghostRec) s += String.fromCharCode(b);
      save.d.ghost = btoa(s);
    }
  }
  persist();
  if (newBest) yt.score(sc); // only a new best is sent, so the leaderboard value always equals the saved best
  const rivals = r.rivals.map((x) => ({ ...x, you: false }));
  rivals.push({ n: 'YOU', s: sc, you: true });
  rivals.sort((a, b) => b.s - a.s);
  last = { score: sc, over: r.over, t: r.t, mode: r.mode, rank: rivals.findIndex((x) => x.you) + 1, rivals, cores: r.cores, grazes: r.grazes, maxCombo: r.maxCombo, hits: r.hits, unlock, canRevive: r.over === 'dead' && !r.revived && r.t < ROUND - 8, tier: tierOf(sc) };
  state = 'over';
}
// leaving the results screen counts the run and, every third run, takes an ad break BEFORE the next screen starts
function leaveRun() {
  gamesOver++;
  if (gamesOver % 3 !== 0) return Promise.resolve();
  adBusy = true;
  return race(yt.interstitial(), 45000).finally(() => { adBusy = false; });
}
async function revive() {
  if (adBusy || !last || !last.canRevive) return;
  adBusy = true;
  const ok = await race(yt.rewarded('revive_once_per_run'), 90000);
  adBusy = false;
  if (!ok) return;
  const r = run;
  r.revived = true; r.over = null; r.endT = 0; r.hp = 2; r.inv = 2.2; r.combo = 0;
  // clear the next stretch so the revive is not an instant death
  r.objs = r.objs.filter((o) => sy(r, o.wy) < SHIP_Y - 520 || sy(r, o.wy) > SHIP_Y + 100);
  save.plays--; // finishRun counts it again
  state = 'play';
}

// ---------------------------------------------------------------- drawing helpers
function text(s, x, y, size, color = '#fff', align = 'center', weight = 900) {
  ctx.font = `${weight} ${size}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(s, x + 3, y + 4);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
let buttons = [];
function button(id, label, x, y, w, h, opts = {}) {
  buttons.push({ id, x, y, w, h });
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  if (opts.ghost) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();
  } else {
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, opts.c1 || '#ff5fb0'); g.addColorStop(1, opts.c2 || '#c4136b');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
  text(label, x, y + 2, opts.size || 40, '#fff');
  if (opts.sub) text(opts.sub, x, y + h / 2 + 24, 22, '#9fb4ff', 'center', 700);
}

function drawBackground(dist, speed, dash) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0326'); g.addColorStop(1, '#1a0636');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // perspective-less neon grid: lanes + scrolling cross lines
  ctx.strokeStyle = 'rgba(138,91,255,0.16)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 90) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  const off = dist % 90;
  for (let y = off; y < H; y += 90) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // far stars scroll slower
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const s of STARS) { const y = (s.y + dist * s.z) % H; ctx.fillRect(s.x, y, s.s, s.s * (1 + speed / 700)); }
  if (dash) { ctx.strokeStyle = 'rgba(55,247,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); for (let i = 0; i < 26; i++) { const x = (i * 83.3) % W, y = ((i * 211 + dist * 2.2) % H); ctx.moveTo(x, y); ctx.lineTo(x, y + 90); } ctx.stroke(); }
}
const STARS = (() => { const r = mulberry32(99); return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, z: 0.1 + r() * 0.25, s: 1 + r() * 2 })); })();

function neonRect(x0, y0, x1, y1, col) {
  if (x1 <= x0) return;
  ctx.fillStyle = '#16072e'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = 12; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1; ctx.lineWidth = 3.5; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}
function drawWorld(r) {
  for (const o of r.objs) {
    const y = sy(r, o.wy);
    if (y < -120 || y > H + 120) continue;
    if (o.k === 'wall') { neonRect(-6, y - o.h, o.gl, y, C.mag); neonRect(o.gr, y - o.h, W + 6, y, C.mag); }
    else {
      ctx.beginPath(); ctx.arc(o.x, y, o.r, 0, TAU); ctx.fillStyle = '#16072e'; ctx.fill();
      ctx.strokeStyle = C.vio; ctx.globalAlpha = 0.3; ctx.lineWidth = 14; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.arc(o.x, y, 9, 0, TAU); ctx.fillStyle = C.vio; ctx.fill();
    }
  }
  const pulse = 1 + 0.12 * Math.sin(time * 9);
  for (const it of r.items) {
    if (it.got) continue;
    const y = sy(r, it.wy);
    if (y < -40 || y > H + 40) continue;
    if (it.k === 'core') {
      const s = 13 * pulse;
      ctx.beginPath(); ctx.moveTo(it.x, y - s); ctx.lineTo(it.x + s * 0.75, y); ctx.lineTo(it.x, y + s); ctx.lineTo(it.x - s * 0.75, y); ctx.closePath();
      ctx.fillStyle = C.cyan; ctx.globalAlpha = 0.25; ctx.lineWidth = 10; ctx.strokeStyle = C.cyan; ctx.stroke(); ctx.globalAlpha = 1; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(it.x, y, 22 * pulse, 0, TAU); ctx.strokeStyle = C.lime; ctx.lineWidth = 5; ctx.stroke();
      text('+', it.x, y + 1, 30, C.lime);
    }
  }
}
function drawShip(x, y, vx, alpha, style, inv, dash, body = '#fff', scale = 1, colOverride = null) {
  const S = SHIPS[style], col = colOverride || S.col, blink = inv > 0 && Math.floor(inv * 14) % 2 ? 0.35 : 1;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(clamp(vx / 2600, -0.45, 0.45)); ctx.scale(scale, scale);
  if (dash) { // each flight style has its own dash aura
    ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = style === 5 ? C.mag : C.cyan; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.stroke();
    if (style >= 4) { ctx.globalAlpha = alpha * 0.4; ctx.beginPath(); ctx.arc(0, 0, 50 + 4 * Math.sin(time * 20), 0, TAU); ctx.stroke(); }
  }
  ctx.beginPath(); S.hull.forEach(([hx, hy], i) => (i ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy))); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha * blink * 0.35; ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.stroke();
  ctx.globalAlpha = alpha * blink; ctx.fillStyle = dash ? C.cyan : body; ctx.fill();
  ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 2, 3.5, 0, TAU); ctx.fillStyle = col; ctx.fill(); // cockpit light in the style colour
  ctx.restore();
}
// the ship's wake: P = [{x, y, life}] oldest first. dots / snow / sparks are particle trails, the rest are ribbons.
function drawTrail(P, kind, col, dash) {
  if (!P.length) return;
  const c1 = dash ? C.cyan : col;
  ctx.lineCap = 'round';
  if (kind === 'dots' || kind === 'snow' || kind === 'sparks') {
    for (const t of P) { ctx.globalAlpha = clamp(t.life * 2, 0, 1) * (kind === 'dots' ? 0.6 : 0.3); ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(t.x, t.y, (kind === 'dots' ? 6 : 4) * t.life * 3, 0, TAU); ctx.fill(); }
  } else {
    for (const o of kind === 'twin' ? [-9, 9] : [0]) {
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i];
        ctx.globalAlpha = clamp(b.life * 2.4, 0, 1) * 0.85;
        ctx.strokeStyle = kind === 'rainbow' ? `hsl(${(i * 14 + time * 240) % 360},100%,62%)` : c1;
        ctx.lineWidth = Math.max(2, 33 * b.life) * (kind === 'twin' ? 0.55 : 1);
        ctx.beginPath(); ctx.moveTo(a.x + o, a.y); ctx.lineTo(b.x + o, b.y); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}
function drawFx(r, noPops) {
  const F = r.fx, S = SHIPS[r.ship | 0];
  drawTrail(F.trail, S.trail, S.col, r.dashT > 0);
  for (const p of F.parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  if (!noPops) for (const p of F.pops) { ctx.globalAlpha = 1 - p.age / 0.8; text(p.txt, p.x, p.y, p.size, p.col); }
  ctx.globalAlpha = 1;
}
function nextRival(r) {
  const sc = scoreOf(r), list = r.rivals.slice().sort((a, b) => a.s - b.s);
  return list.find((x) => x.s > sc) || null;
}
function drawHud(r) {
  const sc = scoreOf(r), m = multOf(r.combo);
  const sh = ctx.createLinearGradient(0, 0, 0, 270); sh.addColorStop(0, 'rgba(6,2,26,0.88)'); sh.addColorStop(0.75, 'rgba(6,2,26,0.7)'); sh.addColorStop(1, 'rgba(6,2,26,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, 270);
  text(fmt(sc), W / 2, 104, 84, '#fff');
  const nr = nextRival(r);
  if (nr) text(`${nr.n} (BOT)  ${fmt(nr.s)}`, W / 2, 166, 24, '#9fb4ff', 'center', 700);
  else text('YOU LEAD THE BOTS', W / 2, 166, 24, C.lime, 'center', 700);
  // time bar
  const f = clamp(r.t / ROUND, 0, 1), bx = 100, bw = 520;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, 198, bw, 10);
  ctx.fillStyle = f > 0.8 ? C.mag : C.cyan; ctx.fillRect(bx, 198, bw * f, 10);
  text(String(Math.max(0, Math.ceil(ROUND - r.t))), W / 2, 238, 30, '#fff');
  // combo
  text('x' + m, 652, 104, 56, m >= 4 ? C.gold : '#fff', 'center');
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(612, 142, 80, 8);
  ctx.fillStyle = C.gold; ctx.fillRect(612, 142, 80 * (m >= 8 ? 1 : (r.combo % 6) / 6), 8);
  // shields
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(64 + i * 44, 1204, 15, 0, TAU);
    ctx.fillStyle = i < r.hp ? C.lime : 'rgba(255,255,255,0.12)'; ctx.fill();
  }
  // dash meter + button
  const ready = r.meter >= 100;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(40, 1244, 300, 14);
  ctx.fillStyle = ready ? C.lime : C.cyan; ctx.fillRect(40, 1244, 300 * (r.meter / 100), 14);
  ctx.beginPath(); ctx.arc(DASHB.x, DASHB.y, DASHB.r, 0, TAU);
  ctx.fillStyle = ready ? 'rgba(166,255,61,0.28)' : 'rgba(255,255,255,0.06)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = ready ? C.lime : 'rgba(255,255,255,0.3)'; ctx.stroke();
  text('DASH', DASHB.x, DASHB.y + 2, 28, ready ? C.lime : 'rgba(255,255,255,0.6)');
  button('pause', 'II', 56, 104, 72, 64, { ghost: true, size: 28 });
}
const DASHB = { x: 604, y: 1150, r: 82 };

function drawTitle(y) {
  const p = 1 + Math.sin(time * 2) * 0.02;
  // a soft pulsing glow behind the logo
  const gl = ctx.createRadialGradient(W / 2, y, 10, W / 2, y, 330); gl.addColorStop(0, `rgba(255,46,147,${0.22 + 0.08 * Math.sin(time * 2.4)})`); gl.addColorStop(1, 'rgba(255,46,147,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, y - 330, W, 660);
  ctx.save(); ctx.translate(W / 2, y); ctx.scale(p, p);
  text('VOLT', 0, -58, 140, '#fff');
  const g = ctx.createLinearGradient(-200, 0, 200, 0); g.addColorStop(0, C.cyan); g.addColorStop(1, C.mag);
  text('LANE', 0, 58, 140, g);
  ctx.restore();
}

// the ship the menu shows / equips (the one you are looking at in the hangar, if it is unlocked)
let view = 0;
const menuShip = () => (shipUnlocked(view) ? view : curShip());
function viewShip(d) {
  view = (view + d + SHIPS.length) % SHIPS.length;
  if (shipUnlocked(view)) { save.ship = view; persist(); }
}
function drawHangar() {
  const S = SHIPS[view], ok = shipUnlocked(view), x0 = 110, y0 = 560, w = 500, h = 270;
  ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
  ctx.strokeStyle = ok ? S.col : 'rgba(255,255,255,0.25)'; ctx.globalAlpha = 0.7; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
  // the ship hovers over a glowing pad, with its own wake
  const cx = W / 2, cy = 665 + Math.sin(time * 2.2) * 6;
  const pad = ctx.createRadialGradient(cx, 760, 4, cx, 760, 120); pad.addColorStop(0, ok ? S.col : '#556'); pad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.35; ctx.fillStyle = pad; ctx.beginPath(); ctx.ellipse(cx, 760, 120, 26, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = ok ? 1 : 0.4;
  const P = []; for (let i = 0; i < 14; i++) P.push({ x: cx + Math.sin(time * 3 - i * 0.35) * 8, y: cy + 46 + (13 - i) * 5.5, life: 0.32 * (i / 13) });
  P.reverse(); P.sort((a, b) => a.life - b.life);
  if (ok) drawTrail(P, S.trail, S.col, false);
  drawShip(cx, cy, Math.sin(time * 1.6) * 500, ok ? 1 : 0.45, view, 0, false, ok ? '#fff' : '#334', 2.5);
  ctx.globalAlpha = 1;
  text(S.n, cx, 785, 36, ok ? S.col : '#7d86a8');
  text(ok ? (view === curShip() ? 'EQUIPPED' : 'TAP TO EQUIP') : `LOCKED  -  REACH ${TIERS[view][0]}`, cx, 815, 20, ok ? '#9fb4ff' : '#ff8ab4', 'center', 700);
  button('prev', '<', 58, 695, 76, 100, { ghost: true, size: 44 });
  button('next', '>', W - 58, 695, 76, 100, { ghost: true, size: 44 });
  for (let i = 0; i < SHIPS.length; i++) { // which ship you are looking at
    ctx.beginPath(); ctx.arc(cx + (i - 2.5) * 30, 862, i === view ? 8 : 5, 0, TAU);
    ctx.fillStyle = shipUnlocked(i) ? SHIPS[i].col : 'rgba(255,255,255,0.2)'; ctx.globalAlpha = i === view ? 1 : 0.6; ctx.fill(); ctx.globalAlpha = 1;
  }
}
function drawMenu() {
  // the demo flight plays behind (see draw()); dim it so the menu reads
  const dim = ctx.createLinearGradient(0, 0, 0, H); dim.addColorStop(0, 'rgba(4,2,16,0.8)'); dim.addColorStop(0.55, 'rgba(4,2,16,0.55)'); dim.addColorStop(1, 'rgba(4,2,16,0.82)');
  ctx.fillStyle = dim; ctx.fillRect(0, 0, W, H);
  drawTitle(235);
  text('60-SECOND SCORE ATTACK', W / 2, 395, 26, '#9fb4ff', 'center', 700);
  if (location.hash === '#art') return; // store-art render: title only, no buttons
  const day = today(), tier = tierOf(save.best), ti = tierIdx(save.best);
  const db = save.d.day === day ? save.d.best : 0;
  // rank badge + best score
  ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + TAU / 12; ctx.lineTo(228 + 36 * Math.cos(a), 482 + 36 * Math.sin(a)); } ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill(); ctx.strokeStyle = tier[2]; ctx.lineWidth = 4; ctx.stroke();
  text(String(ti + 1), 228, 484, 34, tier[2]);
  text(tier[0], 285, 468, 34, tier[2], 'left');
  text(`BEST ${fmt(save.best)}`, 285, 505, 24, '#fff', 'left', 800);
  drawHangar();
  // DAILY RUN pulses; the countdown shows when the track changes
  const secs = Math.floor(86400 - (Date.now() / 1000) % 86400), hh = String(Math.floor(secs / 3600)).padStart(2, '0'), mm = String(Math.floor(secs / 60) % 60).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  const pulseR = 1 + 0.035 * Math.sin(time * 4);
  ctx.save(); ctx.translate(W / 2, 985); ctx.scale(pulseR, pulseR); ctx.beginPath(); ctx.roundRect(-232, -66, 464, 132, 66); ctx.strokeStyle = C.mag; ctx.globalAlpha = 0.4; ctx.lineWidth = 8; ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
  button('daily', 'DAILY RUN', W / 2, 985, 440, 120, { size: 54 });
  text(db ? `TODAY'S BEST ${fmt(db)}   -   NEW TRACK IN ${hh}:${mm}:${ss}` : `SAME TRACK FOR EVERYONE   -   NEW IN ${hh}:${mm}:${ss}`, W / 2, 1066, 20, '#9fb4ff', 'center', 700);
  button('free', 'FREE RUN', W / 2, 1150, 320, 84, { ghost: true, size: 38 });
  text('DRAG TO STEER   -   TAP DASH WHEN READY', W / 2, 1236, 20, 'rgba(159,180,255,0.8)', 'center', 700);
}
function drawOver() {
  const L = last;
  ctx.fillStyle = 'rgba(4,2,16,0.8)'; ctx.fillRect(0, 0, W, H);
  text(L.over === 'time' ? "TIME'S UP" : 'WRECKED', W / 2, 150, 66, L.over === 'time' ? C.cyan : C.mag);
  text(fmt(L.score), W / 2, 290, 150, '#fff');
  text(newBest ? 'NEW BEST!' : `BEST ${fmt(save.best)}`, W / 2, 390, 36, newBest ? C.lime : '#9fb4ff');
  text(L.tier[0], W / 2, 438, 32, L.tier[2]);
  text(`CORES ${L.cores}   GRAZES ${L.grazes}   MAX COMBO ${L.maxCombo}`, W / 2, 490, 22, 'rgba(255,255,255,0.75)', 'center', 700);
  // the ladder vs the daily rival bots
  text(`RANK ${L.rank} OF ${L.rivals.length}`, W / 2, 548, 30, C.gold);
  L.rivals.forEach((x, i) => {
    const y = 600 + i * 46;
    if (x.you) { ctx.fillStyle = 'rgba(55,247,255,0.16)'; ctx.fillRect(150, y - 21, 420, 42); }
    text(`${i + 1}  ${x.n}${x.you ? '' : ' (BOT)'}`, 170, y, 26, x.you ? C.cyan : '#cfd6ff', 'left', 800);
    text(fmt(x.s), 550, y, 26, x.you ? C.cyan : '#cfd6ff', 'right', 800);
  });
  if (L.unlock >= 0) { // a new rank: its flight style is unlocked and equipped
    drawShip(W / 2 - 175, 838, 0, 1, L.unlock, 0, false, '#fff', 1.1);
    text(`NEW SHIP  ${SHIPS[L.unlock].n}`, W / 2 - 135, 838, 30, SHIPS[L.unlock].col, 'left');
  }
  if (YT && L.canRevive) {
    button('revive', '▶ REVIVE', W / 2, 920, 420, 100, { size: 40, c1: '#7dff9a', c2: '#18a85a' });
    text('watch an ad to keep going', W / 2, 988, 22, '#9fb4ff', 'center', 700);
    button('retry', 'RETRY', W / 2, 1090, 320, 90, { size: 42 });
    button('menu', 'MENU', W / 2, 1195, 240, 70, { ghost: true, size: 30 });
  } else {
    button('retry', 'RETRY', W / 2, 960, 360, 110, { size: 52 });
    button('menu', 'MENU', W / 2, 1090, 260, 80, { ghost: true, size: 34 });
  }
}
function drawPaused() {
  ctx.fillStyle = 'rgba(4,2,16,0.75)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, 480, 90, '#fff');
  button('resume', 'RESUME', W / 2, 700, 360, 110, { size: 52 });
  button('menu', 'MENU', W / 2, 840, 260, 84, { ghost: true, size: 34 });
}

// ---------------------------------------------------------------- loop
function draw() {
  ctx.setTransform(bs, 0, 0, bs, 0, 0);
  buttons = [];
  const r = run;
  const sh = r && state !== 'menu' ? r.fx.shake : 0;
  ctx.save();
  if (sh > 0) ctx.translate((vr() - 0.5) * 26 * sh, (vr() - 0.5) * 26 * sh);
  if (r && state !== 'menu') {
    drawBackground(r.dist, speedAt(r.dist), r.dashT > 0);
    drawWorld(r);
    if (r.ghostPlay && r.t < ROUND) { const gi = Math.min(r.ghostPlay.length - 1, Math.floor(r.t * 30)); drawShip(r.ghostPlay[gi] / 255 * W, SHIP_Y, 0, 0.3, r.ship, 0, false, '#b9a6ff', 1, C.vio); }
    drawFx(r);
    if (r.over !== 'dead' && state !== 'over') drawShip(r.x, SHIP_Y, r.vx, 1, r.ship, r.inv, r.dashT > 0);
    if (r.fx.flash > 0) { ctx.globalAlpha = r.fx.flash * 0.5; ctx.fillStyle = r.fx.flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  } else if (demo) {
    // the menu is alive: an autopilot flies the track behind it, in the ship you are looking at
    drawBackground(demo.dist, speedAt(demo.dist), demo.dashT > 0);
    drawWorld(demo); drawFx(demo, true);
    drawShip(demo.x, SHIP_Y, demo.vx, 1, demo.ship, demo.inv, demo.dashT > 0);
  } else {
    drawBackground(time * 220, 600, false);
  }
  ctx.restore();
  if (state === 'play') drawHud(r);
  else if (state === 'menu') drawMenu();
  else if (state === 'over') drawOver();
  else if (state === 'paused') drawPaused();
  if (state === 'play' && r.t < 1.2) text('GO!', W / 2, 600, 120, C.gold);
}

let acc = 0, firstFrame = true;
function frame(now) {
  if (hostPaused) { looping = false; return; }
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now; time += dt;
  if (state === 'play') {
    acc += dt;
    let n = 0;
    const key = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    while (acc >= DT && n < 12) {
      step(run, { key, dash: dashQueued });
      dashQueued = false; acc -= DT; n++;
    }
    if (n >= 12) acc = 0;
    music.update(run.combo);
    // the run is over: let the explosion / finish play for a moment, then show the results
    if (run.over) { run.endT = (run.endT || 0) + dt; if (run.endT > (run.over === 'dead' ? 0.9 : 0.4)) finishRun(); }
  } else if (state === 'menu') {
    // attract mode: the autopilot flies a seeded track behind the menu (silent; it never touches the player's run or save)
    acc += dt;
    let n = 0;
    sfx.quiet = true;
    while (acc >= DT && n < 12) {
      if (!demo || demo.over) demo = newRun('free', 4242);
      demo.ship = menuShip();
      const inp = { key: 0, dash: false };
      botSteer(demo, inp);
      step(demo, inp);
      acc -= DT; n++;
    }
    sfx.quiet = false;
    if (n >= 12) acc = 0;
  } else acc = 0;
  draw();
  if (firstFrame) {
    firstFrame = false;
    // nothing to download: the menu is playable as soon as it is drawn
    yt.call((y) => y.game.firstFrameReady());
    yt.call((y) => y.game.gameReady());
  }
  requestAnimationFrame(frame);
}
let lastNow = performance.now();
function startLoop() {
  if (looping) return;
  looping = true;
  lastNow = performance.now();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input (per pointer: one finger steers, another can DASH)
const toLogical = (e) => { const b = cvs.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
async function onButton(id) {
  sfx.unlock();
  sfx.click();
  if (adBusy) return;
  if (id === 'revive') { revive(); return; }
  if (state === 'over' && (id === 'retry' || id === 'menu')) await leaveRun();
  if (id === 'daily') startRun('daily');
  else if (id === 'free') startRun('free');
  else if (id === 'retry') startRun(last ? last.mode : 'free');
  else if (id === 'menu') { state = 'menu'; run = null; view = curShip(); }
  else if (id === 'prev') viewShip(-1);
  else if (id === 'next') viewShip(1);
  else if (id === 'pause') state = 'paused';
  else if (id === 'resume') state = 'play';
}
cvs.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  const [x, y] = toLogical(e);
  if (state === 'play' && Math.hypot(x - DASHB.x, y - DASHB.y) < DASHB.r + 24) {
    if (run.meter >= 100) dashQueued = true; else sfx.deny();
    return;
  }
  for (const b of buttons) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2) { onButton(b.id); return; }
  if (state === 'play' && steerId === null) { steerId = e.pointerId; steerX0 = x; steerTx0 = run.tx; cvs.setPointerCapture?.(e.pointerId); }
});
cvs.addEventListener('pointermove', (e) => {
  if (state !== 'play' || e.pointerId !== steerId) return;
  const [x] = toLogical(e);
  run.tx = clamp(steerTx0 + (x - steerX0) * 1.3, 24, W - 24);
});
const endPointer = (e) => { if (e.pointerId === steerId) steerId = null; };
cvs.addEventListener('pointerup', endPointer);
cvs.addEventListener('pointercancel', endPointer);
addEventListener('keydown', (e) => {
  if (state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { sfx.unlock(); sfx.click(); viewShip(e.code === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.l = true; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.r = true; e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault(); sfx.unlock();
    if (state === 'play') { if (run.meter >= 100) dashQueued = true; else sfx.deny(); }
    else if (state === 'menu') onButton('daily');
    else if (state === 'over') onButton('retry');
    else if (state === 'paused') state = 'play';
  }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; }
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.l = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.r = false;
});

// ---------------------------------------------------------------- Playables lifecycle
// onPause / onResume are the only pause signals (no Page Visibility API, no blur/focus). Paused = nothing runs:
// the loop (simulation AND drawing) stops, audio is suspended; onResume restarts the loop with a fresh clock.
if (YT) {
  yt.call((y) => y.system.onAudioEnabledChange((on) => { sfx.setHost(on); }));
  yt.call((y) => y.system.onPause(() => {
    hostPaused = true;
    if (state === 'play') state = 'paused'; // come back to the pause screen, not mid-run
    persist();
    if (sfx.ctx) sfx.ctx.suspend();
  }));
  yt.call((y) => y.system.onResume(() => {
    hostPaused = false;
    if (sfx.ctx) sfx.ctx.resume();
    startLoop();
  }));
}

// loadData first, then saveData is allowed. The cloud save wins when it holds more progress than this session so far.
yt.load().then((cloud) => {
  if (cloud && typeof cloud.best === 'number' && cloud.best >= save.best) { Object.assign(save, cloud); if (!save.d) save.d = { day: 0, best: 0, ghost: '' }; }
  view = curShip();
  loaded = true;
  if (dirty) { dirty = false; persist(); }
});
startLoop();
window.__volt = { get state() { return state; }, get run() { return run; }, get last() { return last; }, get save() { return save; }, startRun, runHeadless, step, newRun, scoreOf, speedAt };
