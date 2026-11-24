'use strict';

// The Recent events wording (src/js/game/log-format.js), run in a sandbox:
// amounts read like the rest of the page, a corporation borrower has no
// brackets, and the viewer's own lines start with "You".

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../../..');

function loadLogFormat({ viewer = 'Alex', hotseat = false } = {}) {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    const { formatMoney } = require(path.join(root, 'src/js/ui.js'));
    sandbox.formatMoney = formatMoney;
    sandbox.escapeHtml = value => String(value);
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/game/share-deals.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/game/log-format.js'), 'utf8'), sandbox);
    vm.runInContext(`var currentPlayerData = ${JSON.stringify({ name: viewer })}; var isHotseatMode = ${hotseat};`, sandbox);
    return sandbox;
}

const log = loadLogFormat();
const text = (type, data) => log.formatLogEventHtml(type, data).replace(/<[^>]+>/g, '');

test('amounts have no ".00" and keep real cents', () => {
    expect(text('payment', { from: 'Kim', to: 'Sam', amount: 75 })).toBe('Kim paid $75 to Sam');
    expect(text('payment', { from: 'Kim', to: 'Sam', amount: 1250.5 })).toBe('Kim paid $1,250.50 to Sam');
});

test('a corporation loan names the ticker without brackets', () => {
    expect(text('debt_issued', { issuer: '[MBS]', actor: 'Kim', amount: 100, interestRate: 5, termTurns: 10 }))
        .toBe('Kim borrowed $100 for MBS over 10 turns at 5% per turn');
});

test("the viewer's own lines read You", () => {
    expect(text('debt_issued', { issuer: '[MBS]', actor: 'Alex', amount: 100, interestRate: 5, termTurns: 10 }))
        .toBe('You borrowed $100 for MBS over 10 turns at 5% per turn');
    expect(text('bankruptcy', { player: 'Alex' })).toBe('You have gone BANKRUPT');
    expect(text('interest_accrual', { player: 'Alex', interestCharged: 5 })).toBe('You were charged $5 in interest');
    expect(text('trade_offer_expired', { proposer: 'Alex', recipient: 'Kim' })).toBe('Your trade offer to Kim expired');
    // Only the whole name: "Alexa" is someone else.
    expect(text('payment', { from: 'Alexa', to: 'Sam', amount: 5 })).toBe('Alexa paid $5 to Sam');
});

test('hotseat games keep every name', () => {
    const hotseat = loadLogFormat({ hotseat: true });
    expect(hotseat.formatLogEventHtml('payment', { from: 'Alex', to: 'Sam', amount: 5 }).replace(/<[^>]+>/g, ''))
        .toBe('Alex paid $5 to Sam');
});
