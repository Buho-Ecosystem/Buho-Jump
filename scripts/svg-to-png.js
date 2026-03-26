#!/usr/bin/env node

// Convert blog SVG headers to PNG (1200x630, Nostr/OG-ready)
// Usage: node scripts/svg-to-png.js [file.svg]
//   No args = converts all blog/assets/blog-*.svg
//   With arg = converts that single file

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

var BLOG_ASSETS = 'blog/assets';
var PNG_DIR = 'blog/assets/png';
var WIDTH = 1200;
var HEIGHT = 630;

async function convert(svgPath) {
    var name = path.basename(svgPath, '.svg');
    var outPath = path.join(PNG_DIR, name + '.png');

    var svg = fs.readFileSync(svgPath);
    await sharp(svg)
        .resize(WIDTH, HEIGHT)
        .png()
        .toFile(outPath);

    var size = fs.statSync(outPath).size;
    var kb = (size / 1024).toFixed(1);
    console.log(`  ${name}.png  (${kb} KB)`);
}

async function main() {
    if (!fs.existsSync(PNG_DIR)) fs.mkdirSync(PNG_DIR, { recursive: true });

    var args = process.argv.slice(2);

    if (args.length > 0) {
        // Convert specific file(s)
        for (var file of args) {
            if (!fs.existsSync(file)) { console.error(`  Not found: ${file}`); continue; }
            await convert(file);
        }
    } else {
        // Convert all blog SVGs
        var files = fs.readdirSync(BLOG_ASSETS)
            .filter(f => f.startsWith('blog-') && f.endsWith('.svg'))
            .sort();

        if (files.length === 0) {
            console.log('  No blog SVGs found in ' + BLOG_ASSETS);
            return;
        }

        console.log(`  Converting ${files.length} SVGs to PNG (${WIDTH}x${HEIGHT}):\n`);
        for (var file of files) {
            await convert(path.join(BLOG_ASSETS, file));
        }
    }

    console.log(`\n  Done. PNGs saved to ${PNG_DIR}/`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
