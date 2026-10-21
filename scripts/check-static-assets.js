#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECKED_EXTENSIONS = new Set(['.css', '.html', '.js']);

const failures = [];
const assets = collectAssets();

for (const relativePath of assets) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!isInsideRoot(absolutePath)) {
        failures.push(`${relativePath}: resolves outside project root`);
        continue;
    }

    if (!fs.existsSync(absolutePath)) {
        failures.push(`${relativePath}: missing referenced asset`);
        continue;
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
        failures.push(`${relativePath}: referenced path is not a file`);
        continue;
    }

    if ((stat.mode & 0o004) === 0) {
        failures.push(`${relativePath}: file is not world-readable (${formatMode(stat.mode)})`);
    }

    for (const dir of ancestorDirs(relativePath)) {
        const dirStat = fs.statSync(path.join(ROOT, dir));
        if ((dirStat.mode & 0o001) === 0) {
            failures.push(`${relativePath}: directory ${dir || '.'} is not world-traversable (${formatMode(dirStat.mode)})`);
        }
    }
}

// Pages that can be added to a Home Screen must link the manifest, or Android and
// desktop browsers install them as a plain shortcut without the app icon and name.
for (const htmlFile of fs.readdirSync(ROOT).filter(name => name.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    if (/name="apple-mobile-web-app-capable"/.test(html) && !/rel="manifest"/.test(html)) {
        failures.push(`${htmlFile}: installable page does not link /manifest.webmanifest`);
    }
}

// iOS opens pages outside the installed app's scope (such as auth.html) in an
// in-app browser with a URL bar, so pin the scope to the whole site.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
if (manifest.scope !== '/' || !manifest.start_url) {
    failures.push('manifest.webmanifest: must set scope "/" and a start_url so every page opens inside the installed app');
}

if (failures.length > 0) {
    console.error('Static asset checks failed:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(`Static asset checks passed for ${assets.length} referenced files.`);

function collectAssets() {
    const assets = new Set();
    const htmlFiles = fs.readdirSync(ROOT)
        .filter(name => name.endsWith('.html'))
        .sort();

    for (const htmlFile of htmlFiles) {
        assets.add(htmlFile);
        const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
        for (const url of extractLocalUrls(html)) {
            const relativePath = normalizeAssetPath(url);
            if (relativePath && CHECKED_EXTENSIONS.has(path.extname(relativePath))) {
                assets.add(relativePath);
            }
        }
    }

    return Array.from(assets).sort();
}

function extractLocalUrls(html) {
    const urls = [];
    const attrPattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = attrPattern.exec(html)) !== null) {
        urls.push(match[1]);
    }
    return urls;
}

function normalizeAssetPath(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    if (/^(?:[a-z]+:)?\/\//i.test(trimmed)) return null;
    if (/^(?:mailto|tel|javascript):/i.test(trimmed)) return null;
    if (trimmed.startsWith('/api/') || trimmed.startsWith('/socket.io/')) return null;

    const withoutHash = trimmed.split('#', 1)[0];
    const withoutQuery = withoutHash.split('?', 1)[0];
    if (!withoutQuery || withoutQuery === '/') return null;

    const relative = withoutQuery.replace(/^\/+/, '');
    if (relative.split('/').includes('..')) return null;
    return relative;
}

function ancestorDirs(relativePath) {
    const dirs = [];
    let current = path.dirname(relativePath);
    while (current && current !== '.') {
        dirs.push(current);
        current = path.dirname(current);
    }
    return dirs;
}

function isInsideRoot(absolutePath) {
    const relative = path.relative(ROOT, absolutePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatMode(mode) {
    return `0${(mode & 0o777).toString(8)}`;
}
