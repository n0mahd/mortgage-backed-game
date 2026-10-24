// Game log wording: turns stored game events into the sentences shown in the
// Recent events tab.
// Part of the game page; plain top-level functions, loaded before game.js.

// Format a game event into a human-readable string
function formatLogEvent(type, data) {
    switch (type) {
        case 'property_purchase':
            if (data.actor) return `${data.actor} bought ${data.property} for ${data.buyer} for $${Number(data.price).toFixed(2)}`;
            return `${data.buyer} purchased ${data.property} for $${Number(data.price).toFixed(2)}`;
        case 'rent_policy_changed': {
            const label = data.policy === 'payout' ? 'Payout: rent goes to its shareholders' : 'Reinvest: rent stays in its treasury';
            return data.method === 'unanimous'
                ? `Every ${data.ticker} shareholder agreed: ${data.ticker} switched to ${label}`
                : `${data.actor} switched ${data.ticker} to ${label} (locked for their next ${data.lockedTurns || 5} turns)`;
        }
        case 'rent_policy_vote_proposed':
            return `${data.actor} asked every ${data.ticker} shareholder to switch it to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_supported':
            return `${data.actor} agreed to switch ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'rent_policy_vote_rejected':
            return `${data.actor} rejected switching ${data.ticker} to ${data.policy === 'payout' ? 'Payout' : 'Reinvest'}`;
        case 'dividend_paid':
            return `${data.ticker} paid a $${Number(data.amount).toFixed(2)} dividend: ${formatPayouts(data.payouts)}`;
        case 'rent_distributed':
            return `${data.ticker} passed ${data.payer}'s rent to its shareholders: ${formatPayouts(data.payouts)}`;
        case 'property_offer_made':
            return `${data.offerer} offered ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)} in ${data.payWith === 'cash' ? 'treasury cash' : 'new shares'}`;
        case 'property_offer_countered':
            return `${data.actor} countered: ${(data.properties || []).join(', ')} to ${data.ticker} for $${Number(data.price).toFixed(2)}`;
        case 'property_offer_accepted':
            return `${data.ticker} took ${(data.properties || []).join(', ')} from ${data.offerer} for ${Number(data.newShares) > 0 ? `${ShareDeals.count(data.newShares)} new shares` : `$${Number(data.price).toFixed(2)}`}`;
        case 'property_offer_closed':
            return `The offer of ${(data.properties || []).join(', ')} to ${data.ticker} was ${data.status === 'expired' ? 'left to expire' : data.status}`;
        case 'ipo_created':
            return `${data.founder} created IPO ${data.ticker}: ${ShareDeals.count(data.founderShares || data.shares)} shares held by ${data.founder}`;
        case 'corporation_assets_added': {
            const names = Array.isArray(data.properties) ? data.properties.join(', ') : 'property';
            const shares = Number(data.newShares || 0);
            return `${data.actor} put ${names} into ${data.ticker}${shares ? ` for ${ShareDeals.count(shares)} new share${shares === 1 ? '' : 's'} (${data.ticker} now has ${ShareDeals.count(data.totalShares)})` : ''}`;
        }
        case 'share_purchase': {
            const founderShares = Number(data.founderShares || 0);
            const treasuryShares = Number(data.treasuryShares || 0);
            const parts = [];
            if (founderShares > 0) parts.push(`${founderShares} from founder`);
            if (treasuryShares > 0) parts.push(`${treasuryShares} from treasury`);
            const source = parts.length ? ` (${parts.join(', ')})` : '';
            return `${data.buyer} bought ${data.shares} share(s) of ${data.ticker}${source} for $${Number(data.totalCost).toFixed(2)}`;
        }
        case 'chairman_changed':
            if (data.method === 'bankruptcy') return `${data.ticker} chairman changed to ${data.chairman} after bankruptcy`;
            return `${data.ticker} chairman changed to ${data.chairman} by ${data.method === 'vote' ? `${data.supportedShares} supporting shares` : 'majority control'}`;
        case 'chairman_vacated':
            return `${data.ticker} chairman seat is vacant after ${data.formerChairman}'s bankruptcy`;
        case 'chairman_vote_proposed':
            return `${data.ticker} chairman vote proposed for ${data.candidate}`;
        case 'chairman_vote_supported':
            return `${data.supporter} supported ${data.candidate} for ${data.ticker} chairman`;
        case 'debt_issued':
            return `${data.actor ? `${data.actor} borrowed for ${data.issuer}` : `${data.issuer} borrowed`} $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turns` : ''} at ${data.interestRate}% per turn`;
        case 'debt_payment':
            return data.paidOff
                ? `${data.payer} paid off a loan ($${Number(data.amount).toFixed(2)})`
                : `${data.payer} paid $${Number(data.amount).toFixed(2)} towards a loan`;
        case 'debt_refinanced':
            return `${data.borrower} refinanced ${data.refinancedDebtCount} debt(s) into $${Number(data.amount).toFixed(2)}${data.termTurns ? ` over ${data.termTurns} turns` : ''} at ${data.interestRate}% per turn and ${Number(data.netProceeds || 0) < 0 ? `paid $${(-Number(data.netProceeds)).toFixed(2)} down from cash` : `received $${Number(data.netProceeds || 0).toFixed(2)} net cash`}`;
        case 'debt_autopay':
            return `${data.borrower} turned autopay ${data.autopay ? 'on' : 'off'} for a loan`;
        case 'loan_matured':
            return data.repaid
                ? `${data.borrower} repaid a loan in full at maturity ($${Number(data.amount).toFixed(2)})`
                : `${data.borrower} couldn't repay a $${Number(data.amount).toFixed(2)} loan that came due`;
        case 'interest_accrual':
            return data.paid !== undefined
                ? `${data.player} paid $${Number(data.paid).toFixed(2)} on loans (interest this turn: $${Number(data.interestCharged).toFixed(2)})`
                : `${data.player} was charged $${Number(data.interestCharged).toFixed(2)} in interest`;
        case 'corporation_insolvent': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const sharePositions = Array.isArray(data.wipedSharePositions) ? data.wipedSharePositions.length : 0;
            const debtCount = Array.isArray(data.clearedDebts) ? data.clearedDebts.length : 0;
            return `${data.ticker} became insolvent; ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} returned to the Bank, ${sharePositions} shareholder position(s) wiped, ${debtCount} debt(s) cleared`;
        }
        case 'game_paused':
            return `${data.actor || 'Host'} paused the game${data.reason ? `: ${data.reason}` : ''}`;
        case 'game_resumed':
            return `${data.actor || 'Host'} resumed the game`;
        case 'forced_payment':
            if (Number(data.unpaidAmount || 0) > 0) {
                return `${data.from} owed $${Number(data.amountOwed || 0).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}; paid $${Number(data.amount || 0).toFixed(2)}, $${Number(data.unpaidAmount || 0).toFixed(2)} unpaid`;
            }
            if (data.fullRent) {
                return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to} for ${data.reason} (full rent $${Number(data.fullRent).toFixed(2)}, less their ${data.ownPercent}% stake)`;
            }
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'jail_fine_paid':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} to leave Jail`;
        case 'jail_card_used':
            return `${data.player} used a Get Out of Jail Free card`;
        case 'tax_payment':
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}${data.reason ? ` for ${data.reason}` : ''}`;
        case 'bankruptcy_claim_payment':
            return `${data.player} paid $${Number(data.amount).toFixed(2)} toward ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy_claim_settled':
            return `${data.player} settled ${data.reason} owed to ${data.creditor}`;
        case 'bankruptcy':
            return `${data.player} has gone BANKRUPT${data.creditor ? ` owing ${data.creditor}` : ''}`;
        case 'bankruptcy_liquidation': {
            const propertyCount = Array.isArray(data.releasedProperties) ? data.releasedProperties.length : 0;
            const shares = (data.returnedSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const transferredShares = (data.transferredSharePositions || []).reduce((sum, item) => sum + Number(item.shares || 0), 0);
            const destination = data.assetDestinationName || 'the Bank';
            return `${data.player} liquidation: ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} to ${destination}, ${shares} share(s) returned, ${transferredShares} share(s) transferred`;
        }
        case 'turn_end':
            return `${data.player} ended their turn — it's now ${data.nextPlayer}'s turn`;
        case 'trade_offer_proposed':
            return data.counterOfferId
                ? `${data.proposer} countered ${data.recipient}'s trade offer`
                : `${data.proposer} proposed a trade with ${data.recipient}`;
        case 'trade_offer_accepted':
            return `${data.accepter} accepted ${data.proposer}'s trade offer`;
        case 'trade_offer_canceled':
            return `${data.actor} ${data.status === 'declined' ? 'declined' : 'canceled'} a trade offer`;
        case 'transaction':
            return `Trade: ${data.player1} ↔ ${data.player2} ($${data.player1Cash} + ${data.player1Assets} assets ↔ $${data.player2Cash} + ${data.player2Assets} assets)`;
        case 'payment':
            return `${data.from} paid $${Number(data.amount).toFixed(2)} to ${data.to}`;
        case 'game_started':
            return 'Game started';
        case 'game_ended':
            return `Game over — ${data.reason}`;
        case 'house_purchase':
            return `${data.player} bought houses/hotels for $${Number(data.cost).toFixed(2)}`;
        case 'property_auction_started':
            return `${data.startedBy} started an auction for ${data.property}`;
        case 'property_auction_bid':
            return `${data.bidder} bid $${Number(data.amount).toFixed(2)} for ${data.property}`;
        case 'property_auction_passed':
            return `${data.player} passed on ${data.property}`;
        case 'property_auction_won':
            return `${data.winner} won ${data.property} at auction for $${Number(data.amount).toFixed(2)}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_no_sale':
            return `Auction ended with no sale for ${data.property}${data.reason === 'timeout' ? ' after timeout' : ''}`;
        case 'property_auction_canceled':
            return `${data.actor} canceled the auction for ${data.property}`;
        case 'dice_roll':
            if (data.sentToJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} — sent to Jail`;
            if (data.inJail) return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} and stayed in Jail`;
            return `${data.player} rolled ${data.die1}+${data.die2}=${data.total} — moved to ${data.square}${data.isDoubles ? ' (doubles!)' : ''}`;
        case 'card_draw':
            return `${data.player} drew ${deckDisplayName(data.deckType)}: "${data.card}"${data.effect ? ` Applied: ${data.effect}.` : ''}`;
        case 'pass_go':
            return `${data.player} passed GO — collected $${data.amount}`;
        default:
            return `${type}: ${JSON.stringify(data)}`;
    }
}

function formatPayouts(payouts) {
    return (payouts || []).map(p => `$${Number(p.amount).toFixed(2)} to ${p.name}`).join(', ');
}

function formatLogTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const sameDay = date.toDateString() === new Date().toDateString();
    return date.toLocaleString([], sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
