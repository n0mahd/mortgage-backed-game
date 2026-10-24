'use strict';

const {
    MONOPOLY_PROPERTIES,
    applyAction,
    normalizeState,
    GameRuleError,
} = require('../../domain/gameRules');

function makeState() {
    const state = normalizeState({
        currentPlayerIndex: 0,
        players: [
            player('alice', 'Alice'),
            player('bob', 'Bob'),
        ],
        properties: MONOPOLY_PROPERTIES.map((prop, index) => ({
            ...prop,
            id: `prop-${index}`,
            ownerId: null,
            ownerName: null,
            houses: 0,
        })),
        corporations: [],
        marketOffers: [],
        gameLog: [],
        settings: { passGoAmount: 200, startingCash: 1500, interestRate: 5 },
        chanceCards: [],
        communityChestCards: [],
        lastDiceRoll: null,
        lastCardDrawn: null,
        ended: false,
    });
    ownProperty(state, 'prop-1', 'bob', 'Bob');
    return state;
}

function player(userId, name) {
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
    };
}

function ownProperty(state, propertyId, ownerId, ownerName) {
    const property = state.properties.find(prop => prop.id === propertyId);
    property.ownerId = ownerId;
    property.ownerName = ownerName;
}

function proposeCashForProperty(state) {
    return applyAction(state, 'alice', {
        type: 'propose_trade',
        payload: {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Cash: 100,
            player2Cash: 0,
            player1AssetIds: [],
            player2AssetIds: ['prop-1'],
        },
    });
}

