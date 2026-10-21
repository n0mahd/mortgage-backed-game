#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_GAME_RULES_DIR = path.join(ROOT, 'backend/domain/gameRulesInternal');
const PUBLIC_GAME_RULES_ENTRY = path.join(ROOT, 'backend/domain/gameRules.js');
const SKIPPED_DIRS = new Set([
    '.git',
    'node_modules',
    'backend/node_modules',
    'cli/node_modules',
    'test-results',
    'worktrees',
]);

const failures = [];
const files = collectFiles(ROOT);

checkPrivateGameRulesImports(files);
checkClassicFrontendScripts(files);

if (failures.length > 0) {
    console.error('Architecture checks failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`Architecture checks passed for ${files.length} files.`);

function collectFiles(root) {
    const result = [];
    walk(root, result);
    return result.sort();
}

function walk(dir, result) {
    const relativeDir = path.relative(ROOT, dir);
    if (relativeDir && shouldSkipDir(relativeDir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(ROOT, fullPath);
        if (entry.isDirectory()) {
            if (!shouldSkipDir(relativePath)) walk(fullPath, result);
            continue;
        }
        if (entry.isFile() && /\.(?:js|html)$/.test(entry.name)) {
            result.push(fullPath);
        }
    }
}

function shouldSkipDir(relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    if (SKIPPED_DIRS.has(normalized)) return true;
    return normalized.split('/').some(part => part === 'node_modules');
}

function checkPrivateGameRulesImports(files) {
    const jsFiles = files.filter(file => file.endsWith('.js'));
    for (const file of jsFiles) {
        if (isAllowedGameRulesInternalFile(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of findModuleSpecifiers(source)) {
            const resolved = resolveSpecifier(file, specifier);
            if (resolved && isInside(resolved, PRIVATE_GAME_RULES_DIR)) {
                failures.push(`${relative(file)} imports private game-rules internals (${specifier}); import backend/domain/gameRules.js instead`);
            }
            if (!resolved && /gameRulesInternal/.test(specifier)) {
                failures.push(`${relative(file)} references private game-rules internals (${specifier}); import backend/domain/gameRules.js instead`);
            }
        }
    }
}

function checkClassicFrontendScripts(files) {
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    for (const file of htmlFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const moduleScriptPattern = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi;
        let match;
        while ((match = moduleScriptPattern.exec(source)) !== null) {
            failures.push(`${relative(file)} uses a module script; keep the frontend no-build classic-script model`);
        }
    }
}

function isAllowedGameRulesInternalFile(file) {
    return file === PUBLIC_GAME_RULES_ENTRY || isInside(file, PRIVATE_GAME_RULES_DIR);
}

function findModuleSpecifiers(source) {
    const specifiers = [];
    const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importPattern = /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) specifiers.push(match[1]);
    while ((match = importPattern.exec(source)) !== null) specifiers.push(match[1]);
    return specifiers;
}

function resolveSpecifier(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        base,
        `${base}.js`,
        path.join(base, 'index.js'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || base;
}

function isInside(file, dir) {
    const relativePath = path.relative(dir, file);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function relative(file) {
    return path.relative(ROOT, file).split(path.sep).join('/');
}
