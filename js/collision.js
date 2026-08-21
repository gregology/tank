/**
 * Vehicle interaction policy for the collision-separation pass.
 *
 * Solid vehicles are pushed apart so they don't overlap, but two
 * exceptions allow units to pass through each other:
 *   - air units fly over ground units (and ground units under them)
 *   - enemy vehicles drive through infantry so they can run soldiers
 *     over; friendly vehicles still treat infantry as solid
 *
 * The classes are data-driven (VEHICLES[type].unitClass: "vehicle" /
 * "infantry" / "air"), so a new air or infantry unit inherits the
 * interaction policy automatically.  Kept as a pure function so the
 * policy is unit-testable without constructing a full Game.
 */

import { VEHICLES } from "./config.js";

/**
 * Whether two alive vehicles should be pushed apart by the separation pass.
 *
 * @param {{vehicleType: string, team: number}} a
 * @param {{vehicleType: string, team: number}} b
 * @returns {boolean}
 */
export function vehiclesSeparate(a, b) {
    // Air units fly over ground units (and vice versa).
    if ((VEHICLES[a.vehicleType].unitClass === "air") !== (VEHICLES[b.vehicleType].unitClass === "air")) return false;

    // Infantry is soft against enemy vehicles (run-over), but friendly
    // vehicles still treat it as solid.
    const aInfantry = VEHICLES[a.vehicleType].unitClass === "infantry";
    const bInfantry = VEHICLES[b.vehicleType].unitClass === "infantry";
    if (aInfantry !== bInfantry && a.team !== b.team) return false;

    return true;
}
