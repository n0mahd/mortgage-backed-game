// This player's device: the Play on another device sheet (one-time transfer code)
// and the Turn alerts sheet (Web Push, see turn-notifications.js). Hotseat games
// hide both buttons. Part of the game page; reads game.js's state.

// ---------------------------------------------------------------
// Play on another device: a one-time code signs the other browser in as
// this player. Hotseat games share one device, so they hide the button.
// ---------------------------------------------------------------
async function openMoveDeviceModal() {
    const codeEl = document.getElementById('moveDeviceCode');
    const linkEl = document.getElementById('moveDeviceLink');
    const expiryEl = document.getElementById('moveDeviceExpiry');
    codeEl.textContent = '…';
    linkEl.value = '';
    expiryEl.textContent = '';
    openModal('moveDeviceModal');
    try {
        const { code, expiresAt } = await requestDeviceTransferCode();
        const link = new URL('index.html', window.location.href);
        link.searchParams.set('transfer', code);
        codeEl.textContent = `${code.slice(0, 4)} ${code.slice(4)}`;
        linkEl.value = link.toString();
        const minutes = Math.max(1, Math.round((new Date(expiresAt) - Date.now()) / 60000));
        expiryEl.textContent = `Works once, for the next ${minutes} minutes. Anyone with this code can play as you, so only share it with yourself.`;
    } catch (error) {
        codeEl.textContent = '';
        expiryEl.textContent = error.message || 'Could not create a code. Try again.';
    }
}

// ---------------------------------------------------------------
// Turn alerts (push notifications). See src/js/turn-notifications.js.
// ---------------------------------------------------------------
const TURN_ALERT_HINT = "Get a buzz when it's your turn and the game isn't open.";

function turnAlertCopy(state) {
    const standalone = TurnNotifications.isStandalone();
    switch (state) {
        case 'needs-home-screen':
            return {
                hint: `${TURN_ALERT_HINT} On iPhone, that needs the game on your Home Screen.`,
                note: "Adding it puts a Mortgage icon next to your apps that opens this game full screen. It's a shortcut to the site, not an App Store app, so there's nothing to download.",
                actions: [['add-to-home-screen', 'Add to Home Screen', 'btn-primary'], ['close', 'Not now', 'btn-secondary']],
            };
        case 'off':
            return {
                hint: TURN_ALERT_HINT,
                actions: [['enable', 'Turn on alerts', 'btn-primary'], ['close', 'Not now', 'btn-secondary']],
            };
        case 'on':
            return {
                hint: "Alerts are on for this device. You'll get one when it's your turn and the game isn't open.",
                actions: [['test', 'Send a test alert', 'btn-secondary'], ['disable', 'Turn off alerts', 'btn-secondary'], ['close', 'Done', 'btn-secondary']],
            };
        case 'denied':
            return {
                hint: standalone
                    ? 'Notifications are off for Mortgage. Turn them on in Settings, Notifications, Mortgage, then come back here.'
                    : "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
        case 'unsupported':
            return {
                hint: "This browser can't show alerts. On iPhone, open the game in Safari and add it to your Home Screen. On Android, use Chrome.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
        default:
            return {
                hint: "Alerts aren't available right now. Try again later.",
                actions: [['close', 'Done', 'btn-secondary']],
            };
    }
}

function setText(id, text) {
    const element = document.getElementById(id);
    element.textContent = text || '';
    element.hidden = !text;
}

async function renderTurnAlerts(statusMessage) {
    const actions = document.getElementById('turnAlertsActions');
    actions.innerHTML = '';
    setText('turnAlertsHint', 'Checking this device…');
    setText('turnAlertsNote', '');
    const state = await TurnNotifications.status().catch(() => 'unavailable');
    const copy = turnAlertCopy(state);
    setText('turnAlertsHint', copy.hint);
    setText('turnAlertsNote', copy.note);
    setText('turnAlertsStatus', statusMessage);
    actions.innerHTML = copy.actions.map(([action, label, style]) =>
        `<button class="btn ${style}" data-turn-alerts="${action}">${escapeHtml(label)}</button>`
    ).join('');
    document.getElementById('turn-alerts-btn')?.classList.toggle('is-on', state === 'on');
}

async function openTurnAlertsModal() {
    openModal('turnAlertsModal');
    await renderTurnAlerts();
}

async function refreshTurnAlertsButton() {
    if (isHotseatMode) return;
    const state = await TurnNotifications.status().catch(() => 'unavailable');
    document.getElementById('turn-alerts-btn')?.classList.toggle('is-on', state === 'on');
}

async function handleTurnAlertsAction(event) {
    const button = event.target.closest('[data-turn-alerts]');
    if (!button) return;
    const action = button.dataset.turnAlerts;
    if (action === 'close') {
        closeModal('turnAlertsModal');
        return;
    }
    button.disabled = true;
    try {
        switch (action) {
            case 'add-to-home-screen':
                await TurnNotifications.openAddToHomeScreen();
                return;
            case 'enable':
                await TurnNotifications.enable();
                await renderTurnAlerts('Alerts turned on.');
                return;
            case 'test': {
                const { sent } = await TurnNotifications.sendTest();
                await renderTurnAlerts(sent ? 'Test alert sent. It should arrive in a few seconds.' : "The test alert didn't reach this device. Turn alerts off and on again.");
                return;
            }
            case 'disable':
                await TurnNotifications.disable();
                await renderTurnAlerts('Alerts turned off for this device.');
                return;
        }
    } catch (error) {
        await renderTurnAlerts(error.message || "That didn't work. Try again.");
    }
}

async function shareMoveDeviceLink() {
    const link = document.getElementById('moveDeviceLink').value;
    if (!link) return;
    if (await copyText(link)) {
        showToast('Link copied');
        return;
    }
    const linkEl = document.getElementById('moveDeviceLink');
    linkEl.focus();
    linkEl.select();
    showToast('Select the link and copy it');
}
