/**
 * Seeded noise primitives for procedural map generation.
 *
 * Everything is derived from `grid.seed`, so a seed fully determines the
 * terrain.  Shared by every generation stage / feature module (terrain,
 * settlements, rivers, fields, …) — feature code never calls Math.random
 * or grows its own hash.
 */

/** Integer hash -> [0, 1). Deterministic for a given seed + position. */
export function hash(grid, x, y) {
    let h = (x * 374761393 + y * 668265263 + grid.seed) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    h = (h ^ (h >>> 16)) | 0;
    return (h & 0x7fffffff) / 0x7fffffff;
}

/** Smooth value noise via bilinear interpolation + smoothstep. */
export function noise(grid, x, y, off) {
    const ix = Math.floor(x),
        iy = Math.floor(y);
    const fx = x - ix,
        fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = hash(grid, ix + off, iy);
    const v10 = hash(grid, ix + 1 + off, iy);
    const v01 = hash(grid, ix + off, iy + 1);
    const v11 = hash(grid, ix + 1 + off, iy + 1);
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
}

/** Fractal Brownian Motion -- layered noise for natural textures. */
export function fbm(grid, x, y, octaves, off) {
    let value = 0,
        amp = 1,
        freq = 1,
        total = 0;
    for (let i = 0; i < octaves; i++) {
        value += noise(grid, x * freq, y * freq, off + i * 997) * amp;
        total += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return value / total;
}
