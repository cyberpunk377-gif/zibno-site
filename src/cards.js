// The one small script every page loads. Everything here is an enhancement: with JavaScript off, every
// page still shows all its content, the nav is a scrolling row and the videos show the pinned set.
//   1. light / dark switch (remembered per browser)
//   2. phone menu
//   3. header shadow once the page scrolls
//   4. reading progress + "on this page" highlight on guides
//   5. fade-in of cards as they scroll into view
//   6. homepage video tabs

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- 1. theme
{
  const KEY = 'zibno-theme';
  const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const label = (btn) => btn.setAttribute('aria-label', dark() ? 'Switch to light mode' : 'Switch to dark mode');
  for (const btn of document.querySelectorAll('.theme-btn')) {
    label(btn);
    btn.addEventListener('click', () => {
      const next = dark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts this page only */ }
      label(btn);
    });
  }
}

// ---------------------------------------------------------------- 2. phone menu
{
  const top = document.querySelector('.top'), btn = top?.querySelector('.menu-btn');
  btn?.addEventListener('click', () => {
    const open = top.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && top?.classList.contains('open')) { top.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
  });
}

// ---------------------------------------------------------------- 3 + 4. scroll: header shadow, progress, toc
{
  const top = document.querySelector('.top');
  const bar = document.querySelector('.progress i');
  const article = document.querySelector('.gart');
  const links = [...document.querySelectorAll('.toc a')];
  const heads = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  let ticking = false;
  const update = () => {
    ticking = false;
    top?.classList.toggle('is-scrolled', scrollY > 8);
    if (bar && article) {
      const r = article.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight * 0.6)));
      bar.style.setProperty('--p', p.toFixed(4));
    }
    if (heads.length) {
      const line = innerHeight * 0.3;
      let current = heads[0];
      for (const h of heads) if (h.getBoundingClientRect().top < line) current = h;
      for (const a of links) a.classList.toggle('is-active', a.hash.slice(1) === current.id);
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

// ---------------------------------------------------------------- 5. reveal on scroll
if (!reduced && 'IntersectionObserver' in window) {
  const items = document.querySelectorAll('.glist > a, .desk, .game, .numbers div, .facts li, .finder, .letter');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el, i) => {
    // only animate what starts below the fold, so nothing visible on load ever blinks
    if (el.getBoundingClientRect().top < innerHeight) return;
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 4) * 60}ms`;
    io.observe(el);
  });
}

// ---------------------------------------------------------------- 6. homepage videos
// "All" shows the pinned ones, a game tab shows every video for that game
{
  const grid = document.getElementById('vids'), title = document.getElementById('vids-title');
  const tabs = [...document.querySelectorAll('.filters button')];
  for (const tab of tabs) tab.addEventListener('click', () => {
    const game = tab.dataset.game;
    for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
    for (const v of grid.children) {
      v.hidden = game === 'all' ? !v.hasAttribute('data-top') : v.dataset.game !== game;
      v.classList.add('is-in');
    }
    if (title) title.textContent = game === 'all' ? 'Most watched' : `${tab.textContent} videos`;
  });
}
