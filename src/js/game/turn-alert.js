// Turn alert: a short vibration when it becomes this player's turn.
//
// Android browsers support the Vibration API. Safari on iOS does not, but
// toggling a native switch control gives a light haptic tick on iOS 18+, so
// that is used as a best-effort fallback. Classic browser script, no build.
(function (global) {
    'use strict';

    const VIBRATION_PATTERN = [200, 100, 200];
    let switchLabel = null;

    function tickIosSwitch() {
        if (!switchLabel) {
            switchLabel = document.createElement('label');
            switchLabel.hidden = true;
            switchLabel.setAttribute('aria-hidden', 'true');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('switch', '');
            input.tabIndex = -1;
            switchLabel.appendChild(input);
            document.body.appendChild(switchLabel);
        }
        switchLabel.click();
    }

    function buzz() {
        try {
            if (typeof global.navigator.vibrate === 'function') {
                global.navigator.vibrate(VIBRATION_PATTERN);
                return 'vibrate';
            }
            tickIosSwitch();
            global.setTimeout(tickIosSwitch, 300);
            return 'ios-switch';
        } catch (error) {
            console.warn('Turn alert failed:', error);
            return 'none';
        }
    }

    global.TurnAlert = { buzz };
})(window);
