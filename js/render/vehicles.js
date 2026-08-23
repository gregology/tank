/**
 * Vehicle sprites — thin barrel over the `js/render/vehicles/` package.
 *
 * `drawVehicle` is the stable public entry point (used by the viewport and
 * the menu preview); each sprite lives in its own module under
 * `js/render/vehicles/`, dispatched by the `SPRITES` registry.
 */

export {
    drawDrone,
    drawIFV,
    drawSoldier,
    drawSPG,
    drawSquad,
    drawTank,
    drawVehicle,
    soldierWeapon,
} from "./vehicles/index.js";
