// Games section check: the phone loops the trailer; the phone and the Play button open the real game in a new tab.
//   bun tools/games.ts [baseUrl=http://localhost:5410]
import { chromium } from '../../app/node_modules/playwright-core';
const base = process.argv[2] || 'http://localhost:5410';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
const errs: string[] = [];
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(base + '/');
await Bun.sleep(2000);
await p.click('a[href="#games"]');
await Bun.sleep(2000);
const playing = await p.evaluate(() => { const v = document.querySelector('.phone video') as HTMLVideoElement; return !v.paused && v.currentTime > 0.3; });

const check = async (sel: string) => {
  const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click(sel)]);
  await tab.waitForLoadState();
  await Bun.sleep(800);
  const r = await tab.evaluate(() => ({ game: !!document.getElementById('c') && !!(window as any).__orbit, site: !!document.querySelector('.hero') }));
  await tab.close();
  return r;
};
console.log(JSON.stringify({ playing, phone: await check('.phone'), button: await check('.play-btn'), errs }));
await b.close();
