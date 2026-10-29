// Archivo Black (900) -> three.js typeface JSON with only the glyphs the 3D title needs
// (same conversion three's TTFLoader does, without its CDN import).
//   bun tools/font3d.ts
import opentype from '../../app/node_modules/opentype.js';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const buf = await Bun.file(join(root, 'node_modules/@fontsource/archivo/files/archivo-latin-900-normal.woff')).arrayBuffer();
const font = opentype.parse(buf);
const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
const r = (v: number) => Math.round(v * scale);
const glyphs: Record<string, unknown> = {};
for (const ch of 'ZIBNO') {
  const g = font.charToGlyph(ch);
  let o = '';
  for (const c of g.path.commands as any[]) {
    if (c.type === 'M') o += `m ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'L') o += `l ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'Q') o += `q ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} `;
    else if (c.type === 'C') o += `b ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} `;
  }
  const bb = g.getBoundingBox();
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1), x_max: r(bb.x2), o };
}
const json = {
  glyphs,
  familyName: 'Archivo Black',
  ascender: r(font.ascender),
  descender: r(font.descender),
  underlinePosition: 0,
  underlineThickness: 0,
  boundingBox: { xMin: 0, yMin: r(font.descender), xMax: 0, yMax: r(font.ascender) },
  resolution: 1000,
  original_font_information: { format: 0 },
};
await Bun.write(join(root, 'public/fonts/archivo-900.json'), JSON.stringify(json));
console.log('glyphs', Object.keys(glyphs).join(''), 'bytes', JSON.stringify(json).length);
