// Authentication — OTP code verification

async function handleSendCode() {
    const email = document.getElementById('email-input').value.trim();
    const errorEl = document.getElementById('email-error');

    if (!email) {
        errorEl.textContent = 'Please enter your email address';
        return;
    }

    const btn = document.getElementById('send-code-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    errorEl.textContent = '';

    try {
        await apiFetch('/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ email })
        });

        document.getElementById('sent-to-email').textContent = email;
        document.getElementById('step-email').style.display = 'none';
        document.getElementById('step-code').style.display = 'block';
        document.getElementById('code-input').focus();

    } catch (error) {
        errorEl.textContent = error.message || 'Failed to send code. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Send Code';
        console.error('Send code error:', error);
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
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    errorEl.textContent = '';

    try {
        const data = await apiFetch('/auth/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ email, token })
        });

        localStorage.setItem('auth_token', data.token);
        window.location.href = 'lobby.html';

    } catch (error) {
        errorEl.textContent = error.message || 'Invalid or expired code. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Verify Code';
        console.error('Verify code error:', error);
    }
}

function resetToEmail() {
    document.getElementById('step-code').style.display = 'none';
    document.getElementById('step-email').style.display = 'block';
    document.getElementById('code-input').value = '';
    document.getElementById('code-error').textContent = '';
    const btn = document.getElementById('send-code-btn');
    btn.disabled = false;
    btn.textContent = 'Send Code';
}

// If user is already authenticated, go straight to lobby. Only a token the
// server rejects is dropped; network trouble must not sign a guest out.
async function checkAuth() {
    let user;
    try {
        user = await getCurrentUser();
    } catch {
        return;
    }
    if (!user) {
        localStorage.removeItem('auth_token');
        return;
    }
    if (!user.is_anonymous) {
        window.location.href = 'lobby.html';
    }
}

// Handle Enter key on both inputs
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('send-code-btn').addEventListener('click', handleSendCode);
    document.getElementById('verify-code-btn').addEventListener('click', handleVerifyCode);
    document.getElementById('reset-email-link').addEventListener('click', (e) => {
        e.preventDefault();
        resetToEmail();
    });

    document.getElementById('email-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendCode();
    });
    document.getElementById('code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleVerifyCode();
    });

    checkAuth();
});
