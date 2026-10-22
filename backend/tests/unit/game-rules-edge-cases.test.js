'use strict';

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    calculateNetWorth,
    normalizeState,
} = require('../../domain/gameRules');

function makeState(overrides = {}) {
    return normalizeState({
        currentPlayerIndex: 0,
        players: [
            {
                userId: 'alice',
                name: 'Alice',
                cash: 1500,
                position: 0,
                bankrupt: false,
                inJail: false,
                jailTurns: 0,
                hasGetOutOfJailCard: false,
                doubleCount: 0,
                diceRolled: false,
                properties: [],
                corporations: [],
                debts: [],
            },
            {
                userId: 'bob',
                name: 'Bob',
                cash: 1500,
                position: 0,
                bankrupt: false,
                inJail: false,
                jailTurns: 0,
                hasGetOutOfJailCard: false,
                doubleCount: 0,
                diceRolled: false,
                properties: [],
                corporations: [],
                debts: [],
            },
        ],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({
            ...prop,
            id: `prop-${index}`,
            ownerId: null,
            ownerName: null,
            houses: 0,
        })),
        corporations: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
        ...overrides,
    });
}

function ownProperty(state, propertyId, ownerId = 'bob', ownerName = 'Bob') {
    const property = state.properties.find(prop => prop.id === propertyId);
    property.ownerId = ownerId;
    property.ownerName = ownerName;
}

function makePlayer(userId, name, overrides = {}) {
    return {
        userId,
        name,
        cash: 1500,
        position: 0,
        bankrupt: false,
        inJail: false,
        jailTurns: 0,
        hasGetOutOfJailCard: false,
        doubleCount: 0,
        diceRolled: false,
        properties: [],
        corporations: [],
        debts: [],
        ...overrides,
    };
}

function benignCommunityChestDeck() {
    return [
        {
            id: 'cc-test-collect',
            text: 'Testing dividend - collect $20.',
            action: { type: 'collect', amount: 20 },
        },
    ];
}

