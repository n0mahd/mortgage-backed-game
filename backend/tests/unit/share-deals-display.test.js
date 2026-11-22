'use strict';

// The game page's share-deal previews (src/js/game/share-deals.js) mirror the
// engine for display. This runs that browser script in a sandbox and checks the
// "even trade" it suggests leaves the player putting in a property exactly as
// well off, including when they already hold shares in the company.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadShareDeals() {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../src/js/game/share-deals.js'), 'utf8'), sandbox);
    return sandbox.ShareDeals;
}

const ShareDeals = loadShareDeals();

// MBS is worth $10,000 with 12,000 shares: Priya (who runs it) 9,000, Lee 3,000.
// Lee puts in a $2,000 property and asks Priya for shares.
const gameState = {
    players: [
        { userId: 'priya', name: 'Priya', properties: [] },
        { userId: 'lee', name: 'Lee', properties: [{ id: 'p1', value: 2000 }] },
    ],
    properties: [{ id: 'p1', name: 'Boardwalk', price: 2000 }],
    corporations: [{
        id: 'mbs', ticker: 'MBS', totalShares: 12000, chairmanId: 'priya',
        shareholders: [{ userId: 'priya', shares: 9000 }, { userId: 'lee', shares: 3000 }],
    }],
};
const options = { netAssetValue: () => 10000, jailCardId: 'jail' };
const terms = shares => ({
    player1Id: 'lee', player2Id: 'priya',
    player1AssetIds: ['p1'], player1PropertiesToCorpId: 'mbs',
    player2Shares: shares ? [{ corpId: 'mbs', shares }] : [],
});
const netWorth = (viewer, shares) => ShareDeals.summarize(gameState, terms(shares), viewer, options)
    .rows.find(row => row.label === 'Your net worth').value;

test('the even trade counts the shares the giver already holds', () => {
    // 2,000 x (12,000 - 3,000) / 12,000 = 1,500, not 2,000 x 12,000 / 12,000.
    const even = ShareDeals.summarize(gameState, terms(1), 'lee', options).evenShares;
    expect(even).toEqual({ ticker: 'MBS', shares: 1500, total: 12000 });
    expect(netWorth('lee', 1500)).toBe('$0');
    expect(netWorth('priya', 1500)).toBe('$0');
});

test('the even trade shows before a share count is typed', () => {
    expect(ShareDeals.summarize(gameState, terms(0), 'lee', options).evenShares?.shares).toBe(1500);
});

// MBS issues new shares to Lee for Boardwalk: the preview's fair count and
// net-worth rows mirror tradeFairNewShares in the engine.
describe('a company paying with new shares', () => {
    const issueTerms = (newShares, extra = {}) => ({
        player1Id: 'priya', player1CorpId: 'mbs', player2Id: 'lee',
        player2AssetIds: ['p1'], player1NewShares: newShares, ...extra,
    });
    const issue = (newShares, viewer, extra) => ShareDeals.summarizeShareIssue(gameState, issueTerms(newShares, extra), 'player1', viewer, options);
    const row = (summary, label) => summary.rows.find(item => item.label === label)?.value;

    test('fair is the value in at today\'s value per share, and leaves everyone level', () => {
        // $2,000 x 12,000 / $10,000.
        expect(issue(0, 'lee').fairShares).toBe(2400);
        expect(row(issue(2400, 'lee'), 'Your net worth')).toBe('$0');
        expect(row(issue(2400, 'priya'), 'Your net worth')).toBe('$0');
        expect(issue(2400, 'lee').warnings).toEqual([]);
    });

    test('a count above fair warns that value moves to the receiver', () => {
        const summary = issue(3600, 'priya');
        expect(row(summary, 'Your net worth')).toMatch(/^−/);
        expect(summary.warnings.join(' ')).toMatch(/1,200 more than fair/);
    });

    test('cash the company also pays lowers the fair count', () => {
        expect(issue(0, 'lee', { player1Cash: 500 }).fairShares).toBe(1800);
    });

    test('no preview when the other side is a company too', () => {
        expect(ShareDeals.summarizeShareIssue(gameState, issueTerms(10, { player2CorpId: 'cdo' }), 'player1', 'lee', options)).toBeNull();
    });
});
