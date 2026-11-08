// Market > Rule proposals: the house rules (Pass GO, the loan rate), the open
// vote with each player's answer, proposing a change, and past changes. Also
// the "Vote" pill and the Market tab dot when a vote is waiting for you.
//
// The rules live in backend/domain/gameRulesInternal/ruleChanges.js; this file
// only shows the state and sends propose/vote/withdraw actions. The limits it
// offers come from the server's settings shape and are checked there again.
// Classic browser script, no build; reads game.js's currentGame and currentUser.
(function (global) {
    'use strict';

    // Mirrors RULES in ruleChanges.js, for the form.
    const RULES = {
        passGoAmount: { label: 'Pass GO', unit: 'money', min: 0, max: 1000, step: 50, help: 'What everyone collects for passing or landing on GO.' },
        loanRate: { label: 'Loan interest rate', unit: 'percent', min: 0, max: 25, step: 0.5, help: 'Interest per turn on new loans. Loans already taken keep their rate.' },
    };
    const RULE_KEYS = Object.keys(RULES);

    // null, or { rule, value, step: 'form' | 'review' } while proposing.
    let draft = null;

    function state() {
        return currentGame?.game_state || null;
    }

    function me() {
        return currentUser?.id || null;
    }

    function ruleValue(gameState, rule) {
        return Number(gameState?.settings?.[rule] ?? (rule === 'passGoAmount' ? 200 : 5));
    }

    function formatValue(rule, value) {
        return RULES[rule].unit === 'percent' ? `${Number(value)}% per turn` : formatMoney(value);
    }

    function openProposal() {
        return state()?.ruleProposal || null;
    }

    function activePlayers(gameState) {
        return (gameState?.players || []).filter(player => !player.bankrupt);
    }

    function needsMyVote() {
        const proposal = openProposal();
        const gameState = state();
        if (!proposal || !gameState || gameState.ended || (typeof isSpectator !== "undefined" && isSpectator)) return false;
        const self = gameState.players.find(player => player.userId === me());
        return !!self && !self.bankrupt && !proposal.supporterIds.includes(self.userId);
    }

    // Locks the server keeps: a rule just changed, or my proposal just rejected.
    function lockFor(gameState, rule) {
        const locks = gameState?.ruleLocks || [];
        if (locks.some(lock => lock.userId === me())) return 'Your last proposal was rejected. You can propose again from your next turn.';
        if (locks.some(lock => lock.rule === rule)) return `${RULES[rule].label} was just changed by vote. It can be proposed again after a full round.`;
        return '';
    }

    function voteIcon(kind) {
        const labels = { yes: 'Yes', no: 'No', wait: 'Not voted yet', out: 'Bankrupt, no vote' };
        const glyphs = { yes: '✓', no: '✕', wait: '', out: '⊘' };
        return `<span class="vote-mark is-${kind}" role="img" aria-label="${labels[kind]}">${glyphs[kind]}</span>`;
    }

    // Every player with their mark. supporterIds says who agreed; rejectedById
    // marks the player whose No closed a vote.
    function renderVoters(gameState, supporterIds, { rejectedById = null, youPropose = false } = {}) {
        return `<ul class="rule-voters">${gameState.players.map(player => {
            const kind = player.bankrupt ? 'out'
                : player.userId === rejectedById ? 'no'
                    : (supporterIds.includes(player.userId) || (youPropose && player.userId === me())) ? 'yes' : 'wait';
            const you = player.userId === me() ? ' (you)' : '';
            return `
                <li class="rule-voter${player.bankrupt ? ' is-out' : ''}">
                    <span class="avatar" style="--token-color:${escapeHtml(getPlayerColor(player))}" aria-hidden="true">${escapeHtml(playerInitials(player.name))}</span>
                    <span class="rule-voter-name">${escapeHtml(player.name)}${you}</span>
                    ${voteIcon(kind)}
                </li>`;
        }).join('')}</ul>`;
    }

    function renderHouseRules(gameState) {
        const changes = gameState.ruleChanges || [];
        return `
            <div class="rule-card">
                <div class="rule-card-head">
                    <h4>House rules</h4>
                </div>
                <dl class="house-rules">
                    ${RULE_KEYS.map(rule => {
                        const changed = changes.some(change => change.rule === rule);
                        return `
                            <div class="house-rule">
                                <dt>${escapeHtml(RULES[rule].label)}</dt>
                                <dd>${escapeHtml(formatValue(rule, ruleValue(gameState, rule)))}
                                    <span class="player-badge${changed ? ' badge-gold' : ''}">${changed ? 'Changed by vote' : 'Set by host'}</span></dd>
                            </div>`;
                    }).join('')}
                </dl>
            </div>`;
    }

    function renderOpenProposal(gameState, proposal) {
        const spec = RULES[proposal.rule];
        const mine = proposal.proposedById === me();
        const waiting = needsMyVote();
        const agreed = activePlayers(gameState).filter(player => proposal.supporterIds.includes(player.userId)).length;
        const actions = waiting
            ? `<div class="trade-offer-actions">
                    <button class="btn btn-secondary btn-sm" data-game-action="rule-vote" data-approve="false" data-proposal-id="${escapeHtml(proposal.id)}">✕ No</button>
                    <button class="btn btn-success btn-sm" data-game-action="rule-vote" data-approve="true" data-proposal-id="${escapeHtml(proposal.id)}">✓ Yes</button>
               </div>`
            : (mine ? `<div class="trade-offer-actions"><button class="btn btn-secondary btn-sm" data-game-action="rule-withdraw">Withdraw proposal</button></div>` : '');
        const rateNote = proposal.rule === 'loanRate'
            ? `<p class="rule-note">New loans only. ${myLoanNote(gameState)}</p>`
            : '';
        return `
            <div class="rule-card is-open" id="ruleProposalCard">
                <p class="rule-sentence"><strong>${escapeHtml(mine ? 'You' : proposal.proposedByName)}</strong>: change <strong>${escapeHtml(spec.label)}</strong> from <strong>${escapeHtml(formatValue(proposal.rule, proposal.previousValue))}</strong> to <strong>${escapeHtml(formatValue(proposal.rule, proposal.value))}</strong>.</p>
                ${rateNote}
                <p class="rule-tally">Need a unanimous vote · ${agreed} of ${activePlayers(gameState).length}</p>
                ${renderVoters(gameState, proposal.supporterIds)}
                <p class="rule-note">Expires when it's ${mine ? 'your' : `${escapeHtml(proposal.proposedByName)}'s`} turn again.</p>
                ${actions}
            </div>`;
    }

    function myLoanNote(gameState) {
        const self = gameState.players.find(player => player.userId === me());
        const loans = self?.debts || [];
        if (!loans.length) return 'Loans already taken keep their rate.';
        const rates = [...new Set(loans.map(debt => `${Number(debt.interestRate)}%`))].join(', ');
        return `Your ${loans.length === 1 ? 'loan keeps' : `${loans.length} loans keep`} ${rates}.`;
    }

    function renderForm(gameState) {
        const spec = RULES[draft.rule];
        const current = ruleValue(gameState, draft.rule);
        const lock = lockFor(gameState, draft.rule);
        const unchanged = Number(draft.value) === current;
        return `
            <div class="rule-card" id="ruleProposalForm">
                <div class="rule-card-head"><h4>Propose a change</h4></div>
                <fieldset class="rule-choices">
                    <legend class="sr-only">Rule to change</legend>
                    ${RULE_KEYS.map(rule => `
                        <label class="rule-choice">
                            <input type="radio" name="ruleChoice" value="${rule}" ${rule === draft.rule ? 'checked' : ''}>
                            <span><strong>${escapeHtml(RULES[rule].label)}</strong><small>Now ${escapeHtml(formatValue(rule, ruleValue(gameState, rule)))}</small></span>
                        </label>`).join('')}
                </fieldset>
                <div class="form-group">
                    <label for="ruleValueInput">New ${spec.unit === 'percent' ? 'rate (% per turn)' : 'amount ($)'}</label>
                    <div class="rule-stepper">
                        <button type="button" class="btn btn-secondary" data-game-action="rule-adjust" data-delta="-1" aria-label="Lower">−</button>
                        <input type="number" id="ruleValueInput" inputmode="decimal" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${escapeHtml(String(draft.value))}">
                        <button type="button" class="btn btn-secondary" data-game-action="rule-adjust" data-delta="1" aria-label="Raise">+</button>
                    </div>
                    <p class="rule-note">${escapeHtml(spec.help)} ${spec.unit === 'percent' ? `0% to ${spec.max}%, in steps of ${spec.step}%.` : `${formatMoney(spec.min)} to ${formatMoney(spec.max)}, in steps of ${formatMoney(spec.step)}.`}</p>
                </div>
                ${lock ? `<p class="rule-note is-warning">${escapeHtml(lock)}</p>` : ''}
                <div class="trade-offer-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-game-action="rule-cancel">Cancel</button>
                    <button type="button" class="btn btn-success btn-sm" data-game-action="rule-review" ${lock || unchanged || !isValid(draft.rule, draft.value) ? 'disabled' : ''}>Review</button>
                </div>
            </div>`;
    }

    function renderReview(gameState) {
        const spec = RULES[draft.rule];
        return `
            <div class="rule-card" id="ruleProposalReview">
                <div class="rule-card-head"><h4>Review proposal</h4></div>
                <p class="rule-sentence">Change <strong>${escapeHtml(spec.label)}</strong> from <strong>${escapeHtml(formatValue(draft.rule, ruleValue(gameState, draft.rule)))}</strong> to <strong>${escapeHtml(formatValue(draft.rule, draft.value))}</strong>.</p>
                <p class="rule-tally">Need a unanimous vote</p>
                ${renderVoters(gameState, [], { youPropose: true })}
                <p class="rule-note">If nobody has answered by the time it's your turn again, the proposal expires.</p>
                <div class="trade-offer-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-game-action="rule-edit">Edit</button>
                    <button type="button" class="btn btn-success btn-sm" data-game-action="rule-send">Send proposal</button>
                </div>
            </div>`;
    }

    function renderHistory(gameState) {
        const changes = [...(gameState.ruleChanges || [])].reverse();
        if (!changes.length) return '';
        return `
            <div class="section-heading"><h3>Past changes</h3></div>
            <ul class="rule-history">
                ${changes.map(change => `
                    <li>${escapeHtml(RULES[change.rule]?.label || change.rule)}: ${escapeHtml(formatValue(change.rule, change.from))} → <strong>${escapeHtml(formatValue(change.rule, change.to))}</strong>
                        <small>Proposed by ${escapeHtml(change.proposedByName || 'a player')}, agreed by all</small></li>`).join('')}
            </ul>`;
    }

    function isValid(rule, value) {
        const spec = RULES[rule];
        const number = Number(value);
        if (!Number.isFinite(number) || number < spec.min || number > spec.max) return false;
        const steps = number / spec.step;
        return Math.abs(steps - Math.round(steps)) < 1e-9;
    }

    function canPropose(gameState) {
        const self = gameState.players.find(player => player.userId === me());
        return !!self && !self.bankrupt && !gameState.ended && !gameState.paused && !(typeof isSpectator !== "undefined" && isSpectator);
    }

    function render() {
        const pane = document.getElementById('ruleProposalsPane');
        const gameState = state();
        if (!pane || !gameState) return;
        const proposal = openProposal();
        if (proposal || !canPropose(gameState)) draft = null;

        let body = renderHouseRules(gameState);
        if (proposal) {
            body += renderOpenProposal(gameState, proposal);
        } else if (draft?.step === 'review') {
            body += renderReview(gameState);
        } else if (draft) {
            body += renderForm(gameState);
        } else if (canPropose(gameState)) {
            body += `<button type="button" class="btn btn-success rule-propose-btn" data-game-action="rule-start">Propose a change</button>
                     <p class="rule-note rule-centered">No open proposals. You can propose at any time.</p>`;
        } else {
            body += '<p class="rule-note rule-centered">No open proposals.</p>';
        }
        body += renderHistory(gameState);
        setPaneHtml(pane, body);

        const count = document.getElementById('marketRulesCount');
        if (count) {
            count.textContent = needsMyVote() ? '1' : '';
            count.hidden = !needsMyVote();
        }
        updateVoteBanner();
    }

    // Keeps a value being typed when an update re-renders the pane.
    function setPaneHtml(pane, html) {
        if (pane.dataset.html === html) return;
        const typing = document.activeElement?.id === 'ruleValueInput';
        pane.innerHTML = html;
        pane.dataset.html = html;
        if (typing) {
            const input = document.getElementById('ruleValueInput');
            input?.focus();
        }
    }

    // The "Vote" pill (like "It's your turn") and a dot on the Market tab while
    // a vote waits for you, unless you're already looking at it.
    function updateVoteBanner() {
        const banner = document.getElementById('rule-vote-banner');
        const proposal = openProposal();
        const waiting = needsMyVote();
        const onRulesPane = document.getElementById('market')?.classList.contains('active')
            && !document.getElementById('marketPane-rules')?.hidden;
        if (banner) {
            if (waiting && !onRulesPane) {
                const spec = RULES[proposal.rule];
                document.getElementById('rule-vote-banner-text').textContent =
                    `${proposal.proposedByName} proposes ${spec.label} → ${formatValue(proposal.rule, proposal.value).replace(' per turn', '')}`;
                banner.hidden = false;
            } else {
                banner.hidden = true;
            }
            const turnBanner = document.getElementById('turn-banner');
            banner.classList.toggle('is-stacked', !!turnBanner && turnBanner.style.display === 'flex');
        }
        const marketTab = document.querySelector('.nav-tab[data-section="market"]');
        if (marketTab) {
            let dot = marketTab.querySelector('.tab-dot');
            if (waiting && !dot) {
                dot = document.createElement('span');
                dot.className = 'tab-dot';
                dot.setAttribute('aria-hidden', 'true');
                marketTab.appendChild(dot);
            } else if (!waiting && dot) {
                dot.remove();
            }
        }
    }

    function open() {
        global.closeModal?.('corporationModal');
        global.openMarketPane('rules');
        render();
    }

    // A fresh form starts one step up from today's value, or one step down at the top of the range.
    function firstValue(rule) {
        const current = ruleValue(state(), rule);
        const up = Math.round((current + RULES[rule].step) * 100) / 100;
        return up <= RULES[rule].max ? up : Math.round((current - RULES[rule].step) * 100) / 100;
    }

    function start() {
        const rule = RULE_KEYS[0];
        draft = { rule, value: firstValue(rule), step: 'form' };
        render();
        document.getElementById('ruleValueInput')?.focus();
    }

    function pick(rule) {
        if (!draft || !RULES[rule]) return;
        draft = { rule, value: firstValue(rule), step: 'form' };
        render();
    }

    function adjust(delta) {
        if (!draft) return;
        const spec = RULES[draft.rule];
        const next = Math.round((Number(draft.value || 0) + delta * spec.step) * 100) / 100;
        draft.value = Math.min(spec.max, Math.max(spec.min, next));
        render();
    }

    function typed(value) {
        if (!draft) return;
        draft.value = value;
        // Only the Review button depends on the value; leave the input alone.
        const review = document.querySelector('#ruleProposalForm [data-game-action="rule-review"]');
        if (review) review.disabled = !!lockFor(state(), draft.rule) || Number(value) === ruleValue(state(), draft.rule) || !isValid(draft.rule, value);
    }

    function review() {
        if (!draft || !isValid(draft.rule, draft.value)) return;
        draft.value = Number(draft.value);
        draft.step = 'review';
        render();
    }

    function edit() {
        if (draft) draft.step = 'form';
        render();
    }

    function cancel() {
        draft = null;
        render();
    }

    async function send() {
        if (!draft) return;
        const { rule, value } = draft;
        const result = await global.submitGameAction('propose_rule_change', { rule, value }, {
            errorText: 'Could not send the proposal',
            showError: message => global.showMarketStatus(message, 'error'),
        });
        if (result) {
            draft = null;
            global.showMarketStatus('Proposal sent. Everyone has to agree.', 'success');
        }
        render();
    }

    async function vote(approve, proposalId) {
        const result = await global.submitGameAction('vote_rule_change', { approve, proposalId }, {
            errorText: 'Could not record your vote',
            showError: message => global.showMarketStatus(message, 'error'),
        });
        if (result) global.showMarketStatus(approve ? 'You voted yes.' : 'You voted no. The proposal is closed.', 'info');
        render();
    }

    async function withdraw() {
        const result = await global.submitGameAction('withdraw_rule_change', {}, {
            errorText: 'Could not withdraw the proposal',
            showError: message => global.showMarketStatus(message, 'error'),
        });
        if (result) global.showMarketStatus('Proposal withdrawn.', 'info');
        render();
    }

    function bind() {
        const pane = document.getElementById('ruleProposalsPane');
        if (!pane || pane.dataset.bound) return;
        pane.dataset.bound = 'true';
        pane.addEventListener('change', event => {
            if (event.target.name === 'ruleChoice') pick(event.target.value);
        });
        pane.addEventListener('input', event => {
            if (event.target.id === 'ruleValueInput') typed(event.target.value);
        });
        document.getElementById('rule-vote-banner-btn')?.addEventListener('click', open);
    }

    global.RuleProposals = {
        render,
        bind,
        open,
        start,
        adjust,
        review,
        edit,
        cancel,
        send,
        vote,
        withdraw,
        needsMyVote,
        updateVoteBanner,
    };
})(window);
