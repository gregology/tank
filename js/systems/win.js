/**
 * Win-condition system — ask the mode strategy for a winner and end the match.
 *
 * This used to live as `Game._checkWin`; the mode strategy owns the *rule*
 * (score threshold vs base destruction), and this system owns the mechanics
 * of marking the game over and emitting the event.
 */

import { GAME_EVENTS } from "../events.js";

/** Resolve the match winner via the mode strategy; emit `win` on game over. */
export function checkWin(game) {
    const winner = game.mode.checkWin(game);
    if (winner != null) {
        game.gameOver = true;
        game.winner = winner;
        game.emit(GAME_EVENTS.WIN, { winner });
    }
}
