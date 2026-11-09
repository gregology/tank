/**
 * One running match and the couch rules around it.
 *
 * Any player can pause, but only they can act on the pause screen, because
 * everyone else is usually still pressing fire, which is also confirm.  For
 * the same reason the result screen ignores input for its first moments.
 */

import { ACTIONS, CONFIG } from "./config.js";
import { Game } from "./game.js";
import { anyPressed, firstPresser } from "./input.js";

export class MatchSession {
    constructor(matchConfig, audio) {
        this._humans = matchConfig.humans;
        this._audio = audio;
        this._pausedBy = null;
        this._resultSeconds = 0;
        this.game = new Game(matchConfig);
        audio.hookIntoGame(this.game);
    }

    get paused() {
        return this._pausedBy !== null;
    }

    /** The player label of whoever paused, or null for an unjoined device. */
    get pausedByLabel() {
        return this._humans.find((human) => human.device === this._pausedBy)?.label ?? null;
    }

    get resultPromptsReady() {
        return this._resultSeconds >= CONFIG.GAME_OVER_INPUT_LOCK_SECONDS;
    }

    /**
     * Advance one frame.
     * @returns {boolean} false once the players have left the match
     */
    update(dt, input) {
        if (this.paused) return this._updatePaused(input);
        if (this.game.gameOver) {
            if (!this._updateResult(dt, input)) return false;
        } else {
            this._pausedBy = firstPresser(input, ACTIONS.pause);
            if (this.paused) return true;
        }
        this.game.update(dt);
        return true;
    }

    _updatePaused(input) {
        if (this._pausedBy.wasPressed(ACTIONS.back)) return false;
        const pauserResumes = this._pausedBy.wasPressed(ACTIONS.confirm);
        // Anyone can end a pause, in case the pauser's controller has just died.
        if (pauserResumes || anyPressed(input, ACTIONS.pause)) this._pausedBy = null;
        return true;
    }

    _updateResult(dt, input) {
        if (!this.resultPromptsReady) {
            this._resultSeconds += dt;
            return true;
        }
        if (anyPressed(input, ACTIONS.back)) return false;
        if (anyPressed(input, ACTIONS.confirm)) {
            this._audio.init();
            this.game.restart();
            this._resultSeconds = 0;
        }
        return true;
    }
}
