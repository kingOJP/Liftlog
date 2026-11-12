// Generates every raster the PWA and the App Store listing need from ONE
// source mark, so a redesign is a change to `mark()` below and a re-run:
//
//   node scripts/generate-pwa-assets.mjs
//
//   public/icon.svg                  favicon
//   public/icons/icon-*.png          manifest icons ("any")
//   public/icons/maskable-*.png      manifest icons (full bleed, mark in the safe zone)
//   public/icons/apple-touch-icon.png  iOS home screen (opaque — iOS paints alpha black)
//   public/store/app-icon-1024.png   App Store / Xcode icon (opaque, square, no rounding)
//   public/splash/launch-*.png       iOS launch images, one per device size
//
// Needs Playwright with Chromium (not a project dependency — it is only a
// renderer here): `npx playwright install chromium` once, then run the script.
// The device list must match IOS_SPLASH in vite.config.ts.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// require(), not import: it also finds a globally installed Playwright.
const { chromium } = createRequire(import.meta.url)('playwright');

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = '#0a0a0f';

const IOS_SPLASH = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3],
  [390, 844, 3], [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3],
];

// The in-app logo (components/Icon.tsx `logo`): a barbell, drawn on a 24-unit grid.
function mark(size, x, y) {
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="url(#accent)"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9v6M6.5 6.5v11M17.5 6.5v11M21 9v6M6.5 12h11"/>
          </g>`;
}

const defs = `<defs>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#a59dff"/><stop offset="1" stop-color="#6c62e2"/>
  </linearGradient>
  <radialGradient id="bloom" cx="50%" cy="38%" r="65%">
    <stop offset="0" stop-color="#201d3d"/><stop offset="1" stop-color="${BG}"/>
  </radialGradient>
</defs>`;

/** A square icon. `markShare` is how much of the width the mark spans. */
function iconSvg(size, { radius = 0, markShare = 0.6 } = {}) {
  const m = size * markShare;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${defs}
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bloom)"/>
    ${mark(m, (size - m) / 2, (size - m) / 2)}
  </svg>`;
}

function splashSvg(w, h) {
  const m = Math.round(Math.min(w, h) * 0.26);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${defs}
    <rect width="${w}" height="${h}" fill="${BG}"/>
    ${mark(m, (w - m) / 2, (h - m) / 2)}
  </svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, w, h, file, { transparent = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : BG}">${svg}</body></html>`);
  mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
  await page.screenshot({ path: join(PUBLIC, file), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`${file}  ${w}×${h}`);
}

writeFileSync(join(PUBLIC, 'icon.svg'), iconSvg(512, { radius: 112 }).replace(/\n\s+/g, '\n') + '\n');

for (const size of [192, 512]) {
  await render(iconSvg(size, { radius: size * 0.22 }), size, size, `icons/icon-${size}x${size}.png`, { transparent: true });
  // Launchers crop maskable icons to as little as the central 80%.
  await render(iconSvg(size, { markShare: 0.46 }), size, size, `icons/maskable-${size}x${size}.png`);
}
await render(iconSvg(180), 180, 180, 'icons/apple-touch-icon.png');
await render(iconSvg(1024), 1024, 1024, 'store/app-icon-1024.png');

for (const [w, h, dpr] of IOS_SPLASH) {
  await render(splashSvg(w * dpr, h * dpr), w * dpr, h * dpr, `splash/launch-${w * dpr}x${h * dpr}.png`);
}

await browser.close();
