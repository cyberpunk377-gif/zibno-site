// Records the Voltlane trailer that loops inside the homepage phone (and its poster frame).
// The game's clock is stepped by hand (fake rAF + performance.now), so every frame is exact and smooth.
//   bun tools/trailer_voltlane.ts <framesdir>   -> public/play/voltlane/trailer.mp4 + poster.jpg
import { chromium } from '../../app/node_modules/playwright-core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyFileSync } from 'node:fs';

const dir = process.argv[2];
const FPS = 30, SECS = 14;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 1.5 }); // 9:16, the playfield's own shape
await p.route('**/game_api/**', (r) => r.abort());
await p.addInitScript(() => {
  const w = window as any;
  let now = 0, cbs: FrameRequestCallback[] = [];
  performance.now = () => now;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { cbs.push(cb); return cbs.length; };
  w.__step = (ms: number) => { now += ms; const run = cbs; cbs = []; for (const cb of run) cb(now); };
});
await p.goto(pathToFileURL(join(import.meta.dir, '../public/play/voltlane/index.html')).href);
await p.evaluate(() => (window as any).__step(16));

// the trailer flies the top ship, with a bot at the wheel (same idea as the game's own menu autopilot)
await p.evaluate(() => {
  const V = (window as any).__volt;
  V.save.best = 99999; V.save.ship = 5;
  V.startRun('daily');
  (window as any).__bot = (r: any) => {
    const Y = 1030, ys = (wy: number) => Y - (wy - r.dist);
    let target = r.x, best = 1e9;
    const rows: Record<string, number[]> = {};
    for (const o of r.objs) { const y = ys(o.wy); if (y > Y + 40 || y < Y - 560) continue; const d = Y - y; if (o.k === 'wall') { if (d < best) { best = d; target = (o.gl + o.gr) / 2; } } else (rows[o.wy] = rows[o.wy] || []).push(o.x); }
    for (const wy in rows) { const d = Y - ys(+wy); if (d >= best) continue; const free = [100, 235, 360, 485, 620].filter((s) => !rows[wy].includes(s)).sort((a, c) => Math.abs(a - r.x) - Math.abs(c - r.x)); best = d; target = free[0]; }
    if (best >= 520) { let cd = 1e9; for (const it of r.items) { if (it.got) continue; const y = ys(it.wy); if (y > Y || y < Y - 420) continue; const d = Y - y; if (d < cd) { cd = d; target = it.x; } } }
    r.tx = target;
    if (r.meter >= 100 && r.dashT <= 0 && best < 330) { r.dashT = 0.85; r.meter = 0; r.ready = false; r.fx.flash = 0.3; r.fx.flashCol = '#37f7ff'; } // the DASH button, pressed
  };
});

for (let f = 0; f < FPS * SECS; f++) {
  // two half steps per frame keep the bot's reaction time the same as at 60 fps
  for (let k = 0; k < 2; k++) {
    await p.evaluate((ms) => { const V = (window as any).__volt; if (V.state === 'play' && V.run) (window as any).__bot(V.run); (window as any).__step(ms); }, 500 / FPS);
  }
  const shot = join(dir, `f${String(f).padStart(4, '0')}.jpg`);
  await p.screenshot({ path: shot, type: 'jpeg', quality: 92 });
  if (f === Math.round(FPS * 9.5)) copyFileSync(shot, join(import.meta.dir, '../public/play/voltlane/poster.jpg'));
}
console.log('score', await p.evaluate(() => (window as any).__volt.run && (window as any).__volt.scoreOf((window as any).__volt.run)), 'state', await p.evaluate(() => (window as any).__volt.state));
await b.close();

const out = join(import.meta.dir, '../public/play/voltlane/trailer.mp4');
const ff = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%04d.jpg'),
  '-vf', 'scale=540:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-an', out]);
console.log(ff.success ? 'wrote ' + out : String(ff.stderr));
