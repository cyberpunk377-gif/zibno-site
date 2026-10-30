// Guide card check: hover a card on the guides index and on the homepage, report its 3D transform + glare, and
// whether the deal-in ran. Optional screenshots: bun tools/cardhover.ts <outdir>
import { chromium } from '../../app/node_modules/playwright-core';
const out = process.argv[2];
const proc = Bun.spawn(['bunx', 'vite', 'preview', '--port', '5406', '--strictPort'], { cwd: import.meta.dir + '/..', stdout: 'ignore', stderr: 'ignore' });
await Bun.sleep(2500);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs: string[] = []; p.on('pageerror', (e) => errs.push(e.message));
const probe = async (url: string, sel: string, name: string) => {
  await p.goto(url); await Bun.sleep(1500);
  const card = p.locator(sel).first(); await card.scrollIntoViewIfNeeded(); await Bun.sleep(1500);
  const r = (await card.boundingBox())!;
  await p.mouse.move(r.x + r.width * 0.85, r.y + r.height * 0.2, { steps: 8 }); await Bun.sleep(900);
  const s = await card.evaluate((el) => ({ transform: getComputedStyle(el).transform.slice(0, 60), hot: el.classList.contains('is-hot'), dealt: el.classList.contains('in') }));
  if (out) await p.screenshot({ path: `${out}/${name}.png`, clip: { x: r.x - 40, y: r.y - 40, width: r.width + 80, height: r.height + 80 } });
  await p.mouse.move(5, 5, { steps: 4 }); await Bun.sleep(800);
  const rest = await card.evaluate((el) => getComputedStyle(el).transform.slice(0, 60));
  console.log(name, JSON.stringify({ ...s, rest }));
};
await probe('http://localhost:5406/guides/index.html', '.glist a', 'guides-index');
await probe('http://localhost:5406/guides/valorant-mobile-vs-pc.html', '.more .glist a', 'guide-related');
await probe('http://localhost:5406/', '.gc', 'home');
console.log('errors:', errs.length ? errs : 'none');
await b.close(); proc.kill();
