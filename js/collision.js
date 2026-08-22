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

/**
 * Whether two alive vehicles should be pushed apart by the separation pass.
 *
 * The policy is expressed in terms of the entity's interaction capabilities
 * (`flies`, `softTarget`, `team`) rather than the raw `unitClass` string, so
 * a new air or soft unit inherits the rule automatically.
 *
 * @param {{flies: boolean, softTarget: boolean, team: number}} a
 * @param {{flies: boolean, softTarget: boolean, team: number}} b
 * @returns {boolean}
 */
export function vehiclesSeparate(a, b) {
    // Air units fly over ground units (and vice versa).
    if (a.flies !== b.flies) return false;

    // Soft targets are driven through by enemy vehicles (run-over), but
    // friendly vehicles still treat them as solid.
    if (a.softTarget !== b.softTarget && a.team !== b.team) return false;

    return true;
}
