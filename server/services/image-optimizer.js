import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const COVER_SIZES = [
  { suffix: '', width: 1600, height: 900, quality: 82 },
  { suffix: 'medium', width: 1000, height: 563, quality: 78 },
  { suffix: 'card', width: 720, height: 405, quality: 76 }
];

async function writeWebp(inputPath, outputPath, width, height, quality) {
  await sharp(inputPath, { failOn: 'warning' })
    .rotate()
    .resize({
      width,
      height,
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: true
    })
    .webp({ quality, effort: 4, smartSubsample: true })
    .toFile(outputPath);
}

export async function optimizeCoverImage(inputPath) {
  const directory = path.dirname(inputPath);
  const stem = path.parse(inputPath).name;
  const outputStem = `${stem}-optimized`;
  const variants = COVER_SIZES.map((size) => ({
    ...size,
    filename: size.suffix ? `${outputStem}.${size.suffix}.webp` : `${outputStem}.webp`,
    filePath: path.join(directory, size.suffix ? `${outputStem}.${size.suffix}.webp` : `${outputStem}.webp`)
  }));

  try {
    await Promise.all(variants.map((variant) => (
      writeWebp(inputPath, variant.filePath, variant.width, variant.height, variant.quality)
    )));
  } catch (error) {
    await Promise.all(variants.map((variant) => fs.unlink(variant.filePath).catch(() => {})));
    throw error;
  }

  await fs.unlink(inputPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });

  return {
    filename: variants[0].filename,
    storagePaths: variants.map((variant) => `covers/${variant.filename}`),
    urls: {
      cover: `/media/covers/${variants[0].filename}`,
      medium: `/media/covers/${variants[1].filename}`,
      card: `/media/covers/${variants[2].filename}`
    }
  };
}

export async function optimizeExistingCover(inputPath) {
  const parsed = path.parse(inputPath);
  const stem = parsed.name.replace(/\.(?:medium|card)$/, '');
  const mediumPath = path.join(path.dirname(inputPath), `${stem}.medium.webp`);
  const cardPath = path.join(path.dirname(inputPath), `${stem}.card.webp`);
  if (
    parsed.ext.toLowerCase() === '.webp'
    && (await fs.access(mediumPath).then(() => true).catch(() => false))
    && (await fs.access(cardPath).then(() => true).catch(() => false))
  ) {
    return {
      cover: `/media/covers/${stem}.webp`,
      medium: `/media/covers/${stem}.medium.webp`,
      card: `/media/covers/${stem}.card.webp`
    };
  }
  const result = await optimizeCoverImage(inputPath);
  return result.urls;
}
