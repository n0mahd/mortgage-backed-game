#!/usr/bin/env node
const { createStaticProxyServer } = require('./dev-server');

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3011);
const HOST = process.env.HOST || '0.0.0.0';
const BACKEND_ORIGIN = process.env.DEV_BACKEND_ORIGIN || 'http://127.0.0.1:3111';

const server = createStaticProxyServer({ root: ROOT, backendOrigin: BACKEND_ORIGIN });

server.listen(PORT, HOST, () => {
    console.log(`Dev static/proxy server on http://${HOST}:${PORT}, backend ${BACKEND_ORIGIN}`);
});
