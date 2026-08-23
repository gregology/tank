/**
 * Vehicle-update system — the per-frame component update pass.
 *
 * This used to be an inline loop in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  Each vehicle's
 * behaviour `update` hook ticks its per-instance components (squad member
 * steering).
 */

import { getVehicleBehaviour } from "../vehicles/index.js";

/** Tick each alive vehicle's per-frame component update. */
export function updateVehicles(game, dt) {
    for (const t of game.allTanks) {
        if (t.alive) getVehicleBehaviour(t.vehicleType).update(game, t, dt);
    }
}
