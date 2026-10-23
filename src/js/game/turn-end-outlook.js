// Turn-end outlook: what End Turn will do to the current player's cash.
//
// Display only. It mirrors the order in endTurn (backend/domain/gameRulesInternal/turns.js):
// any unpaid claim is paid from cash first, then personal loans are serviced (serviceLoan in
// loans.js: autopay takes each loan's nextPayment as far as cash allows, and a loan on its
// last turn takes its whole balance), then the player goes bankrupt if cash is below zero or
// the claim is still unpaid. Then each corporation whose loans this player services
// (loanServicerId in debt.js: the chairman, or the majority holder when the chair is
// empty) is serviced the same way, and becomes insolvent if its cash ends below zero.
// Keep the two in step.
// Classic browser script, no build.
(function (global) {
    'use strict';

    function claimCreditorIsActive(gameState, claim) {
        if (claim.creditorType === 'player') {
            return (gameState.players || []).some(p => p.userId === claim.creditorId && !p.bankrupt);
        }
        if (claim.creditorType === 'corporation') {
            return (gameState.corporations || []).some(c => c.id === claim.creditorId && !c.insolvent);
        }
        return false;
    }

    function loanPaymentsAtTurnEnd(debts, cash) {
        let remaining = cash;
        let paid = 0;
        let maturing = 0;
        let shortAutopay = false;
        (debts || []).forEach(debt => {
            const due = Number(debt.nextPayment || 0);
            let payment = 0;
            if (Number(debt.turnsRemaining || 0) <= 1) {
                payment = due;
                maturing += due;
            } else if (debt.autopay !== false) {
                payment = Math.min(due, Math.max(0, remaining));
                if (payment < due) shortAutopay = true;
            }
            remaining -= payment;
            paid += payment;
        });
        return { paid, maturing, shortAutopay };
    }

    function servicesLoansOf(corp, userId) {
        if (corp.chairmanId) return corp.chairmanId === userId;
        const total = Number(corp.totalShares || 0);
        return (corp.shareholders || []).some(holder => holder.userId === userId && Number(holder.shares || 0) * 2 > total);
    }

    // The corporations whose loans this player's End Turn services, with what happens to each.
    function getCompanyOutlooks(gameState, player) {
        if (!player) return [];
        return (gameState?.corporations || [])
            .filter(corp => !corp.insolvent && (corp.debts || []).length && servicesLoansOf(corp, player.userId))
            .map(corp => {
                const cash = Number(corp.cash || 0);
                const loans = loanPaymentsAtTurnEnd(corp.debts, cash);
                const cashAfter = cash - loans.paid;
                return {
                    ticker: corp.ticker,
                    cash,
                    cashAfter,
                    maturing: loans.maturing,
                    // Autopay can't cover a payment: the rest is added to the loan as unpaid interest.
                    shortAutopay: loans.shortAutopay,
                    goesInsolvent: cashAfter < 0,
                };
            });
    }

    function getTurnEndOutlook(gameState, player) {
        const claims = gameState?.bankruptcyClaims || {};
        const rawClaim = player ? claims[player.userId] : null;
        const claim = rawClaim && Number(rawClaim.unpaidAmount || 0) > 0 ? rawClaim : null;
        const cash = Number(player?.cash || 0);
        const unpaid = claim ? Number(claim.unpaidAmount || 0) : 0;
        const creditorActive = claim ? claimCreditorIsActive(gameState, claim) : true;
        const claimPaid = claim && creditorActive ? Math.min(Math.max(cash, 0), unpaid) : 0;
        const loans = loanPaymentsAtTurnEnd(player?.debts, cash - claimPaid);
        const cashAfter = cash - claimPaid - loans.paid;
        const claimLeft = claim !== null && (!creditorActive || claimPaid < unpaid);
        const goesBankrupt = cashAfter < 0 || claimLeft;

        return {
            claim,
            unpaid,
            loanPayments: loans.paid,
            // Loans on their last turn: their whole balance is due at End Turn.
            maturing: loans.maturing,
            cash,
            cashAfter,
            // Cash to raise before End Turn to avoid bankruptcy.
            shortfall: (claim && creditorActive ? unpaid - claimPaid : 0) + Math.max(0, -cashAfter),
            creditorActive,
            goesBankrupt,
            // The claim gets paid in full by End Turn and the player survives.
            settlesClaim: claim !== null && !goesBankrupt,
        };
    }

    global.TurnEndOutlook = { forPlayer: getTurnEndOutlook, forCompanies: getCompanyOutlooks };
})(window);
