// Service worker: shows "your turn" alerts and opens the game when tapped.
// It caches nothing; the game always loads from the network.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let message = {};
    try {
        message = event.data ? event.data.json() : {};
    } catch {
        message = { body: event.data ? event.data.text() : '' };
    }
    const title = message.title || 'Mortgage Backed Monopoly';
    event.waitUntil(self.registration.showNotification(title, {
        body: message.body || "It's your turn.",
        tag: message.tag || 'turn',
        renotify: true,
        icon: '/src/assets/apple-touch-icon.png?v=2',
        badge: '/src/assets/favicon-32.png?v=2',
        vibrate: [200, 100, 200],
        data: { url: message.url || '/lobby.html' },
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/lobby.html', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url === target && 'focus' in client) return client.focus();
        }
        for (const client of windows) {
            if ('navigate' in client) {
                await client.navigate(target);
                return client.focus();
            }
        }
        return self.clients.openWindow(target);
    })());
});
