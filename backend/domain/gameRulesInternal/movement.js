// A turn on the board: dice, jail, moving, landing, cards, buying property
// and houses.

const {
    BOARD_SQUARES,
    HOUSE_COSTS,
    JAIL_FINE_AMOUNT,
    CHANCE_CARDS,
    COMMUNITY_CHEST_CARDS,
    shuffleDeck,
    findNearestType,
    randomDie,
} = require('./board');
const { makeEvent, log, GameRuleError } = require('./util');
const { calculateRentForLanding, recordCashFlow, ownsCompleteGroup } = require('./ledger');
const { payCreditorAvailableCash } = require('./bankruptcy');

function rollDice(state, player, events, options) {
    if (player.diceRolled) throw new GameRuleError(400, 'Dice already rolled this turn');
    state.lastCardDrawn = null;
    const [die1, die2] = Array.isArray(options.dice) ? options.dice : [randomDie(), randomDie()];
    const total = die1 + die2;
    const isDoubles = die1 === die2;
    const wasInJail = player.inJail;
    state.lastDiceRoll = [die1, die2];

    if (!wasInJail && isDoubles) {
        player.doubleCount += 1;
        if (player.doubleCount >= 3) {
            sendToJail(player);
            log(state, `${player.name} rolled doubles 3 times - sent to Jail!`);
            events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, sentToJail: true }));
            return;
        }
    } else if (!wasInJail) {
        player.doubleCount = 0;
    }

    if (wasInJail) {
        if (isDoubles) {
            releaseFromJail(player);
            log(state, `${player.name} rolled doubles and left Jail.`);
        } else {
            player.jailTurns += 1;
            if (player.jailTurns >= 3) {
                player.cash -= JAIL_FINE_AMOUNT;
                recordCashFlow(state, player.userId, null, JAIL_FINE_AMOUNT);
                releaseFromJail(player);
                events.push(makeEvent(player, 'forced_payment', { from: player.name, to: 'the Bank', amount: JAIL_FINE_AMOUNT, reason: 'Jail bail' }));
                log(state, `${player.name} paid $${JAIL_FINE_AMOUNT} bail after their third Jail turn.`);
            } else {
                player.diceRolled = true;
                log(state, `${player.name} is in Jail (turn ${player.jailTurns}/3). Rolled ${die1}+${die2}.`);
                events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, inJail: true }));
                return;
            }
        }
    }

    movePlayer(state, player, total, events);
    if (!isDoubles || wasInJail) player.diceRolled = true;
    if (wasInJail) player.doubleCount = 0;
    const square = BOARD_SQUARES[player.position];
    const canRollAgain = isDoubles && !wasInJail;
    log(state, `${player.name} rolled ${die1}+${die2}=${total} - moved to ${square.name}${canRollAgain ? ' (doubles - roll again!)' : ''}`);
    events.push(makeEvent(player, 'dice_roll', { player: player.name, die1, die2, total, isDoubles, square: square.name, jailReleased: wasInJail }));
    processLanding(state, player, square, total, events);
}

function payJailFine(state, player, events) {
    requireJailExitChoice(player);
    state.lastDiceRoll = null;
    player.cash -= JAIL_FINE_AMOUNT;
    recordCashFlow(state, player.userId, null, JAIL_FINE_AMOUNT);
    releaseFromJail(player);
    events.push(makeEvent(player, 'jail_fine_paid', { player: player.name, amount: JAIL_FINE_AMOUNT }));
    log(state, `${player.name} paid $${JAIL_FINE_AMOUNT} to leave Jail.`);
}

function useGetOutOfJailCard(state, player, events) {
    requireJailExitChoice(player);
    if (!player.hasGetOutOfJailCard) throw new GameRuleError(400, 'No Get Out of Jail Free card available');
    state.lastDiceRoll = null;
    player.hasGetOutOfJailCard = false;
    releaseFromJail(player);
    events.push(makeEvent(player, 'jail_card_used', { player: player.name }));
    log(state, `${player.name} used a Get Out of Jail Free card.`);
}

function requireJailExitChoice(player) {
    if (!player.inJail) throw new GameRuleError(400, 'Player is not in Jail');
    if (player.diceRolled) throw new GameRuleError(400, 'Jail choice must be made before rolling');
}

function movePlayer(state, player, spaces, events) {
    const oldPos = player.position || 0;
    const newPos = (oldPos + spaces) % 40;
    if (newPos < oldPos) {
        const amount = state.settings.passGoAmount || 200;
        player.cash += amount;
        recordCashFlow(state, null, player.userId, amount);
        events.push(makeEvent(player, 'pass_go', { player: player.name, amount }));
        log(state, `${player.name} passed GO - collected $${amount}!`);
    }
    player.position = newPos;
}

