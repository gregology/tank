/**
 * Shared input helpers for the menu screens: discovering who pressed a
 * key/button on the game canvas (keyboard + connected gamepads).
 */

import { ACTIONS } from "../config.js";

/**
 * Devices pressing confirm that are not yet joined.  A device joins only
 * once, so the same device cannot double-join across frames.
 */
export function joinCandidates(input, lobby) {
    const out = [];
    if (!lobby.isJoined(input.keyboard) && input.keyboard.wasPressed(ACTIONS.confirm)) out.push(input.keyboard);
    for (const gp of input.connectedGamepads) {
        if (!lobby.isJoined(gp) && gp.wasPressed(ACTIONS.confirm)) out.push(gp);
    }
    return out;
}

/** The first unjoined device pressing confirm this frame, or null. */
export function firstJoiner(input, lobby) {
    return joinCandidates(input, lobby)[0] ?? null;
}

/** True when any device pressed `action` this frame. */
export function anyPressed(input, action) {
    if (input.keyboard?.wasPressed(action)) return true;
    for (const gp of input.connectedGamepads) {
        if (gp.wasPressed(action)) return true;
    }
    return false;
}
