// Game screen action dispatcher.
//
// This file stays as a classic browser script. Handlers call functions exposed
// by src/js/game.js at click time, keeping the page no-build and easy to split.
(function (global) {
    'use strict';

    const handlers = {
        'place-auction-bid': () => global.placeAuctionBid(),
        'pass-auction': () => global.passAuction(),
        'host-cancel-auction': () => global.hostCancelAuction(),
        'open-buy-property': () => global.openBuyPropertyModal(),
        'roll-dice': () => global.rollDiceAndMove(),
        'pay-jail-fine': () => global.payJailFine(),
        'use-jail-card': () => global.useJailCard(),
        'open-ipo': () => global.openIPOModal(),
        'open-debt': () => global.openDebtModal(),
        'open-corporation': () => global.openCorporationModal(),
        'end-turn': () => global.endTurn(),
        'host-pause': () => global.hostPauseGame(),
        'host-end': () => global.hostEndGame(),
        'host-resume': () => global.hostResumeGame(),
        'buy-shares': button => global.buyShares(button.dataset.corpId),
        'support-chairman-vote': button => global.supportChairmanVote(button.dataset.corpId, button.dataset.voteId),
        'change-chairman-majority': button => global.changeChairmanByMajority(button.dataset.corpId),
        'propose-chairman-vote': button => global.proposeChairmanVote(button.dataset.corpId),
        'accept-trade-offer': button => global.acceptTradeOffer(button.dataset.offerId),
        'cancel-trade-offer': button => global.cancelTradeOffer(button.dataset.offerId),
        'host-cancel-trade-offer': button => global.hostCancelTradeOffer(button.dataset.offerId),
        'adjust-house': button => global.houseModalAdjust(button.dataset.propertyId, Number(button.dataset.delta)),
        'open-house': () => global.openHouseModal(),
    };

    function run(button) {
        const action = button?.dataset?.gameAction;
        const handler = handlers[action];
        if (!handler) {
            console.warn('Unhandled game action:', action);
            return false;
        }
        handler(button);
        return true;
    }

    global.GameActionDispatcher = { run };
})(window);
