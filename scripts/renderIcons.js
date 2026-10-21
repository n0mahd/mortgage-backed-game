// Renders the PNG app icons from src/assets/icon.svg and src/assets/favicon.svg.
// Run after editing either SVG: node scripts/renderIcons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const assets = path.join(__dirname, '..', 'src', 'assets');
const icon = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const favicon = fs.readFileSync(path.join(assets, 'favicon.svg'), 'utf8');

// Maskable icons get cropped to a circle as small as 80% of the canvas, so the
// artwork is shrunk onto the same background to stay inside that safe zone.
const maskable = icon.replace(
    /(<rect width="512" height="512" fill="url\(#bg\)"\/>)([\s\S]*)(<\/svg>)/,
    '$1<g transform="translate(256 256) scale(.78) translate(-256 -256)">$2</g>$3'
);

const outputs = [
    { file: 'apple-touch-icon.png', svg: icon, size: 180 },
    { file: 'favicon-512.png', svg: icon, size: 512 },
    { file: 'icon-maskable-512.png', svg: maskable, size: 512 },
    { file: 'favicon-32.png', svg: favicon, size: 32 },
];

(async () => {
    const browser = await chromium.launch();
    for (const { file, svg, size } of outputs) {
        const page = await browser.newPage({ viewport: { width: size, height: size } });
        await page.setContent(
            `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
        );
        await page.screenshot({ path: path.join(assets, file), omitBackground: true });
        await page.close();
        console.log(`${file} ${size}x${size}`);
    }
    await browser.close();
})();
