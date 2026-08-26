/**
 * Spatial geometry queries over a `TileGrid`.
 *
 * These are the one implementation per geometric question (see the shared
 * geometry API in `js/AGENTS.md`).  Movement, separation, spawning, LOS,
 * the AI, watch towers, and squad members all answer the same questions
 * here.  They are plain functions over the grid (rather than methods) so
 * the geometry stays independent of the map's generation/compound code.
 */

import { VEHICLES } from "../config.js";

/**
 * Can a vehicle of `size` radius stand at continuous world position
 * (wx, wy)?  Checks the four corners of its bounding box (the 0.85
 * corner inset is the shared collision geometry for all vehicles —
 * movement, separation, structure pushing, and spawn all use this).
 */
export function canStand(grid, wx, wy, size = VEHICLES.tank.size) {
    const s = size * 0.85;
    return (
        grid.isPassable(wx - s, wy - s) &&
        grid.isPassable(wx + s, wy - s) &&
        grid.isPassable(wx - s, wy + s) &&
        grid.isPassable(wx + s, wy + s)
    );
}

/** Sample points along a line, excluding the origin/destination tiles on request. */
function lineSamples(x1, y1, x2, y2, skipOrigin, skipTarget = false) {
    const dx = x2 - x1,
        dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const n = Math.ceil(d * 3);
    const originGx = Math.floor(x1),
        originGy = Math.floor(y1);
    const targetGx = Math.floor(x2),
        targetGy = Math.floor(y2);
    const samples = [];
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const sx = x1 + dx * t,
            sy = y1 + dy * t;
        if (skipOrigin && Math.floor(sx) === originGx && Math.floor(sy) === originGy) continue;
        if (skipTarget && Math.floor(sx) === targetGx && Math.floor(sy) === targetGy) continue;
        samples.push([sx, sy]);
    }
    return samples;
}

/**
 * Is the straight line between two points clear of projectile-blocking
 * terrain?  The shared LOS query — tanks, watch towers, squad members,
 * and the AI all use it.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skipOrigin]  skip the shooter's own tile so a
 *        structure standing on a blocking tile (e.g. a watch tower) does
 *        not block itself.  Harmless for tanks (they never stand on
 *        blocking tiles).
 * @param {boolean} [opts.skipTarget]  skip the target's own tile so a
 *        solid structure can be *seen*: the wall's tile shouldn't block
 *        sight of the wall (the swarm's discovery uses this).
 */
export function hasLineOfSight(grid, x1, y1, x2, y2, { skipOrigin = false, skipTarget = false } = {}) {
    for (const [sx, sy] of lineSamples(x1, y1, x2, y2, skipOrigin, skipTarget)) {
        if (grid.blocksSight(sx, sy)) return false;
    }
    return true;
}

/**
 * Is the straight line between two points fully walkable (passable
 * tiles, endpoints included)?  Used by the AI to pick a direct
 * waypoint skip when a path leg has no obstacles.
 */
export function hasWalkableLine(grid, x1, y1, x2, y2) {
    for (const [sx, sy] of lineSamples(x1, y1, x2, y2, false)) {
        if (!grid.isPassable(sx, sy)) return false;
    }
    // Sample the endpoint too — the waypoint tile itself must be passable.
    if (!grid.isPassable(x2, y2)) return false;
    return true;
}

/**
 * Count projectile-blocking tiles within a radius of a world position.
 * Used by AI to evaluate how much cover a position offers.
 */
export function countCoverTiles(grid, wx, wy, radius = 3) {
    const gx = Math.floor(wx);
    const gy = Math.floor(wy);
    const r = Math.ceil(radius);
    let count = 0;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue;
            if (grid.blocksSight(gx + dx + 0.5, gy + dy + 0.5)) count++;
        }
    }
    return count;
}

/**
 * Is there an intact (undamaged) building tile within `radius` of a
 * world position?  Drives the infantry squad's mechanical cover bonus.
 */
export function hasIntactBuildingNear(grid, wx, wy, radius = 1.2) {
    const gx = Math.floor(wx);
    const gy = Math.floor(wy);
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            const tx = gx + dx,
                ty = gy + dy;
            if (!grid.isIntactBuilding(tx, ty)) continue;
            const cx = tx + 0.5,
                cy = ty + 0.5;
            if ((cx - wx) * (cx - wx) + (cy - wy) * (cy - wy) <= r2) return true;
        }
    }
    return false;
}

/**
 * Nearest intact building tile centre within `maxDist` of a world
 * position.  Used by squad formation steering to hug walls.
 *
 * @returns {{x:number, y:number, dist:number} | null}
 */
export function nearestBuilding(grid, wx, wy, maxDist = 2.0) {
    const gx = Math.floor(wx);
    const gy = Math.floor(wy);
    const r = Math.ceil(maxDist);
    const r2 = maxDist * maxDist;
    let best = null;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            const tx = gx + dx,
                ty = gy + dy;
            if (!grid.isIntactBuilding(tx, ty)) continue;
            const cx = tx + 0.5,
                cy = ty + 0.5;
            const d2 = (cx - wx) * (cx - wx) + (cy - wy) * (cy - wy);
            if (d2 > r2) continue;
            if (!best || d2 < best.d2) best = { x: cx, y: cy, dist: Math.sqrt(d2), d2 };
        }
    }
    return best ? { x: best.x, y: best.y, dist: best.dist } : null;
}

/**
 * Nearest passable tile centre to a world position (spiral search).
 * Used by squad formation steering to keep members out of obstacles.
 *
 * @returns {{x:number, y:number} | null}
 */
export function nearestPassable(grid, wx, wy) {
    const gx = Math.floor(wx);
    const gy = Math.floor(wy);
    if (grid.isPassable(wx, wy)) return { x: wx, y: wy };
    for (let r = 1; r <= 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const tx = gx + dx,
                    ty = gy + dy;
                if (grid.isPassable(tx + 0.5, ty + 0.5)) return { x: tx + 0.5, y: ty + 0.5 };
            }
        }
    }
    return null;
}
