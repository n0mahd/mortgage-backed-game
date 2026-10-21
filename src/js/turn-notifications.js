// Turn alerts: Web Push so a phone buzzes when it becomes the player's turn
// and the game isn't open. Classic browser script, no build.
//
// iPhone and iPad only allow push for sites added to the Home Screen, and the
// Home Screen icon has its own storage. So on iOS Safari we first hand the
// signed-in session to it: a one-time transfer code goes into the page address
// (home-screen.html?code=CODE) before the player taps "Add to Home Screen",
// and the icon redeems it the first time it opens.
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

    // One of: needs-home-screen, unsupported, unavailable, denied, off, on.
    async function status() {
        if (isIos() && !isStandalone()) return 'needs-home-screen';
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
        if (!config.enabled) throw new Error("Alerts aren't available right now. Try again later.");
        const permission = await global.Notification.requestPermission();
        if (permission !== 'granted') throw new Error("Notifications weren't allowed, so alerts are still off.");
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

    // iOS Safari: open the Add to Home Screen page, carrying a one-time code
    // that signs the new Home Screen icon in.
    async function openAddToHomeScreen() {
        const { code } = await requestDeviceTransferCode();
        global.location.href = `/home-screen.html?code=${encodeURIComponent(code)}`;
    }

    global.TurnNotifications = { status, enable, disable, sendTest, openAddToHomeScreen, isIos, isStandalone };
})(window);
