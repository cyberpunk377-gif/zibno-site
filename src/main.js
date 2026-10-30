import './style.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { GAMES, VIDEOS } from './videos.js';

gsap.registerPlugin(ScrollTrigger);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ hero scene: one painting + its depth map
// Every pixel slides by its depth as you move the mouse, tilt the phone or scroll, so the flat
// render moves like a real 3D set (near plants and the mascot shift more than the far ring).
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: null }, depth: { value: null },
    sway: { value: new THREE.Vector2() }, zoom: { value: 1 }, fit: { value: new THREE.Vector2(1, 1) }, focus: { value: new THREE.Vector2(0.56, 0.5) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D map, depth; uniform vec2 sway, fit, focus; uniform float zoom; varying vec2 vUv;
    void main() {
      vec2 uv = (vUv - 0.5) * fit / zoom + focus;
      vec2 off = sway * 0.03;
      float d = texture2D(depth, uv).r;
      d = texture2D(depth, uv + off * (d - 0.4)).r;
      vec3 c = texture2D(map, uv + off * (d - 0.4)).rgb;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
  depthWrite: false, depthTest: false,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
let imgAspect = 16 / 9;
const tl = new THREE.TextureLoader();
// upright screens (phones, portrait iPads) get the tall version of the set when it exists
const tall = innerWidth / innerHeight < 1;
const pick = (name) => fetch(`/hero/${name}_m.jpg`, { method: 'HEAD' }).then((r) => (tall && r.ok && (r.headers.get('content-type') || '').startsWith('image') ? `/hero/${name}_m.jpg` : `/hero/${name}.jpg`));
Promise.all([pick('plate'), pick('plate_d')]).then(([a, b]) => Promise.all([tl.loadAsync(a), tl.loadAsync(b)])).then(([m, d]) => {
  m.colorSpace = THREE.SRGBColorSpace;
  for (const t of [m, d]) { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  mat.uniforms.map.value = m;
  mat.uniforms.depth.value = d;
  imgAspect = m.image.width / m.image.height;
  resize();
  gsap.fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'power2.out' });
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  // cover-fit, slightly zoomed so the parallax never shows an edge
  const a = w / h;
  mat.uniforms.fit.value.set(a < imgAspect ? a / imgAspect : 1, a < imgAspect ? 1 : imgAspect / a).multiplyScalar(0.94);
  // portrait phones crop to the mascot; wide screens show the whole set
  mat.uniforms.focus.value.set(imgAspect > 1 && a < 1 ? 0.6 : 0.5, 0.5);
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ smooth scroll
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;
}
for (const a of document.querySelectorAll('a[href^="#"]')) {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(id, { duration: 1.4 }); else document.querySelector(id).scrollIntoView();
  });
}
// ------------------------------------------------------------------ phone menu: the burger opens the nav full screen
{
  const bar = document.querySelector('.nav');
  const btn = bar.querySelector('.menu-btn');
  const setOpen = (open) => {
    bar.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (lenis) open ? lenis.stop() : lenis.start();
  };
  btn.addEventListener('click', () => setOpen(!bar.classList.contains('open')));
  // close first so the link's own smooth scroll (registered above) runs with scrolling switched back on
  for (const a of bar.querySelectorAll('nav a')) a.addEventListener('click', () => setOpen(false), { capture: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && bar.classList.contains('open')) { setOpen(false); btn.focus(); } });
  matchMedia('(max-aspect-ratio: 1/1), (max-width: 700px)').addEventListener('change', () => setOpen(false));
}
let heroP = 0;
ScrollTrigger.create({ trigger: '.hero', start: 'top top', end: 'bottom top', onUpdate: (s) => { heroP = s.progress; } });
const nav = document.querySelector('.nav');
// ------------------------------------------------------------------ scroll story (Shopify Editions-style)
// The stage pins for ~1.3 screens of scroll. Scroll position scrubs one timeline: HUD lines draw in, the two
// Zibnos fly in from the sides, a spark builds between their hands while they glitch into a green outline,
// the title rises, then the camera pushes through. Scrolling back plays it in reverse.
const spark = { burst: 0 };
{
  const stage = document.querySelector('.story-stage');
  // jagged "torn screen" edge, seeded so it is the same on every visit
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = ['0% 100%'];
  for (let x = 0; x <= 100; x += 2 + rnd() * 3) pts.push(`${x.toFixed(1)}% ${(35 + rnd() * 55).toFixed(1)}%`);
  pts.push('100% 60%', '100% 100%');
  document.querySelector('.tear').style.clipPath = `polygon(${pts.join(',')})`;

  for (const p of stage.querySelectorAll('.lines circle, .lines path')) { const l = p.getTotalLength(); p.style.strokeDasharray = l; p.style.strokeDashoffset = reduced ? 0 : l; }

  if (!reduced) {
    const outline = (k) => `drop-shadow(0 0 ${k * 2}px #2ee35b) drop-shadow(0 0 ${k * 10}px rgba(46,227,91,${k * 0.8})) grayscale(${k}) contrast(${1 + k * 0.6}) brightness(${1 + k * 0.5})`;
    gsap.set('.char', { filter: outline(0) });
    const m = innerWidth < 700 ? 0 : 1; // on phones the two are stacked, so they do not slide toward each other
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.story', start: 'top top', end: '+=130%', pin: true, scrub: 0.6, anticipatePin: 1 } })
      .fromTo('.sky', { scale: 1.35, opacity: 0.2 }, { scale: 1.08, opacity: 1, duration: 3, ease: 'power2.out' }, 0)
      .to('.lines circle, .lines path', { strokeDashoffset: 0, duration: 1.6, stagger: 0.12, ease: 'power2.inOut' }, 0)
      .fromTo('.char-l', { xPercent: -120, yPercent: 30, rotate: -18 }, { xPercent: 8, yPercent: 0, rotate: 0, duration: 2.4, ease: 'power3.out' }, 0.6)
      .fromTo('.char-r', { xPercent: 120, yPercent: -25, rotate: 16 }, { xPercent: -8, yPercent: 0, rotate: 0, duration: 2.4, ease: 'power3.out' }, 0.75)
      .to('.lines', { opacity: 0.35, duration: 1 }, 2)
      .to('.char-l', { xPercent: 8 + 14 * m, yPercent: -4, duration: 2 }, 3)
      .to('.char-r', { xPercent: -8 - 14 * m, yPercent: 4, duration: 2 }, 3)
      .to(spark, { burst: 1, duration: 2 }, 3)
      .to('.char', { filter: outline(1), duration: 1.2 }, 3.6)
      .from('.story-copy .kicker', { y: 30, opacity: 0, duration: 0.6 }, 3.4)
      .from('.story-title span', { yPercent: 110, opacity: 0, stagger: 0.25, duration: 0.9, ease: 'power3.out' }, 3.6)
      .from('.story-sub', { y: 20, opacity: 0, duration: 0.6 }, 4.2)
      // camera push: everything scales toward you and the spark floods the frame
      .to('.char-l', { xPercent: -60, scale: 1.5, opacity: 0, duration: 1.6, ease: 'power2.in' }, 5.4)
      .to('.char-r', { xPercent: 60, scale: 1.5, opacity: 0, duration: 1.6, ease: 'power2.in' }, 5.4)
      .to('.sky', { scale: 1.4, duration: 1.6, ease: 'power2.in' }, 5.4)
      .to('.story-copy', { scale: 1.15, opacity: 0, duration: 1.2, ease: 'power2.in' }, 5.8)
      .to(spark, { burst: 1.8, duration: 1.6, ease: 'power2.in' }, 5.4);
  }

  // spark field: particles orbit and stream out of the point between the two hands; burst drives the density
  const cv = stage.querySelector('.sparks'), g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const fit = () => { dpr = Math.min(devicePixelRatio, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; };
  addEventListener('resize', fit); fit();
  const parts = Array.from({ length: 420 }, (_, i) => ({ a: rnd() * Math.PI * 2, r: rnd(), s: 0.3 + rnd(), z: rnd(), k: i / 420 }));
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);
  const draw = (now) => {
    requestAnimationFrame(draw);
    if (!visible) return;
    const t = now / 1000, b = reduced ? 0.6 : spark.burst;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (b < 0.01) return;
    const cx = W * 0.5, cy = H * 0.42, R = Math.min(W, H) * (0.12 + b * 0.22);
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    halo.addColorStop(0, `rgba(200,255,215,${Math.min(1, b) * 0.55})`);
    halo.addColorStop(0.35, `rgba(46,227,91,${Math.min(1, b) * 0.25})`);
    halo.addColorStop(1, 'rgba(46,227,91,0)');
    g.fillStyle = halo; g.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
    for (const p of parts) {
      if (p.k > b) continue; // more particles join as the burst grows
      const a = p.a + t * p.s * 0.6, rr = R * (0.15 + p.r * 0.85) * (1 + Math.sin(t * 2 + p.a) * 0.08);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.62;
      const tw = 0.5 + 0.5 * Math.sin(t * 6 + p.a * 9);
      g.fillStyle = p.z > 0.85 ? `rgba(255,255,255,${0.9 * tw})` : `rgba(120,255,160,${0.75 * tw})`;
      const sz = (p.z > 0.85 ? 2.2 : 1.3) * (0.6 + tw);
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    // a four-point star at the meeting point
    const st = R * 0.35 * Math.min(1, b);
    g.strokeStyle = `rgba(255,255,255,${Math.min(1, b)})`; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - st, cy); g.lineTo(cx + st, cy); g.moveTo(cx, cy - st * 1.3); g.lineTo(cx, cy + st * 1.3); g.stroke();
    g.globalCompositeOperation = 'source-over';
  };
  requestAnimationFrame(draw);
}

