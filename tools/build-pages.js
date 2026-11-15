// Writes every page of the site as static HTML (real text in the HTML, for search and AdSense):
// the homepage, the guides, the guides index, game category pages, about, contact, privacy, terms, 404, sitemap.
//   bun tools/build-pages.js
import { GUIDES } from '../content/guides.js';
import { ARCHIVED_GUIDES } from '../content/archived-guides.js';
import { GAMES as VIDEO_GAMES, VIDEOS } from '../src/videos.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// SITE_URL=https://yourdomain.com bun tools/build-pages.js  -> also writes sitemap.xml + robots.txt with the real address
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.CONTACT_EMAIL || ''; // shown on the privacy, about, contact and terms pages when set
const YT = 'https://www.youtube.com/@Zibnoofficial';
const SOCIAL = [['YouTube', '@Zibnoofficial', YT], ['X (Twitter)', '@zibnoapex', 'https://twitter.com/zibnoapex'], ['Telegram', 't.me/zibnoofficial', 'https://t.me/zibnoofficial'], ['TikTok', '@zibnoofficial', 'https://www.tiktok.com/@zibnoofficial']];
const STATS = { subs: '6.9K', videos: '682', top: '91K' }; // channel numbers, update by hand

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// [[guide-slug|link text]] inside any text becomes an internal link
const inline = (s) => esc(s).replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, (_, slug, text) => `<a href="/guides/${slug}.html">${text}</a>`);
const plain = (s) => s.replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, '$1');
const slugify = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const block = ([t, v, x]) => {
  if (t === 'img') return `<figure class="gimg"><img src="${esc(v)}" alt="${esc(x || '')}" loading="lazy">${x ? `<figcaption>${esc(x)}</figcaption>` : ''}</figure>`;
  if (t === 'h2') return `<h2 id="${slugify(v)}">${inline(v)}</h2>`;
  if (t === 'ul' || t === 'ol') return `<${t}>${v.map((i) => `<li>${inline(i)}</li>`).join('')}</${t}>`;
  if (t === 'dl') return `<dl>${v.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${inline(b)}</dd>`).join('')}</dl>`;
  if (t === 'tip') return `<p class="tip"><b>Tip</b> ${inline(v)}</p>`;
  if (t === 'faq') return `<h2 id="faq">FAQ</h2><div class="faq">${v.map(([q, a]) => `<h3>${esc(q)}</h3><p>${inline(a)}</p>`).join('')}</div>`;
  if (t === 'src') return `<h2 id="sources">Sources</h2><ul class="src">${v.map(([label, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(label)}</a></li>`).join('')}</ul>`;
  return `<${t}>${inline(v)}</${t}>`;
};
const abs = (p) => (SITE_URL ? SITE_URL + p : p);
const ldTag = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

// game category pages: only for games with enough guides to make a real page
const CATEGORIES = [
  { slug: 'valorant-mobile', game: 'Valorant Mobile', image: '/hero/card_valorant.jpg',
    intro: 'Valorant Mobile launched first in China, with menus only in Chinese. These guides cover how to download and log in to the China version from outside China, every settings screen translated into English, how the mobile game differs from PC, and where the global release stands.' },
  { slug: 'delta-force', game: 'Delta Force', image: '/hero/card_deltaforce.jpg',
    intro: 'Delta Force runs on PC, console and mobile with shared progression. These guides cover the mobile settings in English, phone requirements, cross-progression and controller support, and what each new season and event adds.' },
];
const catOf = (game) => CATEGORIES.find((c) => c.game === game);

const NAV = [['Home', '/'], ['Guides', '/guides/'], ...CATEGORIES.map((c) => [c.game, `/guides/${c.slug}.html`]), ['Videos', '/#videos'], ['About', '/about.html'], ['Contact', '/contact.html']];

// path: the page's URL path (for canonical / og:url); image: share image path; ld: structured data objects
const ICON_MOON = '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>';
const ICON_SUN = '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
// the stored light/dark choice is applied before the stylesheet paints, so a dark-mode reader never sees a white flash
const THEME_BOOT = "document.documentElement.className = 'js'; try { var t = localStorage.getItem('zibno-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}";

const page = (title, desc, main, { path = '', image = '/hero/plate.jpg', type = 'website', ld = [], cls = 'doc', fullTitle = '', progress = false } = {}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111311" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%232ee35b%22/%3E%3Cpath d=%22M9 9h14v3L13.5 20H23v3H9v-3l9.5-8H9z%22 fill=%22%230b2a14%22/%3E%3C/svg%3E">
<title>${esc(fullTitle || `${title} | Zibno`)}</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL && path ? `<link rel="canonical" href="${abs(path)}">\n<meta property="og:url" content="${abs(path)}">\n` : ''}<meta property="og:site_name" content="Zibno">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${abs(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@zibnoapex">
<script>${THEME_BOOT}</script>
<link rel="stylesheet" href="/src/page.css">
<script type="module" src="/src/cards.js"></script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4488971638965066" crossorigin="anonymous"></script>
${ld.map(ldTag).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="strap"><div class="wrap strap-in"><span><i class="dot"></i>Mobile shooter guides · Settings in English · Early access</span><span class="strap-r"><a href="${YT}" target="_blank" rel="noopener">${STATS.subs} subscribers on YouTube</a> · <a href="/guides/">${GUIDES.length} guides</a></span></div></div>
<header class="top">
<div class="wrap top-in">
<button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><i></i><i></i><i></i></button>
<a class="logo" href="/" aria-label="Zibno home"><span class="logo-z">Z</span><span class="logo-w">Zibno</span></a>
<nav id="site-nav" aria-label="Main">${NAV.map(([t, h]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>
<div class="top-act"><button class="theme-btn" type="button" aria-label="Switch colour theme">${ICON_MOON}${ICON_SUN}</button><a class="top-yt" href="${YT}" target="_blank" rel="noopener"><span>YouTube</span></a></div>
</div>
${progress ? '<div class="progress" aria-hidden="true"><i></i></div>' : ''}
</header>
<main id="main" class="${cls}">${main}</main>
<footer class="foot">
<div class="wrap foot-mark"><b>Zibno<span>.</span></b><p>Mobile shooter guides, settings translated into English and early-access news, by the creator of the Zibno Official YouTube channel.</p></div>
<div class="wrap foot-in">
<div><h3>Guides</h3><ul><li><a href="/guides/">All guides</a></li>${CATEGORIES.map((c) => `<li><a href="/guides/${c.slug}.html">${esc(c.game)}</a></li>`).join('')}<li><a href="/guides/settings-glossary.html">Settings glossary</a></li><li><a href="/#videos">Videos</a></li><li><a href="/#games">Free games</a></li></ul></div>
<div><h3>Site</h3><ul><li><a href="/about.html">About</a></li><li><a href="/about.html#how-guides-are-made">How guides are made</a></li><li><a href="/contact.html">Contact</a></li><li><a href="/privacy.html">Privacy policy</a></li><li><a href="/terms.html">Terms of use</a></li></ul></div>
<div><h3>Follow</h3><ul>${SOCIAL.map(([n, , h]) => `<li>${ext(h, n)}</li>`).join('')}</ul></div>
<div class="foot-sub"><h3>New guides first</h3><p>Every guide starts as a video. Subscribe and you will see the next one the day it drops.</p><a class="btn" href="${YT}?sub_confirmation=1" target="_blank" rel="noopener">Subscribe on YouTube</a></div>
</div>
<p class="wrap legal">© 2026 Zibno. Zibno is an independent creator and is not affiliated with or endorsed by Riot Games, Tencent, TiMi, Electronic Arts or Respawn. Game names and images belong to their owners. Some links on this site are affiliate links; I may earn a commission at no cost to you.</p>
</footer>
</body>
</html>
`;

const AUTHOR = { '@type': 'Person', name: 'Zibno', url: YT };
// guides written from the web may have no video of mine: they use game art instead (g.image)
const thumb = (g) => (g.video ? `/videos/${g.video}.jpg` : g.image);
const kick = (g) => (g.news ? 'News' : esc(g.game));
const when = (g) => `${longDate(g.updated || g.date)} · ${mins(g)} min read`;
const card = (g) => `<a class="card" href="/guides/${g.slug}.html"><figure><img src="${thumb(g)}" alt="" loading="lazy" width="640" height="360"></figure><span class="tag">${kick(g)}</span><b>${esc(g.title)}</b><p>${esc(g.description)}</p><em>${when(g)}</em></a>`;
// reading time from the guide's own text, about 220 words a minute
const mins = (g) => Math.max(1, Math.round((JSON.stringify(g.body).replace(/<[^>]*>/g, ' ').match(/[A-Za-z0-9']+/g) || []).length / 220));
const SORTED = [...GUIDES].sort((a, b) => (b.updated || b.date).localeCompare(a.updated || a.date));
const authorBox = `<aside class="author" aria-label="About the author">
<img src="/chars/zibno_reach.webp" alt="" width="96" height="96" loading="lazy">
<div><b>Written by Zibno</b><p>I make mobile shooter guides on YouTube (${STATS.subs} subscribers, ${STATS.videos} videos), focused on games that launch in China or closed beta first. I check settings on my own phone and list my sources. <a href="/about.html#how-guides-are-made">How I make guides</a> · <a href="/contact.html#corrections">Report a correction</a></p></div>
</aside>`;

// ---------------------------------------------------------------- guides
mkdirSync('guides', { recursive: true });
for (const g of GUIDES) {
  const path = `/guides/${g.slug}.html`;
  const cat = catOf(g.game);
  // same game first, then the newest of the rest
  const related = [...SORTED.filter((o) => o !== g && o.game === g.game), ...SORTED.filter((o) => o.game !== g.game)].slice(0, 4);
  // sidebar contents list: every h2 in the body, plus FAQ / Sources when present
  const toc = g.body.flatMap(([t, v]) => (t === 'h2' ? [[slugify(v), plain(v)]] : t === 'faq' ? [['faq', 'FAQ']] : t === 'src' ? [['sources', 'Sources']] : []));
  const faq = g.body.find(([t]) => t === 'faq');
  const crumbs = [['Guides', '/guides/'], ...(cat ? [[cat.game, `/guides/${cat.slug}.html`]] : [])];
  const ld = [
    { '@context': 'https://schema.org', '@type': g.news ? 'NewsArticle' : 'Article', headline: g.title, description: g.description, image: [abs(thumb(g))],
      datePublished: g.date, dateModified: g.updated || g.date, author: AUTHOR, publisher: AUTHOR, mainEntityOfPage: abs(path), about: { '@type': 'VideoGame', name: g.game } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [...crumbs, [g.title, path]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(item) })) },
  ];
  if (faq) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq[1].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: plain(a) } })) });
  writeFileSync(`guides/${g.slug}.html`, page(g.title, g.description, `
<header class="story-head">
<p class="crumb">${crumbs.map(([t, h]) => `<a href="${h}">${esc(t)}</a>`).join(' / ')}</p>
<p class="kicker">${cat ? `<a href="/guides/${cat.slug}.html">${esc(g.game)}</a>` : esc(g.game)}${g.news ? ' · News' : ' · Guide'}</p>
<h1>${esc(g.title)}</h1>
<p class="dek">${esc(g.description)}</p>
<p class="byline"><span><img src="/chars/zibno_reach.webp" alt="" width="60" height="60">By <a href="/about.html">Zibno</a></span><span>${g.updated ? `Updated <time datetime="${g.updated}">${longDate(g.updated)}</time>` : `<time datetime="${g.date}">${longDate(g.date)}</time>`}</span><span>${mins(g)} min read</span></p>
</header>
<figure class="story-media">
${g.video ? `<a class="watch" href="https://www.youtube.com/watch?v=${g.video}" target="_blank" rel="noopener"><img src="/videos/${g.video}.jpg" alt="${esc(g.title)}, video thumbnail" width="1280" height="720" fetchpriority="high"><span class="play" aria-hidden="true"></span></a>
<figcaption><span>${g.relatedVideo ? 'Related video on my channel' : 'This guide is based on my video'}</span><a href="https://www.youtube.com/watch?v=${g.video}" target="_blank" rel="noopener">Watch on YouTube</a></figcaption>` : `<img class="hero-img" src="${g.image}" alt="${esc(g.game)}" width="1280" height="720" fetchpriority="high">
<figcaption><span>${esc(g.game)}</span><span>Game art belongs to its owners</span></figcaption>`}
</figure>
<div class="gwrap">
<article class="gart">
${g.body.map(block).join('\n')}
<p class="by">${!g.body.some(([t]) => t === 'src') ? 'Written by Zibno, based on my video. Settings can change with game updates.'
  : g.video && !g.relatedVideo ? 'Written by Zibno, based on my video, with extra research from the sources listed above. Settings can change with game updates.'
  : 'Written by Zibno from the sources listed above. I update this page when something official changes.'}</p>
${authorBox}
</article>
<aside class="side">
${/settings/.test(g.slug) ? '<a class="side-gloss" href="/guides/settings-glossary.html"><b>Settings glossary</b><span>Search every setting from all my settings guides in one place.</span></a>' : ''}<nav class="toc" aria-label="On this page"><b>On this page</b><ol>${toc.map(([id, text]) => `<li><a href="#${id}">${esc(text)}</a></li>`).join('')}</ol></nav>
<a class="side-yt" href="${YT}" target="_blank" rel="noopener"><b>Zibno on YouTube</b><span>Guides, settings and early-access news for mobile shooters.</span><i>Subscribe</i></a>
</aside>
</div>
<section class="more"><header class="rubric"><h2>Keep reading</h2><a href="/guides/">All guides</a></header><div class="glist">${related.map(card).join('')}</div></section>`, { path, image: thumb(g), type: 'article', ld, cls: 'doc guide', progress: true }));
}

// retired thin posts: a noindex page at each old URL that sends readers (and Google) to the closest live guide
const REDIRECTS = {
  'delta-force-mobile-beta-first-look': 'delta-force-mobile-requirements-cross-progression',
  'how-to-create-qq-account': 'valorant-mobile-china-pre-register',
  'high-energy-heroes-season-5-early-access': 'high-energy-heroes-settings-english',
  'duowan-streaming-app-for-beginners': '',
  'ios-18-call-recording': '',
  'best-mobile-shooting-games-2024': '',
  'high-energy-heroes-season-4-review': 'high-energy-heroes-settings-english',
  'high-energy-heroes-monkey-king-legend-leak': 'high-energy-heroes-settings-english',
  'high-energy-heroes-season-5-female-fade-corona-city': 'high-energy-heroes-settings-english',
  'ios-18-best-features-wwdc-2024': '',
};
for (const a of ARCHIVED_GUIDES) if (!(a.slug in REDIRECTS)) throw new Error(`archived guide ${a.slug} has no entry in REDIRECTS`);
for (const [from, to] of Object.entries(REDIRECTS)) {
  if (to && !GUIDES.some((g) => g.slug === to)) throw new Error(`redirect target ${to} is not a live guide`);
  const target = to ? `/guides/${to}.html` : '/guides/';
  writeFileSync(`guides/${from}.html`, `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Moved | Zibno</title><meta name="robots" content="noindex,follow">
<link rel="canonical" href="${abs(target)}"><meta http-equiv="refresh" content="0; url=${target}"></head>
<body><p>This page has moved. <a href="${target}">Continue to the new page</a>.</p></body></html>
`);
}
// every [[slug|text]] link must point at a live guide
for (const g of GUIDES) for (const [, slug] of JSON.stringify(g.body).matchAll(/\[\[([a-z0-9-]+)\|/g))
  if (!GUIDES.some((o) => o.slug === slug)) throw new Error(`${g.slug} links to missing guide ${slug}`);
for (const c of CATEGORIES) if (GUIDES.some((g) => g.slug === c.slug)) throw new Error(`category ${c.slug} clashes with a guide slug`);

// ---------------------------------------------------------------- guides index + game category pages
const gameCounts = Object.entries(GUIDES.reduce((m, g) => ({ ...m, [g.game]: (m[g.game] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
writeFileSync('guides/index.html', page('Mobile shooter guides and news', 'Settings guides in English, download guides and news for Valorant Mobile, Delta Force, High Energy Heroes and Ace Force 2, by Zibno.', `
<header class="phead"><p class="crumb"><a href="/">Home</a> / Guides</p><h1>Guides</h1>
<p class="lede">My most-watched videos written out so you can read them at your own pace, plus news on the games I cover. ${GUIDES.length} guides, newest first. Looking for one option? Search the <a href="/guides/settings-glossary.html">settings glossary</a>.</p>
<p class="pills">${gameCounts.map(([game, n]) => { const c = catOf(game); return c ? `<a href="/guides/${c.slug}.html">${esc(game)} <i>${n}</i></a>` : `<span>${esc(game)} <i>${n}</i></span>`; }).join('')}</p></header>
<div class="glist">${SORTED.map(card).join('')}</div>`, { path: '/guides/', cls: 'doc wide', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Zibno guides', hasPart: SORTED.map((g) => ({ '@type': 'Article', headline: g.title, url: abs(`/guides/${g.slug}.html`) })) }] }));

for (const c of CATEGORIES) {
  const list = SORTED.filter((g) => g.game === c.game);
  const path = `/guides/${c.slug}.html`;
  writeFileSync(`guides/${c.slug}.html`, page(`${c.game} guides`, `${c.game} guides by Zibno: ${list.length} guides on settings in English, downloads and news.`, `
<header class="cat-head" style="--img:url(${c.image})"><p class="crumb"><a href="/">Home</a> / <a href="/guides/">Guides</a> / ${esc(c.game)}</p><h1>${esc(c.game)} guides</h1>
<p class="lede">${esc(c.intro)}</p><span class="count">${list.length} guides</span></header>
<div class="glist">${list.map(card).join('')}</div>
<p class="back"><a href="/guides/">See all ${GUIDES.length} guides</a></p>`, { path, image: c.image, cls: 'doc wide', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.game} guides`, hasPart: list.map((g) => ({ '@type': 'Article', headline: g.title, url: abs(`/guides/${g.slug}.html`) })) }] }));
}

// ---------------------------------------------------------------- settings glossary
// every setting explained in the settings guides, in one searchable page, each linking back to its section
const GLOSSARY = [];
for (const g of GUIDES.filter((x) => /settings/.test(x.slug))) {
  let sec = '';
  for (const [t, v] of g.body) {
    if (t === 'h2') sec = v;
    // lobby buttons, game modes and download steps are not settings
    if (/lobby|bottom|top left|modes|download|which setup/i.test(sec)) continue;
    // one-word choices like Tap or Off only make sense with the setting they belong to
    const add = (term, text) => GLOSSARY.push({ term: /^(Off|Tap|Hold|Mixed)$/.test(term) ? `${plain(sec).split(/[,:]/)[0]}: ${term}` : plain(term), text, game: g.game, guide: g, sec: plain(sec) });
    if (t === 'dl') for (const [a, b] of v) add(a, b);
    if (t === 'ul') for (const i of v) { const m = /^([A-Z][^:.]{1,40}): (.{20,})$/.exec(i); if (m) add(m[1], m[2]); }
  }
}
const glossGames = [...new Set(GLOSSARY.map((e) => e.game))];
writeFileSync('guides/settings-glossary.html', page('Mobile shooter settings glossary', `${GLOSSARY.length} settings from Valorant Mobile, Delta Force Mobile and High Energy Heroes explained in plain English, with a search box and a link to the full guide for each one.`, `
<header class="phead"><p class="crumb"><a href="/">Home</a> / <a href="/guides/">Guides</a> / Settings glossary</p><h1>Settings glossary</h1>
<p class="lede">Every setting I explain in my settings guides, in one place: ${GLOSSARY.length} options from ${glossGames.join(', ').replace(/, ([^,]*)$/, ' and $1')}. Type a setting name, or part of what it does, to find it. Each entry links to the guide section where it is explained in full.</p>
<p class="gsearch"><input type="search" id="gq" placeholder="Search settings, e.g. gyroscope, walk, smart fire" aria-label="Search the settings glossary" autocomplete="off"><span id="gcount" aria-live="polite"></span></p>
<p class="pills">${glossGames.map((game) => `<a href="#${slugify(game)}">${esc(game)} <i>${GLOSSARY.filter((e) => e.game === game).length}</i></a>`).join('')}</p></header>
${glossGames.map((game) => `<section class="gloss" id="${slugify(game)}"><h2>${esc(game)}</h2><dl>${GLOSSARY.filter((e) => e.game === game).sort((a, b) => a.term.localeCompare(b.term)).map((e) => `<div class="gitem"><dt>${esc(e.term)}</dt><dd>${inline(e.text.charAt(0).toUpperCase() + e.text.slice(1))} <a class="gsrc" href="/guides/${e.guide.slug}.html${e.sec ? `#${slugify(e.sec)}` : ''}">Read more: ${esc(e.guide.title)}${e.sec ? ` › ${esc(e.sec)}` : ''}</a></dd></div>`).join('')}</dl></section>`).join('\n')}
<p class="back" id="gnone" hidden>No setting matches that. Try a shorter word, or <a href="/guides/">browse all guides</a>.</p>
<script>
(() => { const q = document.getElementById('gq'), items = [...document.querySelectorAll('.gitem')], count = document.getElementById('gcount'), none = document.getElementById('gnone');
  const run = () => { const s = q.value.trim().toLowerCase(); let n = 0;
    for (const el of items) { const hit = !s || el.textContent.toLowerCase().includes(s); el.hidden = !hit; n += hit; }
    for (const sec of document.querySelectorAll('.gloss')) sec.hidden = !sec.querySelector('.gitem:not([hidden])');
    count.textContent = s ? n + ' of ' + items.length : ''; none.hidden = n > 0; };
  q.addEventListener('input', run);
  // the homepage search box sends ?q=: start with that search filled in
  const pre = new URLSearchParams(location.search).get('q'); if (pre) { q.value = pre; run(); } })();
</script>`, { path: '/guides/settings-glossary.html', cls: 'doc', ld: [{ '@context': 'https://schema.org', '@type': 'DefinedTermSet', name: 'Mobile shooter settings glossary', url: abs('/guides/settings-glossary.html'),
  hasDefinedTerm: GLOSSARY.map((e) => ({ '@type': 'DefinedTerm', name: e.term, description: plain(e.text.charAt(0).toUpperCase() + e.text.slice(1)), inDefinedTermSet: abs('/guides/settings-glossary.html') })) }] }));

// ---------------------------------------------------------------- homepage
{
  // front page of "The Mobile Shooter Journal": masthead, lead story + numbered latest, numbers, one desk per game,
  // the glossary finder, videos, games and a note from the editor
  const [lead, ...rest] = SORTED;
  const latest = rest.slice(0, 4);
  const newest = longDate(lead.updated || lead.date);
  const vid = ([id, game, title, views, top]) => `<a class="vid" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener" data-game="${game}"${top ? ' data-top' : ' hidden'}><figure><img src="/videos/${id}.jpg" alt="" loading="lazy" width="640" height="360"></figure><span class="tag">${esc(VIDEO_GAMES[game])}</span><b>${esc(title)}</b><em>${views} views</em></a>`;
  const games = [...new Set(VIDEOS.map((v) => v[1]))];
  const others = SORTED.filter((g) => !catOf(g.game));
  const desks = [
    ...CATEGORIES.map((c) => ({ name: c.game, href: `/guides/${c.slug}.html`, img: c.image, list: SORTED.filter((g) => g.game === c.game) })),
    { name: 'More games', href: '/guides/', img: '/hero/card_apex.jpg', list: others },
  ];
  const desk = (d) => `<div class="desk">
<a class="desk-cover" href="${d.href}" style="--img:url(${d.img})"><b>${esc(d.name)}</b><span>${d.list.length} guide${d.list.length === 1 ? '' : 's'}</span></a>
<ul>${d.list.slice(0, 4).map((g) => `<li><a href="/guides/${g.slug}.html">${esc(g.title)}</a></li>`).join('')}</ul>
<a class="more-link" href="${d.href}">${d.href === '/guides/' ? `All ${GUIDES.length} guides` : `All ${esc(d.name)} guides`}</a>
</div>`;
  writeFileSync('index.html', page('Zibno: mobile shooter guides, settings in English and news', 'Mobile shooter guides by Zibno: download guides for China and beta releases, every settings menu translated into English, and news for Valorant Mobile and Delta Force.', `
<section class="wrap cover" aria-labelledby="cover-title">
<header class="cover-head">
<h1 class="cover-title" id="cover-title">The mobile shooter <em>journal</em></h1>
<p class="cover-dek">When a shooter launches in China or closed beta first, I show you how to get in, then translate every settings screen into plain English. <b>Written guides, based on my YouTube videos.</b></p>
</header>
<nav class="cover-bar" aria-label="Sections"><span><a href="/guides/valorant-mobile.html">Valorant Mobile</a></span><span><a href="/guides/delta-force.html">Delta Force</a></span><span><a href="/guides/settings-glossary.html">Settings glossary</a></span><span><a href="#games">Free games</a></span><span>Updated ${newest}</span></nav>
<div class="cover-grid">
<article class="lead"><a href="/guides/${lead.slug}.html">
<figure><img src="${thumb(lead)}" alt="" width="1280" height="720" fetchpriority="high"><span class="badge">Lead story</span></figure>
<span class="kicker">${kick(lead)}</span>
<h2><span>${esc(lead.title)}</span></h2>
<p>${esc(lead.description)}</p>
<p class="meta">By Zibno · ${when(lead)}</p>
</a></article>
<aside class="latest-list" aria-labelledby="latest-title">
<h2 id="latest-title">Latest</h2>
<ol>${latest.map((g) => `<li><a href="/guides/${g.slug}.html"><div><span class="kicker">${kick(g)}</span><b>${esc(g.title)}</b><em>${when(g)}</em></div><img src="${thumb(g)}" alt="" loading="lazy" width="184" height="184"></a></li>`).join('')}</ol>
<a class="all" href="/guides/">See all ${GUIDES.length} guides</a>
</aside>
</div>
</section>

<section class="wrap numbers" aria-label="Zibno in numbers">
<dl><div><dt>Subscribers</dt><dd>${STATS.subs}</dd></div><div><dt>Videos</dt><dd>${STATS.videos}</dd></div><div><dt>Top video</dt><dd>${STATS.top}<small> views</small></dd></div><div><dt>Written guides</dt><dd>${GUIDES.length}</dd></div></dl>
</section>

<section class="wrap desks" id="guides">
<header class="rubric"><h2>By game</h2><p>Every guide, filed by the game it covers.</p><a href="/guides/">All guides</a></header>
<div class="desks-grid">${desks.map(desk).join('\n')}</div>
</section>

<section class="wrap">
<div class="finder">
<div><span class="kicker">Settings glossary</span><h2>Stuck on one setting? <em>Look it up.</em></h2><p>Every option from my settings guides in one searchable place, each linked to the full explanation.</p></div>
<div><form action="/guides/settings-glossary.html" method="get" role="search"><label class="sr-only" for="finder-q">Search settings</label><input id="finder-q" name="q" type="search" placeholder="Try gyroscope, smart fire, walk…" autocomplete="off"><button type="submit">Search</button></form>
<p class="examples">Popular: <a href="/guides/settings-glossary.html?q=gyro">gyroscope</a><a href="/guides/settings-glossary.html?q=fire">fire button</a><a href="/guides/settings-glossary.html?q=walk">walk</a></p></div>
</div>
</section>

<section class="wrap" id="videos">
<header class="rubric"><h2 id="vids-title">Most watched</h2><p>The videos people keep coming back to.</p>${ext(`${YT}/videos`, `All ${STATS.videos} videos`)}</header>
<div class="filters" role="tablist" aria-label="Filter videos by game"><button role="tab" data-game="all" aria-selected="true">All</button>${games.map((k) => `<button role="tab" data-game="${k}" aria-selected="false">${esc(VIDEO_GAMES[k])}</button>`).join('')}</div>
<div class="glist vids" id="vids">${VIDEOS.map(vid).join('')}</div>
</section>

<section class="wrap" id="games">
<header class="rubric"><h2>From the workshop</h2><p>Small browser games I build myself, in code. Free, no download, no sign-up.</p></header>
<div class="games">
<a class="game" href="/play/orbit-hop/index.html"><img src="/play/orbit-hop/poster.jpg" alt="Orbit Hop gameplay" loading="lazy" width="320" height="420"><div><span class="tag">Play free</span><b>Orbit Hop</b><p>Tap to jump from planet to planet. Gravity bends your flight, so time it right, grab the stars and unlock five astronaut skins.</p><span class="play">Play now →</span></div></a>
<a class="game" href="/play/voltlane/index.html"><img src="/play/voltlane/poster.jpg" alt="Voltlane gameplay" loading="lazy" width="320" height="420"><div><span class="tag">Play free</span><b>Voltlane</b><p>A 60-second neon score attack. Fly 16 jets armed with guns, rockets and sabers, smash through walls and chain cores up to x8.</p><span class="play">Play now →</span></div></a>
</div>
</section>

<section class="wrap editor" aria-labelledby="editor-title">
<div class="letter">
<div class="letter-head"><img src="/chars/zibno_reach.webp" alt="The Zibno mascot" width="152" height="152" loading="lazy"><div><span class="kicker">From the editor</span><h2 id="editor-title">Why this site exists</h2></div></div>
<p>My name is Zibno, and I make videos about mobile shooters. I cover Valorant Mobile, Delta Force, Apex Legends Mobile, High Energy Heroes and whatever drops next, with a focus on games that release in China or in closed beta first, when the menus are still in Chinese and nobody has explained them yet.</p>
<p>Every guide here is based on one of my videos or on official sources, which I link. I play on my own phone, I don't publish settings I haven't looked at, and I update guides when games change.</p>
<p class="sign">Zibno</p>
<p class="cta"><a class="btn" href="/about.html">More about me</a><a class="btn ghost" href="/contact.html">Contact</a></p>
</div>
<ul class="facts"><li><b>Early access</b><span>Download steps for China and beta releases, the day they drop.</span></li><li><b>Settings in English</b><span>Every menu translated and explained, screen by screen.</span></li><li><b>Checked and sourced</b><span>Played on my phone, sources linked, corrections welcome.</span></li></ul>
</section>`, { path: '/', cls: 'home', fullTitle: 'Zibno: mobile shooter guides, settings in English and news', ld: [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Zibno', url: abs('/'), publisher: { ...AUTHOR, sameAs: SOCIAL.map((s) => s[2]) } }] }));
}

// ---------------------------------------------------------------- about, contact, privacy, terms, 404
writeFileSync('about.html', page('About Zibno', 'Zibno is an FPS mobile gaming creator: early-access download guides and Chinese-to-English settings translations for Valorant Mobile, Delta Force and other mobile shooters.', `
<header class="phead"><h1>About Zibno</h1>
<p class="lede">I make guides for mobile shooters, with a focus on games that launch in China or in closed beta before they reach the rest of the world.</p></header>
<h2 id="what-i-do">What I do</h2>
<p>When a new shooter appears on mobile, the menus are often only in Chinese and the download steps are unclear. I show how to get the game, then go through the settings screen by screen and explain what every option does in plain English, so you can set up your controls properly on day one.</p>
<p>My channel, Zibno Official, has about ${STATS.subs} subscribers and ${STATS.videos} videos. My most-watched guides cover Valorant Mobile, Delta Force Mobile and High Energy Heroes, and one video has passed 90K views.</p>
<h2 id="how-guides-are-made">How guides are made</h2>
<ul><li>Each written guide is based on one of my own videos and follows what I explain in it, or on official sources, which are listed at the end of the guide.</li><li>I play on my own phone. I do not publish settings I have not looked at myself.</li><li>When a game updates, menus and options can change. Each guide shows the date it was last updated and links to its video so you can check.</li><li>If I am not sure what an option does, I say so instead of guessing.</li><li>News pages say what is officially confirmed and what is not. I do not post rumours as facts.</li><li>I remove or rewrite old guides that are no longer accurate or useful.</li></ul>
<h2 id="corrections">Corrections</h2>
<p>If something in a guide is wrong or out of date, <a href="/contact.html#corrections">tell me</a> and I will fix it and update the date on the page.</p>
<h2 id="sponsorships-and-affiliate-links">Sponsorships and affiliate links</h2>
<p>Some links are affiliate links, such as the booster app I use for the China versions of games. I only link tools I use myself, and I mark affiliate links where they appear. Sponsors do not get to review or change my guides. For brand deals and collaborations, see the <a href="/contact.html">contact page</a>.</p>
<h2 id="find-me">Find me</h2>
<ul>${SOCIAL.map(([n, h, u]) => `<li>${ext(u, `${n}: ${h}`)}</li>`).join('')}</ul>`, { path: '/about.html' }));

writeFileSync('contact.html', page('Contact Zibno', 'How to contact Zibno for brand deals, sponsored videos, early-access coverage, collaborations, corrections and questions about this site.', `
<header class="phead"><h1>Contact</h1>
<p class="lede">Brand deals, sponsored videos, early-access coverage, collabs, or a correction to one of my guides: here is how to reach me.</p></header>
<h2 id="email">Email</h2>
<p>${EMAIL ? `<a href="mailto:${EMAIL}">${EMAIL}</a>. This is the best way for business enquiries. I usually reply within a few days.` : 'Message me on Telegram or X below.'}</p>
<h2 id="social">Social</h2>
<ul>${SOCIAL.map(([n, h, u]) => `<li>${ext(u, `${n}: ${h}`)}</li>`).join('')}</ul>
<h2 id="corrections">Corrections</h2>
<p>Games update often, and menus or numbers in a guide can change. If something in a guide is wrong or out of date, email me with the page link and what changed, and I will fix it.</p>
<h2 id="please-note">Please note</h2>
<ul><li>I do not sell accounts, APKs, top-ups or game items, and I will never ask for your password or login codes.</li><li>Anyone messaging you as "Zibno" from another account is not me. My only accounts are the ones listed on this page.</li></ul>`, { path: '/contact.html' }));

writeFileSync('privacy.html', page('Privacy policy', 'How the Zibno website handles your data, cookies and advertising.', `
<header class="phead"><h1>Privacy policy</h1>
<p class="lede">Last updated: 14 November 2026</p></header>
<p>This website (the "site") is run by Zibno, the creator of the Zibno Official YouTube channel. This page explains what data is collected when you visit and how it is used.</p>
<h2>What I collect</h2>
<p>The site has no accounts, sign-ups or forms, and I do not ask for or store your name, email or other personal details. Like every website, the hosting provider may keep standard server logs (such as IP address, browser type and the pages requested) for security and performance.</p>
<h2>Cookies and advertising</h2>
<p>This site may show ads from Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your previous visits to this site and other websites. Google's use of advertising cookies lets it and its partners show ads to you based on those visits.</p>
<ul><li>You can turn off personalised ads in ${ext('https://www.google.com/settings/ads', 'Google Ads Settings')}.</li><li>You can opt out of some third-party vendors' cookies at ${ext('https://www.aboutads.info/choices/', 'aboutads.info')}.</li><li>When ads are switched on for this site, visitors from the EEA, UK and Switzerland will see a consent message from Google before any personalised ads are shown.</li></ul>
<p>Read more in ${ext('https://policies.google.com/technologies/ads', 'how Google uses data from sites that use its services')}.</p>
<h2>Embedded links and affiliate links</h2>
<p>Links to YouTube, X, Telegram and other sites take you to services with their own privacy policies. Some links are affiliate links, which means I may earn a small commission at no extra cost to you. They are labelled where they appear.</p>
<h2>Local storage</h2>
<p>Games on this site may save your progress, such as high scores, in your browser's local storage. That data stays on your device.</p>
<h2>Children</h2>
<p>This site is not directed at children under 13, and I do not knowingly collect data from them.</p>
<h2>Contact</h2>
<p>Questions about this policy: ${EMAIL ? `email <a href="mailto:${EMAIL}">${EMAIL}</a>, or ` : ''}message me on ${ext('https://t.me/zibnoofficial', 'Telegram')} or ${ext('https://twitter.com/zibnoapex', 'X')}.</p>`, { path: '/privacy.html' }));

writeFileSync('terms.html', page('Terms of use', 'The terms for using the Zibno website: guides, games, links and advertising.', `
<header class="phead"><h1>Terms of use</h1>
<p class="lede">Last updated: 14 November 2026</p></header>
<p>By using this website (the "site") you agree to these terms. If you do not agree, please do not use the site.</p>
<h2>Guides and information</h2>
<p>The guides are written in good faith from my own videos and from official sources. Games change often, so settings, menus, release dates and requirements may be out of date by the time you read them. The guides are for general information only, and you use them at your own risk.</p>
<h2>Third-party games, apps and services</h2>
<p>Some guides explain how to use games, apps or services run by other companies, including versions released only in some regions. You are responsible for following the terms of those services and the laws where you live. I do not provide accounts, APKs, top-ups or game items.</p>
<h2>Games on this site</h2>
<p>The browser games on this site are free to play and are provided as they are, without any guarantee that they will always be available or work on every device.</p>
<h2>Links, affiliate links and advertising</h2>
<p>The site links to other websites that I do not control. Some links are affiliate links, and the site may show ads from Google AdSense. See the <a href="/privacy.html">privacy policy</a> for how advertising cookies work.</p>
<h2>Copyright and trademarks</h2>
<p>The text, the Zibno name and mascot, and the games on this site belong to Zibno. Please do not copy whole guides to other sites; a short quote with a link back is fine. Game names, logos and images belong to their owners and are used only to identify the games being discussed.</p>
<h2>Changes</h2>
<p>I may update these terms. The date at the top of this page shows when they last changed.</p>
<h2>Contact</h2>
<p>Questions about these terms: see the <a href="/contact.html">contact page</a>${EMAIL ? ` or email <a href="mailto:${EMAIL}">${EMAIL}</a>` : ''}.</p>`, { path: '/terms.html' }));

writeFileSync('404.html', page('Page not found', 'This page does not exist.', '<header class="phead"><h1>Page not found</h1><p class="lede">That page does not exist or has moved.</p></header><p><a href="/">Go to the homepage</a> or browse the <a href="/guides/">guides</a>.</p>'));

// ---------------------------------------------------------------- sitemap + robots
mkdirSync('public', { recursive: true });
const NL = String.fromCharCode(10);
if (SITE_URL) {
  const newest = SORTED[0].updated || SORTED[0].date;
  const urls = [['/', newest], ['/guides/', newest], ...CATEGORIES.map((c) => [`/guides/${c.slug}.html`, newest]), ['/about.html'], ['/contact.html'], ['/privacy.html'], ['/terms.html'], ['/guides/settings-glossary.html', newest], ['/play/orbit-hop/'], ['/play/voltlane/'], ...GUIDES.map((g) => [`/guides/${g.slug}.html`, g.updated || g.date])];
  const body = urls.map(([u, d]) => `  <url><loc>${SITE_URL}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join(NL);
  writeFileSync('public/sitemap.xml', ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', body, '</urlset>', ''].join(NL));
  writeFileSync('public/robots.txt', ['User-agent: *', 'Allow: /', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join(NL));
} else {
  writeFileSync('public/robots.txt', ['User-agent: *', 'Allow: /', ''].join(NL));
}
console.log('wrote home +', GUIDES.length, 'guides +', CATEGORIES.length, 'categories + glossary (' + GLOSSARY.length + ' settings) + index + about + contact + privacy + terms + 404', EMAIL ? 'with email' : 'NO EMAIL');
