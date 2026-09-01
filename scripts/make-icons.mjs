/**
 * Generates the app icons from the master artwork.
 *
 *   npm run icons            everything
 *   npm run icons:favicon    just the browser tab icon and favicon.ico
 *
 * The master is half a megabyte — fine for a source file, but Next's app-router
 * icon convention serves these files verbatim rather than resizing them, so the
 * sizing has to happen here or every page load carries the full weight.
 *
 * The `--favicon` filter exists because the favicon and the header logo are not
 * always the same artwork, and regenerating the lot would quietly restyle the
 * header too.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * Two masters, deliberately.
 *
 * The favicon has to read at 16 px in a browser tab, so it is usually a
 * tighter, bolder crop than the artwork that works as a header logo. Keeping
 * them separate means regenerating one cannot quietly restyle the other.
 */
const FAVICON_SOURCE = 'public/fav.png';
const APP_SOURCE = 'src/img/fav.png';

/** `--favicon` limits output to the files a browser tab actually uses. */
const faviconOnly = process.argv.includes('--favicon');

/** Square canvas, artwork centred, transparent padding preserved. */
const square = (size, source) =>
  sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true });

const TARGETS = [
  // Picked up automatically by Next as <link rel="icon">. 256 is plenty for a
  // browser tab even on a hi-dpi screen, and a quarter the weight of 512.
  { path: 'src/app/icon.png', size: 256, source: FAVICON_SOURCE, favicon: true },
  // iOS home screen wants a fixed 180.
  { path: 'src/app/apple-icon.png', size: 180, source: APP_SOURCE },
  // Referenced by the web manifest for installed-app contexts.
  { path: 'public/icon-192.png', size: 192, source: APP_SOURCE },
  { path: 'public/icon-512.png', size: 512, source: APP_SOURCE },
  // The header logo. Square, so Next never has to letterbox it — importing the
  // master directly would force a non-native aspect ratio and warn.
  { path: 'src/img/mark.png', size: 128, source: APP_SOURCE },
];

await mkdir('public', { recursive: true });

for (const { path, size, source } of TARGETS.filter((t) => !faviconOnly || t.favicon)) {
  const buffer = await square(size, source).toBuffer();
  await writeFile(path, buffer);
  console.log(
    `${path.padEnd(24)} ${String(size).padStart(4)}px  ` +
      `${(buffer.length / 1024).toFixed(1).padStart(6)} KB  ← ${source}`
  );
}

/*
 * A real favicon.ico as well.
 *
 * Browsers request /favicon.ico unprompted, so without one every page load
 * takes a 404. Since Vista an .ico entry may hold a PNG verbatim, which means
 * the container is just a 22-byte header — no extra dependency needed.
 */
const png = await square(64, FAVICON_SOURCE).toBuffer();
const ico = Buffer.alloc(22 + png.length);

ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // one image
ico.writeUInt8(64, 6); // width
ico.writeUInt8(64, 7); // height
ico.writeUInt8(0, 8); // palette size (0 = truecolour)
ico.writeUInt8(0, 9); // reserved
ico.writeUInt16LE(1, 10); // colour planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14); // image byte length
ico.writeUInt32LE(22, 18); // offset to the image data
png.copy(ico, 22);

await writeFile('src/app/favicon.ico', ico);
console.log(
  `${'src/app/favicon.ico'.padEnd(24)}   64px  ` +
    `${(ico.length / 1024).toFixed(1).padStart(6)} KB  ← ${FAVICON_SOURCE}`
);

console.log(faviconOnly ? '\nfavicon generated' : '\nicons generated');