// section highlights (nav tabs + chapter rail) are created after the story pin so their positions include its scroll length
const navLinks = [...nav.querySelectorAll('nav a'), ...document.querySelectorAll('.rail a')];
for (const id of ['top', 'guides', 'videos', 'games', 'contact', 'about']) {
  ScrollTrigger.create({ trigger: '#' + id, start: 'top 45%', end: 'bottom 45%', onToggle: (s) => { if (s.isActive) navLinks.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + id)); } });
}
// the chapter rail only shows once the story is behind you
ScrollTrigger.create({ trigger: '#guides', start: 'top 60%', endTrigger: 'html', end: 'bottom bottom', toggleClass: { targets: '.rail', className: 'show' } });

// guide cards deal in like a fanned hand of cards
if (!reduced) {
  ScrollTrigger.batch('.gc', { start: 'top 88%', once: true, onEnter: (els) => gsap.from(els, {
    y: 120, rotate: (i) => (i % 3 - 1) * 9, scale: 0.9, opacity: 0, transformOrigin: '50% 120%', stagger: 0.09, duration: 0.9, ease: 'power3.out', clearProps: 'transform,opacity',
  }) });
}

// ------------------------------------------------------------------ entrance: one orchestrated reveal
if (!reduced) {
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.nav', { y: -30, opacity: 0, duration: 0.8, clearProps: 'transform' }) // a leftover transform would trap the phone menu inside the bar
    .from('.wordmark', { y: 60, opacity: 0, duration: 1.4 }, 0)
    .from('.hud-strip', { opacity: 0, duration: 0.6 }, 0.15)
    .from('.kicker', { x: -30, opacity: 0, duration: 0.7 }, 0.2)
    .from('.headline span', { y: 70, opacity: 0, skewY: 6, stagger: 0.08, duration: 0.9 }, 0.25)
    .from('.hero-lede, .cta, .stats', { y: 24, opacity: 0, stagger: 0.1, duration: 0.7 }, 0.6)
    .from('.feed', { x: 80, opacity: 0, duration: 1.1, clearProps: 'transform' }, 0.35)
    .from('.chip', { y: 30, opacity: 0, stagger: 0.1, duration: 0.6, clearProps: 'transform' }, 0.8);
}

