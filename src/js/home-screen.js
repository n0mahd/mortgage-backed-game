// home-screen.html: the Add to Home Screen handoff for turn alerts.
//
// The game sends iPhone players here with a one-time transfer code
// (home-screen.html?code=CODE). In Safari this page only shows the steps; iOS
// keeps this address, code included, as the new icon's start page. Opened from
// the Home Screen (separate storage, so signed out), the code signs the player
// in and the game opens. Later opens are already signed in and skip the code.
(function () {
    'use strict';

    const code = new URLSearchParams(window.location.search).get('code') || '';
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    async function openActiveGame() {
        const rooms = await getUserRooms();
        const activeRoom = rooms.find(room => room.status === 'in_progress') || rooms.find(room => room.status === 'waiting');
        if (activeRoom) navigateToRoom(activeRoom);
        else window.location.href = 'lobby.html';
    }

    function showSignInAgain(message) {
        document.getElementById('home-screen-launch-title').textContent = 'Sign in again';
        document.getElementById('home-screen-launch-text').textContent = message;
        document.getElementById('home-screen-fallback').hidden = false;
    }

    async function launch() {
        document.getElementById('home-screen-launch').hidden = false;
        let user = null;
        try {
            user = await getCurrentUser();
        } catch (error) {
            showSignInAgain(error.message);
            return;
        }
        if (!user) {
            try {
                await redeemDeviceTransferCode(code);
            } catch {
                showSignInAgain("This icon's sign-in link has expired. In Safari, open your game, tap the bell, and add it to your Home Screen again. Or sign in from the home page.");
                return;
            }
        }
        await openActiveGame();
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (standalone) {
            launch();
            return;
        }
        document.getElementById('home-screen-steps').hidden = false;
        // Back returns to the game this page was opened from.
        if (document.referrer.includes('/game.html')) {
            document.getElementById('home-screen-back').href = document.referrer;
        }
    });
})();
