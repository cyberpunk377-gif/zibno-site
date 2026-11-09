// Records the Voltlane trailer that loops inside the homepage phone (and its poster frame): real gameplay, one segment per jet, all 16.
// The game's clock is stepped by hand (fake rAF + performance.now), so every frame is exact and smooth.
//   bun tools/trailer_voltlane.ts <framesdir>   -> public/play/voltlane/trailer.mp4 + poster.jpg
import { chromium } from '../../app/node_modules/playwright-core';
import { join } from 'node:path';
import { copyFileSync } from 'node:fs';

const dir = process.argv[2];
const FPS = 30, INTRO = 45, SEG = 57, OUTRO = 84;
const root = join(import.meta.dir, '../public/play/voltlane');
const server = Bun.serve({ port: 5330, async fetch(q) { const u = new URL(q.url); const f = Bun.file(join(root, u.pathname === '/' ? 'index.html' : u.pathname.slice(1))); return (await f.exists()) ? new Response(f) : new Response('not found', { status: 404 }); } });
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 1.5 }); // 9:16, the playfield's own shape
await p.addInitScript(() => {
  const w = window as any;
  let now = 0, cbs: FrameRequestCallback[] = [], seed = 77;
  performance.now = () => now;
  // same trailer every time it is recorded
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { cbs.push(cb); return cbs.length; };
  w.__step = (ms: number) => { now += ms; const run = cbs; cbs = []; for (const cb of run) cb(now); };
});
await p.goto(`http://localhost:${server.port}/index.html`);
await p.waitForFunction(() => (window as any).__volt, null, { timeout: 15000 });
await Bun.sleep(1500); // Bridge finishes starting up
await p.evaluate(() => (window as any).__step(16));