describe('game rule edge cases', () => {
    test('IPO gives founder all shares, and nobody can buy them without the founder agreeing', () => {
        const state = makeState();
        ownProperty(state, 'prop-0', 'alice', 'Alice');

        const created = applyAction(state, 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'BRWN', totalShares: 12, pricePerShare: 50, assetIds: ['prop-0'] },
        });
        const corporation = created.state.corporations.find(corp => corp.ticker === 'BRWN');
        const aliceAfterIpo = created.state.players.find(player => player.userId === 'alice');

        expect(corporation.shareholders).toEqual([{ userId: 'alice', name: 'Alice', shares: 12 }]);
        expect(corporation.availableShares).toBe(0);
        expect(corporation.treasuryShares).toBe(0);
        expect(aliceAfterIpo.corporations[0].sharesOwned).toBe(12);
        expect(aliceAfterIpo.corporations[0].shareValue).toBe(5);

        created.state.currentPlayerIndex = 1;
        expect(() => applyAction(created.state, 'bob', {
            type: 'buy_shares',
            payload: { corpId: corporation.id, shares: 3 },
        })).toThrow(/make them an offer in the Market/);

        // The founder sells by accepting an offer.
        const offered = applyAction(created.state, 'bob', {
            type: 'propose_trade',
            payload: { player1Id: 'bob', player2Id: 'alice', player1Cash: 150, player2Cash: 0, player1AssetIds: [], player2AssetIds: [], player2Shares: [{ corpId: corporation.id, shares: 3 }] },
        });
        const bought = applyAction(offered.state, 'alice', { type: 'accept_trade', payload: { offerId: offered.state.marketOffers[0].id } });
        const updatedCorp = bought.state.corporations.find(corp => corp.id === corporation.id);
        expect(bought.state.players.find(player => player.userId === 'alice').cash).toBe(1650);
        expect(bought.state.players.find(player => player.userId === 'bob').cash).toBe(1350);
        expect(updatedCorp.shareholders.find(holder => holder.userId === 'alice').shares).toBe(9);
        expect(updatedCorp.shareholders.find(holder => holder.userId === 'bob').shares).toBe(3);
        expect(calculateNetWorth(bought.state, 'bob')).toBe(1365);
    });

    test('legacy 0-founder-share corporations are repaired to founder equity', () => {
        const state = makeState({
            corporations: [{
                id: 'corp-1',
                ticker: 'OLD',
                name: 'OLD Corporation',
                founderId: 'alice',
                founderName: 'Alice',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 12,
                pricePerShare: 50,
                availableShares: 9,
                assets: [],
                shareholders: [{ userId: 'bob', name: 'Bob', shares: 3 }],
                debts: [],
                cash: 0,
            }],
        });
        const corporation = state.corporations[0];

        expect(corporation.shareholders.find(holder => holder.userId === 'alice').shares).toBe(9);
        expect(corporation.shareholders.find(holder => holder.userId === 'bob').shares).toBe(3);
        // Founder listings are gone: only treasury shares can be for sale.
        expect(corporation.availableShares).toBe(0);
        expect(corporation.treasuryShares).toBe(0);
    });

    test('treasury shares can be purchased by the founder and pay the corporation treasury', () => {
        const state = makeState({
            corporations: [{
                id: 'corp-1',
                ticker: 'TRSY',
                name: 'TRSY Corporation',
                founderId: 'alice',
                founderName: 'Alice',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 12,
                pricePerShare: 50,
                availableShares: 3,
                treasuryShares: 3,
                assets: [],
                shareholders: [{ userId: 'alice', name: 'Alice', shares: 9 }],
                debts: [],
                cash: 0,
            }],
        });

        const result = applyAction(state, 'alice', {
            type: 'buy_shares',
            payload: { corpId: 'corp-1', shares: 2 },
        });
        const corporation = result.state.corporations[0];
        const alice = result.state.players.find(player => player.userId === 'alice');
        const event = result.events.find(item => item.type === 'share_purchase');

        expect(alice.cash).toBe(1400);
        expect(corporation.cash).toBe(100);
        expect(corporation.treasuryShares).toBe(1);
        expect(corporation.availableShares).toBe(1);
        expect(corporation.shareholders.find(holder => holder.userId === 'alice').shares).toBe(11);
        expect(event.data.founderProceeds).toBe(0);
        expect(event.data.treasuryProceeds).toBe(100);
    });

    test('corporation-owned properties collect rent into corporation treasury', () => {
        const state = makeState({
            players: [
                {
                    userId: 'alice',
                    name: 'Alice',
                    cash: 1500,
                    position: 39,
                    bankrupt: false,
                    inJail: false,
                    jailTurns: 0,
                    hasGetOutOfJailCard: false,
                    doubleCount: 0,
                    diceRolled: false,
                    properties: [],
                    corporations: [],
                    debts: [],
                },
                {
                    userId: 'bob',
                    name: 'Bob',
                    cash: 1500,
                    position: 0,
                    bankrupt: false,
                    inJail: false,
                    jailTurns: 0,
                    hasGetOutOfJailCard: false,
                    doubleCount: 0,
                    diceRolled: false,
                    properties: [],
                    corporations: [],
                    debts: [],
                },
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'bob',
                founderName: 'Bob',
                chairmanId: 'bob',
                chairmanName: 'Bob',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 8,
                assets: [{ id: 'prop-0', name: 'Mediterranean Avenue', value: 60, color: 'Brown' }],
                shareholders: [],
                debts: [],
                cash: 0,
            }],
        });
        ownProperty(state, 'prop-0', 'corp-1', '[MBS]');

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 1] });
        const corporation = result.state.corporations.find(corp => corp.id === 'corp-1');

        expect(result.state.players[0].position).toBe(1);
        expect(result.state.players[0].cash).toBe(1698);
        expect(corporation.cash).toBe(2);
        expect(result.events.some(event =>
            event.type === 'forced_payment' &&
            event.data.to === '[MBS]' &&
            event.data.amount === 2 &&
            event.data.reason === 'Rent for Mediterranean Ave'
        )).toBe(true);
    });

    test('Chance nearest utility charges 10x dice roll even when owner has one utility', () => {
        const state = makeState({
            chanceCards: [{
                id: 'legacy-ch-4',
                text: 'Advance to nearest Utility. If owned, pay 10x your dice roll.',
                action: { type: 'advance_nearest', nearestType: 'utility' },
            }],
        });
        ownProperty(state, 'prop-6');

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [3, 4] });

        expect(result.state.players[0].position).toBe(12);
        expect(result.state.players[0].cash).toBe(1430);
        expect(result.state.players[1].cash).toBe(1570);
        expect(result.events.some(event =>
            event.type === 'forced_payment' &&
            event.data.amount === 70 &&
            event.data.reason === 'Rent for Electric Company'
        )).toBe(true);
    });

    test('Chance nearest railroad doubles normal railroad rent', () => {
        const state = makeState({
            chanceCards: [{
                id: 'ch-5',
                text: 'Advance to nearest Railroad. Pay owner twice the normal rent.',
                action: { type: 'advance_nearest', nearestType: 'railroad', rentMultiplier: 2 },
            }],
        });
        ownProperty(state, 'prop-16');

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [3, 4] });

        expect(result.state.players[0].position).toBe(15);
        expect(result.state.players[0].cash).toBe(1450);
        expect(result.state.players[1].cash).toBe(1550);
        expect(result.events.some(event =>
            event.type === 'forced_payment' &&
            event.data.amount === 50 &&
            event.data.reason === 'Rent for Pennsylvania RR'
        )).toBe(true);
    });

    test('unaffordable rent records a creditor claim instead of overpaying the owner', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 20, position: 36 }),
                makePlayer('bob', 'Bob'),
            ],
        });
        ownProperty(state, 'prop-26', 'bob', 'Bob');

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const claim = result.state.bankruptcyClaims.alice;

        expect(result.state.players.find(player => player.userId === 'alice').cash).toBe(0);
        expect(result.state.players.find(player => player.userId === 'bob').cash).toBe(1520);
        expect(claim.creditorId).toBe('bob');
        expect(claim.creditorType).toBe('player');
        expect(claim.amountOwed).toBe(50);
        expect(claim.paidAmount).toBe(20);
        expect(claim.unpaidAmount).toBe(30);
        expect(result.events.some(event =>
            event.type === 'forced_payment' &&
            event.data.amount === 20 &&
            event.data.amountOwed === 50 &&
            event.data.unpaidAmount === 30
        )).toBe(true);
    });

    test('unpaid rent claim settles when the player raises enough cash before ending turn', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 20, position: 36 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
        });
        ownProperty(state, 'prop-26', 'bob', 'Bob');

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        rolled.state.players.find(player => player.userId === 'alice').cash = 30;

        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });

        expect(ended.state.players.find(player => player.userId === 'alice').bankrupt).toBe(false);
        expect(ended.state.players.find(player => player.userId === 'alice').cash).toBe(0);
        expect(ended.state.players.find(player => player.userId === 'bob').cash).toBe(1550);
        expect(ended.state.bankruptcyClaims.alice).toBeUndefined();
        expect(ended.state.currentPlayerIndex).toBe(1);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_claim_settled' &&
            event.data.creditor === 'Bob'
        )).toBe(true);
    });

    test('rent bankruptcy transfers direct assets and shares to the player creditor', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 20, position: 36 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'alice',
                founderName: 'Alice',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 5,
                treasuryShares: 5,
                assets: [],
                shareholders: [
                    { userId: 'alice', name: 'Alice', shares: 2 },
                    { userId: 'bob', name: 'Bob', shares: 1 },
                ],
                debts: [],
                cash: 0,
                chairmanVotes: [],
            }],
        });
        ownProperty(state, 'prop-26', 'bob', 'Bob');
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 2;

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });
        const alice = ended.state.players.find(player => player.userId === 'alice');
        const bob = ended.state.players.find(player => player.userId === 'bob');
        const transferredProperty = ended.state.properties.find(prop => prop.id === 'prop-0');
        const corporation = ended.state.corporations.find(corp => corp.id === 'corp-1');

        expect(alice.bankrupt).toBe(true);
        expect(bob.cash).toBe(1520);
        expect(transferredProperty.ownerId).toBe('bob');
        expect(transferredProperty.ownerName).toBe('Bob');
        expect(transferredProperty.houses).toBe(0);
        expect(corporation.shareholders.find(shareholder => shareholder.userId === 'alice')).toBeUndefined();
        expect(corporation.shareholders.find(shareholder => shareholder.userId === 'bob').shares).toBe(3);
        expect(corporation.availableShares).toBe(5);
        expect(corporation.chairmanId).toBe('bob');
        expect(ended.state.bankruptcyClaims.alice).toBeUndefined();
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationName === 'Bob' &&
            event.data.transferredSharePositions[0].shares === 2
        )).toBe(true);
    });

    test('rent bankruptcy transfers direct properties to the corporation creditor', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 20, position: 36 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'bob',
                founderName: 'Bob',
                chairmanId: 'bob',
                chairmanName: 'Bob',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 8,
                assets: [{ id: 'prop-26', name: 'Boardwalk', value: 400, color: 'Dark Blue' }],
                shareholders: [],
                debts: [],
                cash: 0,
                chairmanVotes: [],
            }],
        });
        ownProperty(state, 'prop-26', 'corp-1', '[MBS]');
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 2;

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });
        const corporation = ended.state.corporations.find(corp => corp.id === 'corp-1');
        const transferredProperty = ended.state.properties.find(prop => prop.id === 'prop-0');

        expect(ended.state.players.find(player => player.userId === 'alice').bankrupt).toBe(true);
        expect(corporation.cash).toBe(20);
        expect(transferredProperty.ownerId).toBe('corp-1');
        expect(transferredProperty.ownerName).toBe('[MBS]');
        expect(transferredProperty.houses).toBe(0);
        expect(corporation.assets.some(asset => asset.id === 'prop-0')).toBe(true);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationName === '[MBS]' &&
            event.data.assetDestinationType === 'corporation'
        )).toBe(true);
    });

    test('bankruptcy cancels pending offers involving the bankrupt player and skips their future turn', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: -5, diceRolled: true, debts: [{ id: 'debt-1', principal: 100, interestRate: 5 }] }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'alice',
                founderName: 'Alice',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 1,
                treasuryShares: 1,
                assets: [],
                shareholders: [
                    { userId: 'alice', name: 'Alice', shares: 3 },
                    { userId: 'bob', name: 'Bob', shares: 2 },
                    { userId: 'carol', name: 'Carol', shares: 2 },
                ],
                debts: [],
                cash: 0,
                chairmanVotes: [{
                    id: 'vote-1',
                    type: 'chairman',
                    status: 'open',
                    candidateUserId: 'carol',
                    candidateName: 'Carol',
                    supporters: [{ userId: 'alice', name: 'Alice' }],
                    createdBy: 'alice',
                    createdAt: '2026-01-01T00:00:00.000Z',
                }],
            }],
            marketOffers: [
                {
                    id: 'offer-alice-bob',
                    status: 'pending',
                    proposedById: 'alice',
                    proposedByName: 'Alice',
                    recipientId: 'bob',
                    recipientName: 'Bob',
                    player1Id: 'alice',
                    player1Name: 'Alice',
                    player2Id: 'bob',
                    player2Name: 'Bob',
                    player1Cash: 10,
                    player2Cash: 0,
                    player1AssetIds: [],
                    player2AssetIds: [],
                    createdAt: '2026-01-01T00:00:00.000Z',
                    expiresAt: '2999-01-01T00:00:00.000Z',
                },
                {
                    id: 'offer-bob-carol',
                    status: 'pending',
                    proposedById: 'bob',
                    proposedByName: 'Bob',
                    recipientId: 'carol',
                    recipientName: 'Carol',
                    player1Id: 'bob',
                    player1Name: 'Bob',
                    player2Id: 'carol',
                    player2Name: 'Carol',
                    player1Cash: 20,
                    player2Cash: 0,
                    player1AssetIds: [],
                    player2AssetIds: [],
                    createdAt: '2026-01-01T00:00:00.000Z',
                    expiresAt: '2999-01-01T00:00:00.000Z',
                },
            ],
        });
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 3;

        const result = applyAction(state, 'alice', { type: 'end_turn', payload: {} });
        const corporation = result.state.corporations.find(corp => corp.id === 'corp-1');
        const releasedProperty = result.state.properties.find(prop => prop.id === 'prop-0');

        expect(result.state.players.find(p => p.userId === 'alice').bankrupt).toBe(true);
        expect(result.state.players.find(p => p.userId === 'alice').debts).toEqual([]);
        expect(result.state.currentPlayerIndex).toBe(1);
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.ownerName).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(corporation.availableShares).toBe(4);
        expect(corporation.shareholders.some(shareholder => shareholder.userId === 'alice')).toBe(false);
        expect(corporation.chairmanId).toBe('bob');
        expect(corporation.chairmanName).toBe('Bob');
        expect(corporation.chairmanVotes[0].status).toBe('closed');
        expect(corporation.chairmanVotes[0].closeReason).toBe('bankruptcy');
        expect(result.state.marketOffers.find(offer => offer.id === 'offer-alice-bob').status).toBe('canceled');
        expect(result.state.marketOffers.find(offer => offer.id === 'offer-alice-bob').cancelReason).toBe('bankruptcy');
        expect(result.state.marketOffers.find(offer => offer.id === 'offer-bob-carol').status).toBe('pending');
        expect(result.events.some(event =>
            event.type === 'trade_offer_canceled' &&
            event.data.offerId === 'offer-alice-bob' &&
            event.data.reason === 'bankruptcy'
        )).toBe(true);
        expect(result.events.some(event =>
            event.type === 'turn_end' &&
            event.data.nextPlayer === 'Bob'
        )).toBe(true);
        expect(result.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.releasedProperties.length === 1 &&
            event.data.returnedSharePositions[0].shares === 3
        )).toBe(true);
        expect(result.events.some(event =>
            event.type === 'chairman_changed' &&
            event.data.ticker === 'MBS' &&
            event.data.method === 'bankruptcy'
        )).toBe(true);
    });

    test('rolling doubles to leave Jail consumes the turn roll', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { position: 10, inJail: true, jailTurns: 1 }),
                makePlayer('bob', 'Bob'),
            ],
        });

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [2, 2] });
        const alice = result.state.players.find(player => player.userId === 'alice');

        expect(alice.inJail).toBe(false);
        expect(alice.position).toBe(14);
        expect(alice.jailTurns).toBe(0);
        expect(alice.doubleCount).toBe(0);
        expect(alice.diceRolled).toBe(true);
        expect(result.state.gameLog.some(entry => entry.message.includes('roll again'))).toBe(false);
        expect(result.events.some(event =>
            event.type === 'dice_roll' &&
            event.data.isDoubles === true &&
            event.data.jailReleased === true
        )).toBe(true);
        expect(() => applyAction(result.state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 1] }))
            .toThrow('Dice already rolled this turn');
    });

    test('rolling from Jail does not automatically use a Get Out of Jail Free card', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { position: 10, inJail: true, hasGetOutOfJailCard: true }),
                makePlayer('bob', 'Bob'),
            ],
        });

        const result = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const alice = result.state.players.find(player => player.userId === 'alice');

        expect(alice.inJail).toBe(true);
        expect(alice.position).toBe(10);
        expect(alice.jailTurns).toBe(1);
        expect(alice.diceRolled).toBe(true);
        expect(alice.hasGetOutOfJailCard).toBe(true);
        expect(result.state.gameLog.some(entry => entry.message.includes('used a Get Out of Jail Free card'))).toBe(false);
    });

    test('paying the Jail fine releases the player before their move roll', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 40, position: 10, inJail: true, jailTurns: 2 }),
                makePlayer('bob', 'Bob'),
            ],
            communityChestCards: benignCommunityChestDeck(),
        });

        const paid = applyAction(state, 'alice', { type: 'pay_jail_fine', payload: {} });
        const aliceAfterFine = paid.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterFine.inJail).toBe(false);
        expect(aliceAfterFine.position).toBe(10);
        expect(aliceAfterFine.cash).toBe(-10);
        expect(aliceAfterFine.jailTurns).toBe(0);
        expect(aliceAfterFine.diceRolled).toBe(false);
        expect(paid.state.turnCashFlow.alice.paid).toBe(50);
        expect(paid.events.some(event =>
            event.type === 'jail_fine_paid' &&
            event.data.player === 'Alice' &&
            event.data.amount === 50
        )).toBe(true);

        const rolled = applyAction(paid.state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [3, 4] });
        const aliceAfterRoll = rolled.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterRoll.position).toBe(17);
        expect(aliceAfterRoll.diceRolled).toBe(true);
    });

    test('using a Get Out of Jail Free card releases the player before their move roll', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { position: 10, inJail: true, jailTurns: 2, hasGetOutOfJailCard: true }),
                makePlayer('bob', 'Bob'),
            ],
        });

        const released = applyAction(state, 'alice', { type: 'use_get_out_of_jail_card', payload: {} });
        const aliceAfterCard = released.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterCard.inJail).toBe(false);
        expect(aliceAfterCard.position).toBe(10);
        expect(aliceAfterCard.jailTurns).toBe(0);
        expect(aliceAfterCard.diceRolled).toBe(false);
        expect(aliceAfterCard.hasGetOutOfJailCard).toBe(false);
        expect(released.events.some(event =>
            event.type === 'jail_card_used' &&
            event.data.player === 'Alice'
        )).toBe(true);

        const rolled = applyAction(released.state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 3] });
        const aliceAfterRoll = rolled.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterRoll.position).toBe(14);
        expect(aliceAfterRoll.diceRolled).toBe(true);
    });

    test('using a Get Out of Jail Free card requires having one', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { position: 10, inJail: true }),
                makePlayer('bob', 'Bob'),
            ],
        });

        expect(() => applyAction(state, 'alice', { type: 'use_get_out_of_jail_card', payload: {} }))
            .toThrow('No Get Out of Jail Free card available');
    });

    test('forced Jail bail can trigger bank-return bankruptcy on end turn', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 25, position: 10, inJail: true, jailTurns: 2 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
        });
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 1;

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const aliceAfterRoll = rolled.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterRoll.inJail).toBe(false);
        expect(aliceAfterRoll.position).toBe(13);
        expect(aliceAfterRoll.cash).toBe(-25);
        expect(aliceAfterRoll.diceRolled).toBe(true);
        expect(rolled.state.turnCashFlow.alice.paid).toBe(50);
        expect(rolled.events.some(event =>
            event.type === 'forced_payment' &&
            event.data.reason === 'Jail bail' &&
            event.data.amount === 50
        )).toBe(true);

        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });
        const alice = ended.state.players.find(player => player.userId === 'alice');
        const releasedProperty = ended.state.properties.find(prop => prop.id === 'prop-0');

        expect(alice.bankrupt).toBe(true);
        expect(alice.debts).toEqual([]);
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.ownerName).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationType === 'bank' &&
            event.data.releasedProperties.length === 1
        )).toBe(true);
    });

    test('tax-driven negative cash uses bank-return bankruptcy', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 100, position: 1 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
        });
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 2;

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const aliceAfterTax = rolled.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterTax.position).toBe(4);
        expect(aliceAfterTax.cash).toBe(-100);
        expect(rolled.events.some(event =>
            event.type === 'tax_payment' &&
            event.data.amount === 200 &&
            event.data.reason === 'Income Tax'
        )).toBe(true);

        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });
        const alice = ended.state.players.find(player => player.userId === 'alice');
        const releasedProperty = ended.state.properties.find(prop => prop.id === 'prop-0');

        expect(alice.bankrupt).toBe(true);
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationType === 'bank'
        )).toBe(true);
    });

    test('card-payment negative cash uses bank-return bankruptcy', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 10, position: 4 }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
            chanceCards: [{
                id: 'ch-test-pay',
                text: 'Pay a poor tax of $15.',
                action: { type: 'pay', amount: 15 },
            }],
        });
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 1;

        const rolled = applyAction(state, 'alice', { type: 'roll_dice', payload: {} }, { dice: [1, 2] });
        const aliceAfterCard = rolled.state.players.find(player => player.userId === 'alice');

        expect(aliceAfterCard.position).toBe(7);
        expect(aliceAfterCard.cash).toBe(-5);
        expect(rolled.state.lastCardDrawn.card).toBe('Pay a poor tax of $15.');
        expect(rolled.events.some(event =>
            event.type === 'card_draw' &&
            event.data.effect.includes('paid $15.00')
        )).toBe(true);

        const ended = applyAction(rolled.state, 'alice', { type: 'end_turn', payload: {} });
        const alice = ended.state.players.find(player => player.userId === 'alice');
        const releasedProperty = ended.state.properties.find(prop => prop.id === 'prop-0');

        expect(alice.bankrupt).toBe(true);
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationType === 'bank'
        )).toBe(true);
    });

    test('a loan that comes due without the cash to repay it uses bank-return bankruptcy', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { cash: 0, diceRolled: true, debts: [{ id: 'debt-1', principal: 100, interestRate: 5, termTurns: 5, turnsRemaining: 1 }] }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
        });
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        state.properties.find(prop => prop.id === 'prop-0').houses = 1;

        const ended = applyAction(state, 'alice', { type: 'end_turn', payload: {} });
        const alice = ended.state.players.find(player => player.userId === 'alice');
        const releasedProperty = ended.state.properties.find(prop => prop.id === 'prop-0');

        expect(alice.bankrupt).toBe(true);
        expect(alice.cash).toBe(-105);
        expect(alice.debts).toEqual([]);
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(ended.events.some(event =>
            event.type === 'interest_accrual' &&
            event.data.interestCharged === 5
        )).toBe(true);
        expect(ended.events.some(event =>
            event.type === 'bankruptcy_liquidation' &&
            event.data.assetDestinationType === 'bank'
        )).toBe(true);
    });

    test('corporation insolvency releases assets, wipes shares and closes governance', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice', { diceRolled: true }),
                makePlayer('bob', 'Bob'),
                makePlayer('carol', 'Carol'),
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'alice',
                founderName: 'Alice',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 5,
                treasuryShares: 5,
                assets: [{ id: 'prop-0', name: 'Mediterranean Ave', value: 60, color: 'Brown' }],
                shareholders: [
                    { userId: 'bob', name: 'Bob', shares: 2 },
                    { userId: 'carol', name: 'Carol', shares: 1 },
                ],
                debts: [{ id: 'corp-debt-1', principal: 100, interestRate: 5, termTurns: 5, turnsRemaining: 1, issuerType: 'corporation' }],
                cash: 1,
                chairmanVotes: [{
                    id: 'vote-1',
                    type: 'chairman',
                    status: 'open',
                    candidateUserId: 'bob',
                    candidateName: 'Bob',
                    supporters: [{ userId: 'bob', name: 'Bob' }],
                    createdBy: 'bob',
                    createdAt: '2026-01-01T00:00:00.000Z',
                }],
            }],
        });
        ownProperty(state, 'prop-0', 'corp-1', '[MBS]');
        state.properties.find(prop => prop.id === 'prop-0').houses = 3;

        const result = applyAction(state, 'alice', { type: 'end_turn', payload: {} });
        const corporation = result.state.corporations.find(corp => corp.id === 'corp-1');
        const releasedProperty = result.state.properties.find(prop => prop.id === 'prop-0');
        const event = result.events.find(item => item.type === 'corporation_insolvent');

        expect(corporation.insolvent).toBe(true);
        expect(corporation.status).toBe('insolvent');
        expect(corporation.cash).toBe(0);
        expect(corporation.assets).toEqual([]);
        expect(corporation.debts).toEqual([]);
        expect(corporation.shareholders).toEqual([]);
        expect(corporation.availableShares).toBe(0);
        expect(corporation.treasuryShares).toBe(0);
        expect(corporation.pricePerShare).toBe(0);
        expect(corporation.chairmanId).toBeNull();
        expect(corporation.chairmanName).toBeNull();
        expect(corporation.chairmanVotes[0].status).toBe('closed');
        expect(corporation.chairmanVotes[0].closeReason).toBe('corporation_insolvent');
        expect(releasedProperty.ownerId).toBeNull();
        expect(releasedProperty.ownerName).toBeNull();
        expect(releasedProperty.houses).toBe(0);
        expect(event.data.ticker).toBe('MBS');
        // The loan came due: its whole $105 balance was taken from $1 of cash.
        expect(event.data.cashBeforeReset).toBe(-104);
        expect(event.data.releasedProperties).toEqual([{ id: 'prop-0', name: 'Mediterranean Avenue' }]);
        expect(event.data.wipedSharePositions).toEqual([
            { userId: 'bob', name: 'Bob', shares: 2 },
            { userId: 'carol', name: 'Carol', shares: 1 },
        ]);
        expect(event.data.closedVotes).toBe(1);
    });

    test('insolvent corporation rejects shares, debt and governance actions', () => {
        const state = makeState({
            players: [
                makePlayer('alice', 'Alice'),
                makePlayer('bob', 'Bob'),
            ],
            corporations: [{
                id: 'corp-1',
                ticker: 'MBS',
                name: 'MBS Corporation',
                founderId: 'bob',
                founderName: 'Bob',
                chairmanId: 'alice',
                chairmanName: 'Alice',
                totalShares: 8,
                pricePerShare: 50,
                availableShares: 4,
                assets: [],
                shareholders: [{ userId: 'alice', name: 'Alice', shares: 4 }],
                debts: [],
                cash: 0,
                insolvent: true,
                status: 'insolvent',
                chairmanVotes: [{
                    id: 'vote-1',
                    type: 'chairman',
                    status: 'open',
                    candidateUserId: 'bob',
                    candidateName: 'Bob',
                    supporters: [],
                    createdBy: 'bob',
                    createdAt: '2026-01-01T00:00:00.000Z',
                }],
            }],
        });

        expect(() => applyAction(state, 'alice', { type: 'buy_shares', payload: { corpId: 'corp-1', shares: 1 } }))
            .toThrow('Corporation is insolvent');
        expect(() => applyAction(state, 'alice', { type: 'issue_debt', payload: { issuerType: 'corporation', corpId: 'corp-1', amount: 100 } }))
            .toThrow('Corporation is insolvent');
        expect(() => applyAction(state, 'alice', { type: 'change_chairman', payload: { corpId: 'corp-1', candidateUserId: 'bob' } }))
            .toThrow('Corporation is insolvent');
        expect(() => applyAction(state, 'alice', { type: 'propose_chairman_vote', payload: { corpId: 'corp-1', candidateUserId: 'bob' } }))
            .toThrow('Corporation is insolvent');
        expect(() => applyAction(state, 'alice', { type: 'support_chairman_vote', payload: { corpId: 'corp-1', voteId: 'vote-1' } }))
            .toThrow('Corporation is insolvent');
    });

    test('refinance debt replaces selected loans and pays out only net new cash', () => {
        const state = makeState();
        ownProperty(state, 'prop-0', 'alice', 'Alice');
        ownProperty(state, 'prop-26', 'alice', 'Alice');
        state.players[0].cash = 200;
        state.players[0].debts = [
            { id: 'debt-1', principal: 100, interestRate: 8 },
            { id: 'debt-2', principal: 50, interestRate: 10 },
            { id: 'debt-3', principal: 25, interestRate: 5 },
        ];

        const result = applyAction(state, 'alice', {
            type: 'refinance_debt',
            payload: {
                debtIds: ['debt-1', 'debt-2'],
                amount: 200,
                // Alice owns Boardwalk, so her loans can reach $360 in total.
            },
        });

        const alice = result.state.players[0];
        expect(alice.cash).toBe(250);
        expect(alice.debts).toHaveLength(2);
        expect(alice.debts.find(debt => debt.id === 'debt-3').principal).toBe(25);

        const newDebt = alice.debts.find(debt => debt.refinancedFrom);
        expect(newDebt.principal).toBe(200);
        expect(newDebt.interestRate).toBe(5);
        expect(newDebt.refinancedFrom).toEqual([
            { id: 'debt-1', principal: 100, interestRate: 8 },
            { id: 'debt-2', principal: 50, interestRate: 10 },
        ]);

        const event = result.events.find(item => item.type === 'debt_refinanced');
        expect(event.data.payoffAmount).toBe(150);
        expect(event.data.netProceeds).toBe(50);
        expect(result.state.turnCashFlow.alice.received).toBe(200);
        expect(result.state.turnCashFlow.alice.paid).toBe(150);
    });

    test('refinance debt requires a larger loan than the selected payoff', () => {
        const state = makeState();
        state.players[0].debts = [
            { id: 'debt-1', principal: 100, interestRate: 8 },
        ];

        expect(() => applyAction(state, 'alice', {
            type: 'refinance_debt',
            payload: { debtIds: ['debt-1'], amount: 100 },
        })).toThrow('Refinance amount must exceed selected debt principal');
    });

    test('host can pause and resume while normal actions are blocked', () => {
        const state = makeState();
        state.players[0].diceRolled = true;

        const paused = applyAction(state, 'alice', {
            type: 'host_pause_game',
            payload: { reason: 'Bob reconnecting' },
        }, { hostId: 'alice' });

        expect(paused.state.paused).toBe(true);
        expect(paused.state.pause.reason).toBe('Bob reconnecting');
        expect(paused.events.some(event => event.type === 'game_paused')).toBe(true);
        expect(() => applyAction(paused.state, 'alice', {
            type: 'end_turn',
            payload: {},
        }, { hostId: 'alice' })).toThrow('Game is paused');
        expect(() => applyAction(paused.state, 'bob', {
            type: 'host_resume_game',
            payload: {},
        }, { hostId: 'alice' })).toThrow('Not the host');

        const resumed = applyAction(paused.state, 'alice', {
            type: 'host_resume_game',
            payload: {},
        }, { hostId: 'alice' });

        expect(resumed.state.paused).toBe(false);
        expect(resumed.state.pause).toBeNull();
        expect(resumed.state.pauseHistory).toHaveLength(1);
        expect(resumed.state.pauseHistory[0].reason).toBe('Bob reconnecting');
        expect(resumed.events.some(event => event.type === 'game_resumed')).toBe(true);
    });

    test('host can end a paused game and pause metadata is closed', () => {
        const state = makeState({
            paused: true,
            pause: {
                reason: 'Dinner break',
                pausedAt: '2026-06-04T00:00:00.000Z',
                pausedById: 'alice',
                pausedByName: 'Alice',
            },
        });

        const ended = applyAction(state, 'alice', {
            type: 'host_end_game',
            payload: {},
        }, { hostId: 'alice' });

        expect(ended.state.ended).toBe(true);
        expect(ended.state.paused).toBe(false);
        expect(ended.state.pause).toBeNull();
        expect(ended.state.pauseHistory[0].closeReason).toBe('game_ended');
        expect(ended.events.some(event => event.type === 'game_ended')).toBe(true);
    });
});
