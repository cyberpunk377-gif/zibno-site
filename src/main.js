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
let heroP = 0;
ScrollTrigger.create({ trigger: '.hero', start: 'top top', end: 'bottom top', onUpdate: (s) => { heroP = s.progress; } });
const nav = document.querySelector('.nav');
const navLinks = [...nav.querySelectorAll('nav a')];
for (const id of ['top', 'videos', 'about', 'games', 'contact']) {
  ScrollTrigger.create({ trigger: '#' + id, start: 'top 45%', end: 'bottom 45%', onToggle: (s) => { if (s.isActive) navLinks.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + id)); } });
}

// ------------------------------------------------------------------ hero cards: build the 3D slab
const LAYERS = 10;
for (const g of document.querySelectorAll('.game')) {
  const slab = document.createElement('div');
  slab.className = 'slab';
  for (let n = LAYERS; n >= 1; n--) { const ex = document.createElement('b'); ex.className = 'ex'; ex.style.setProperty('--n', n); slab.append(ex); }
  slab.append(...g.children);
  g.append(slab);
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    g.addEventListener('pointermove', (e) => {
      const r = g.getBoundingClientRect();
      slab.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 24}deg`);
      slab.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 18}deg`);
    });
    g.addEventListener('pointerleave', () => { slab.style.setProperty('--ry', '0deg'); slab.style.setProperty('--rx', '0deg'); });
  }
}

// ------------------------------------------------------------------ entrance: one orchestrated reveal
if (!reduced) {
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.nav', { y: -30, opacity: 0, duration: 0.8 })
    .from('.kicker', { x: -30, opacity: 0, duration: 0.7 }, 0.15)
    .from('.logo span', { x: -60, opacity: 0, skewX: 12, duration: 1 }, 0.2)
    .from('.motto', { x: -30, opacity: 0, duration: 0.7 }, 0.45)
    .from('.yt', { y: 24, opacity: 0, duration: 0.7 }, 0.6)
    .from('.panel-wrap', { x: 120, opacity: 0, duration: 1.2, clearProps: 'transform' }, 0.35)
    .from('.game', { x: 60, opacity: 0, stagger: 0.12, duration: 0.7, clearProps: 'transform' }, 0.7);
}

// ------------------------------------------------------------------ ZIBNO title: the gradient follows the mouse
// The black→green split slides to the cursor and a green glow sits under it; leaving eases back to rest.
{
  const word = document.querySelector('.logo span');
  const cur = { s: 0, g: 0, x: 50, y: 50 }, want = { ...cur };
  let raf = 0;
  const tick = () => {
    for (const k in cur) cur[k] += (want[k] - cur[k]) * 0.12;
    word.style.setProperty('--s', cur.s.toFixed(2) + '%');
    word.style.setProperty('--g', cur.g.toFixed(3));
    word.style.setProperty('--mx', cur.x.toFixed(2) + '%');
    word.style.setProperty('--my', cur.y.toFixed(2) + '%');
    const done = Object.keys(cur).every((k) => Math.abs(want[k] - cur[k]) < 0.05);
    raf = done ? 0 : requestAnimationFrame(tick);
  };
  const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
  word.addEventListener('pointermove', (e) => {
    const r = word.getBoundingClientRect();
    want.x = ((e.clientX - r.left) / r.width) * 100;
    want.y = ((e.clientY - r.top) / r.height) * 100;
    want.s = want.x - 58; // the dark→green edge (58% at rest) lands on the cursor
    want.g = 1;
    go();
  });
  word.addEventListener('pointerleave', () => { Object.assign(want, { s: 0, g: 0 }); go(); });
}

// ------------------------------------------------------------------ pointer + tilt
const look = { x: 0, y: 0 }, lookT = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { lookT.x = e.clientX / innerWidth - 0.5; lookT.y = e.clientY / innerHeight - 0.5; });
addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  lookT.x = Math.max(-0.5, Math.min(0.5, e.gamma / 50));
  lookT.y = Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 60));
});

const copy = document.querySelector('.hero-copy');
const panel = document.querySelector('.games-panel');
const pl = { x: 0, y: 0 }; // panel's own copy of the pointer, frozen while a card is hovered
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
  nav.classList.toggle('solid', p > 0.6);
  copy.style.transform = `translate3d(${look.x * -14}px, ${p * -120 + look.y * -8}px, 0)`;
  copy.style.opacity = String(1 - smooth(0.25, 0.7, p));
  if (!reduced && innerWidth / innerHeight >= 1 && innerWidth > 700) {
    panel.style.transform = `rotateY(${-20 + pl.x * 10 - p * 18}deg) rotateZ(-4deg) rotateX(${4 - pl.y * 8}deg) translate3d(${p * 80}px, ${p * -60}px, 0)`;
  }
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
// the game cards in the hero jump straight to that game's videos
for (const c of document.querySelectorAll('.game[data-game]')) c.addEventListener('click', () => renderVideos(c.dataset.game));

// ------------------------------------------------------------------ 3D tilt on every card
// The card leans toward the pointer and a soft light follows it across the surface.
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
let hot = 0; // cards currently under the pointer; the hero panel stops following the mouse while > 0
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
bindTilt(document.querySelectorAll('.links a, .stats div, .gcard'));
renderVideos('all', false);

// ------------------------------------------------------------------ games: the phone loops a trailer while on screen
// Playing happens on the game's own page (new tab), so nothing on this page can interrupt a run.
const trailer = document.querySelector('.phone video');
new IntersectionObserver(([e]) => {
  if (e.isIntersecting && !matchMedia('(prefers-reduced-motion: reduce)').matches) trailer.play().catch(() => {});
  else trailer.pause();
}, { threshold: 0.2 }).observe(trailer);
