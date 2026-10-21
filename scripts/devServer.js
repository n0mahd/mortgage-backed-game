'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { URL } = require('url');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

function createStaticProxyServer({ root, backendOrigin, noStore = false }) {
    const staticRoot = path.resolve(root);
    const backend = new URL(backendOrigin);

    const server = http.createServer((req, res) => {
        if (isBackendRoute(req.url)) {
            proxyHttp(req, res, backend);
            return;
        }
        serveStatic(req, res, staticRoot, noStore);
    });

    server.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {});
        if (!req.url.startsWith('/socket.io/')) {
            socket.destroy();
            return;
        }
        proxyWebSocket(req, socket, head, backend);
    });

    return server;
}

function isBackendRoute(url) {
    return url.startsWith('/api/') || url.startsWith('/socket.io/');
}

function proxyHttp(req, res, backend) {
    const proxyReq = http.request({
        hostname: backend.hostname,
        port: backend.port || defaultPort(backend),
        path: req.url,
        method: req.method,
        headers: proxyHeaders(req.headers, backend),
    }, proxyRes => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxyReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Backend proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
}

function proxyWebSocket(req, socket, head, backend) {
    const backendSocket = net.connect(Number(backend.port || defaultPort(backend)), backend.hostname, () => {
        backendSocket.write(formatUpgradeRequest(req));
        if (head && head.length) backendSocket.write(head);
        socket.pipe(backendSocket);
        backendSocket.pipe(socket);
    });
    backendSocket.on('error', () => socket.destroy());
    backendSocket.on('close', () => socket.destroy());
    socket.on('close', () => backendSocket.destroy());
}

function serveStatic(req, res, root, noStore) {
    let requested;
    try {
        requested = decodeURIComponent(String(req.url || '/').split(/[?#]/, 1)[0]);
    } catch {
        res.writeHead(400, cacheHeaders(noStore));
        res.end('Bad request');
        return;
    }
    if (requested.split('/').includes('..')) {
        res.writeHead(403, cacheHeaders(noStore));
        res.end('Forbidden');
        return;
    }
    if (requested === '/favicon.ico') {
        res.writeHead(204, cacheHeaders(noStore));
        res.end();
        return;
    }

    const relative = requested === '/' ? '/index.html' : requested;
    const fullPath = path.normalize(path.join(root, relative));
    if (!isInsideRoot(root, fullPath)) {
        res.writeHead(403, cacheHeaders(noStore));
        res.end('Forbidden');
        return;
    }

    fs.stat(fullPath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, cacheHeaders(noStore));
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType(fullPath),
            ...cacheHeaders(noStore),
        });
        fs.createReadStream(fullPath).pipe(res);
    });
}

function isInsideRoot(root, filePath) {
    return filePath === root || filePath.startsWith(`${root}${path.sep}`);
}

function cacheHeaders(noStore) {
    return noStore ? { 'Cache-Control': 'no-store' } : {};
}

function contentType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function defaultPort(url) {
    return url.protocol === 'https:' ? 443 : 80;
}

function formatUpgradeRequest(req) {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(proxyHeaders(req.headers))) {
        lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    return `${lines.join('\r\n')}\r\n\r\n`;
}

function proxyHeaders(headers, backend = null) {
    const nextHeaders = { ...headers };
    delete nextHeaders.origin;
    if (backend) nextHeaders.host = backend.host;
    return nextHeaders;
}

module.exports = {
    createStaticProxyServer,
};
