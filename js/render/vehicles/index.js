/**
 * Vehicle sprite registry — the render-layer mirror of js/vehicles/index.js.
 *
 * One sprite module per vehicle type, dispatched by `drawVehicle` from the
 * `vehicleType` via a table (no `if (vehicleType === …)` chain).  Adding a
 * vehicle sprite is one module + one `SPRITES` entry.  `drawVehicle` is the
 * stable public entry point used by the viewport and the menu preview.
 */

import { drawDrone } from "./drone.js";
import { drawIFV } from "./ifv.js";
import { drawSPG } from "./spg.js";
import { drawSoldier, drawSquad, soldierWeapon } from "./squad.js";
import { drawTank } from "./tank.js";

export { drawDrone, drawIFV, drawSoldier, drawSPG, drawSquad, drawTank, soldierWeapon };

/** Sprite lookup keyed by vehicle type (falls back to the tank). */
export const SPRITES = {
    tank: drawTank,
    ifv: drawIFV,
    drone: drawDrone,
    spg: drawSPG,
    squad: drawSquad,
};

/** Draw a tank-like object (a real `Tank` or a menu `fakeTank`). */
export function drawVehicle(ctx, tank, sx, sy) {
    const sprite = SPRITES[tank.vehicleType] ?? drawTank;
    sprite(ctx, tank, sx, sy);
}
