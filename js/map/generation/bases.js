/**
 * Bases stage — base-compound placement and stamping.
 *
 * Runs inside the generation pipeline when the map plan calls for bases
 * (battle); skipped on base-less plans (skirmish).  Everything about
 * placement and compound shapes lives in js/map/compounds.js — this
 * stage is the pipeline's adapter: it stamps the compounds and records
 * the layouts on the shared ctx for the mode's entity construction.
 */

import { buildBaseCompounds } from "../compounds.js";

/** Stamp base compounds when the plan wants them; record layouts. */
export function placeBases(grid, ctx) {
    if (!grid.plan.bases) return;
    ctx.baseLayouts = buildBaseCompounds(grid, grid.plan.bases);
    grid.baseLayouts = ctx.baseLayouts;
}
