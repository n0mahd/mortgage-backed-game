// Turn notifications ("Alerts"): Web Push so a phone buzzes when it becomes the
// player's turn, even with the screen locked. Classic browser script, no build.
//
// iPhone and iPad only allow push for sites added to the Home Screen, and the
// Home Screen app has its own storage. So on iOS Safari we first hand the
// signed-in session to the future app: a one-time transfer code goes into the
// page address (install.html?code=CODE) before the player taps "Add to Home
// Screen", and the installed app redeems it on first launch.
(function (global) {
    'use strict';

    function isIos() {
        const ua = global.navigator.userAgent;
        return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && global.navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
        return global.matchMedia?.('(display-mode: standalone)').matches || global.navigator.standalone === true;
    }

    function pushSupported() {
        return 'serviceWorker' in global.navigator && 'PushManager' in global && 'Notification' in global;
    }

    async function registration() {
        return global.navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }

    async function currentSubscription() {
        if (!pushSupported()) return null;
        const reg = await global.navigator.serviceWorker.getRegistration('/');
        return reg ? reg.pushManager.getSubscription() : null;
    }

    // One of: needs-install, unsupported, unavailable, denied, off, on.
    async function status() {
        if (isIos() && !isStandalone()) return 'needs-install';
        if (!pushSupported()) return 'unsupported';
        const config = await apiFetch('/push/config').catch(() => ({ enabled: false }));
        if (!config.enabled) return 'unavailable';
        if (global.Notification.permission === 'denied') return 'denied';
        return (await currentSubscription()) ? 'on' : 'off';
    }

    function base64UrlToBytes(value) {
        const padded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(global.atob(padded), char => char.charCodeAt(0));
    }

    // Must run from a tap: browsers only show the permission prompt then.
    async function enable() {
        const config = await apiFetch('/push/config');
        if (!config.enabled) throw new Error('Alerts are not available right now.');
        const permission = await global.Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked for this site.');
        const reg = await registration();
        await global.navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.getSubscription()
            || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.publicKey) });
        await apiFetch('/push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
    }

    async function disable() {
        const subscription = await currentSubscription();
        if (!subscription) return;
        await apiFetch('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
        await subscription.unsubscribe();
    }

    async function sendTest() {
        return apiFetch('/push/test', { method: 'POST' });
    }

    // iOS Safari: move to the install page carrying a one-time code for the app.
    async function prepareHomeScreenInstall() {
        const { code } = await requestDeviceTransferCode();
        global.location.href = `/install.html?code=${encodeURIComponent(code)}`;
    }

    global.TurnNotifications = { status, enable, disable, sendTest, prepareHomeScreenInstall, isIos, isStandalone };
})(window);