// ------------------------------------------------------------------ HUD clocks: broadcast-style timecode (HH:MM:SS:FF)
const clocks = [...document.querySelectorAll('.clock, .tc')];
const t0 = performance.now();
const timecode = () => {
  const f = Math.floor((performance.now() - t0) / (1000 / 30));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / 108000))}:${p(Math.floor(f / 1800) % 60)}:${p(Math.floor(f / 30) % 60)}:${p(f % 30)}`;
};

// ------------------------------------------------------------------ pointer + tilt
const look = { x: 0, y: 0 }, lookT = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { lookT.x = e.clientX / innerWidth - 0.5; lookT.y = e.clientY / innerHeight - 0.5; });
addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  lookT.x = Math.max(-0.5, Math.min(0.5, e.gamma / 50));
  lookT.y = Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 60));
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20), t = clock.elapsedTime;
  look.x += (lookT.x - look.x) * Math.min(1, dt * 5);
  look.y += (lookT.y - look.y) * Math.min(1, dt * 5);
  const p = reduced ? 0 : heroP;
  const idle = reduced ? 0 : 1;
  // scroll dollies into the set; idle drift keeps it alive when nobody touches anything
  mat.uniforms.sway.value.set(look.x * 1.4 + Math.sin(t * 0.35) * 0.25 * idle, -look.y * 0.9 + Math.sin(t * 0.27) * 0.12 * idle + p * 1.2);
  mat.uniforms.zoom.value = 1 + smooth(0, 1, p) * 0.18;
  nav.classList.toggle('solid', scrollY > 40);
  const tc = timecode();
  for (const c of clocks) c.textContent = tc;
  renderer.render(scene, cam);
});

// ------------------------------------------------------------------ scroll tracer
// A green round rides the right edge in step with the page scroll (like a live scrollbar),
// leaving a glowing tracer. Scroll speed stretches the trail and throws sparks.
if (!reduced) {
  const tc = document.getElementById('tracer');
  const g = tc.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const fit = () => { dpr = Math.min(devicePixelRatio, 2); W = innerWidth; H = innerHeight; tc.width = W * dpr; tc.height = H * dpr; };
  addEventListener('resize', fit);
  fit();
  const trail = [], sparks = [];
  let y = 0, vy = 0, lastScroll = scrollY, last = performance.now(), flash = 0;
  const sections = [...document.querySelectorAll('section')];
  let passed = 0;
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const sy = lenis ? lenis.scroll : scrollY;
    const speed = (sy - lastScroll) / Math.max(dt, 1e-3);
    lastScroll = sy;
    vy += (speed - vy) * Math.min(1, dt * 10);
    // round's screen height = how far down the page you are
    const ty = 80 + (H - 160) * (sy / max);
    y += (ty - y) * Math.min(1, dt * 14);
    const t = now / 1000;
    const x = W - Math.max(26, W * 0.03) + Math.sin(t * 2.2 + y * 0.01) * 6;
    trail.push({ x, y, life: 1 });
    // crossing into a new section fires a muzzle flash
    const cur = sections.findIndex((s) => s.getBoundingClientRect().bottom > innerHeight * 0.5);
    if (cur !== passed) { passed = cur; flash = 1; for (let i = 0; i < 26; i++) sparks.push({ x, y, vx: (Math.random() - 0.8) * 420, vy: (Math.random() - 0.5) * 380, life: 0.6 }); }
    const fast = Math.min(1, Math.abs(vy) / 2500);
    if (fast > 0.15 && Math.random() < fast) sparks.push({ x, y, vx: -60 - Math.random() * 200, vy: -Math.sign(vy) * Math.random() * 260, life: 0.45 });
    const fade = 2.4 - fast * 1.6; // fast scroll = longer trail
    for (const p of trail) p.life -= dt * fade;
    while (trail.length && trail[0].life <= 0) trail.shift();
    for (const s of sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94; }
    while (sparks.length && sparks[0].life <= 0) sparks.shift();
    flash = Math.max(0, flash - dt * 3);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], k = b.life;
      g.strokeStyle = `rgba(46,227,91,${0.35 * k})`;
      g.lineWidth = 14 * k;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = `rgba(220,255,230,${0.9 * k})`;
      g.lineWidth = 3 * k;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (const s of sparks) { g.fillStyle = `rgba(140,255,170,${s.life * 1.6})`; g.beginPath(); g.arc(s.x, s.y, 2.2, 0, Math.PI * 2); g.fill(); }
    // bloom halo + the round itself, nose pointing the way you scroll
    const r = 60 + flash * 70 + fast * 30;
    const halo = g.createRadialGradient(x, y, 0, x, y, r);
    halo.addColorStop(0, `rgba(46,227,91,${0.55 + flash * 0.4})`);
    halo.addColorStop(1, 'rgba(46,227,91,0)');
    g.fillStyle = halo;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
    g.save();
    g.translate(x, y);
    g.rotate(vy < -40 ? Math.PI : 0);
    g.fillStyle = '#c9ffd6';
    g.beginPath(); g.moveTo(-4, -10); g.lineTo(4, -10); g.lineTo(4, 4); g.quadraticCurveTo(0, 14, -4, 4); g.closePath(); g.fill();
    g.fillStyle = '#17b53f';
    g.fillRect(-4.5, -14, 9, 5);
    g.restore();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ videos: filter by game
const grid = document.getElementById('vids');
const tabs = [...document.querySelectorAll('.filters button')];
const title = document.getElementById('vids-title');
function renderVideos(game, animate = true) {
  const list = game === 'all' ? VIDEOS.filter((v) => v[4]) : VIDEOS.filter((v) => v[1] === game);
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.game === game)));
  title.textContent = game === 'all' ? 'Most watched' : GAMES[game];
  grid.innerHTML = list.map(([id, g, t, v]) => `
      <a class="vid tilt" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">
        <img src="/videos/${id}.jpg" alt="" loading="lazy" width="640" height="360">
        <span class="tag">${GAMES[g]}</span>
        <strong>${t}</strong>
        <em>${v} views</em>
      </a>`).join('');
  bindTilt(grid.querySelectorAll('.tilt'));
  if (animate && !reduced) gsap.from(grid.children, { opacity: 0, y: 40, rotateX: -35, transformPerspective: 900, transformOrigin: '50% 100%', stagger: 0.05, duration: 0.6, ease: 'power3.out', clearProps: 'transform,opacity' });
  ScrollTrigger.refresh();
}
tabs.forEach((t) => t.addEventListener('click', () => renderVideos(t.dataset.game)));
// each tab shows how many videos it holds, like the nav counts
for (const t of tabs) t.insertAdjacentHTML('beforeend', `<sup>${t.dataset.game === 'all' ? VIDEOS.filter((v) => v[4]).length : VIDEOS.filter((v) => v[1] === t.dataset.game).length}</sup>`);
// the game chips under the hero feed jump straight to that game's videos
for (const c of document.querySelectorAll('.chip[data-game]')) c.addEventListener('click', () => renderVideos(c.dataset.game));

// ------------------------------------------------------------------ 3D tilt on every card
// The card leans toward the pointer and a soft light follows it across the surface.
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
let hot = 0; // cards currently under the pointer
function bindTilt(els) {
  for (const el of els) {
    if (el.dataset.tiltBound) continue;
    el.dataset.tiltBound = '1';
    el.classList.add('tilt');
    if (reduced || !canHover) continue;
    const max = el.classList.contains('game') ? 9 : 7;
    // Hover state comes from a rectangle measured at rest, not from pointerenter/leave: a tilted card moves
    // its own edge under a still cursor, which used to retrigger enter/leave and shake the card.
    let rect = null;
    const release = () => {
      if (!rect) return;
      rect = null; hot--;
      el.classList.remove('is-hot');
      removeEventListener('pointermove', move);
      gsap.to(el, { rotateY: 0, rotateX: 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
    };
    const move = (e) => {
      const m = 8;
      if (e.clientX < rect.left - m || e.clientX > rect.right + m || e.clientY < rect.top - m || e.clientY > rect.bottom + m) return release();
      const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      el.style.setProperty('--gx', `${px * 100}%`);
      el.style.setProperty('--gy', `${py * 100}%`);
      gsap.to(el, { rotateY: (px - 0.5) * max * 2, rotateX: (0.5 - py) * max * 2, transformPerspective: 900, duration: 0.3, ease: 'power3.out', overwrite: 'auto' });
    };
    el.addEventListener('pointerenter', (e) => {
      if (rect) return;
      gsap.killTweensOf(el); gsap.set(el, { rotateX: 0, rotateY: 0 }); // measure the card flat
      rect = el.getBoundingClientRect(); hot++;
      el.classList.add('is-hot');
      addEventListener('pointermove', move);
      move(e);
    });
  }
}
bindTilt(document.querySelectorAll('.links a, .gcard'));
renderVideos('all', false);

// ------------------------------------------------------------------ games: the phone loops a trailer while on screen
// Playing happens on the game's own page (new tab), so nothing on this page can interrupt a run.
for (const trailer of document.querySelectorAll('.phone video')) {
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !matchMedia('(prefers-reduced-motion: reduce)').matches) trailer.play().catch(() => {});
    else trailer.pause();
  }, { threshold: 0.2 }).observe(trailer);
}
