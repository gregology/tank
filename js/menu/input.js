/**
 * Shared input helpers for the menu screens: discovering who is joining
 * (keyboard + connected gamepads).
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
