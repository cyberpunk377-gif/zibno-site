import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

// every HTML page is an entry: home, the site pages, and each guide / category page written by tools/build-pages.js
const guides = Object.fromEntries(readdirSync('guides').filter((f) => f.endsWith('.html')).map((f) => [`guides/${f}`, `guides/${f}`]));
export default defineConfig({ build: { rollupOptions: { input: { main: 'index.html', privacy: 'privacy.html', terms: 'terms.html', about: 'about.html', contact: 'contact.html', notfound: '404.html', ...guides } } } });
