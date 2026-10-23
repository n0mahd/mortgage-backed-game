// index.html?seat=<token>: a personal link from the host back to one seat
// (POST /seat-links/redeem). A guest seat signs this browser in as that seat;
// a seat that belongs to an account sends the player to sign in first.
// The token is taken out of the address bar before anything else happens.
(function () {
    'use strict';

    const token = new URLSearchParams(window.location.search).get('seat');
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname);

    function showStatus(message) {
        const status = document.getElementById('seat-link-status');
        status.textContent = message;
        status.hidden = !message;
    }

    function showError(message) {
        showStatus('');
        const errorEl = document.getElementById('resume-error');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        document.getElementById('resume')?.scrollIntoView();
    }

    async function redeem() {
        showStatus('Opening your seat…');
        document.getElementById('resume')?.scrollIntoView();
        let result;
        try {
            result = await redeemSeatLink(token);
        } catch (error) {
            showError(error.message || 'That link did not work. Ask the host for a new one.');
            return;
        }
        const room = result.room || {};
        if (result.requires_sign_in) {
            const next = `waiting.html?room=${encodeURIComponent(room.id)}`;
            window.location.href = `auth.html?next=${encodeURIComponent(next)}&reason=seat`;
            return;
        }
        if (result.token) {
            setToken(result.token);
            clearHotseatSession();
        }
        navigateToRoom(room);
    }

    document.addEventListener('DOMContentLoaded', redeem);
})();
