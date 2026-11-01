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

// ------------------------------------------------------------------ scroll knife
// The Zibno balisong (an original design) rides the right edge in step with the page scroll.
// Ride: the knife holds still and leans while each hinged handle swings on its own spring.
// New section: it is tossed into the page, turns end over end and is caught with the handles snapping shut.
// Touch: hover (or tap) brings it out to show itself; a click cuts a slash across the screen.
if (!reduced) {
  const kc = document.getElementById('knife');
  const g = kc.getContext('2d');
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrap = (a) => a - TAU * Math.round(a / TAU);

  // A real button tracks the knife, which gives us hover, touch, keyboard and a pointer cursor for free.
  const hit = document.createElement('button');
  hit.id = 'knife-hit'; hit.type = 'button'; hit.setAttribute('aria-label', 'Slash with the Zibno balisong');
  const tag = document.createElement('div');
  tag.id = 'knife-tag'; tag.setAttribute('aria-hidden', 'true');
  const verb = matchMedia('(hover: hover)').matches ? 'Click' : 'Tap';
  tag.innerHTML = `<span>Heirloom tier</span><b>Zibno Balisong</b><em>Slashes <i>0</i> <u></u></em><small>${verb} to slash</small>`;
  document.body.append(hit, tag);
  const countEl = tag.querySelector('i'), comboEl = tag.querySelector('u');
  let total = 0;
  try { total = Number(localStorage.getItem('zibno-slashes')) || 0; } catch {}
  countEl.textContent = total;

  let W = 0, H = 0, dpr = 1, S = 1, edge = 0;
  const fit = () => {
    dpr = Math.min(devicePixelRatio, 2); W = innerWidth; H = innerHeight; kc.width = W * dpr; kc.height = H * dpr;
    S = Math.min(1.7, Math.max(0.52, W / 1440));
    edge = W < 700 ? 26 : 56 * S;
  };
  addEventListener('resize', fit);
  fit();

  const path = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); };
  // Blade: pivot at the origin, pointing up. A tanto point with a stepped spine.
  const BLADE = [-11.5, 7, 11.5, 7, 11.5, -5, 7.5, -12, 7.5, -66, 1, -88, -7.5, -74, -7.5, -40, -5, -36, -7.5, -32, -7.5, -12, -11.5, -5];
  const drawBlade = (glint, shine) => {
    const steel = g.createLinearGradient(-8, 0, 8, 0);
    steel.addColorStop(0, '#8f9a95'); steel.addColorStop(0.46, '#f4fbf6'); steel.addColorStop(0.54, '#b9c5bf'); steel.addColorStop(1, '#eef6f0');
    path(BLADE); g.fillStyle = steel; g.fill();
    g.lineWidth = 1; g.strokeStyle = glint > 0.02 ? `rgba(255,255,255,${0.5 + glint * 0.5})` : 'rgba(7,26,14,.7)'; g.stroke();
    path([1, -18, 7.5, -18, 7.5, -66, 1, -88]); g.fillStyle = 'rgba(46,227,91,.32)'; g.fill(); // ground edge, lit green
    // Z cut through the blade
    path([-4.5, -30, 3, -30, 3, -27, -0.8, -21, 3, -21, 3, -18, -4.5, -18, -4.5, -21, -0.8, -27, -4.5, -27]);
    g.fillStyle = '#071a0e'; g.fill();
    g.fillStyle = '#2ee35b'; for (const y of [-58, -52, -46]) g.fillRect(-5, y, 3.5, 2.5); // jimping
    if (shine >= 0) { // a band of light running up the blade
      g.save(); path(BLADE); g.clip();
      g.shadowBlur = 0;
      const y = 14 - shine * 120;
      g.fillStyle = 'rgba(255,255,255,.75)';
      path([-14, y + 6, 14, y - 6, 14, y - 16, -14, y - 4]); g.fill();
      g.restore();
    }
  };
  // One handle: hinge at the origin, running down. Skeleton cut windows and a green anodised body.
  const drawHandle = (side) => {
    const body = g.createLinearGradient(-6, 0, 6, 0);
    body.addColorStop(0, side < 0 ? '#2ee35b' : '#0d5a26'); body.addColorStop(0.5, '#17b53f'); body.addColorStop(1, side < 0 ? '#0d5a26' : '#2ee35b');
    g.beginPath(); g.roundRect(-5.5, -7, 11, 96, 4.5); g.fillStyle = body; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(7,26,14,.8)'; g.stroke();
    g.fillStyle = '#071a0e';
    for (const [y, h] of [[12, 20], [37, 20], [62, 15]]) { g.beginPath(); g.roundRect(-2.2, y, 4.4, h, 2.2); g.fill(); }
    g.fillStyle = '#e9f2ec'; g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill(); // hinge pin
    g.fillStyle = '#071a0e'; g.beginPath(); g.arc(0, 0, 0.9, 0, TAU); g.fill();
    g.fillStyle = '#e9f2ec'; g.fillRect(-5.5, 82, 11, 2.2); // end cap
  };
  // foldL / foldR: 0 = handle shut against its partner below the blade, PI = folded up around the blade.
  // sx squeezes the knife sideways to fake it turning about its long axis.
  const drawKnife = (x, y, rot, foldL, foldR, scale, sx, glint, shine) => {
    const handles = () => {
      for (const [side, fold] of [[-1, foldL], [1, foldR]]) {
        g.save(); g.translate(side * 6, 0); g.rotate(-side * fold); drawHandle(side); g.restore();
      }
    };
    g.save();
    g.translate(x, y); g.rotate(rot); g.scale(scale * sx, scale);
    g.shadowColor = `rgba(46,227,91,${0.35 + glint * 0.55})`; g.shadowBlur = (10 + glint * 22) * scale * dpr;
    if (foldL + foldR < Math.PI) { handles(); drawBlade(glint, shine); } else { drawBlade(glint, shine); handles(); }
    g.restore();
  };

  // click-clack and a blade ring, made in the browser; only ever plays after a click or tap
  let ac = null, noise = null;
  const shing = () => {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      if (!noise) {
        noise = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const n = ac.currentTime;
      const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), v = ac.createGain();
      src.buffer = noise; bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(7500, n); bp.frequency.exponentialRampToValueAtTime(1900, n + 0.24);
      v.gain.setValueAtTime(0.16, n); v.gain.exponentialRampToValueAtTime(0.001, n + 0.26);
      src.connect(bp).connect(v).connect(ac.destination); src.start(n); src.stop(n + 0.3);
      for (const at of [0, 0.07]) {
        const o = ac.createOscillator(), c = ac.createGain();
        o.type = 'square'; o.frequency.value = 1700 + at * 4000;
        c.gain.setValueAtTime(0.05, n + at); c.gain.exponentialRampToValueAtTime(0.001, n + at + 0.02);
        o.connect(c).connect(ac.destination); o.start(n + at); o.stop(n + at + 0.03);
      }
    } catch {}
  };

  const arc = [], sparks = [], slashes = [];
  let seq = 0, lastRot = Math.PI, y = -1, vy = 0, lastScroll = lenis ? lenis.scroll : scrollY, last = performance.now(), flash = 0;
  let dir = 1, ang = Math.PI + 0.24, angV = 0, phase = 0, amp = 0, still = 0, trickIn = 6, rollIn = -1;
  let foldL = 0, foldR = 0, velL = 0, velR = 0, latchCd = 0, yaw = 0, yawV = 0, yawT = 0, toss = -1, lunge = 0;
  let hover = false, focused = false, holdT = 0, insp = 0, leaveTimer = 0, tagOn = false, hitW = '', hitH = '';
  let combo = 0, lastSlash = -1e9, px = 0, py = 0, scale = 1;
  const sections = [...document.querySelectorAll('section')];
  let passed = -2;

  const burst = (bx, by, n, life) => { for (let i = 0; i < n; i++) sparks.push({ x: bx, y: by, vx: (Math.random() - 0.7) * 420, vy: (Math.random() - 0.5) * 380, life }); };
  const addSlash = (a, big) => {
    const len = Math.hypot(W, H);
    slashes.push({ x: px, y: py, a, len, big, age: 0 });
    for (let i = 0; i < 26; i++) {
      const d = Math.random() * len * 0.8;
      sparks.push({ x: px + Math.cos(a) * d, y: py + Math.sin(a) * d, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.35 + Math.random() * 0.25 });
    }
  };
  const slash = () => {
    const now = performance.now();
    combo = now - lastSlash < 900 ? combo + 1 : 1;
    lastSlash = now;
    total++;
    try { localStorage.setItem('zibno-slashes', total); } catch {}
    countEl.textContent = total;
    comboEl.textContent = combo > 1 ? `x${combo}` : '';
    const alt = combo % 2 ? 1 : -1;
    addSlash(Math.PI - alt * 0.5, false);
    if (combo % 3 === 0) addSlash(Math.PI + alt * 0.5, true); // every third hit crosses into an X
    lunge = 1; flash = 1; angV += alt * 20; velL += 30; velR += 24;
    holdT = Math.max(holdT, 2.6);
    shing();
  };
  hit.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { clearTimeout(leaveTimer); hover = true; } });
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leaveTimer = setTimeout(() => { hover = false; }, 220); });
  hit.addEventListener('focus', () => { focused = hit.matches(':focus-visible'); });
  hit.addEventListener('blur', () => { focused = false; });
  hit.addEventListener('click', slash);

  const swingHandle = (h, v, tgt, dt) => {
    v += ((tgt - h) * 150 - v * 12) * dt;
    h += v * dt;
    if (h < 0) { // latch: the handles knock together and bounce
      h = 0;
      if (v < -6 && latchCd <= 0) { latchCd = 0.12; flash = Math.max(flash, 0.3); burst(px, py, 4, 0.3); }
      v *= -0.38;
    } else if (h > Math.PI) { h = Math.PI; v *= -0.38; }
    return [h, v];
  };

  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const sy = lenis ? lenis.scroll : scrollY;
    const ds = sy - lastScroll;
    lastScroll = sy;
    vy += (ds / Math.max(dt, 1e-3) - vy) * Math.min(1, dt * 10);
    // knife's screen height = how far down the page you are
    const pad = 112 * S;
    const ty = pad + (H - pad * 2) * (sy / max);
    y = y < 0 ? ty : y + (ty - y) * Math.min(1, dt * 14);
    const x = W - edge + Math.sin(t * 1.3) * 3 * S;

    if (Math.abs(ds) > 0.2) { dir = Math.sign(ds); still = 0; trickIn = 8; phase += ds * 0.011; } else still += dt;
    holdT = Math.max(0, holdT - dt);
    latchCd -= dt;
    const showing = hover || focused || holdT > 0;
    insp += ((showing ? 1 : 0) - insp) * Math.min(1, dt * (showing ? 9 : 6));

    // the blade always points the way you are going, so reversing the scroll rolls it over
    const rest = dir > 0 ? Math.PI + 0.24 : -0.24;
    const angT = rest + Math.round((ang - rest) / TAU) * TAU;
    angV += ((angT - ang) * 70 - angV * 11) * dt;
    ang += angV * dt;

    // crossing into a new section throws the knife
    const cur = sections.findIndex((s) => s.getBoundingClientRect().bottom > innerHeight * 0.5);
    if (passed !== -2 && cur !== passed && toss < 0 && insp < 0.3) { toss = 0; burst(x, y, 10, 0.4); }
    passed = cur;
    let ox = 0, oy = 0, tossAng = 0, tossYaw = 0, T = 0;
    if (toss >= 0) {
      toss += dt / 0.95;
      if (toss >= 1) { toss = -1; flash = 1; burst(x, y, 18, 0.5); }
      else {
        T = toss;
        const p = Math.sin(Math.PI * T), reach = Math.min(210 * S, W * 0.24);
        ox = -p * reach; oy = p * reach * 0.6 * (y < H * 0.45 ? 1 : -1); // always arc toward the open screen
        const e = 1 - (1 - T) ** 2.2;
        tossAng = TAU * 2 * dir * e;
        tossYaw = TAU * 2 * e;
      }
    }

    // idle trick: a turn about the long axis while one handle then the other swings out and back
    if (still > 1 && toss < 0 && !showing && !document.hidden && (trickIn -= dt) <= 0) {
      trickIn = 8; yawT += TAU; velL += 34; rollIn = 0.32; angV += 7 * dir;
    }
    if (rollIn >= 0 && (rollIn -= dt) < 0) velR += 34;

    // the showcase turns slowly; when it ends, finish the turn so the face lands flat
    if (insp > 0.5 && showing) yawT += dt * 1.5; else if (!showing) yawT = Math.ceil(yawT / TAU - 0.02) * TAU;
    yawV += ((yawT - yaw) * 60 - yawV * 13) * dt;
    yaw += yawV * dt;

    // handles: scrolling drives a wave through them, a beat apart
    amp += (Math.min(1, Math.abs(vy) / 1100) - amp) * Math.min(1, dt * 9);
    let tL = amp * 2.6 * (0.5 - 0.5 * Math.cos(phase));
    let tR = amp * 2.6 * (0.5 - 0.5 * Math.cos(phase + 1.3));
    if (insp > 0.05) {
      tL = Math.max(tL, insp * (0.34 + 0.1 * Math.sin(t * 2.6)));
      tR = Math.max(tR, insp * (0.34 + 0.1 * Math.sin(t * 2.6 + 0.8)));
    }
    if (toss >= 0) { const o = T < 0.84 ? Math.PI / 2 : 0; tL = o; tR = o; }
    [foldL, velL] = swingHandle(foldL, velL, tL, dt);
    [foldR, velR] = swingHandle(foldR, velR, tR, dt);

    lunge = Math.max(0, lunge - dt * 5);
    const inward = Math.min(150 * S, W * 0.2);
    const m = 175 * S;
    scale = S * (1 + 0.7 * insp);
    px = x + ox - inward * insp - lunge * 46 * S;
    py = y + (clamp(y, m, H - m) - y) * insp + oy;
    const base = ang + clamp(vy / 2600, -1, 1) * 0.38 + Math.sin(t * 1.1) * 0.05 + tossAng;
    const rot = base + wrap(0.42 - base) * insp;
    const c = Math.cos(yaw + tossYaw);
    const sx = Math.sign(c || 1) * Math.max(0.14, Math.abs(c));

    // blade tip slash left by fast turns, filled in so it stays a smooth curve
    const tipR = 88 * scale, turned = rot - lastRot;
    if (Math.abs(turned) > 0.07 && Math.abs(turned) < 2) {
      const n = Math.ceil(Math.abs(turned) / 0.1);
      for (let i = 1; i <= n; i++) {
        const r = lastRot + turned * (i / n);
        arc.push({ x: px + Math.sin(r) * tipR, y: py - Math.cos(r) * tipR, life: 1 - (1 - i / n) * dt * 3.4, seq: ++seq });
      }
    } else seq++;
    lastRot = rot;
    for (const p of arc) p.life -= dt * 3.4;
    while (arc.length && arc[0].life <= 0) arc.shift();
    if (insp > 0.6 && Math.random() < dt * 24) sparks.push({ x: px + (Math.random() - 0.5) * 70 * scale, y: py + (Math.random() - 0.5) * 180 * scale, vx: (Math.random() - 0.5) * 24, vy: -60 - Math.random() * 70, life: 0.8 });
    for (const s of sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    flash = Math.max(0, flash - dt * 2.4);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    if (insp > 0.02) {
      const r = 190 * scale;
      const halo = g.createRadialGradient(px, py, 0, px, py, r);
      halo.addColorStop(0, `rgba(46,227,91,${0.24 * insp})`);
      halo.addColorStop(1, 'rgba(46,227,91,0)');
      g.fillStyle = halo;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i];
      s.age += dt;
      const fade = 1 - clamp((s.age - 0.09) / 0.34, 0, 1);
      if (fade <= 0) { slashes.splice(i, 1); continue; }
      const reach = s.len * clamp(s.age / 0.09, 0, 1);
      const w = (s.big ? 34 : 22) * Math.max(0.8, S) * fade;
      const cx = Math.cos(s.a), cy = Math.sin(s.a), nx = -cy, ny = cx;
      const blade = (width, fill) => {
        path([s.x, s.y, s.x + cx * reach * 0.42 + nx * width, s.y + cy * reach * 0.42 + ny * width, s.x + cx * reach, s.y + cy * reach, s.x + cx * reach * 0.42 - nx * width, s.y + cy * reach * 0.42 - ny * width]);
        g.fillStyle = fill; g.fill();
      };
      blade(w, `rgba(46,227,91,${0.55 * fade})`);
      blade(w * 0.28, `rgba(235,255,240,${fade})`);
    }
    for (let i = 1; i < arc.length; i++) {
      const a = arc[i - 1], b = arc[i];
      if (b.seq !== a.seq + 1) continue;
      g.strokeStyle = `rgba(46,227,91,${0.4 * b.life})`; g.lineWidth = 7 * b.life * S;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = `rgba(220,255,230,${0.85 * b.life})`; g.lineWidth = 1.6 * b.life * S;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (const s of sparks) { g.fillStyle = `rgba(140,255,170,${Math.min(1, s.life * 1.6)})`; g.beginPath(); g.arc(s.x, s.y, 2, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    const glint = Math.max(flash, amp * 0.3, (1 - Math.abs(c)) * 0.5, insp * 0.35);
    drawKnife(px, py, rot, foldL, foldR, scale, sx, glint, insp > 0.3 ? (t * 0.7) % 1 : -1);

    // the touch area: tight on the knife while riding; while it is showing, it also covers the way back to
    // the rail, so the knife moving out from under a still cursor cannot make it drop out and shake
    let bw, bh, bx, by, br;
    if (showing || insp > 0.05) {
      bw = W - (x - inward - 130 * S * 1.7); bh = Math.max(280, 400 * S);
      bx = W - bw; by = clamp(y, m, H - m) - bh / 2; br = 0;
    } else {
      bw = Math.max(44, 64 * S); bh = Math.max(110, 190 * S);
      bx = x - bw / 2; by = y - bh / 2; br = rot;
    }
    if (`${bw}` !== hitW) hit.style.width = `${hitW = `${bw}`}px`;
    if (`${bh}` !== hitH) hit.style.height = `${hitH = `${bh}`}px`;
    hit.style.transform = `translate(${bx}px,${by}px) rotate(${br}rad)`;
    const wantTag = insp > 0.45;
    if (wantTag !== tagOn) { tagOn = wantTag; tag.classList.toggle('on', tagOn); }
    if (tagOn) tag.style.transform = `translate(${Math.max(10, px - 78 * scale - tag.offsetWidth)}px,${clamp(py - 50, 80, H - 130)}px)`;
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
bindTilt(document.querySelectorAll('.links a, .gcard, .gc'));
renderVideos('all', false);

// ------------------------------------------------------------------ games: the phone loops a trailer while on screen
// Playing happens on the game's own page (new tab), so nothing on this page can interrupt a run.
for (const trailer of document.querySelectorAll('.phone video')) {
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !matchMedia('(prefers-reduced-motion: reduce)').matches) trailer.play().catch(() => {});
    else trailer.pause();
  }, { threshold: 0.2 }).observe(trailer);
}
