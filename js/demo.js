/**
 * Unattended matches for testing on real hardware: `--demo=<scenario>` starts
 * one directly, with robot players pressing buttons in place of people.
 */

import { ACTIONS as A } from "./config.js";
import { InputDevice } from "./input.js";
import { Lobby } from "./lobby.js";

export const DEMO_SCENARIOS = Object.freeze({
    "battle-4p": { gameType: "battle", players: 4, mapSizeIndex: 1 },
    "battle-4p-large": { gameType: "battle", players: 4, mapSizeIndex: 2 },
    "battle-2p": { gameType: "battle", players: 2, mapSizeIndex: 1 },
    "skirmish-4p": { gameType: "skirmish", players: 4, mapSizeIndex: 1 },
});

const DEMO_SCRIPT = [
    { seconds: 3, actions: [A.forward, A.fire] },
    { seconds: 1, actions: [A.left, A.turretRight] },
    { seconds: 2, actions: [A.forward, A.right, A.fire] },
    { seconds: 1, actions: [A.backward, A.turretLeft] },
];
const DEMO_SCRIPT_SECONDS = DEMO_SCRIPT.reduce((sum, step) => sum + step.seconds, 0);

/** A robot player: the same looped script, started at a different point per player. */
export class DemoDevice extends InputDevice {
    constructor(startSeconds, now = () => performance.now() / 1000) {
        super();
        this._startSeconds = startSeconds;
        this._now = now;
    }

    isDown(action) {
        return this._currentStep().actions.includes(action);
    }

    /** A robot has no fresh presses, the same as AIController. */
    wasPressed() {
        return false;
    }

    analog(action) {
        return this.isDown(action) ? 1 : 0;
    }

    _currentStep() {
        let remaining = (this._startSeconds + this._now()) % DEMO_SCRIPT_SECONDS;
        for (const step of DEMO_SCRIPT) {
            if (remaining < step.seconds) return step;
            remaining -= step.seconds;
        }
        return DEMO_SCRIPT[0];
    }
}

/**
 * The MatchConfig for a scenario, built through the Lobby like a real match.
 * @throws if the scenario is unknown: a mistyped test option must not quietly
 *         fall through to the menu and report menu frame rates.
 */
export function demoMatch(scenarioName) {
    const scenario = DEMO_SCENARIOS[scenarioName];
    if (!scenario) throw new Error(`Unknown demo scenario "${scenarioName}"`);
    const lobby = new Lobby();
    lobby.setGameType(scenario.gameType);
    lobby.mapSizeIndex = scenario.mapSizeIndex;
    for (let i = 0; i < scenario.players; i++) lobby.join(new DemoDevice(i * 2));
    return lobby.buildMatch();
}
