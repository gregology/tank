/**
 * The swarm package — colony-insect AI state, one Swarm per faction.
 *
 * A Swarm bundles the two halves of the colony's shared world:
 *   fields  — the pheromone grids (trail / alarm / food / visited)
 *   intel   — which enemy structures the faction has discovered
 *
 * plus the context behaviours need that isn't pheromone-shaped:
 *   tuning  — the live tuning object (shared with the Game, so sandbox
 *             sliders and sweep overrides apply immediately)
 *   humans  — the faction's human-driven vehicles (natural convoy
 *             leaders; the system reads them, never steers them)
 */

import { SWARM } from "../../config.js";
import { SignalFields } from "./fields.js";
import { FactionIntel } from "./intel.js";

export class Swarm {
    constructor(width, height, tuning = null) {
        this.fields = new SignalFields(width, height);
        this.intel = new FactionIntel();
        /** Live tuning — shared by reference with the owning Game. */
        this.tuning = tuning ?? { ...SWARM };
        /** @type {Set<object>} human-driven tanks of this faction */
        this.humans = new Set();
        /** Where the colony starts (its base / spawn centroid) — the
         *  reference point exploration expands away from. */
        this.home = null;
        /** Last seen position per unit (for distance-travelled tracking). */
        this._lastPos = new Map();
        this._tickTimer = 0;
    }

    isHumanDriven(tank) {
        return this.humans.has(tank);
    }
}

export { chooseSwarmGoal, spacingOffset } from "./behaviours.js";
export { SIGNALS, SignalFields } from "./fields.js";
export { FactionIntel } from "./intel.js";
