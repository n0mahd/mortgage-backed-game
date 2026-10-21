// Home page (index.html): continue on this device with a transfer code,
// resume a room by its code (saved hotseat players first), and email
// forgotten room codes.

document.addEventListener('DOMContentLoaded', () => {
    /* Enter key on resume code input */
    const codeInput = document.getElementById('resume-code');
    if (codeInput) {
        codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') resumeWithCode();
        });
    }

    document.getElementById('resume-code-btn')?.addEventListener('click', resumeWithCode);
    document.getElementById('forgot-code-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showForgotCode();
    });
    document.getElementById('send-forgot-code-btn')?.addEventListener('click', sendForgotCode);

    document.getElementById('transfer-code-btn')?.addEventListener('click', () => continueWithTransferCode());
    document.getElementById('transfer-code')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') continueWithTransferCode();
    });
    if (new URLSearchParams(window.location.search).get('signin') === 'game') {
        document.getElementById('signed-out-notice').hidden = false;
        const more = document.querySelector('.resume-more');
        if (more) more.open = true;
        document.getElementById('resume')?.scrollIntoView();
        document.getElementById('transfer-code')?.focus();
    }

    const transferFromLink = new URLSearchParams(window.location.search).get('transfer');
    if (transferFromLink) {
        document.getElementById('transfer-code').value = transferFromLink;
        document.getElementById('resume')?.scrollIntoView();
        continueWithTransferCode();
    }
});

/* ── Continue on this device with a code from another device ── */
async function continueWithTransferCode() {
    const input = document.getElementById('transfer-code');
    const button = document.getElementById('transfer-code-btn');
    const errorEl = document.getElementById('transfer-error');
    errorEl.style.display = 'none';
    button.disabled = true;
    try {
        await redeemDeviceTransferCode(input.value);
        // Drop the one-time code from the address bar and history.
        window.history.replaceState(null, '', window.location.pathname);
        await openActiveGame();
    } catch (err) {
        errorEl.textContent = err.message || 'That code did not work. Get a new one and try again.';
        errorEl.style.display = 'block';
        button.disabled = false;
    }
}

/* ── Resume game functionality ── */
function resumeWithCode() {
    const code = normalizeInviteCode(document.getElementById('resume-code').value);
    const errorEl = document.getElementById('resume-error');
    if (!code || code.length < 4) {
        errorEl.textContent = 'Room codes are 6 letters and numbers, like KLJZX8.';
        errorEl.style.display = 'block';
        return;
    }
    errorEl.style.display = 'none';

    const optionsEl = document.getElementById('hotseat-resume-options');
    if (RoomResume.showSavedHotseat(optionsEl, code)) {
        return;
    }

    window.location.href = `waiting.html?code=${encodeURIComponent(code)}`;
}

function showForgotCode() {
    document.getElementById('forgot-code-form').style.display = 'block';
    document.getElementById('forgot-email')?.focus();
    return false;
}

async function sendForgotCode() {
    const email = document.getElementById('forgot-email').value.trim();
    const successEl = document.getElementById('forgot-success');
    const errorEl = document.getElementById('forgot-error');
    successEl.style.display = 'none';
    errorEl.style.display = 'none';

    if (!email) {
        errorEl.textContent = 'Enter the email you used to create your games.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        await sendRoomCode({ action: 'forgot_code', email });
        successEl.style.display = 'block';
    } catch (err) {
        errorEl.textContent = err.message || 'Could not send room codes. Please try again.';
        errorEl.style.display = 'block';
    }
}
