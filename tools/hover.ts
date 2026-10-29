// Hover stability check: sweep the mouse over a hero card edge, hold, count enter/leave and transform changes.
import { chromium } from '../../app/node_modules/playwright-core';
const proc = Bun.spawn(['bunx', 'vite', 'preview', '--port', '5405', '--strictPort'], { cwd: import.meta.dir + '/..', stdout: 'ignore', stderr: 'ignore' });
await Bun.sleep(2500);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
await p.goto('http://localhost:5405/');
await Bun.sleep(4000);
await p.evaluate(() => {
  const w = window as any; w.__ev = { enter: 0, leave: 0, tf: new Set<string>() };
  const c = document.querySelector('.game')!;
  c.addEventListener('pointerenter', () => w.__ev.enter++);
  c.addEventListener('pointerleave', () => w.__ev.leave++);
  const sample = () => { w.__ev.tf.add(getComputedStyle(c).transform); requestAnimationFrame(sample); }; sample();
});
const r = (await p.locator('.game').first().boundingBox())!;
for (let i = 0; i < 20; i++) { await p.mouse.move(r.x + r.width - 6 - i, r.y + r.height / 2); await Bun.sleep(16); }
await Bun.sleep(700); await p.evaluate(() => ((window as any).__ev.tf = new Set()));
await Bun.sleep(1200); // hold still near the edge
console.log(await p.evaluate(() => { const e = (window as any).__ev; return { enter: e.enter, leave: e.leave, distinctTransformsWhileStill: e.tf.size }; }));
await b.close(); proc.kill();
