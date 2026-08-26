/**
 * Map generation pipeline — the ordered stage registry.
 *
 * `generate(grid)` runs each stage in order.  Stage order is a design
 * decision made explicit here (roads must come after the water they
 * bridge, fields before the tree lines that border them, …), and a new
 * feature (rivers, fields, tree lines, …) is one stage module + one
 * registry entry — never an implicit call sequence.
 *
 * Stages read/write the grid and receive a shared `ctx` (today: nothing;
 * base positions join it when base placement becomes a stage).
 */

import { placeVillages } from "./settlements.js";
import { paintTerrain } from "./terrain.js";

/** The ordered generation stages. */
export const GENERATION_STAGES = [paintTerrain, placeVillages];

/** Regenerate the island terrain: run every stage in order. */
export function generate(grid) {
    for (const stage of GENERATION_STAGES) stage(grid);
}

export { layDirtRoad } from "./roads.js";
export { styleFor } from "./terrain.js";
