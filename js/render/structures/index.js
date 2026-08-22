/**
 * Base-structure sprite dispatch — the registry keyed by `entityType`,
 * mirroring the vehicle sprite registry in `js/render/vehicles/`.
 *
 * Adding a structure type is a `BASE_STRUCTURES` entry + one sprite module
 * here + one `STRUCTURE_SPRITES` entry — no `switch` to edit.
 */

import { drawBaseHQ } from "./hq.js";
import { drawWatchTower } from "./tower.js";
import { drawBaseWall } from "./wall.js";

export { drawIsoBlock } from "./block.js";
export { drawBaseHQ } from "./hq.js";
export { drawWatchTower } from "./tower.js";
export { drawBaseWall } from "./wall.js";

export const STRUCTURE_SPRITES = {
    baseWall: drawBaseWall,
    baseTower: drawWatchTower,
    baseHQ: drawBaseHQ,
};

/** Dispatch to the appropriate draw function for a base structure. */
export function drawBaseStructure(ctx, entity, sx, sy, time) {
    (STRUCTURE_SPRITES[entity.entityType] ?? (() => {}))(ctx, entity, sx, sy, time);
}
