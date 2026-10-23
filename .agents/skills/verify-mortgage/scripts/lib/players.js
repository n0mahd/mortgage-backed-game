'use strict';

// Haiku players: one headless `claude -p` per agent seat (or one for several
// seats with --shared). Each plays through the same look/click commands a
// person-shaped agent would use, with a persona that steers how it plays and
// what it looks for, and ends with a written review of the game.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const runs = require('./runs');

const CMD = '.agents/skills/verify-mortgage/scripts/verify-mortgage';
const DEFAULT_MODEL = process.env.VERIFY_AGENT_MODEL || 'claude-haiku-5-5';
const AGENT_CAP = Number(process.env.VERIFY_AGENT_CAP || 8);

const PERSONAS = {
    newbie: {
        title: 'first-time player',
        play: 'You have never played this game. You know ordinary Monopoly a little. Read the screen literally and do what it seems to invite. Buy what looks affordable, try the buttons whose names you understand, and try a couple you do not.',
        watch: 'Anything that confuses you: unclear wording, a button whose effect surprised you, not knowing whose turn it is or what to do next, numbers you cannot explain, things you had to hunt for. Every moment of confusion is a finding.',
    },
    trader: {
        title: 'aggressive financier',
        play: 'You play to win through finance. Every turn, look for a deal: issue debt against property, create an IPO, buy other players\' shares, propose trades (Market tab) to complete colour groups, then buy houses. Settle debt when you are rich.',
        watch: 'Whether the money adds up: purchase prices, rent paid, interest charged at End Turn, share prices, trade cash. Check the Recent events tab against your cash. Any mismatch, or any finance screen that is hard to use on your device, is a finding.',
    },
    breaker: {
        title: 'QA tester trying to break the rules',
        play: 'You are a tester looking for holes. Within normal play, keep trying things the game should refuse: bids above your cash or below the current bid, zero, negative or fractional amounts, paying yourself, trading property you do not own, acting when it is not your turn, opening forms during an auction, pressing buttons twice, cancelling halfway through, leaving a form half-filled and switching tabs.',
        watch: 'Anything the game allows that a fair game should not, error messages that do not say what is wrong, states you cannot get out of, and screens that stop matching Recent events.',
    },
    auditor: {
        title: 'careful accountant',
        play: 'You play steadily and conservatively: buy cheap property, keep a cash cushion, avoid debt unless you must.',
        watch: 'Before and after each of your turns, compare your cash, properties and Recent actions and Recent events with what should have happened (GO salary $200, taxes, rent, card effects). Also check the other players\' cards for numbers that change without a log line. Report every discrepancy with the numbers.',
    },
};
const ROTATION = ['newbie', 'trader', 'breaker', 'auditor'];

// Which pathway groups each persona is best placed to reach.
const AFFINITY = {
    newbie: ['People', 'Turn', 'Property', 'Jail', 'Host'],
    trader: ['Corporation desk', 'Corporations', 'Debt', 'Market', 'Houses'],
    breaker: ['Refusals', 'Market', 'Property', 'Jail'],
    auditor: ['Rent', 'Corporation desk', 'Houses', 'Bankruptcy', 'Turn'],
};

// Splits unreached pathways between agent seats by persona, never-reached first,
// so each agent has its own missions and no two chase the same thing.
function assignMissions(pathways, seats, personas, perSeat = 8) {
    const open = pathways.filter(p => !p.hits && !p.id.startsWith('card.') && !p.id.startsWith('ui.'))
        .sort((a, b) => Number(a.everReached) - Number(b.everReached));
    const taken = new Set();
    const missions = {};
    for (const seat of seats) {
        const groups = AFFINITY[personas[seat.index]] || [];
        const mine = open.filter(p => groups.includes(p.group) && !taken.has(p.id)).slice(0, perSeat);
        mine.forEach(p => taken.add(p.id));
        missions[seat.index] = mine;
    }
    // Anything left goes round-robin.
    let i = 0;
    for (const p of open.filter(x => !taken.has(x.id))) {
        const seat = seats[i++ % seats.length];
        if (missions[seat.index].length < perSeat + 3) { missions[seat.index].push(p); taken.add(p.id); }
    }
    return missions;
}

function claudeCount() {
    try { return Number(execSync('pgrep -c -x claude').toString().trim()) || 0; } catch { return 0; }
}

// Refuses before anything is built if the machine-wide agent cap would be passed.
function checkCap(needed) {
    const running = claudeCount();
    if (running + needed > AGENT_CAP) {
        throw new Error(`Agent cap: ${running} claude processes already running here, ${needed} more would pass the cap of ${AGENT_CAP}. Use --shared (one process for all agent seats), fewer --agents seats, wait for other sessions to finish, or run on the M60e.`);
    }
    return running;
}

