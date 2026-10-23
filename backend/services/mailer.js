'use strict';

// Sends one email through the configured HTTP mail API (see config.email).
// Does nothing without an API key; throws if the provider refuses.

const { getConfig } = require('../config');

async function sendEmail(to, subject, text, html) {
    const { apiKey, url, from } = getConfig().email;
    if (!apiKey) return;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to: [to], subject, text, html })
    });
    if (!res.ok) {
        // Provider responses can echo the recipient address, so log only the status.
        await res.text().catch(() => {});
        throw new Error(`Email provider returned HTTP ${res.status}`);
    }
}

module.exports = { sendEmail };
