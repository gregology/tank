/**
 * Map generation pipeline — the ordered stage registry.
 *
 * `generate(grid)` runs each stage in order.  Stage order is a design
 * decision made explicit here: water before the bridges that cross it,
 * roads after the destinations they connect (bases/bridges/farms), and
 * villages LAST — settlements grow around the road network.  A new
 * feature is one stage module + one registry entry.
 */

import { placeBases } from "./bases.js";
import { layBridges } from "./bridges.js";
import { placeFarms } from "./farms.js";
import { layRoadNetwork } from "./roads.js";
import { placeVillages } from "./settlements.js";
import { paintTerrain } from "./terrain.js";
import { carveWater } from "./water.js";

/** The ordered generation stages.  `placeBases` is conditional on the
 *  map plan (`grid.plan.bases`) — skirmish plans skip it. */
export const GENERATION_STAGES = [
    paintTerrain,
    placeBases,
    carveWater,
    layBridges,
    placeFarms,
    layRoadNetwork,
    placeVillages,
];

/** Regenerate the island terrain: run every stage in order over a
 *  shared ctx (base layouts, and later bridge ends, flow through it). */
export function generate(grid) {
    const ctx = {};
    for (const stage of GENERATION_STAGES) stage(grid, ctx);
}

export { layRoad, layRoadNetwork, spanningTree } from "./roads.js";
export { styleFor } from "./terrain.js";
