/**
 * Generate PNG icons from SVG source.
 * Run: node scripts/generate-icons.js
 * Requires: npm install sharp (dev dependency)
 *
 * If sharp is not available, use any SVG→PNG tool:
 *   - Inkscape: inkscape icon.svg -w 128 -h 128 -o icon-128.png
 *   - ImageMagick: convert -background none icon.svg -resize 128x128 icon-128.png
 *   - Online: https://svgtopng.com
 */

const fs = require('fs');
const path = require('path');

const SIZES = [16, 48, 128];
const SVG_PATH = path.join(__dirname, '..', 'icons', 'icon.svg');
const OUT_DIR = path.join(__dirname, '..', 'icons');

async function generate() {
  try {
    const sharp = require('sharp');
    const svg = fs.readFileSync(SVG_PATH);

    for (const size of SIZES) {
      await sharp(svg).resize(size, size).png().toFile(path.join(OUT_DIR, `icon-${size}.png`));
      console.log(`Generated icon-${size}.png`);
    }
  } catch (e) {
    console.log('sharp not available. Generating placeholder PNGs...');
    // Create minimal valid 1x1 PNGs as placeholders (extension will load but icons will be tiny)
    // Real icons should be generated from the SVG using any tool listed above.
    const { createCanvas } = (() => { try { return require('canvas'); } catch { return { createCanvas: null }; } })();

    if (!createCanvas) {
      console.log('Neither sharp nor canvas available. Please generate PNGs manually from icons/icon.svg');
      console.log('See comments at top of this file for options.');
      return;
    }

    for (const size of SIZES) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0a1a14';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#00ffc8';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2);
      ctx.fill();
      fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), canvas.toBuffer('image/png'));
      console.log(`Generated icon-${size}.png (placeholder)`);
    }
  }
}

generate();