const count = await p.evaluate(() => {
  const w = window as any, V = w.__volt, order = V.SHIPS.map((_: any, i: number) => i).sort((a: number, c: number) => V.SHIPS[a].need - V.SHIPS[c].need);
  w.__order = order;
  const sprite = (i: number, paint: number) => V.shipSprite(i, paint, 0, 0).toDataURL();
  const title = V.buildTitle().toDataURL();
  const scene = V.sceneCanvas(6).toDataURL();
  document.head.insertAdjacentHTML('beforeend', `<style>
    #ov { position: fixed; inset: 0; pointer-events: none; font-family: "Arial Black", sans-serif; color: #fff; }
    #card { position: absolute; left: 14px; right: 14px; top: 150px; height: 128px; display: flex; align-items: center; gap: 16px; padding: 0 18px; box-sizing: border-box; border-radius: 22px; background: rgba(6,2,26,.8); border: 2px solid; }
    #card img { height: 104px; image-rendering: pixelated; }
    #card small { display: block; font: 800 13px Arial, sans-serif; letter-spacing: 2px; color: #9fb4ff; }
    #card b { display: block; font-size: 38px; line-height: 1.1; }
    #full { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; background-size: cover; image-rendering: pixelated; }
    #full::before { content: ''; position: absolute; inset: 0; background: rgba(4,2,16,.55); }
    #full > * { position: relative; }
    #grid { display: grid; grid-template-columns: repeat(4, 76px); gap: 8px 4px; justify-items: center; }
    #grid img { height: 70px; image-rendering: pixelated; }
    .line { font: 900 19px Arial, sans-serif; letter-spacing: 2px; color: #9fb4ff; text-align: center; }
  </style>`);
  const ov = document.createElement('div'); ov.id = 'ov'; document.body.appendChild(ov);
  // intro: the logo punches in
  w.__intro = (f: number, n: number) => {
    const k = Math.min(1, f / 12), z = 1.45 - 0.45 * (1 - (1 - k) * (1 - k)) + (n - f) * 0.0006;
    ov.innerHTML = `<div id="full" style="background-image:url(${scene})"><img src="${title}" style="width:390px;margin-top:190px;transform:scale(${z})"><div class="line" style="margin-top:30px;opacity:${Math.min(1, Math.max(0, (f - 14) / 8))}">16 JETS<br><br>GUN &nbsp; ROCKETS &nbsp; SABER</div></div>`;
  };
  // one jet: start a run in it, with the first screen of track already on the way
  w.__seg = (k: number) => {
    const i = order[k], pt = (k * 2 + 1) % 3 === 2 ? 0 : (k * 2 + 1) % 3 - 1 + (k % 2);
    const paint = Math.min(2, Math.max(0, pt));
    V.save.best = 1e7; V.save.tip = 2; V.save.ship = i; V.save.paint[i] = paint; V.save.art = (k % 8) + 1;
    V.startRun('free');
    const r = V.run;
    r.dist = 17000 + k * 900; r.nextGen = r.dist + 900; r.patIdx = 5; r.t = 8 + k * 3; r.pts = 900 + k * 2600;
    w.__k = k;
    // a little flying before the camera rolls, so the screen is already full
    for (let n = 0; n < 60; n++) { w.__bot(r); w.__step(1000 / 60); }
    const S = V.SHIPS[i], col = S.paints[paint][4], wp = V.WEAPONS[S.w].label;
    w.__card = (f: number, n: number) => {
      const inK = Math.min(1, f / 6), outK = Math.min(1, (n - 1 - f) / 5), x = (1 - inK * inK) * -420 + (1 - outK) * 420;
      ov.innerHTML = `<div id="card" style="border-color:${col};transform:translateX(${x}px)"><img src="${sprite(i, paint)}"><div><small>JET ${k + 1} OF 16</small><b style="color:${col}">${S.n}</b><small style="color:#fff">${wp}</small></div></div>`;
    };
  };
  // the trailer's pilot sways across the lanes on purpose, so the weapon always has something to hit. It can't crash and never runs dry.
  w.__bot = (r: any) => { r.inv = 0.05; r.hp = 3; r.ammo = 100; r.tx = 360 + 215 * Math.sin(r.t * 2.1 + w.__k); };
  w.__k = 0;
  // the finish: every jet at once
  w.__outro = (f: number, n: number) => {
    const cells = order.map((i: number, j: number) => { const t = Math.max(0, Math.min(1, (f - j * 1.6) / 6)); return `<img src="${sprite(i, 0)}" style="opacity:${t};transform:scale(${1.5 - 0.5 * t})">`; }).join('');
    const tail = Math.min(1, Math.max(0, (f - 34) / 8));
    ov.innerHTML = `<div id="full" style="background-image:url(${scene})"><img src="${title}" style="width:390px;margin-top:6px"><div id="grid" style="margin-top:-8px">${cells}</div><div class="line" style="margin-top:32px;font-size:26px;color:#fff;opacity:${tail}">PLAY FREE</div><div class="line" style="margin-top:8px;font-size:20px;opacity:${tail}">ZIBNOGAMING.COM</div></div>`;
  };
  return order.length as number;
});

let frame = 0;
const snap = async () => { const shot = join(dir, `f${String(frame++).padStart(4, '0')}.jpg`); await p.screenshot({ path: shot, type: 'jpeg', quality: 92 }); return shot; };
for (let f = 0; f < INTRO; f++) { await p.evaluate(([x, n]) => (window as any).__intro(x, n), [f, INTRO]); await snap(); }
for (let k = 0; k < count; k++) {
  await p.evaluate((n) => (window as any).__seg(n), k);
  for (let f = 0; f < SEG; f++) {
    // two half steps per frame keep the pilot's reaction time the same as at 60 fps
    await p.evaluate(([x, n]) => { const w = window as any, V = w.__volt; for (let i = 0; i < 2; i++) { if (V.state === 'play' && V.run) w.__bot(V.run); w.__step(500 / 30); } w.__card(x, n); }, [f, SEG]);
    await snap();
  }
  console.log('jet', k + 1, await p.evaluate(() => { const r = (window as any).__volt.run; return `state ${(window as any).__volt.state}, broken ${r.broken}`; }));
}
let last = '';
for (let f = 0; f < OUTRO; f++) { await p.evaluate(([x, n]) => (window as any).__outro(x, n), [f, OUTRO]); last = await snap(); }
copyFileSync(last, join(root, 'poster.jpg'));
await b.close();
server.stop();

const out = join(root, 'trailer.mp4');
const ff = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%04d.jpg'),
  '-vf', 'scale=540:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-an', out]);
console.log(ff.success ? 'wrote ' + out : String(ff.stderr));
