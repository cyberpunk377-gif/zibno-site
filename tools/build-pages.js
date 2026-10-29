// Writes static HTML for the guides and the privacy policy (real text in the HTML, for search and AdSense).
//   bun tools/build-pages.js
import { GUIDES } from '../content/guides.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// SITE_URL=https://yourdomain.com bun tools/build-pages.js  -> also writes sitemap.xml + robots.txt with the real address
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.CONTACT_EMAIL || ''; // shown on the privacy page and About page when set

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// [[guide-slug|link text]] inside any text becomes an internal link
const inline = (s) => esc(s).replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, (_, slug, text) => `<a href="/guides/${slug}.html">${text}</a>`);
const plain = (s) => s.replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, '$1');
const slugify = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const block = ([t, v]) => {
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
// path: the page's URL path (for canonical / og:url); image: share image path; ld: structured data objects
const page = (title, desc, main, { path = '', image = '/hero/plate.jpg', type = 'website', ld = [], cls = '' } = {}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#EEF5EF">
<title>${esc(title)} | Zibno</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL && path ? `<link rel="canonical" href="${abs(path)}">\n<meta property="og:url" content="${abs(path)}">\n` : ''}<meta property="og:site_name" content="Zibno">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${abs(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@zibnoapex">
<link rel="stylesheet" href="/src/page.css">
${ld.map(ldTag).join('\n')}
</head>
<body>
<header class="pnav"><a class="logo-sm" href="/">ZIBNO</a><nav><a href="/">Home</a><a href="/guides/">Guides</a><a href="/about.html">About</a><a href="/#videos">Videos</a><a href="/#games">Games</a><a href="/#contact">Contact</a></nav></header>
<main class="doc${cls ? ' ' + cls : ''}">${main}</main>
<footer class="foot"><a href="/guides/">Guides</a><a href="/about.html">About</a><a href="/privacy.html">Privacy policy</a><span>© 2026 Zibno</span><p class="legal">Zibno is an independent creator and is not affiliated with or endorsed by Riot Games, Tencent, TiMi, Electronic Arts or Respawn. Game names and images belong to their owners. Some links on this site are affiliate links; I may earn a commission at no cost to you.</p></footer>
</body>
</html>
`;

const AUTHOR = { '@type': 'Person', name: 'Zibno', url: 'https://www.youtube.com/@Zibnoofficial' };
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// guides written from the web may have no video of mine: they use game art instead (g.image)
const thumb = (g) => (g.video ? `/videos/${g.video}.jpg` : g.image);
const card = (g) => `<a href="/guides/${g.slug}.html"><img src="${thumb(g)}" alt="" loading="lazy" width="640" height="360"><span class="tag">${g.news ? 'News' : esc(g.game)}</span><b>${esc(g.title)}</b></a>`;
const SORTED = [...GUIDES].sort((a, b) => (b.updated || b.date).localeCompare(a.updated || a.date));

mkdirSync('guides', { recursive: true });
for (const g of GUIDES) {
  const path = `/guides/${g.slug}.html`;
  // same game first, then the newest of the rest
  const related = [...SORTED.filter((o) => o !== g && o.game === g.game), ...SORTED.filter((o) => o.game !== g.game)].slice(0, 4);
  // sidebar contents list: every h2 in the body, plus FAQ / Sources when present
  const toc = g.body.flatMap(([t, v]) => (t === 'h2' ? [[slugify(v), plain(v)]] : t === 'faq' ? [['faq', 'FAQ']] : t === 'src' ? [['sources', 'Sources']] : []));
  const faq = g.body.find(([t]) => t === 'faq');
  const ld = [
    { '@context': 'https://schema.org', '@type': g.news ? 'NewsArticle' : 'Article', headline: g.title, description: g.description, image: [abs(thumb(g))],
      datePublished: g.date, dateModified: g.updated || g.date, author: AUTHOR, publisher: AUTHOR, mainEntityOfPage: abs(path), about: { '@type': 'VideoGame', name: g.game } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Guides', item: abs('/guides/') }, { '@type': 'ListItem', position: 2, name: g.title, item: abs(path) }] },
  ];
  if (faq) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq[1].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: plain(a) } })) });
  // wide on desktop: title row across the top, article + sticky sidebar, related guides across the bottom
  writeFileSync(`guides/${g.slug}.html`, page(g.title, g.description, `
<header class="ghead">
<p class="crumb"><a href="/guides/">Guides</a> / ${esc(g.game)}</p>
<h1>${esc(g.title)}</h1>
<p class="meta">By Zibno · ${g.updated ? `Updated <time datetime="${g.updated}">${longDate(g.updated)}</time>` : `<time datetime="${g.date}">${longDate(g.date)}</time>`}</p>
<p class="lede">${esc(g.description)}</p>
</header>
<div class="gwrap">
<article class="gart">
${g.video ? `<a class="watch" href="https://www.youtube.com/watch?v=${g.video}" target="_blank" rel="noopener"><img src="/videos/${g.video}.jpg" alt="${esc(g.title)}, video thumbnail" width="640" height="360"><span>${g.relatedVideo ? 'Related video on my channel' : 'Watch the video on YouTube'}</span></a>` : `<img class="hero-img" src="${g.image}" alt="${esc(g.game)}" width="640" height="360">`}
${g.body.map(block).join('\n')}
<p class="by">${g.body.some(([t]) => t === 'src') ? 'Written by Zibno from the sources listed above. I update this page when something official changes.' : 'Written by Zibno, based on my video. Settings can change with game updates.'}</p>
</article>
<aside class="side">
<nav class="toc" aria-label="On this page"><b>On this page</b><ol>${toc.map(([id, text]) => `<li><a href="#${id}">${esc(text)}</a></li>`).join('')}</ol></nav>
<a class="side-yt" href="https://www.youtube.com/@Zibnoofficial" target="_blank" rel="noopener"><b>Zibno on YouTube</b><span>Guides, settings and early-access news for mobile shooters.</span><i>Subscribe</i></a>
</aside>
</div>
<section class="more"><h2>More guides</h2><div class="glist">${related.map(card).join('')}</div></section>`, { path, image: thumb(g), type: 'article', ld, cls: 'guide' }));
}
writeFileSync('guides/index.html', page('Mobile shooter guides and news', 'Settings guides, gyro and movement tips and news for Valorant Mobile, Delta Force Mobile, Apex Legends Mobile and High Energy Heroes, by Zibno.', `
<h1>Guides</h1>
<p class="lede">My most-watched videos, written out so you can read them at your own pace, plus news on the games I cover.</p>
<div class="glist">${SORTED.map(card).join('')}</div>`, { path: '/guides/', ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Zibno guides', hasPart: SORTED.map((g) => ({ '@type': 'Article', headline: g.title, url: abs(`/guides/${g.slug}.html`) })) }] }));

writeFileSync('privacy.html', page('Privacy policy', 'How the Zibno website handles your data, cookies and advertising.', `
<h1>Privacy policy</h1>
<p class="lede">Last updated: 28 October 2026</p>
<p>This website (the "site") is run by Zibno, the creator of the Zibno Official YouTube channel. This page explains what data is collected when you visit and how it is used.</p>
<h2>What I collect</h2>
<p>The site has no accounts, sign-ups or forms, and I do not ask for or store your name, email or other personal details. Like every website, the hosting provider may keep standard server logs (such as IP address, browser type and the pages requested) for security and performance.</p>
<h2>Cookies and advertising</h2>
<p>This site may show ads from Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your previous visits to this site and other websites. Google's use of advertising cookies lets it and its partners show ads to you based on those visits.</p>
<ul><li>You can turn off personalised ads in <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google Ads Settings</a>.</li><li>You can opt out of some third-party vendors' cookies at <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener">aboutads.info</a>.</li><li>When ads are switched on for this site, visitors from the EEA, UK and Switzerland will see a consent message from Google before any personalised ads are shown.</li></ul>
<p>Read more in <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">how Google uses data from sites that use its services</a>.</p>
<h2>Embedded links and affiliate links</h2>
<p>Links to YouTube, X, Telegram and other sites take you to services with their own privacy policies. Some links are affiliate links, which means I may earn a small commission at no extra cost to you. They are labelled where they appear.</p>
<h2>Local storage</h2>
<p>Games on this site may save your progress, such as high scores, in your browser's local storage. That data stays on your device.</p>
<h2>Children</h2>
<p>This site is not directed at children under 13, and I do not knowingly collect data from them.</p>
<h2>Contact</h2>
<p>Questions about this policy: ${EMAIL ? `email <a href="mailto:${EMAIL}">${EMAIL}</a>, or ` : ''}message me on <a href="https://t.me/zibnoofficial" target="_blank" rel="noopener">Telegram</a> or <a href="https://twitter.com/zibnoapex" target="_blank" rel="noopener">X</a>.</p>`));
console.log('wrote', GUIDES.length, 'guides + index + privacy');

writeFileSync('about.html', page('About Zibno', 'Zibno is an FPS mobile gaming creator: early-access download guides and Chinese-to-English settings translations for Valorant Mobile, Delta Force and Apex-style shooters.', `
<h1>About Zibno</h1>
<p class="lede">I make guides for mobile shooters, with a focus on games that launch in China or in closed beta before they reach the rest of the world.</p>
<h2>What I do</h2>
<p>When a new shooter appears on mobile, the menus are often only in Chinese and the download steps are unclear. I show how to get the game, then go through the settings screen by screen and explain what every option does in plain English, so you can set up your controls properly on day one.</p>
<p>My channel, Zibno Official, has about 6.9K subscribers and 682 videos. My most-watched guides cover Valorant Mobile, Delta Force Mobile and High Energy Heroes, and one video has passed 90K views.</p>
<h2>How the guides on this site are made</h2>
<ul><li>Each written guide is based on one of my own videos and follows what I explain in it.</li><li>I play on my own phone. I do not publish settings I have not looked at myself.</li><li>When a game updates, menus and options can change. Each guide links to its video so you can check the date.</li><li>If I am not sure what an option does, I say so instead of guessing.</li></ul>
<h2>Sponsorships and affiliate links</h2>
<p>Some links are affiliate links, such as the booster app I use for the China versions of games. I only link tools I use myself, and I mark affiliate links where they appear. For brand deals and collaborations, message me on <a href="https://t.me/zibnoofficial" target="_blank" rel="noopener">Telegram</a>, <a href="https://twitter.com/zibnoapex" target="_blank" rel="noopener">X</a>${EMAIL ? ` or by email at <a href="mailto:${EMAIL}">${EMAIL}</a>` : ''}.</p>
<h2>Find me</h2>
<ul><li><a href="https://www.youtube.com/@Zibnoofficial" target="_blank" rel="noopener">YouTube: @Zibnoofficial</a></li><li><a href="https://twitter.com/zibnoapex" target="_blank" rel="noopener">X: @zibnoapex</a></li><li><a href="https://t.me/zibnoofficial" target="_blank" rel="noopener">Telegram: t.me/zibnoofficial</a></li></ul>`));
writeFileSync('404.html', page('Page not found', 'This page does not exist.', '<h1>Page not found</h1><p class="lede">That page does not exist or has moved.</p><p><a href="/">Go to the homepage</a> or browse the <a href="/guides/">guides</a>.</p>'));

mkdirSync('public', { recursive: true });
const NL = String.fromCharCode(10);
if (SITE_URL) {
  const newest = SORTED[0].updated || SORTED[0].date;
  const urls = [['/', newest], ['/guides/', newest], ['/about.html'], ['/privacy.html'], ['/play/orbit-hop/'], ...GUIDES.map((g) => [`/guides/${g.slug}.html`, g.updated || g.date])];
  const body = urls.map(([u, d]) => `  <url><loc>${SITE_URL}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join(NL);
  writeFileSync('public/sitemap.xml', ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', body, '</urlset>', ''].join(NL));
  writeFileSync('public/robots.txt', ['User-agent: *', 'Allow: /', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join(NL));
} else {
  writeFileSync('public/robots.txt', ['User-agent: *', 'Allow: /', ''].join(NL));
}
console.log('wrote', GUIDES.length, 'guides + index + about + 404 + privacy');
