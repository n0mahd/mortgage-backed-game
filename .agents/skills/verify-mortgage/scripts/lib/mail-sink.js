'use strict';

// A local stand-in for the mail API (Resend-compatible), used on dev runs
// without --email. The backend's real mailer (backend/services/mailer.js)
// posts here instead of to Resend, so journeys can read the login codes and
// room-code emails people would get, without spending the email quota.

const http = require('http');

const API_KEY = 'verify-mail-sink';

async function startMailSink({ log = () => {} } = {}) {
    const messages = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            if (req.method !== 'POST' || req.url !== '/emails') { res.statusCode = 404; return res.end(); }
            if (req.headers.authorization !== `Bearer ${API_KEY}`) { res.statusCode = 401; return res.end(); }
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.statusCode = 400; return res.end(); }
            const to = (Array.isArray(body.to) ? body.to : [body.to]).map(x => String(x).toLowerCase());
            messages.push({ at: Date.now(), from: body.from, to, subject: String(body.subject || ''), text: String(body.text || ''), html: String(body.html || '') });
            log(`mail sink: "${body.subject}" to ${to.length} recipient(s)`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ id: `sink-${messages.length}` }));
        });
    });
    await new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}/emails`,
        apiKey: API_KEY,
        messages,
        to(address) {
            return messages.filter(m => m.to.includes(String(address).toLowerCase()));
        },
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

// The 6-digit login code from the newest login-code mail to `email` sent at
// or after `since` (ms). Waits up to `timeout`.
async function readLoginCode(sink, email, { since = 0, timeout = 10000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const mail = sink.to(email).filter(m => m.at >= since && /login code/i.test(m.subject)).pop();
        if (mail) {
            const match = /\b(\d{6})\b/.exec(mail.text) || /<strong>(\d{6})<\/strong>/.exec(mail.html);
            if (!match) throw new Error(`The login-code email to ${email} has no 6-digit code: "${mail.text.slice(0, 80)}"`);
            return match[1];
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`No login-code email reached ${email} within ${timeout / 1000}s`);
}

module.exports = { startMailSink, readLoginCode };
