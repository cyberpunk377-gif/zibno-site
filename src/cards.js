// Guide cards on the guide pages: they deal in as they scroll into view, then lean toward the pointer in 3D
// with a light that follows it. No GSAP here: these pages only load page.css and this file.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const MAX = 9; // degrees of lean at the card's edge

for (const list of document.querySelectorAll('.glist')) {
  const cards = [...list.querySelectorAll('a')];
  if (!reduced) {
    // deal-in: each row's cards rise and fan in one after the other
    list.classList.add('deal');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.style.setProperty('--d', `${(cards.indexOf(e.target) % 4) * 80}ms`);
        e.target.classList.add('in');
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    cards.forEach((c) => io.observe(c));
  }
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
