/**
 * Procedural island generation over a `TileGrid`.
 *
 * Each game gets a unique island.  The coastline, hill placement, and
 * rock cover are all derived from layered value-noise so the result
 * feels organic.  Village clusters are connected by dirt roads, with
 * buildings scattered along them.  Hills, rocks, and buildings are solid
 * obstacles (destructible cover) — see TILE_PROPS for the semantics.
 *
 * The terrain *palette* and noise tuning are data-driven from `MAP_STYLES`
 * (js/config/biomes.js), selected by `grid.style`; a new biome is a table
 * entry, not an edit here.  The noise *algorithm* (octaves, interpolation)
 * stays local.
 */

import { MAP_STYLES } from "../config.js";
import { distance } from "../utils.js";

/** The map style for a grid (defaults to the island biome). */
function styleFor(grid) {
    return MAP_STYLES[grid.style] ?? MAP_STYLES.island;
}

/** Lay down water / sand / grass, then scatter villages across the island. */
export function generate(grid) {
    const w = grid.width,
        h = grid.height;
    const cx = w / 2,
        cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 1;

    paintTerrain(grid, cx, cy, maxR, styleFor(grid));
    placeVillages(grid, cx, cy, maxR);
}

/** Pass 1: water / sand / grass across the whole grid. */
function paintTerrain(grid, cx, cy, maxR, style) {
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

/**
 * Place village clusters (min 14 tiles apart), connect with dirt
 * roads, then scatter roadside buildings along the connecting roads.
 */
function placeVillages(grid, cx, cy, maxR) {
    // Scale village density with map size and density multiplier
    const mapScale = Math.min(grid.width, grid.height) / 64;
    const density = grid.villageDensity;
    const MIN_VILLAGE_DIST = Math.max(6, Math.round((14 * mapScale) / density));
    const villageCentres = [];
    const attempts = Math.round((20 + Math.floor(hash(grid, 77, 88) * 10)) * mapScale * mapScale * density);

    // Step 1: pick village positions, enforcing minimum separation
    for (let i = 0; i < attempts; i++) {
        const angle = hash(grid, i * 11, 100) * Math.PI * 2;
        const dist = 5 + hash(grid, i * 17, 200) * (maxR - 12);
        const vx = Math.round(cx + Math.cos(angle) * dist);
        const vy = Math.round(cy + Math.sin(angle) * dist);

        if (!grid.isPassable(vx + 0.5, vy + 0.5)) continue;
        if (distance(vx, vy, cx, cy) > maxR - 6) continue;

        // Enforce minimum distance from every existing village
        let tooClose = false;
        for (const vc of villageCentres) {
            if (distance(vx, vy, vc.x, vc.y) < MIN_VILLAGE_DIST) {
                tooClose = true;
                break;
            }
        }
        if (tooClose) continue;

        stampVillage(grid, vx, vy, i);
        villageCentres.push({ x: vx, y: vy });
    }

    // Step 2: connect villages with dirt roads (nearest-neighbour chain)
    if (villageCentres.length < 2) return;
    const connected = [0];
    const remaining = new Set(villageCentres.keys());
    remaining.delete(0);

    const roadSegments = [];
    while (remaining.size > 0) {
        let bestI = -1,
            bestJ = -1,
            bestD = Infinity;
        for (const ci of connected) {
            for (const ri of remaining) {
                const d = distance(
                    villageCentres[ci].x,
                    villageCentres[ci].y,
                    villageCentres[ri].x,
                    villageCentres[ri].y,
                );
                if (d < bestD) {
                    bestD = d;
                    bestI = ci;
                    bestJ = ri;
                }
            }
        }
        if (bestJ < 0) break;
        const a = villageCentres[bestI],
            b = villageCentres[bestJ];
        layDirtRoad(grid, a, b);
        roadSegments.push({ a, b });
        connected.push(bestJ);
        remaining.delete(bestJ);
    }

    // Step 3: scatter a few buildings along the dirt roads between villages
    for (let seg = 0; seg < roadSegments.length; seg++) {
        scatterRoadsideBuildings(grid, roadSegments[seg].a, roadSegments[seg].b, seg);
    }
}

/**
 * Lay a 1-tile-wide dirt road between two points using only
 * cardinal steps (up/down/left/right).  Every tile shares a
 * full edge with the next -- no diagonal-only connections.
 * (Shared with base-compound layout, which connects each entrance
 * to the road network.)
 */
export function layDirtRoad(grid, a, b) {
    let x = Math.floor(a.x),
        y = Math.floor(a.y);
    const gx = Math.floor(b.x),
        gy = Math.floor(b.y);
    const s = styleFor(grid);

    while (x !== gx || y !== gy) {
        const tile = grid.getTile(x, y);
        if (tile === s.grass || tile === s.darkGrass) {
            grid.setTile(x, y, s.dirt);
        }
        // Step one tile: pick the axis with the larger remaining gap.
        // When equal, use a hash for a natural wobble instead of
        // always favouring the same axis.
        const dx = gx - x,
            dy = gy - y;
        if (Math.abs(dx) > Math.abs(dy)) {
            x += dx > 0 ? 1 : -1;
        } else if (Math.abs(dy) > Math.abs(dx)) {
            y += dy > 0 ? 1 : -1;
        } else {
            // Equal -- random pick for variety
            if (hash(grid, x * 31 + y * 47, 1050) > 0.5) x += dx > 0 ? 1 : -1;
            else y += dy > 0 ? 1 : -1;
        }
    }
    // Final tile
    const tile = grid.getTile(x, y);
    if (tile === s.grass || tile === s.darkGrass) {
        grid.setTile(x, y, s.dirt);
    }
}

/**
 * Scatter a few isolated buildings alongside a dirt road between
 * two villages.  Gives the roads a lived-in feel without creating
 * a full village.
 */
function scatterRoadsideBuildings(grid, a, b, seed) {
    const dx = b.x - a.x,
        dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return; // too short, skip

    const ux = dx / len,
        uy = dy / len; // road direction
    const px = -uy,
        py = ux; // perpendicular
    const s = styleFor(grid);

    const count = 2 + Math.floor(hash(grid, seed * 67, 1100) * 4);
    for (let i = 0; i < count; i++) {
        // Position along the road (skip first/last 20% to stay away from villages)
        const t = 0.2 + hash(grid, seed * 13 + i * 47, 1200) * 0.6;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;

        // Offset 1-2 tiles to one side
        const side = hash(grid, seed * 19 + i * 31, 1300) > 0.5 ? 1 : -1;
        const off = 1 + Math.floor(hash(grid, seed * 23 + i * 37, 1400) * 1.5);
        const bx = Math.round(cx + px * side * off);
        const by = Math.round(cy + py * side * off);

        if (grid.isRoad(bx, by)) continue;
        if (!grid.isPassable(bx + 0.5, by + 0.5)) continue;

        // Roadside buildings are mostly small
        const sizeRoll = hash(grid, seed * 29 + i * 41, 1500);
        const bldgType = sizeRoll < 0.6 ? s.buildings.small : s.buildings.medium;
        grid.setTile(bx, by, bldgType);
    }
}

/**
 * Stamp a single village at (vx, vy).
 *
 * 1. Lay 1-2 paved roads through the village
 * 2. Place buildings along both sides -- NEVER on a road tile
 */
function stampVillage(grid, vx, vy, seed) {
    const roadCount = hash(grid, seed * 31, 400) > 0.4 ? 2 : 1;
    const style = styleFor(grid);

    const roads = [];
    for (let r = 0; r < roadCount; r++) {
        const dirRoll = hash(grid, seed * 11 + r * 71, 410);
        let dx, dy;
        if (r === 0) {
            dx = dirRoll < 0.5 ? 1 : 0;
            dy = dx === 0 ? 1 : 0;
        } else {
            dx = roads[0].dy !== 0 ? 1 : 0;
            dy = dx === 0 ? 1 : 0;
        }
        const halfLen = 3 + Math.floor(hash(grid, seed * 17 + r * 43, 420) * 4);
        roads.push({ dx, dy, halfLen });
    }

    // Step 1: lay paved roads
    for (const road of roads) {
        for (let i = -road.halfLen; i <= road.halfLen; i++) {
            const rx = vx + road.dx * i;
            const ry = vy + road.dy * i;
            if (grid.isPassable(rx + 0.5, ry + 0.5)) {
                grid.setTile(rx, ry, style.paved);
            }
        }
    }

    // Step 2: place buildings along roads (never ON a road)
    for (const road of roads) {
        const px = road.dy !== 0 ? 1 : 0; // perpendicular
        const py = road.dx !== 0 ? 1 : 0;

        for (let i = -road.halfLen; i <= road.halfLen; i++) {
            const rx = vx + road.dx * i;
            const ry = vy + road.dy * i;

            for (const side of [-1, 1]) {
                const skip = hash(grid, seed * 7 + i * 13 + side * 37, 500 + side);
                if (skip < 0.45) continue;

                const offset = 1 + Math.floor(hash(grid, seed * 3 + i * 19 + side * 41, 550) * 1.5);
                const bx = rx + px * side * offset;
                const by = ry + py * side * offset;

                // NEVER place on a road tile
                if (grid.isRoad(bx, by)) continue;
                if (!grid.isPassable(bx + 0.5, by + 0.5)) continue;

                const sizeRoll = hash(grid, seed * 23 + i * 37 + side * 53, 600);
                let bldgType;
                if (sizeRoll < 0.45) bldgType = style.buildings.small;
                else if (sizeRoll < 0.8) bldgType = style.buildings.medium;
                else bldgType = style.buildings.large;

                grid.setTile(bx, by, bldgType);

                // Large buildings extend along the road
                if (bldgType === style.buildings.large) {
                    const ex = bx + road.dx,
                        ey = by + road.dy;
                    if (!grid.isRoad(ex, ey) && grid.isPassable(ex + 0.5, ey + 0.5))
                        grid.setTile(ex, ey, style.buildings.large);
                }
            }
        }
    }
}

/* ── noise primitives ─────────────────────────────────────── */

/** Integer hash -> [0, 1). Deterministic for a given seed + position. */
function hash(grid, x, y) {
    let h = (x * 374761393 + y * 668265263 + grid.seed) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    h = (h ^ (h >>> 16)) | 0;
    return (h & 0x7fffffff) / 0x7fffffff;
}

/** Smooth value noise via bilinear interpolation + smoothstep. */
function noise(grid, x, y, off) {
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
function fbm(grid, x, y, octaves, off) {
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
