// Generates the PNG icons the web app manifest needs from public/favicon.svg.
// Run with: npm run icons
import sharp from 'sharp';
import fs from 'node:fs';

const svg = fs.readFileSync('public/favicon.svg');
const BLUE = '#2563eb';

const any = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

// Full-bleed square with the artwork inset: used for maskable and iOS icons (no transparent corners)
async function flat(size, inset) {
  const art = await sharp(svg, { density: 384 }).resize(Math.round(size * inset), Math.round(size * inset)).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BLUE } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

fs.writeFileSync('public/icons/icon-192.png', await any(192));
fs.writeFileSync('public/icons/icon-512.png', await any(512));
fs.writeFileSync('public/icons/maskable-512.png', await flat(512, 0.7));
fs.writeFileSync('public/icons/apple-touch-icon.png', await flat(180, 0.82));
console.log('icons written');
