/**
 * Movement system — the per-frame human + bot movement pass.
 *
 * This used to be two inline loops in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  Humans are
 * driven by their InputDevice, bots by their AIController (which implements
 * the same interface).
 */

/** Drive every alive tank's movement (humans via devices, bots via AI). */
export function runMovement(game, bots, humanDevices, dt) {
    for (let i = 0; i < game.humanTanks.length; i++) {
        if (game.humanTanks[i].alive) {
            game.humanTanks[i].update(dt, humanDevices[i], game.map);
        }
    }
    for (const { ai, tank } of bots) {
        if (tank.alive) tank.update(dt, ai, game.map);
    }
}
