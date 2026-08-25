/**
 * GameMap — the public map facade.
 *
 * `GameMap` composes the `js/map/` package behind the one class the rest
 * of the game imports:
 *
 *   grid.js        tile data + tile-property queries (TileGrid)
 *   queries.js     spatial geometry (canStand / LOS / walkable / cover)
 *   generation.js  procedural island generation (noise, villages, roads)
 *   compounds.js   base-compound layout + spawn helpers
 *
 * Callers keep using `new GameMap(...)` and the method API unchanged
 * (`map.canStand`, `map.hasLineOfSight`, `map.buildBaseCompounds`, …);
 * only the internals moved behind this facade.
 */

import {
    getBaseSpawnPoint as baseSpawnPoint,
    buildBaseCompounds,
    getSpawnPoint as spawnPoint,
} from "./map/compounds.js";
import { generate } from "./map/generation.js";
import { TileGrid } from "./map/grid.js";
import {
    canStand as canStandQuery,
    countCoverTiles as countCoverTilesQuery,
    hasIntactBuildingNear as hasIntactBuildingNearQuery,
    hasLineOfSight as hasLineOfSightQuery,
    hasWalkableLine as hasWalkableLineQuery,
    nearestBuilding as nearestBuildingQuery,
    nearestPassable as nearestPassableQuery,
} from "./map/queries.js";

export class GameMap extends TileGrid {
    /**
     * @param {number} [width]           map width (defaults to CONFIG.MAP_WIDTH)
     * @param {number} [height]          map height (defaults to CONFIG.MAP_HEIGHT)
     * @param {number} [villageDensity]  multiplier for village generation (default 1.0)
     * @param {string} [style]           biome key in `MAP_STYLES` (default "island")
     * @param {number} [seed]            terrain seed (defaults to a random draw)
     */
    constructor(width, height, villageDensity, style, seed) {
        super(width, height, villageDensity, style, seed);
        this.generate();
    }

    /** Regenerate the island terrain (water/sand/grass + villages). */
    generate() {
        generate(this);
    }

    /** Build two base compounds; returns the layout pair (see compounds.js). */
    buildBaseCompounds(baseType) {
        return buildBaseCompounds(this, baseType);
    }

    /** Random passable spawn point inside a compound's interior. */
    getBaseSpawnPoint(cx, cy, half, rng) {
        return baseSpawnPoint(this, cx, cy, half, rng);
    }

    /** Random passable spawn point, far from (ax, ay). */
    getSpawnPoint(ax, ay, minDist = 10, rng) {
        return spawnPoint(this, ax, ay, minDist, rng);
    }

    /* ── shared geometry API (see queries.js) ─────────────── */

    canStand(wx, wy, size) {
        return canStandQuery(this, wx, wy, size);
    }

    hasLineOfSight(x1, y1, x2, y2, opts) {
        return hasLineOfSightQuery(this, x1, y1, x2, y2, opts);
    }

    hasWalkableLine(x1, y1, x2, y2) {
        return hasWalkableLineQuery(this, x1, y1, x2, y2);
    }

    countCoverTiles(wx, wy, radius) {
        return countCoverTilesQuery(this, wx, wy, radius);
    }

    hasIntactBuildingNear(wx, wy, radius) {
        return hasIntactBuildingNearQuery(this, wx, wy, radius);
    }

    nearestBuilding(wx, wy, maxDist) {
        return nearestBuildingQuery(this, wx, wy, maxDist);
    }

    nearestPassable(wx, wy) {
        return nearestPassableQuery(this, wx, wy);
    }
}