function personaFor(seatIndex, list) {
    const names = list && list.length ? list : ROTATION;
    const name = names[(seatIndex - 1) % names.length];
    if (!PERSONAS[name]) throw new Error(`Unknown persona ${name}. Known: ${Object.keys(PERSONAS).join(', ')}`);
    return name;
}

function brief({ seats, personas, rounds, missions = {} }) {
    const who = seats.map(s => `seat ${s.index} (${s.name}, ${s.device} screen ${s.viewport.width}x${s.viewport.height}) as the ${PERSONAS[personas[s.index]].title}`).join('; ');
    const seatList = seats.map(s => s.index).join(',');
    const personaText = seats.map(s => {
        const p = PERSONAS[personas[s.index]];
        return `### ${s.name} (seat ${s.index}): ${p.title}\nHow to play: ${p.play}\nWhat to watch for: ${p.watch}`;
    }).join('\n\n');
    const missionText = seats.map(s => {
        const list = missions[s.index] || [];
        if (!list.length) return '';
        return `### ${s.name}'s missions\n${list.map(p => `- **${p.label}** (${p.id})${p.hint ? `: ${p.hint}` : ''}${p.everReached ? '' : ' (no game has reached this yet)'}`).join('\n')}`;
    }).filter(Boolean).join('\n\n');
    return `You are playtesting Mortgage Backed Monopoly, a web board game (Monopoly plus debt, IPOs and trading), as a real player using a browser. You play ${who}. Other seats are played by a bot. The game lasts about ${rounds} rounds, and then the host's bot ends it.

You are the player, not a developer: you see only the screen. You implement this brief yourself. Do not start other agents.

## Your only tool: the game command

Run every command exactly like this, with the full path, as the whole Bash command (no variables, no pipes, no other commands; anything else is refused):

    ${CMD} wait ${seatList} --timeout 100
    ${CMD} look <seat>
    ${CMD} click <seat> e6            (or by label: click <seat> "Roll Dice")
    ${CMD} fill <seat> e9 120          (type into a field; then click its button)
    ${CMD} select <seat> e12 "Option text"
    ${CMD} check <seat> e14            (tick a checkbox)
    ${CMD} tab <seat> market           (game | market | log | board)
    ${CMD} shot <seat> short-name      (screenshot; open the printed .png path with Read to see the layout)
    ${CMD} coverage --missing          (what nobody has reached yet in this game)
    ${CMD} note --seat <seat> --category ux|bug --severity low|medium|high --title "..." --detail "..."

\`wait\` returns when one of your seats must act (your-turn, auction, trade-offer) or the game is over (game-over), and shows that seat's screen. If it says nothing to do yet, call it again. \`click\`/\`select\` print the new screen. Controls are numbered e1, e2, ...; numbers change after each screen, so use the latest list or the label. "MODAL OPEN" means only that dialog's controls are usable until you close it. DIALOG lines are pop-ups the game showed you (already dismissed): read them, because they are often error messages.

## The loop

1. \`wait ${seatList} --timeout 100\`.
2. Act for the seat it names until that seat has nothing left to do: on your turn roll, deal with where you landed, do any optional actions your persona wants, then End Turn. In an auction, bid or pass. With a trade offer, open the Market tab and accept or decline.
3. Go back to 1. When wait says game-over, finish (below).

Rules: never click "End Game", "Pause Game" or "Play on another device". "Cancel Auction" only when you are host and an auction is stuck with nobody able to bid or pass. Pop-ups that ask "are you sure?" are refused unless you add --confirm to the click (\`click <seat> e7 --confirm\`), so use it only when you mean it.

Log lines that start with "Test setup:" or "Test harness:" come from the testing tool, not from players. They put the game into rare situations on purpose (for example, giving someone a colour group with houses). Treat the situation as real from that point, but don't report the setup itself as a bug. Keep each turn under about 8 commands unless you are investigating a problem. If you are stuck (nothing works, or the screen does not change), take a shot, write a note, and move on: End Turn or pass if you can.

## Personas

${personaText}

## Missions: reach every part of the game

The point of this playtest is to reach every part of the game, not to win. These are parts no player has reached yet in this game. Work your way through your list as the game allows. Some need setting up first (owning property before an IPO, having debt before refinancing), so plan a few turns ahead. When one is impossible right now, move on and come back to it. Trying a mission and finding that the game refuses or confuses you is a result: write a note.

${missionText || '(no missions: play your persona.)'}

Every 4-5 of your turns, run \`${CMD} coverage --missing\` to see what is still unreached in this game, and pick up anything in your groups that nobody has reached. Each of your own turns should try at least one thing you have not done yet in this game.

## Notes as you go

Write a \`note\` the moment you hit a problem, while the screen still shows it (note screenshots it). Be concrete: what you did, what you expected, what happened. Severity: high = wrong money/state or you are blocked; medium = misleading or very confusing; low = polish. Look at a screenshot with Read at least three times during the game (after your first roll, during an auction or a modal, and the game-over screen), and judge the layout as a person on that screen size would.

## When the game is over

Take a \`shot\` of the game-over screen and Read it. Then reply with your review in markdown and stop:

- **Verdict**: one line. Would you play again, and was it clear?
- **Bugs**: wrong behaviour, with steps.
- **Confusing moments**: with the screen and wording.
- **UI recommendations**: specific changes, most valuable first (5-10).
- **Persona checks**: what your persona's "watch for" found, including what was fine.
`;
}

