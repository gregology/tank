/**
 * Firing system — the per-frame human + bot firing pass.
 *
 * This used to be two inline loops in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  Each vehicle's
 * behaviour `fire` hook owns its firing/attack rules.
 */

import { getVehicleBehaviour } from "../vehicles/index.js";

/** Dispatch firing for every alive tank (humans via devices, bots via AI). */
export function runFiring(game, bots, humanDevices, dt) {
    for (let i = 0; i < game.humanTanks.length; i++) {
        if (game.humanTanks[i].alive) {
            getVehicleBehaviour(game.humanTanks[i].vehicleType).fire(game, game.humanTanks[i], humanDevices[i], dt);
        }
    }
    for (const { ai, tank } of bots) {
        if (tank.alive) getVehicleBehaviour(tank.vehicleType).fire(game, tank, ai, dt);
    }
}
