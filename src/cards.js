// The one small script every page loads: cards lean toward the pointer in 3D with a light that follows it,
// the phone menu opens from the burger, and the homepage video tabs filter by game.
// Cards are always visible: nothing waits for a scroll to appear.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const MAX = 6; // degrees of lean at the card's edge

for (const list of document.querySelectorAll('.glist')) {
  const cards = [...list.querySelectorAll('a')];
  if (reduced || !canHover) continue;
  for (const el of cards) bindTilt(el);
}

function bindTilt(el) {
  // Hover comes from a rectangle measured flat, not from pointerenter/leave: a tilted card moves its own
  // edge under a still cursor, which would retrigger enter/leave and make it shake.
  let rect = null;
  const release = () => {
    if (!rect) return;
    rect = null;
    el.classList.remove('is-hot');
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
    removeEventListener('pointermove', move);
  };
  const move = (e) => {
    const m = 8;
    if (e.clientX < rect.left - m || e.clientX > rect.right + m || e.clientY < rect.top - m || e.clientY > rect.bottom + m) return release();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    el.style.setProperty('--gx', `${px * 100}%`); el.style.setProperty('--gy', `${py * 100}%`);
    el.style.setProperty('--ry', `${(px - 0.5) * MAX * 2}deg`); el.style.setProperty('--rx', `${(0.5 - py) * MAX * 2}deg`);
  };
  el.addEventListener('pointerenter', (e) => {
    if (rect) return;
    rect = el.getBoundingClientRect(); // the card is flat between hovers (release resets it)
    el.classList.add('is-hot');
    addEventListener('pointermove', move);
    move(e);
  });
  addEventListener('scroll', release, { passive: true }); // the measured rect is stale once the page moves
}

// phone menu: the burger opens the nav under the header
{
  const top = document.querySelector('.top'), btn = top?.querySelector('.menu-btn');
  btn?.addEventListener('click', () => {
    const open = top.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
}

// homepage videos: "All" shows the pinned ones, a game tab shows every video for that game
{
  const grid = document.getElementById('vids'), title = document.getElementById('vids-title');
  const tabs = [...document.querySelectorAll('.filters button')];
  for (const tab of tabs) tab.addEventListener('click', () => {
    const game = tab.dataset.game;
    for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
    for (const v of grid.children) v.hidden = game === 'all' ? !v.hasAttribute('data-top') : v.dataset.game !== game;
    title.textContent = game === 'all' ? 'Most watched' : `${tab.textContent} videos`;
  });
}
