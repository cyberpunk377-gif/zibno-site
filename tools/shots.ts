// Screenshots of the hero fight at set scroll points, desktop + phone.
//   bun tools/shots.ts <outdir>
import { chromium } from '../../app/node_modules/playwright-core';
import { join } from 'node:path';

const out = process.argv[2];
const proc = Bun.spawn(['bunx', 'vite', 'preview', '--port', '5402', '--strictPort'], { cwd: join(import.meta.dir, '..'), stdout: 'ignore', stderr: 'ignore' });
await Bun.sleep(2500);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
for (const [tag, vp] of [['desk', { width: 1440, height: 810 }], ['tv', { width: 3840, height: 2160 }], ['ipadP', { width: 820, height: 1180 }], ['ipadL', { width: 1180, height: 820 }], ['phone', { width: 412, height: 915 }]] as const) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('http://localhost:5402/');
  await Bun.sleep(4500);
  const track = await page.evaluate(() => innerHeight);
  for (const p of [0, 1.2, 2.3, 3.4]) {
    await page.evaluate((y) => (window as any).__lenis.scrollTo(y, { immediate: true }), Math.round(track * p));
    await Bun.sleep(1400);
    await page.screenshot({ path: join(out, `${tag}_${String(p).replace('.', '')}.png`) });
  }
  const fps = await page.evaluate(() => new Promise<number>((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); }; f(); }));
  console.log(tag, 'fps', fps);
  await page.close();
}
await browser.close();
proc.kill();
