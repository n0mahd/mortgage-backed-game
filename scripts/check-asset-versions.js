#!/usr/bin/env node
'use strict';

// Cloudflare caches /src/ for hours keyed by the ?v= query, so a changed file
// shipped under a ?v= that is already in use reaches players as the old copy.
// Two threads raising the same file to the same ?v= from the same base merge
// without a conflict, which is how this happened on 2026-10-24.
//
//   node scripts/check-asset-versions.js [--base <ref>]   (default origin/main)
//     Fails when a versioned asset differs from <ref> but its ?v= is not higher
//     than the one <ref> uses. Run after merging <ref> in, before pushing.
//   node scripts/check-asset-versions.js --live <url>
//     Fails when a versioned asset differs from the live copy at the same ?v=,
//     or goes below the live ?v=. Run right before copying files to production.
//     It fetches only pages (served no-cache) and ?v= URLs the live pages
//     already use, so it never caches a version that is not deployed yet.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

main().catch(error => {
    console.error(`Asset version check could not run: ${error.message}`);
    process.exit(1);
});

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const local = collectVersions(readLocalPages());
    const failures = args.live ? await checkLive(local, args.live) : checkBase(local, args.base);

    if (failures === null) return;
    if (failures.length > 0) {
        console.error('Asset version checks failed:');
        for (const failure of failures) console.error(`- ${failure}`);
        process.exit(1);
    }
    console.log(`Asset version checks passed for ${local.size} versioned files${args.live ? ` against ${args.live}` : ` against ${args.base}`}.`);
}

function parseArgs(argv) {
    const args = { base: 'origin/main', live: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') args.base = argv[++i];
        else if (argv[i] === '--live') args.live = String(argv[++i] || '').replace(/\/+$/, '');
        else throw new Error(`unknown argument ${argv[i]}`);
    }
    if (!args.base || (args.live !== null && !args.live)) throw new Error('--base and --live need a value');
    return args;
}

function checkBase(local, base) {
    if (!gitOk(['rev-parse', '--verify', '--quiet', `${base}^{commit}`])) {
        console.log(`Asset version checks skipped: ${base} is not available.`);
        return null;
    }
    const pages = new Map();
    for (const name of git(['ls-tree', '--name-only', base]).split('\n')) {
        if (name.endsWith('.html')) pages.set(name, git(['show', `${base}:${name}`]));
    }
    const baseVersions = collectVersions(pages);

    const failures = [];
    for (const [asset, version] of local) {
        const baseVersion = baseVersions.get(asset);
        if (baseVersion === undefined) continue;
        const baseContent = gitOk(['cat-file', '-e', `${base}:${asset}`]) ? gitBuffer(['show', `${base}:${asset}`]) : null;
        if (baseContent && baseContent.equals(fs.readFileSync(path.join(ROOT, asset)))) continue;
        if (compareVersions(version, baseVersion) <= 0) {
            failures.push(`${asset}: changed since ${base} but still ?v=${version} (${base} uses ?v=${baseVersion}); raise it above ${baseVersion}`);
        }
    }
    return failures;
}

async function checkLive(local, origin) {
    const pages = new Map();
    for (const name of localPageNames()) {
        const res = await fetch(`${origin}/${name}`, { headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) pages.set(name, await res.text());
    }
    if (pages.size === 0) throw new Error(`no pages could be fetched from ${origin}`);
    const liveVersions = collectVersions(pages);

    const failures = [];
    for (const [asset, version] of local) {
        const liveVersion = liveVersions.get(asset);
        if (liveVersion === undefined) continue;
        const order = compareVersions(version, liveVersion);
        if (order < 0) {
            failures.push(`${asset}: ?v=${version} is below the live ?v=${liveVersion}; production has newer code than this checkout`);
        } else if (order === 0) {
            const res = await fetch(`${origin}/${asset}?v=${encodeURIComponent(liveVersion)}`);
            if (!res.ok) throw new Error(`${asset}?v=${liveVersion} answered HTTP ${res.status}`);
            const live = Buffer.from(await res.arrayBuffer());
            if (!live.equals(fs.readFileSync(path.join(ROOT, asset)))) {
                failures.push(`${asset}: differs from the live copy at the same ?v=${version}; raise it above ${version}`);
            }
        }
    }
    return failures;
}

function localPageNames() {
    return fs.readdirSync(ROOT).filter(name => name.endsWith('.html')).sort();
}

function readLocalPages() {
    const pages = new Map();
    for (const name of localPageNames()) {
        pages.set(name, fs.readFileSync(path.join(ROOT, name), 'utf8'));
    }
    return pages;
}

// Map of asset path -> highest ?v= any page uses for it (check-static-assets.js
// already requires every page to use the same one).
function collectVersions(pages) {
    const versions = new Map();
    for (const html of pages.values()) {
        const pattern = /\b(?:href|src)\s*=\s*["']\/?(src\/[^"'?#]+)\?(?:[^"'#]*&)?v=([^"'&#]+)/gi;
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const [, asset, version] = match;
            const known = versions.get(asset);
            if (known === undefined || compareVersions(version, known) > 0) versions.set(asset, version);
        }
    }
    return versions;
}

function compareVersions(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.sign(na - nb);
    return a === b ? 0 : (a < b ? -1 : 1);
}

function git(args) {
    return gitBuffer(args).toString('utf8');
}

function gitBuffer(args) {
    return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function gitOk(args) {
    try {
        execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
