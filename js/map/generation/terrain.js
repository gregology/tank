/**
 * Terrain stage — the island's water / sand / grass base layer.
 *
 * The coastline comes from radial distance + coast noise; grass texture
 * from fbm.  Everything is data-driven from MAP_STYLES (the biome table)
 * — a new biome is a table entry, not an edit here.
 */

import { MAP_STYLES } from "../../config.js";
import { distance } from "../../utils.js";
import { fbm } from "../noise.js";

/** The map style for a grid (defaults to the island biome). */
export function styleFor(grid) {
    return MAP_STYLES[grid.style] ?? MAP_STYLES.island;
}

/** Pass 1: water / sand / grass across the whole grid. */
export function paintTerrain(grid) {
    const cx = grid.width / 2,
        cy = grid.height / 2,
        maxR = Math.min(grid.width, grid.height) / 2 - 1,
        style = styleFor(grid);
    for (let gy = 0; gy < grid.height; gy++) {
        for (let gx = 0; gx < grid.width; gx++) {
            grid.setTile(gx, gy, baseTile(grid, gx, gy, cx, cy, maxR, style));
        }
    }
}

/** Water / sand / grass only -- no structures. */
function baseTile(grid, gx, gy, cx, cy, maxR, s) {
    const d = distance(gx, gy, cx, cy);
    const coastNoise = fbm(grid, gx * s.coast.scale, gy * s.coast.scale, s.coast.octaves, 0) - 0.5;
    const islandEdge = maxR + coastNoise * s.coast.amplitude;

    if (d > islandEdge) return s.deepWater;
    if (d > islandEdge - s.coast.shallowBand) return s.shallowWater;
    if (d > islandEdge - s.coast.sandBand) return s.sand;

    const grassN = fbm(
        grid,
        gx * s.grassNoise.scale,
        gy * s.grassNoise.scale,
        s.grassNoise.octaves,
        s.grassNoise.offset,
    );
    return grassN > s.grassNoise.threshold ? s.darkGrass : s.grass;
}
