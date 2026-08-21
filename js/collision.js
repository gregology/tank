/**
 * Vehicle interaction policy for the collision-separation pass.
 *
 * Solid vehicles are pushed apart so they don't overlap, but two
 * exceptions allow units to pass through each other:
 *   - drones fly over ground vehicles (and ground vehicles under them)
 *   - enemy vehicles drive through squads so they can run soldiers over;
 *     friendly vehicles still treat squads as solid
 *
 * Kept as a pure function so the policy is unit-testable without
 * constructing a full Game.
 */

/**
 * Whether two alive vehicles should be pushed apart by the separation pass.
 *
 * @param {{vehicleType: string, team: number}} a
 * @param {{vehicleType: string, team: number}} b
 * @returns {boolean}
 */
export function vehiclesSeparate(a, b) {
    // Drones fly over ground vehicles (and vice versa).
    if ((a.vehicleType === "drone") !== (b.vehicleType === "drone")) return false;

    // Squads are soft against enemy vehicles (run-over), but friendly
    // vehicles still treat them as solid.
    const aSquad = a.vehicleType === "squad";
    const bSquad = b.vehicleType === "squad";
    if (aSquad !== bSquad && a.team !== b.team) return false;

    return true;
}