describe('trade consent rules', () => {
    test('proposing a trade creates a pending offer without transferring assets', () => {
        const result = proposeCashForProperty(makeState());
        const state = result.state;

        expect(state.marketOffers).toHaveLength(1);
        expect(state.marketOffers[0].status).toBe('pending');
        expect(state.marketOffers[0].proposedById).toBe('alice');
        expect(state.marketOffers[0].recipientId).toBe('bob');
        expect(new Date(state.marketOffers[0].expiresAt).getTime()).toBeGreaterThan(new Date(state.marketOffers[0].createdAt).getTime());
        expect(state.players.find(p => p.userId === 'alice').cash).toBe(1500);
        expect(state.players.find(p => p.userId === 'bob').cash).toBe(1500);
        expect(state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('bob');
        expect(result.events.some(event => event.type === 'trade_offer_proposed')).toBe(true);
    });

    test('recipient acceptance executes the proposed transfer', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;

        const accepted = applyAction(proposed.state, 'bob', {
            type: 'accept_trade',
            payload: { offerId },
        });

        expect(accepted.state.marketOffers[0].status).toBe('accepted');
        expect(accepted.state.players.find(p => p.userId === 'alice').cash).toBe(1400);
        expect(accepted.state.players.find(p => p.userId === 'bob').cash).toBe(1600);
        expect(accepted.state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('alice');
        expect(accepted.events.some(event => event.type === 'trade_offer_accepted')).toBe(true);
    });

    test('accepting an expired trade offer clears it without transferring assets', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;
        proposed.state.marketOffers[0].expiresAt = '2000-01-01T00:00:00.000Z';

        const expired = applyAction(proposed.state, 'bob', {
            type: 'accept_trade',
            payload: { offerId },
        });

        expect(expired.state.marketOffers[0].status).toBe('expired');
        expect(expired.state.marketOffers[0].cancelReason).toBe('timeout');
        expect(expired.state.players.find(p => p.userId === 'alice').cash).toBe(1500);
        expect(expired.state.players.find(p => p.userId === 'bob').cash).toBe(1500);
        expect(expired.state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('bob');
        expect(expired.events.some(event => event.type === 'trade_offer_expired')).toBe(true);
        expect(expired.events.some(event => event.type === 'trade_offer_accepted')).toBe(false);
    });

    test('expired pending offers are cleared on the next normal action', () => {
        const proposed = proposeCashForProperty(makeState());
        proposed.state.players.find(p => p.userId === 'alice').diceRolled = true;
        proposed.state.marketOffers[0].expiresAt = '2000-01-01T00:00:00.000Z';

        const ended = applyAction(proposed.state, 'alice', {
            type: 'end_turn',
            payload: {},
        });

        expect(ended.state.marketOffers[0].status).toBe('expired');
        expect(ended.state.marketOffers[0].cancelReason).toBe('timeout');
        expect(ended.events.some(event => event.type === 'trade_offer_expired')).toBe(true);
        expect(ended.events.some(event => event.type === 'turn_end')).toBe(true);
    });

    test('proposer cannot accept their own trade offer', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;

        expect(() => applyAction(proposed.state, 'alice', {
            type: 'accept_trade',
            payload: { offerId },
        })).toThrow(GameRuleError);
    });

    test('bankrupt player cannot propose or accept trade offers', () => {
        const bankruptProposer = makeState();
        bankruptProposer.players.find(p => p.userId === 'alice').bankrupt = true;

        expect(() => proposeCashForProperty(bankruptProposer)).toThrow('Bankrupt player cannot act');

        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;
        proposed.state.players.find(p => p.userId === 'bob').bankrupt = true;

        expect(() => applyAction(proposed.state, 'bob', {
            type: 'accept_trade',
            payload: { offerId },
        })).toThrow('Bankrupt player cannot act');
    });

    test('stale property ownership rejects the offer at accept time', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;
        ownProperty(proposed.state, 'prop-1', 'alice', 'Alice');

        expect(() => applyAction(proposed.state, 'bob', {
            type: 'accept_trade',
            payload: { offerId },
        })).toThrow('Can only transfer owned property');
    });

    test('recipient can decline without transferring assets', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;

        const declined = applyAction(proposed.state, 'bob', {
            type: 'cancel_trade',
            payload: { offerId },
        });

        expect(declined.state.marketOffers[0].status).toBe('declined');
        expect(declined.state.players.find(p => p.userId === 'alice').cash).toBe(1500);
        expect(declined.state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('bob');
        expect(declined.events.some(event => event.type === 'trade_offer_canceled')).toBe(true);
    });

    test('host can cancel any pending trade offer and non-host cannot', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;

        expect(() => applyAction(proposed.state, 'bob', {
            type: 'host_cancel_trade_offer',
            payload: { offerId },
        }, { hostId: 'alice' })).toThrow('Not the host');

        const canceled = applyAction(proposed.state, 'alice', {
            type: 'host_cancel_trade_offer',
            payload: { offerId },
        }, { hostId: 'alice' });

        expect(canceled.state.marketOffers[0].status).toBe('canceled');
        expect(canceled.state.marketOffers[0].cancelReason).toBe('host');
        expect(canceled.state.players.find(p => p.userId === 'alice').cash).toBe(1500);
        expect(canceled.state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('bob');
        expect(canceled.events.some(event =>
            event.type === 'trade_offer_canceled' &&
            event.data.reason === 'host'
        )).toBe(true);
    });
});

