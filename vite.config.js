import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

// every HTML page is an entry: home, privacy, and each guide written by tools/build-pages.js
const guides = Object.fromEntries(readdirSync('guides').filter((f) => f.endsWith('.html')).map((f) => [`guides/${f}`, `guides/${f}`]));
export default defineConfig({ build: { rollupOptions: { input: { main: 'index.html', privacy: 'privacy.html', about: 'about.html', notfound: '404.html', ...guides } } } });