function processLanding(state, player, square, diceTotal, events, options = {}) {
    if (!square) return;
    if (['property', 'railroad', 'utility'].includes(square.type)) {
        const prop = state.properties.find(p => p.id === square.propertyId);
        if (!prop || !prop.ownerId || prop.ownerId === player.userId) return;
        const owner = state.players.find(p => p.userId === prop.ownerId);
        const corporationOwner = owner ? null : state.corporations.find(corp => corp.id === prop.ownerId);
        if (!owner && !corporationOwner) return;
        if (owner && owner.bankrupt) return;
        if (corporationOwner && corporationOwner.insolvent) return;
        const rent = calculateRentForLanding(state, prop.id, diceTotal, options);
        const creditor = owner
            ? { type: 'player', id: owner.userId, name: owner.name, entity: owner }
            : { type: 'corporation', id: corporationOwner.id, name: `[${corporationOwner.ticker}]`, entity: corporationOwner };
        payCreditorAvailableCash(state, player, creditor, rent, `Rent for ${square.name}`, events, {
            propertyId: prop.id,
            propertyName: prop.name,
        });
        return;
    }
    if (square.type === 'tax') {
        player.cash -= square.taxAmount;
        recordCashFlow(state, player.userId, null, square.taxAmount);
        events.push(makeEvent(player, 'tax_payment', { from: player.name, to: 'the Bank', amount: square.taxAmount, reason: square.name }));
        log(state, `${player.name} paid $${square.taxAmount} to the Bank for ${square.name}`);
        return;
    }
    if (square.type === 'chance') drawCard(state, player, 'chance', events);
    if (square.type === 'community_chest') drawCard(state, player, 'community_chest', events);
    if (square.type === 'go_to_jail') {
        sendToJail(player);
        log(state, `${player.name} landed on Go to Jail!`);
    }
}

function drawCard(state, player, deckType, events) {
    const key = deckType === 'chance' ? 'chanceCards' : 'communityChestCards';
    const source = deckType === 'chance' ? CHANCE_CARDS : COMMUNITY_CHEST_CARDS;
    if (!state[key] || state[key].length === 0) state[key] = shuffleDeck(source);
    const card = state[key].shift();
    const before = snapshotCardState(state, player);
    applyCardEffect(state, player, card, events);
    const effect = summarizeCardEffect(before, state, player);
    state.lastCardDrawn = {
        id: card.id,
        deckType,
        playerId: player.userId,
        playerName: player.name,
        card: card.text,
        effect,
        drawnAt: new Date().toISOString(),
    };
    events.push(makeEvent(player, 'card_draw', { player: player.name, deckType, card: card.text, effect }));
}

function applyCardEffect(state, player, card, events) {
    const action = card.action;
    switch (action.type) {
        case 'advance_to': {
            const old = player.position;
            player.position = action.position;
            if (action.position < old || (action.position === 0 && old !== 0)) {
                player.cash += state.settings.passGoAmount || 200;
                recordCashFlow(state, null, player.userId, state.settings.passGoAmount || 200);
            }
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events);
            break;
        }
        case 'advance_nearest': {
            const nearest = findNearestType(player.position, action.nearestType);
            if (nearest < player.position) {
                player.cash += state.settings.passGoAmount || 200;
                recordCashFlow(state, null, player.userId, state.settings.passGoAmount || 200);
            }
            player.position = nearest;
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events, {
                rentMultiplier: action.rentMultiplier || 1,
                utilityMultiplier: action.utilityMultiplier || (action.nearestType === 'utility' ? 10 : null),
            });
            break;
        }
        case 'go_to_jail':
            sendToJail(player);
            break;
        case 'back_3':
            player.position = (player.position - 3 + 40) % 40;
            processLanding(state, player, BOARD_SQUARES[player.position], state.lastDiceRoll ? state.lastDiceRoll[0] + state.lastDiceRoll[1] : 0, events);
            break;
        case 'collect':
            player.cash += action.amount;
            recordCashFlow(state, null, player.userId, action.amount);
            break;
        case 'pay':
            player.cash -= action.amount;
            recordCashFlow(state, player.userId, null, action.amount);
            break;
        case 'collect_from_each':
            state.players.forEach(other => {
                if (other.userId !== player.userId && !other.bankrupt) {
                    other.cash -= action.amount;
                    player.cash += action.amount;
                    recordCashFlow(state, other.userId, player.userId, action.amount);
                }
            });
            break;
        case 'pay_to_each':
            state.players.forEach(other => {
                if (other.userId !== player.userId && !other.bankrupt) {
                    other.cash += action.amount;
                    player.cash -= action.amount;
                    recordCashFlow(state, player.userId, other.userId, action.amount);
                }
            });
            break;
        case 'get_out_of_jail':
            player.hasGetOutOfJailCard = true;
            break;
        case 'repairs': {
            let houses = 0;
            let hotels = 0;
            state.properties.forEach(prop => {
                if (prop.ownerId === player.userId) {
                    if (prop.houses === 5) hotels += 1;
                    else houses += prop.houses || 0;
                }
            });
            const repairCost = action.perHouse * houses + action.perHotel * hotels;
            player.cash -= repairCost;
            if (repairCost > 0) recordCashFlow(state, player.userId, null, repairCost);
            break;
        }
    }
    log(state, `${player.name} drew card: ${card.text}`);
}

