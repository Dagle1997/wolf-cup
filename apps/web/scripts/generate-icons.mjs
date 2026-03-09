/**
 * Generates PWA icons for Wolf Cup.
 * Run from apps/web: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public');

// Wolf Cup branded icon SVG
// Dark forest green bg + bold "WOLF CUP" typography
// Maskable-safe zone: content stays within inner 80% (round 40px padding on 512px icon)
function iconSvg(size) {
  const s = size;
  const pad = Math.round(s * 0.10);
  const cx = s / 2;
  const cy = s / 2;

  // Font sizes proportional to icon size
  const wolfSize = Math.round(s * 0.25);
  const cupSize  = Math.round(s * 0.16);
  const tagSize  = Math.round(s * 0.058);
  const wolfY    = Math.round(cy + s * 0.06);
  const cupY     = Math.round(cy + s * 0.28);
  const tagY     = Math.round(cy + s * 0.42);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#1a5c35"/>
      <stop offset="100%" stop-color="#0a2e1a"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${s}" height="${s}" fill="url(#bg)"/>

  <!-- Accent line top -->
  <rect x="${pad}" y="${pad}" width="${s - pad * 2}" height="${Math.round(s * 0.012)}" rx="${Math.round(s * 0.006)}" fill="#4ade80" opacity="0.6"/>

  <!-- Accent line bottom -->
  <rect x="${pad}" y="${s - pad - Math.round(s * 0.012)}" width="${s - pad * 2}" height="${Math.round(s * 0.012)}" rx="${Math.round(s * 0.006)}" fill="#4ade80" opacity="0.6"/>

  <!-- ⛳ Golf flag icon (upper center) -->
  <!-- Flag pole -->
  <line x1="${cx}" y1="${Math.round(s * 0.12)}" x2="${cx}" y2="${Math.round(s * 0.38)}" stroke="#a3e635" stroke-width="${Math.round(s * 0.022)}" stroke-linecap="round"/>
  <!-- Flag triangle -->
  <polygon
    points="${cx + Math.round(s * 0.012)},${Math.round(s * 0.12)} ${cx + Math.round(s * 0.15)},${Math.round(s * 0.17)} ${cx + Math.round(s * 0.012)},${Math.round(s * 0.22)}"
    fill="#f59e0b"
  />

  <!-- WOLF text -->
  <text
    x="${cx}" y="${wolfY}"
    text-anchor="middle" dominant-baseline="middle"
    font-family="'Arial Black', 'Impact', Arial, sans-serif"
    font-weight="900"
    font-size="${wolfSize}"
    fill="white"
  >WOLF</text>

  <!-- CUP text -->
  <text
    x="${cx}" y="${cupY}"
    text-anchor="middle" dominant-baseline="middle"
    font-family="'Arial Black', 'Impact', Arial, sans-serif"
    font-weight="900"
    font-size="${cupSize}"
    fill="#4ade80"
    letter-spacing="${Math.round(s * 0.018)}"
  >CUP</text>

  <!-- Harvey Cup tagline -->
  <text
    x="${cx}" y="${tagY}"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, sans-serif"
    font-weight="400"
    font-size="${tagSize}"
    fill="#86efac"
    letter-spacing="${Math.round(s * 0.008)}"
    opacity="0.75"
  >HARVEY CUP · GUYAN G&amp;CC</text>
</svg>`;
}

async function generateIcon(size, filename) {
  const svg = iconSvg(size);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(outDir, filename));
  console.log(`✓ Generated ${filename} (${size}×${size})`);
}

await generateIcon(512, 'icon-512.png');
await generateIcon(192, 'icon-192.png');
console.log('Icons generated in apps/web/public/');
