// Records the Orbit Hop trailer that loops inside the homepage phone.
// The game's clock is stepped by hand (fake rAF + performance.now), so every frame is exact and smooth.
//   bun tools/trailer.ts <framesdir>   -> public/play/orbit-hop/trailer.mp4
import { chromium } from '../../app/node_modules/playwright-core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
const FPS = 30, SECS = 12, MENU = 1.2;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 810 }, deviceScaleFactor: 1.5 });
await p.route('**/game_api/**', (r) => r.abort());
await p.addInitScript(() => {
  const w = window as any;
  let now = 0, cbs: FrameRequestCallback[] = [];
  performance.now = () => now;
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { cbs.push(cb); return cbs.length; };
  w.__step = (ms: number) => { now += ms; const run = cbs; cbs = []; for (const cb of run) cb(now); };
});
await p.goto(pathToFileURL(join(import.meta.dir, '../public/play/orbit-hop/index.html')).href);
await p.evaluate(() => (window as any).__step(16));

for (let f = 0; f < FPS * SECS; f++) {
  if (f === Math.round(FPS * MENU)) {
    // same bot as games/orbit-hop/test.ts: hop when facing the next planet
    await p.evaluate(() => {
      const o = (window as any).__orbit;
      o.startGame();
      const loop = () => {
        if (o.state === 'play' && o.player.state === 'orbit') {
          const pl = o.player.planet, next = o.planets.find((q: any) => q.id === pl.id + 1);
          if (next) {
            let d = o.player.ang - Math.atan2(next.y - pl.y, next.x - pl.x);
            d = Math.atan2(Math.sin(d), Math.cos(d));
            if (Math.abs(d) < 0.12) o.jump();
          }
        }
        if (o.state === 'over') o.startGame();
        requestAnimationFrame(loop);
      };
      loop();
    });
  }
  // two half steps per frame keep the bot's reaction time the same as at 60 fps
  await p.evaluate((ms) => { (window as any).__step(ms); (window as any).__step(ms); }, 500 / FPS);
  await p.screenshot({ path: join(dir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
}
console.log('score', await p.evaluate(() => (window as any).__orbit.score));
await b.close();

const out = join(import.meta.dir, '../public/play/orbit-hop/trailer.mp4');
const ff = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%04d.jpg'),
  '-vf', 'scale=540:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-an', out]);
console.log(ff.success ? 'wrote ' + out : String(ff.stderr));