function snapshotCardState(state, player) {
    return {
        player: {
            cash: Number(player.cash || 0),
            position: Number(player.position || 0),
            inJail: !!player.inJail,
            hasGetOutOfJailCard: !!player.hasGetOutOfJailCard,
        },
        others: state.players
            .filter(other => other.userId !== player.userId)
            .map(other => ({ userId: other.userId, cash: Number(other.cash || 0) })),
    };
}

function summarizeCardEffect(before, state, player) {
    const parts = [];
    const cashDelta = Number(player.cash || 0) - before.player.cash;
    if (cashDelta > 0) parts.push(`collected $${cashDelta.toFixed(2)}`);
    if (cashDelta < 0) parts.push(`paid $${Math.abs(cashDelta).toFixed(2)}`);
    if (Number(player.position || 0) !== before.player.position) {
        const square = BOARD_SQUARES[player.position || 0];
        parts.push(`moved to ${square ? square.name : `position ${player.position}`}`);
    }
    if (!before.player.inJail && player.inJail) parts.push('went to Jail');
    if (!before.player.hasGetOutOfJailCard && player.hasGetOutOfJailCard) parts.push('received a Get Out of Jail Free card');

    const otherDeltas = state.players
        .filter(other => other.userId !== player.userId)
        .map(other => {
            const previous = before.others.find(item => item.userId === other.userId);
            return previous ? Number(other.cash || 0) - previous.cash : 0;
        })
        .filter(delta => delta !== 0);
    if (otherDeltas.length > 0) parts.push('affected other players');
    return parts.length ? parts.join('; ') : 'no immediate cash or position change';
}

function buyProperty(state, player, events) {
    const square = BOARD_SQUARES[player.position || 0];
    if (!square || !square.propertyId) throw new GameRuleError(400, 'You are not on a property');
    const prop = state.properties.find(p => p.id === square.propertyId);
    if (!prop || prop.ownerId) throw new GameRuleError(400, 'Property is not available');
    if (player.cash < prop.price) throw new GameRuleError(400, 'Insufficient funds');
    prop.ownerId = player.userId;
    prop.ownerName = player.name;
    player.cash -= prop.price;
    recordCashFlow(state, player.userId, null, prop.price);
    events.push(makeEvent(player, 'property_purchase', { buyer: player.name, property: prop.name, price: prop.price }));
    log(state, `${player.name} purchased ${prop.name} for $${prop.price.toFixed(2)}`);
}

function buyHouses(state, player, payload, events) {
    const selections = payload.selections || {};
    let totalCost = 0;
    const changes = [];
    for (const [propId, deltaRaw] of Object.entries(selections)) {
        const delta = Number(deltaRaw);
        if (!Number.isInteger(delta) || delta <= 0) continue;
        const prop = state.properties.find(p => p.id === propId);
        if (!prop || prop.ownerId !== player.userId) throw new GameRuleError(400, 'Can only improve owned properties');
        if (!ownsCompleteGroup(state, player.userId, prop.color)) throw new GameRuleError(400, 'Must own complete color group');
        if (!HOUSE_COSTS[prop.color]) throw new GameRuleError(400, 'Cannot improve this property type');
        if ((prop.houses || 0) + delta > 5) throw new GameRuleError(400, 'Too many houses');
        totalCost += delta * HOUSE_COSTS[prop.color];
        changes.push({ prop, delta });
    }
    if (changes.length === 0) throw new GameRuleError(400, 'No houses selected');
    if (player.cash < totalCost) throw new GameRuleError(400, 'Insufficient funds');
    player.cash -= totalCost;
    recordCashFlow(state, player.userId, null, totalCost);
    changes.forEach(({ prop, delta }) => { prop.houses = (prop.houses || 0) + delta; });
    events.push(makeEvent(player, 'house_purchase', { player: player.name, cost: totalCost }));
    log(state, `${player.name} bought houses/hotels for $${totalCost}`);
}

// Going to Jail by any route ends the turn: no doubles re-roll and no Jail
// choice until the player's next turn.
function sendToJail(player) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    player.doubleCount = 0;
    player.diceRolled = true;
}

function releaseFromJail(player) {
    player.inJail = false;
    player.jailTurns = 0;
    player.doubleCount = 0;
}

module.exports = {
    rollDice,
    payJailFine,
    useGetOutOfJailCard,
    applyCardEffect,
    buyProperty,
    buyHouses,
};