describe('trading LLC shares', () => {
    function stateWithCorporation() {
        const state = makeState();
        ownProperty(state, 'prop-3', 'alice', 'Alice');
        const { state: withCorp } = applyAction(state, 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, assetIds: ['prop-3'] },
        });
        return { state: withCorp, corp: withCorp.corporations[0] };
    }

    function holderShares(state, corpId, userId) {
        const corp = state.corporations.find(c => c.id === corpId);
        return corp.shareholders.find(holder => holder.userId === userId)?.shares || 0;
    }

    function propose(state, actorId, payload) {
        return applyAction(state, actorId, {
            type: 'propose_trade',
            payload: { player1Cash: 0, player2Cash: 0, player1AssetIds: [], player2AssetIds: [], ...payload },
        });
    }

    test('shares move from seller to buyer when the offer is accepted', () => {
        const { state, corp } = stateWithCorporation();
        const proposed = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Shares: [{ corpId: corp.id, shares: 4 }],
            player2Cash: 150,
        });
        const offer = proposed.state.marketOffers[0];
        expect(offer.player1Shares).toEqual([{ corpId: corp.id, shares: 4 }]);
        expect(holderShares(proposed.state, corp.id, 'alice')).toBe(10);

        const accepted = applyAction(proposed.state, 'bob', { type: 'accept_trade', payload: { offerId: offer.id } });
        expect(holderShares(accepted.state, corp.id, 'alice')).toBe(6);
        expect(holderShares(accepted.state, corp.id, 'bob')).toBe(4);
        expect(accepted.state.players.find(p => p.userId === 'alice').cash).toBe(1650);
        expect(accepted.state.players.find(p => p.userId === 'bob').cash).toBe(1350);
        // Nothing is listed for sale; shares a player holds move only by accepted offers.
        expect(accepted.state.corporations[0].availableShares).toBe(0);
        expect(accepted.state.players.find(p => p.userId === 'bob').corporations[0]).toMatchObject({ ticker: 'ALC', sharesOwned: 4 });
    });

    test('shares can be sent as a gift and traded onward by a non-founder', () => {
        const { state, corp } = stateWithCorporation();
        const gift = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Shares: [{ corpId: corp.id, shares: 3 }],
        });
        const afterGift = applyAction(gift.state, 'bob', { type: 'accept_trade', payload: { offerId: gift.state.marketOffers[0].id } }).state;
        expect(holderShares(afterGift, corp.id, 'bob')).toBe(3);

        const sellBack = propose(afterGift, 'bob', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Cash: 40,
            player2Shares: [{ corpId: corp.id, shares: 1 }],
        });
        const offerId = sellBack.state.marketOffers.find(o => o.status === 'pending').id;
        const afterSale = applyAction(sellBack.state, 'alice', { type: 'accept_trade', payload: { offerId } }).state;
        expect(holderShares(afterSale, corp.id, 'bob')).toBe(2);
        expect(holderShares(afterSale, corp.id, 'alice')).toBe(8);
    });

    test('cannot offer more shares than held, or shares of an insolvent LLC', () => {
        const { state, corp } = stateWithCorporation();
        expect(() => propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Shares: [{ corpId: corp.id, shares: 11 }],
        })).toThrow(GameRuleError);
        expect(() => propose(state, 'bob', {
            player1Id: 'alice',
            player2Id: 'bob',
            player2Shares: [{ corpId: corp.id, shares: 1 }],
        })).toThrow(/does not hold/);

        state.corporations[0].insolvent = true;
        state.corporations[0].status = 'insolvent';
        expect(() => propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Shares: [{ corpId: corp.id, shares: 1 }],
        })).toThrow(/insolvent/);
    });

    test('an offer is rejected at accept time if the seller no longer holds the shares', () => {
        const { state, corp } = stateWithCorporation();
        const proposed = propose(state, 'alice', {
            player1Id: 'alice',
            player2Id: 'bob',
            player1Shares: [{ corpId: corp.id, shares: 10 }],
        });
        proposed.state.corporations[0].shareholders[0].shares = 5;
        proposed.state.corporations[0].treasuryShares = 5;
        proposed.state.corporations[0].availableShares = 5;
        expect(() => applyAction(proposed.state, 'bob', {
            type: 'accept_trade',
            payload: { offerId: proposed.state.marketOffers[0].id },
        })).toThrow(/does not hold/);
    });
});

