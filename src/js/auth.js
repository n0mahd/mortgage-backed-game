// auth.html: sign in with a username or email and a password (the default),
// create an account (a guest is upgraded in place and keeps their seats), or
// sign in with an emailed code. ?mode=signin|register|email picks the view;
// ?next=<same-origin path> is where to go afterwards (else the lobby);
// ?reason=<key> explains why the player was sent here.

const AUTH_REASONS = {
    seat: 'This seat belongs to an account. Sign in to continue.',
    host_offer: 'To become host, create an account first.',
    keep_games: 'Create an account to keep your games across devices.',
};

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;

// Only a relative path on this site: no scheme, no protocol-relative "//",
// no backslashes (some browsers treat them as "/"), no control characters.
function safeNextPath(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    if (raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    try {
        const url = new URL(raw, window.location.href);
        if (url.origin !== window.location.origin) return null;
    } catch {
        return null;
    }
    return raw;
}

function afterSignIn() {
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    window.location.href = next || 'lobby.html';
}

function showView(name) {
    document.querySelectorAll('[data-auth-view]').forEach(view => {
        view.hidden = view.dataset.authView !== name;
    });
    const focusId = { signin: 'login-input', register: 'register-username', email: 'email-input', code: 'code-input' }[name];
    const focusEl = focusId && document.getElementById(focusId);
    if (focusEl) focusEl.focus();
}

function setBusy(button, busy, idleText, busyText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
}

async function handleSignIn(event) {
    event.preventDefault();
    const login = document.getElementById('login-input').value.trim();
    const password = document.getElementById('password-input').value;
    const errorEl = document.getElementById('signin-error');
    const button = document.getElementById('signin-btn');
    errorEl.textContent = '';

    if (!login || !password) {
        errorEl.textContent = 'Enter your username or email and your password.';
        return;
    }

    setBusy(button, true, 'Sign In', 'Signing in…');
    try {
        await loginWithPassword(login, password);
        afterSignIn();
    } catch (error) {
        errorEl.textContent = error.message || 'Could not sign in. Please try again.';
        setBusy(button, false, 'Sign In', 'Signing in…');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm').value;
    const errorEl = document.getElementById('register-error');
    const button = document.getElementById('register-btn');
    errorEl.textContent = '';

    if (!USERNAME_PATTERN.test(username)) {
        errorEl.textContent = 'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.';
        return;
    }
    if (password.length < 8 || password.length > 200) {
        errorEl.textContent = 'Passwords are 8 to 200 characters.';
        return;
    }
    if (password !== confirmPassword) {
        errorEl.textContent = "The passwords don't match.";
        return;
    }

    setBusy(button, true, 'Create Account', 'Creating…');
    try {
        await registerAccount(username, password);
        afterSignIn();
    } catch (error) {
        errorEl.textContent = error.message || 'Could not create your account. Please try again.';
        setBusy(button, false, 'Create Account', 'Creating…');
    }
}

async function handleSendCode() {
    const email = document.getElementById('email-input').value.trim();
    const errorEl = document.getElementById('email-error');

    if (!email) {
        errorEl.textContent = 'Please enter your email address';
        return;
    }

    const btn = document.getElementById('send-code-btn');
    setBusy(btn, true, 'Send Code', 'Sending...');
    errorEl.textContent = '';

    try {
        await apiFetch('/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        document.getElementById('sent-to-email').textContent = email;
        showView('code');
    } catch (error) {
        errorEl.textContent = error.message || 'Failed to send code. Please try again.';
        setBusy(btn, false, 'Send Code', 'Sending...');
        if (!(error.status >= 400 && error.status < 500)) console.error('Send code error:', error);
    }
}

async function handleVerifyCode() {
    const token = document.getElementById('code-input').value.trim();
    const errorEl = document.getElementById('code-error');
    const email = document.getElementById('sent-to-email').textContent;

    if (!token) {
        errorEl.textContent = 'Please enter the 6-digit code';
        return;
    }

    const btn = document.getElementById('verify-code-btn');
    setBusy(btn, true, 'Verify Code', 'Verifying...');
    errorEl.textContent = '';

    try {
        const data = await apiFetch('/auth/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ email, token })
        });

        setToken(data.token);
        clearHotseatSession();
        afterSignIn();
    } catch (error) {
        errorEl.textContent = error.message || 'Invalid or expired code. Please try again.';
        setBusy(btn, false, 'Verify Code', 'Verifying...');
        if (!(error.status >= 400 && error.status < 500)) console.error('Verify code error:', error);
    }
}

function resetToEmail() {
    document.getElementById('code-input').value = '';
    document.getElementById('code-error').textContent = '';
    setBusy(document.getElementById('send-code-btn'), false, 'Send Code', 'Sending...');
    showView('email');
}

// An account that is already signed in goes straight on. A guest stays: they
// may be here to create an account, which keeps their games. Only a token the
// server rejects is dropped; network trouble must not sign a guest out.
async function checkAuth() {
    let user;
    try {
        user = await getCurrentUser();
    } catch {
        return;
    }
    if (!user) {
        if (getToken()) clearToken();
        return;
    }
    if (!user.is_anonymous) {
        afterSignIn();
        return;
    }
    document.getElementById('register-keeps-games').hidden = false;
    document.getElementById('signin-guest-note').hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);

    const reason = AUTH_REASONS[params.get('reason')];
    if (reason) {
        const reasonEl = document.getElementById('auth-reason');
        reasonEl.textContent = reason;
        reasonEl.hidden = false;
    }

    document.getElementById('signin-form').addEventListener('submit', handleSignIn);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('send-code-btn').addEventListener('click', handleSendCode);
    document.getElementById('verify-code-btn').addEventListener('click', handleVerifyCode);
    document.getElementById('reset-email-link').addEventListener('click', (e) => {
        e.preventDefault();
        resetToEmail();
    });
    document.querySelectorAll('[data-auth-switch]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showView(link.dataset.authSwitch);
        });
    });

    document.getElementById('email-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendCode();
    });
    document.getElementById('code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleVerifyCode();
    });

    const mode = params.get('mode');
    if (mode === 'register' || mode === 'email') showView(mode);

    checkAuth();
});
