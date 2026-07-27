import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pearlDir = path.join(projectRoot, 'pearl');
const publicDir = path.join(projectRoot, 'public');
const appDir = path.join(projectRoot, 'app');
const champagne = { r: 220, g: 193, b: 161 };

async function normalizeBrandColors(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const isChampagne =
      alpha > 0 &&
      red > 150 &&
      red - green > 18 &&
      green - blue > 18;

    if (isChampagne) {
      data[index] = champagne.r;
      data[index + 1] = champagne.g;
      data[index + 2] = champagne.b;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  });
}

async function addBlackOutline(input, radius = 3) {
  const { data: originalPixels, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const dilatedAlpha = await sharp(originalPixels, {
    raw: { width, height, channels: 4 },
  })
    .extractChannel(3)
    .dilate(radius)
    .raw()
    .toBuffer();
  const outlinedPixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * 4;
    const sourceAlpha = originalPixels[sourceOffset + 3];
    if (sourceAlpha > 0) {
      outlinedPixels[sourceOffset] = originalPixels[sourceOffset];
      outlinedPixels[sourceOffset + 1] = originalPixels[sourceOffset + 1];
      outlinedPixels[sourceOffset + 2] = originalPixels[sourceOffset + 2];
      outlinedPixels[sourceOffset + 3] = sourceAlpha;
    } else {
      outlinedPixels[sourceOffset + 3] = dilatedAlpha[pixel];
    }
  }

  return sharp(outlinedPixels, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function createLightSurfaceVersion(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const isGold = red === champagne.r && green === champagne.g && blue === champagne.b;
    const isNeutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 32;
    if (!isGold && isNeutral) {
      const inverted = 255 - Math.round((red + green + blue) / 3);
      data[index] = inverted;
      data[index + 1] = inverted;
      data[index + 2] = inverted;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function writeClamAssets() {
  const clamSource = path.join(pearlDir, 'pearl-clam-transparent.png');
  const normalized = await normalizeBrandColors(clamSource);
  const clamBuffer = await normalized
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(472, 472, { fit: 'contain' })
    .extend({
      top: 20,
      bottom: 20,
      left: 20,
      right: 20,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await Promise.all([
    sharp(clamBuffer).toFile(path.join(publicDir, 'pearl-mark-transparent.png')),
    sharp(clamBuffer)
      .negate({ alpha: false })
      .toFile(path.join(publicDir, 'pearl-mark-black-transparent.png')),
  ]);

  const iconBuffer = await sharp(clamBuffer)
    .resize(512, 512)
    .png()
    .toBuffer();
  const icoPng = await sharp(iconBuffer).resize(64, 64).png().toBuffer();
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  icoHeader.writeUInt8(64, 6);
  icoHeader.writeUInt8(64, 7);
  icoHeader.writeUInt8(0, 8);
  icoHeader.writeUInt8(0, 9);
  icoHeader.writeUInt16LE(1, 10);
  icoHeader.writeUInt16LE(32, 12);
  icoHeader.writeUInt32LE(icoPng.length, 14);
  icoHeader.writeUInt32LE(22, 18);
  const icoBuffer = Buffer.concat([icoHeader, icoPng]);

  await Promise.all([
    sharp(iconBuffer).toFile(path.join(publicDir, 'pearl-favicon-v5.png')),
    sharp(iconBuffer).toFile(path.join(appDir, 'icon.png')),
    sharp(iconBuffer).resize(180, 180).toFile(path.join(appDir, 'apple-icon.png')),
    sharp(iconBuffer).resize(32, 32).toFile(path.join(publicDir, 'favicon-32x32.png')),
    sharp(iconBuffer).resize(16, 16).toFile(path.join(publicDir, 'favicon-16x16.png')),
    import('node:fs/promises').then(({ writeFile }) =>
      Promise.all([
        writeFile(path.join(publicDir, 'pearl-favicon-v5.ico'), icoBuffer),
        writeFile(path.join(publicDir, 'favicon.ico'), icoBuffer),
      ]),
    ),
  ]);
}

async function writeLockupAsset() {
  const lockupSource = path.join(pearlDir, 'pearl-lockup-transparent.png');
  const normalized = await normalizeBrandColors(lockupSource);
  await normalized
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 1600, withoutEnlargement: true })
    .png()
    .toFile(path.join(publicDir, 'pearl-lockup-transparent.png'));
}

async function writeHeroBarGraphAsset() {
  const barBottom = 720;
  const barGraphRects = [
    { left: 0, top: 553, right: 90, bottom: barBottom },
    { left: 122, top: 321, right: 223, bottom: barBottom },
    { left: 258, top: 318, right: 358, bottom: barBottom },
    { left: 393, top: 456, right: 492, bottom: barBottom },
    { left: 530, top: 434, right: 630, bottom: barBottom },
    { left: 690, top: 304, right: 790, bottom: barBottom },
    { left: 829, top: 145, right: 928, bottom: barBottom },
    { left: 963, top: 39, right: 1063, bottom: barBottom },
    { left: 1094, top: 300, right: 1193, bottom: barBottom },
  ];
  const rectangles = barGraphRects
    .map(
      (rect) =>
        `<rect x="${rect.left}" y="${rect.top}" width="${rect.right - rect.left + 1}" height="${rect.bottom - rect.top + 1}" fill="url(#bar)" />`,
    )
    .join('');
  const barGraphSvg = `
    <svg width="1254" height="850" viewBox="0 0 1254 850" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3a342f" stop-opacity="0.78" />
          <stop offset="62%" stop-color="#302b27" stop-opacity="0.68" />
          <stop offset="100%" stop-color="#211e1b" stop-opacity="0.42" />
        </linearGradient>
      </defs>
      ${rectangles}
    </svg>
  `;

  await sharp(Buffer.from(barGraphSvg))
    .png()
    .toFile(path.join(pearlDir, 'pearl-hero-bars-transparent.png'));
}

async function writeStackedLockupAsset() {
  const stackedSource = path.join(pearlDir, 'pearl-lockup-stacked-transparent.png');
  const normalized = await normalizeBrandColors(stackedSource);
  const stackedBase = await normalized
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 40,
      bottom: 40,
      left: 56,
      right: 56,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize({ width: 1000, withoutEnlargement: true })
    .png()
    .toBuffer();
  const stackedBuffer = await addBlackOutline(stackedBase, 8);
  const lightSurfaceBuffer = await createLightSurfaceVersion(stackedBase);
  await Promise.all([
    sharp(stackedBuffer).toFile(path.join(publicDir, 'pearl-lockup-stacked-transparent.png')),
    sharp(lightSurfaceBuffer).toFile(path.join(publicDir, 'pearl-lockup-stacked-black-transparent.png')),
    // Keep the legacy URL because it is consumed by dashboard/PDF/export code.
    sharp(stackedBuffer).toFile(path.join(publicDir, 'pearl-clam-transparent.png')),
  ]);
}

async function writeSocialPreview() {
  const stackedSource = path.join(pearlDir, 'B1A88975-2133-420A-AF50-30FA4E1E55A7.PNG');
  const normalized = await normalizeBrandColors(stackedSource);
  await normalized
    .resize(1200, 630, {
      fit: 'cover',
      position: 'centre',
    })
    .flatten({ background: '#000000' })
    .png()
    .toFile(path.join(publicDir, 'pearl-social-preview.png'));
}

await Promise.all([
  writeClamAssets(),
  writeLockupAsset(),
  writeHeroBarGraphAsset(),
  writeStackedLockupAsset(),
  writeSocialPreview(),
]);
