import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const f = async (n) => doc.embedFont(StandardFonts[n]);
const noto = await doc.embedFont(fs.readFileSync('node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'), { subset: true });
const notoR = await doc.embedFont(fs.readFileSync('node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'), { subset: true });
const p = doc.addPage([595, 842]);
const rows = [
  ['Times Bold 24pt heading', 'TimesRomanBold', 24, rgb(0.6, 0, 0)],
  ['Courier 11pt code line', 'Courier', 11, rgb(0, 0.4, 0)],
  ['Helvetica Oblique 14pt note', 'HelveticaOblique', 14, rgb(0, 0, 0.7)],
  ['Times Italic 18pt quote', 'TimesRomanItalic', 18, rgb(0, 0, 0)],
  ['Helvetica Bold 9pt small print', 'HelveticaBold', 9, rgb(0.2, 0.2, 0.2)],
];
let y = 780;
for (const [t, n, s, c] of rows) { p.drawText(t, { x: 60, y, size: s, font: await f(n), color: c }); y -= 44; }
p.drawText('Embedded Noto Sans Bold 16pt', { x: 60, y, size: 16, font: noto, color: rgb(0, 0, 0) }); y -= 44;
p.drawText('Embedded Noto Sans Regular 13pt', { x: 60, y, size: 13, font: notoR, color: rgb(0, 0, 0) });
fs.writeFileSync('test/fonts.pdf', await doc.save());
console.log('ok');