describe('trading a property into an LLC for shares', () => {
    // Alice founds ALC (12 shares) with prop-3; Bob owns prop-1 (makeState).
    function setup() {
        const state = makeState();
        ownProperty(state, 'prop-3', 'alice', 'Alice');
        const { state: withCorp } = applyAction(state, 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 12, assetIds: ['prop-3'] },
        });
        return { state: withCorp, corp: withCorp.corporations[0] };
    }

    function propose(state, actorId, payload) {
        return applyAction(state, actorId, {
            type: 'propose_trade',
            payload: { player1Id: 'alice', player2Id: 'bob', player1AssetIds: [], player2AssetIds: [], ...payload },
        });
    }

    function holderShares(state, corpId, userId) {
        const corp = state.corporations.find(c => c.id === corpId);
        return corp.shareholders.find(holder => holder.userId === userId)?.shares || 0;
    }

    test('the property goes into the LLC and the giver gets shares', () => {
        const { state, corp } = setup();
        const proposed = propose(state, 'bob', {
            player2AssetIds: ['prop-1'],
            player2PropertiesToCorpId: corp.id,
            player1Shares: [{ corpId: corp.id, shares: 3 }],
        });
        const offer = proposed.state.marketOffers[0];
        expect(offer.player2PropertiesToCorpId).toBe(corp.id);
        expect(offer.player1PropertiesToCorpId).toBeNull();

        const { state: after } = applyAction(proposed.state, 'alice', { type: 'accept_trade', payload: { offerId: offer.id } });
        const property = after.properties.find(prop => prop.id === 'prop-1');
        expect(property.ownerId).toBe(corp.id);
        expect(property.ownerName).toBe('[ALC]');
        const afterCorp = after.corporations.find(c => c.id === corp.id);
        expect(afterCorp.assets.map(asset => asset.id)).toEqual(expect.arrayContaining(['prop-1', 'prop-3']));
        expect(holderShares(after, corp.id, 'bob')).toBe(3);
        expect(holderShares(after, corp.id, 'alice')).toBe(9);
        const alice = after.players.find(p => p.userId === 'alice');
        expect(alice.properties.map(prop => prop.id)).not.toContain('prop-1');
        expect(after.gameLog.some(entry => /into ALC/.test(entry.message || entry))).toBe(true);
    });

    test('only an LLC the receiving player runs can take the property', () => {
        const { state, corp } = setup();
        // Alice gives prop-5 into ALC, but the receiving side is Bob, who doesn't run ALC.
        ownProperty(state, 'prop-5', 'alice', 'Alice');
        expect(() => propose(state, 'alice', {
            player1AssetIds: ['prop-5'],
            player1PropertiesToCorpId: corp.id,
            player2Cash: 10,
        })).toThrow(/Bob does not run ALC/);
    });

    test('an LLC destination needs a property on that side and a solvent LLC', () => {
        const { state, corp } = setup();
        expect(() => propose(state, 'bob', {
            player2Cash: 10,
            player2PropertiesToCorpId: corp.id,
        })).toThrow(/property/);

        state.corporations[0].insolvent = true;
        state.corporations[0].status = 'insolvent';
        expect(() => propose(state, 'bob', {
            player2AssetIds: ['prop-1'],
            player2PropertiesToCorpId: corp.id,
        })).toThrow(/insolvent/);
    });

    test('the offer fails at accept time if the receiver no longer runs the LLC', () => {
        const { state, corp } = setup();
        const proposed = propose(state, 'bob', {
            player2AssetIds: ['prop-1'],
            player2PropertiesToCorpId: corp.id,
            player1Shares: [{ corpId: corp.id, shares: 3 }],
        });
        const liveCorp = proposed.state.corporations[0];
        liveCorp.chairmanId = 'bob';
        liveCorp.chairmanName = 'Bob';
        liveCorp.shareholders = [{ userId: 'alice', name: 'Alice', shares: 6 }, { userId: 'bob', name: 'Bob', shares: 6 }];
        expect(() => applyAction(proposed.state, 'alice', {
            type: 'accept_trade',
            payload: { offerId: proposed.state.marketOffers[0].id },
        })).toThrow(/Alice does not run ALC/);
    });
});

describe('majority holders chair their LLC', () => {
    function stateWithLlc() {
        const state = makeState();
        ownProperty(state, 'prop-3', 'alice', 'Alice');
        const { state: withCorp } = applyAction(state, 'alice', {
            type: 'create_ipo',
            payload: { ticker: 'ALC', totalShares: 10, assetIds: ['prop-3'] },
        });
        return withCorp;
    }

    function sellShares(state, shares) {
        const corp = state.corporations[0];
        const { state: proposed } = applyAction(state, 'bob', {
            type: 'propose_trade',
            payload: { player1Id: 'bob', player2Id: 'alice', player1Cash: 10 * shares, player2Cash: 0, player1AssetIds: [], player2AssetIds: [], player2Shares: [{ corpId: corp.id, shares }] },
        });
        const offer = proposed.marketOffers.find(o => o.status === 'pending');
        return applyAction(proposed, 'alice', { type: 'accept_trade', payload: { offerId: offer.id } });
    }

    test('buying a majority by trade makes the buyer chairman, with a log line', () => {
        const { state, events } = sellShares(stateWithLlc(), 6);
        expect(state.corporations[0].chairmanId).toBe('bob');
        expect(events.some(e => e.type === 'chairman_changed' && e.data.method === 'majority-gained')).toBe(true);
        expect(state.gameLog.some(entry => /Bob now holds a majority of ALC/.test(entry.message))).toBe(true);
    });

    test('half the shares is not a majority', () => {
        const { state } = sellShares(stateWithLlc(), 5);
        expect(state.corporations[0].chairmanId).toBe('alice');
    });

    test('a majority holder who appoints someone else keeps that choice', () => {
        let { state } = sellShares(stateWithLlc(), 6);
        const corp = state.corporations[0];
        ({ state } = applyAction(state, 'bob', { type: 'change_chairman', payload: { corpId: corp.id, candidateUserId: 'alice' } }));
        expect(state.corporations[0].chairmanId).toBe('alice');
        // Bob buying one more share does not take the chair back: he already had a majority.
        ({ state } = sellShares(state, 1));
        expect(state.corporations[0].chairmanId).toBe('alice');
    });
});

