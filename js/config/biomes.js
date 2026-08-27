/**
 * Map styles (biomes) — the per-style palette and noise parameters the
 * procedural generator (`js/map/generation.js`) reads.
 *
 * A new biome (desert, snow, city) is one entry here; the generator picks
 * it up from `grid.style` without touching its algorithm.  The noise
 * *algorithm* (octaves, bilinear interpolation) stays in generation.js —
 * only the per-style values (tile ids, bands, thresholds) live here.
 */

import { TILES } from "./tiles.js";

export const MAP_STYLES = Object.freeze({
    island: {
        deepWater: TILES.DEEP_WATER,
        shallowWater: TILES.SHALLOW_WATER,
        sand: TILES.SAND,
        grass: TILES.GRASS,
        darkGrass: TILES.DARK_GRASS,
        dirt: TILES.DIRT,
        destroyedTile: TILES.GRASS, // what a destructible tile becomes when destroyed
        buildings: {
            small: TILES.BLDG_SMALL,
            medium: TILES.BLDG_MEDIUM,
            large: TILES.BLDG_LARGE,
        },
        coast: { scale: 0.06, octaves: 3, amplitude: 8, shallowBand: 1.8, sandBand: 3.5 },
        grassNoise: { scale: 0.12, octaves: 2, offset: 300, threshold: 0.52 },
    },
});
