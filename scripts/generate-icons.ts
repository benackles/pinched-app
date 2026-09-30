/**
 * App icons, favicon, notification badge and the social preview image.
 *
 * The mark is the wordmark's "P" and its tomato period, drawn as plain shapes (so it renders the
 * same everywhere, with no font needed). Icons come in the three flavours installs need:
 *  - "any"       rounded tile on a transparent corner (desktop and Android launchers)
 *  - "maskable"  full-bleed, artwork inside the 80% safe zone (Android adaptive icons)
 *  - apple-touch full-bleed square (iOS rounds the corners itself)
 *
 *   pnpm assets:icons
 */
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const TOMATO = "#c44323"; // --primary-strong: AA against the cream mark
const CREAM = "#faf4e8";

/** The "P." mark on a 512 canvas, centred on (256, 256) and within a 272px-tall box. */
function mark(color: string): string {
  return (
    `<g transform="translate(-10 -10)" fill="${color}" stroke="none">` +
    // stem
    `<rect x="168" y="130" width="56" height="252" rx="6"/>` +
    // bowl
    `<path d="M196 130 H270 A98 98 0 0 1 270 326 H196 V270 H270 A42 42 0 0 0 270 186 H196 Z" />` +
    // the period
    `<circle cx="332" cy="372" r="30"/>` +
    `</g>`
  );
}

const svg = (body: string, size = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${body}</svg>`;

const tile = (radius: number) =>
  svg(`<rect width="512" height="512" rx="${radius}" fill="${TOMATO}"/>${mark(CREAM)}`);
const fullBleed = svg(`<rect width="512" height="512" fill="${TOMATO}"/>${mark(CREAM)}`);
const badge = svg(mark("#ffffff"));

async function png(markup: string, size: number, file: string) {
  const out = path.join(root, "public", file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(markup), { density: Math.max(72, (size / 512) * 72 * 4) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main() {
  await png(tile(112), 192, "icons/icon-192.png");
  await png(tile(112), 512, "icons/icon-512.png");
  await png(fullBleed, 192, "icons/icon-maskable-192.png");
  await png(fullBleed, 512, "icons/icon-maskable-512.png");
  await png(fullBleed, 180, "icons/apple-touch-icon.png");
  await png(tile(104), 32, "icons/favicon-32.png");
  // Android notification badge: white silhouette on transparent, 96px.
  await png(badge, 96, "icons/badge-96.png");

  // Social preview (1200×630): the mark beside the hero illustration. No text — the page title and
  // description do the talking in link previews.
  const hero = await sharp(path.join(root, "public", "images", "hero-prep.svg"), { density: 96 })
    .resize(780, 585, { fit: "cover" })
    .extract({ left: 0, top: 0, width: 780, height: 585 })
    .png()
    .toBuffer();
  const markTile = await sharp(Buffer.from(tile(96)), { density: 288 })
    .resize(300, 300)
    .png()
    .toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: CREAM } })
    .composite([
      { input: markTile, left: 70, top: 165 },
      {
        input: await sharp(hero)
          .composite([
            {
              input: Buffer.from(
                `<svg width="780" height="585"><rect width="780" height="585" rx="48" fill="#fff"/></svg>`,
              ),
              blend: "dest-in",
            },
          ])
          .png()
          .toBuffer(),
        left: 390,
        top: 22,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, "public", "og.png"));

  console.log("wrote icons, favicon, badge and og.png");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