describe('trade counteroffers', () => {
    function counter(state, actorId, offerId, overrides = {}) {
        return applyAction(state, actorId, {
            type: 'propose_trade',
            payload: {
                player1Id: 'bob',
                player2Id: 'alice',
                player1Cash: 0,
                player2Cash: 150,
                player1AssetIds: ['prop-1'],
                player2AssetIds: [],
                counterOfferId: offerId,
                ...overrides,
            },
        });
    }

    test('a counter closes the original as countered and waits on the original proposer', () => {
        const proposed = proposeCashForProperty(makeState());
        const originalId = proposed.state.marketOffers[0].id;

        const countered = counter(proposed.state, 'bob', originalId);
        const [original, reply] = countered.state.marketOffers;

        expect(original).toMatchObject({ status: 'countered', resolvedById: 'bob', counteredByOfferId: reply.id });
        expect(reply).toMatchObject({ status: 'pending', proposedById: 'bob', recipientId: 'alice', counterToOfferId: originalId, player2Cash: 150 });
        expect(countered.events.find(event => event.type === 'trade_offer_proposed').data.counterOfferId).toBe(originalId);
        expect(countered.state.gameLog.some(entry => entry.message.includes("Bob countered Alice's trade offer"))).toBe(true);
        expect(countered.state.players.find(p => p.userId === 'bob').cash).toBe(1500);

        // The original can no longer be accepted; the counter can.
        expect(() => applyAction(countered.state, 'bob', { type: 'accept_trade', payload: { offerId: originalId } })).toThrow('Pending trade offer not found');
        const accepted = applyAction(countered.state, 'alice', { type: 'accept_trade', payload: { offerId: reply.id } });
        expect(accepted.state.properties.find(prop => prop.id === 'prop-1').ownerId).toBe('alice');
        expect(accepted.state.players.find(p => p.userId === 'alice').cash).toBe(1350);
    });

    test('only the player the offer waits on can counter it', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;
        expect(() => counter(proposed.state, 'alice', offerId)).toThrow('Only the player an offer was made to can counter it');
    });

    test('a counter must be between the same two players', () => {
        const state = makeState();
        state.players.push(player('carol', 'Carol'));
        const proposed = proposeCashForProperty(state);
        const offerId = proposed.state.marketOffers[0].id;
        expect(() => counter(proposed.state, 'bob', offerId, { player2Id: 'carol' })).toThrow('A counteroffer must be between the same two players');
        expect(proposed.state.marketOffers[0].status).toBe('pending');
    });

    test('an expired or answered offer cannot be countered', () => {
        const proposed = proposeCashForProperty(makeState());
        const offerId = proposed.state.marketOffers[0].id;
        const declined = applyAction(proposed.state, 'bob', { type: 'cancel_trade', payload: { offerId } });
        expect(() => counter(declined.state, 'bob', offerId)).toThrow('Pending trade offer not found');

        proposed.state.marketOffers[0].expiresAt = '2000-01-01T00:00:00.000Z';
        expect(() => counter(proposed.state, 'bob', offerId)).toThrow('That trade offer has expired');
    });
});