function agentDir(runId) {
    return path.join(runs.evidenceDir(runId), 'agents');
}

function launch({ run, seats, personas, rounds, model, effort, shared, missions }) {
    const dir = agentDir(run.runId);
    fs.mkdirSync(dir, { recursive: true });
    const groups = shared ? [seats] : seats.map(seat => [seat]);
    const launched = [];
    for (const group of groups) {
        const name = `seats-${group.map(s => s.index).join('-')}`;
        const text = brief({ seats: group, personas, rounds, missions });
        fs.writeFileSync(path.join(dir, `${name}.brief.md`), text);
        const args = [
            '-p', text,
            '--model', model,
            '--output-format', 'stream-json', '--verbose',
            '--allowedTools', `Bash(${CMD} *)`, 'Read',
            '--strict-mcp-config',
            '--no-session-persistence',
        ];
        if (effort) args.push('--effort', effort);
        const out = fs.openSync(path.join(dir, `${name}.jsonl`), 'a');
        const child = spawn('claude', args, {
            cwd: runs.REPO_ROOT,
            env: { ...process.env, VERIFY_RUN_ID: run.runId },
            detached: true,
            stdio: ['ignore', out, out],
        });
        child.unref();
        launched.push({ name, pid: child.pid, seats: group.map(s => s.index), personas: group.map(s => personas[s.index]), model, startedAt: new Date().toISOString() });
    }
    return launched;
}

// Reads each agent's stream: running or done, tool calls, cost, final review.
function status(run) {
    const dir = agentDir(run.runId);
    const latest = runs.readRun(run.runId) || run;
    return (latest.agents || []).map(agent => {
        const file = path.join(dir, `${agent.name}.jsonl`);
        let calls = 0;
        let result = null;
        let lastText = '';
        let denied = 0;
        try {
            for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
                if (!line.startsWith('{')) continue;
                let ev;
                try { ev = JSON.parse(line); } catch { continue; }
                if (ev.type === 'assistant') {
                    for (const c of ev.message?.content || []) {
                        if (c.type === 'tool_use') calls++;
                        if (c.type === 'text' && c.text.trim()) lastText = c.text;
                    }
                }
                if (ev.type === 'user') {
                    for (const c of ev.message?.content || []) {
                        if (c.type === 'tool_result' && /permission|not allowed|denied/i.test(JSON.stringify(c.content || '')) && c.is_error) denied++;
                    }
                }
                if (ev.type === 'result') result = ev;
            }
        } catch {}
        const alive = runs.isAlive(agent.pid);
        if (result && (result.result || lastText)) {
            fs.writeFileSync(path.join(dir, `${agent.name}.review.md`), `# Review from ${agent.name} (${agent.personas.join(', ')}, ${agent.model})\n\n${result.result || lastText}\n`);
        }
        return {
            ...agent,
            state: alive ? 'running' : (result ? (result.is_error ? 'failed' : 'done') : 'exited'),
            calls,
            denied,
            cost: result ? result.total_cost_usd : null,
            turns: result ? result.num_turns : null,
            minutes: result ? (result.duration_ms / 60000).toFixed(1) : null,
            usage: result ? result.usage : null,
            review: result ? path.join(path.relative(runs.REPO_ROOT, dir), `${agent.name}.review.md`) : null,
            error: result && result.is_error ? String(result.result || result.subtype) : null,
        };
    });
}

function stopAll(run) {
    for (const agent of run.agents || []) {
        if (runs.isAlive(agent.pid)) {
            try { process.kill(-agent.pid, 'SIGTERM'); } catch { try { process.kill(agent.pid, 'SIGTERM'); } catch {} }
        }
    }
}

module.exports = { assignMissions, PERSONAS, DEFAULT_MODEL, AGENT_CAP, checkCap, personaFor, launch, status, stopAll, claudeCount };
