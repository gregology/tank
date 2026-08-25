/**
 * Base-compound layout and spawn-point helpers over a `TileGrid`.
 *
 * `buildBaseCompounds` stamps two compounds (walls, towers, HQ tiles) on
 * opposite sides of the island and carves a path between them.  The
 * spawn helpers (`getBaseSpawnPoint`, `getSpawnPoint`) pick passable
 * positions using the shared geometry (`canStand`).
 */

import { TILES as T, VEHICLES } from "../config.js";
import { distance, randomInt } from "../utils.js";
import { layDirtRoad } from "./generation.js";
import { canStand } from "./queries.js";

/** Half-extent (tiles) of each compound tier; full size and spawn radius derive from it. */
const COMPOUND_HALF = { small: 5, medium: 7, large: 10 };

/**
 * Compound-shape stampers, keyed by tier.  Each returns the layout data
 * (`structures`, centre, entrance, half) for one compound.  The square tiers
 * share one `stampSquareCompound`; the large tier is circular and stays its
 * own hand-rolled shape.
 */
const COMPOUND_STAMPERS = {
    small: stampCompoundSmall,
    medium: stampCompoundMedium,
    large: stampCompoundLarge,
};

/**
 * Build two base compounds on opposite sides of the island.
 *
 * Compound size scales with the map:
 *   Small  (<=80):  10x10 square, 2 entrance towers
 *   Medium (<=160): 14x14 square, 4 corner towers
 *   Large  (>160):  circular r=10, 6 towers (2 entrance + 4 distributed)
 *
 * @param {string} [baseType='compound']  'compound' = walls+towers+HQ,
 *                                        'hq_only'  = just HQ building
 * @returns {[CompoundLayout, CompoundLayout]}  layout data for
 *          game.js to create entity objects from.
 */
export function buildBaseCompounds(grid, baseType) {
    const cx = grid.width / 2,
        cy = grid.height / 2;
    const maxR = Math.min(grid.width, grid.height) / 2 - 1;

    // Pick compound tier based on map size
    const mapMin = Math.min(grid.width, grid.height);
    const tier = mapMin <= 80 ? "small" : mapMin <= 160 ? "medium" : "large";
    const compoundR = COMPOUND_HALF[tier] + 2;

    // Scale spatial parameters from island radius
    const clearR = Math.round(maxR * 0.25); // clear terrain radius around base
    const pathHW = Math.max(3, Math.round(maxR * 0.06)); // path half-width

    // Place bases by searching inward from the coast on opposite sides.
    const baseAngle = Math.PI * 1.25; // SW -> NE diagonal
    const p1 = findCoastalSpot(grid, cx, cy, maxR, baseAngle, compoundR);
    const p2 = findCoastalSpot(grid, cx, cy, maxR, baseAngle + Math.PI, compoundR);

    // Clear large areas (remove hills, rocks, buildings)
    clearAroundBase(grid, Math.floor(p1.x), Math.floor(p1.y), clearR);
    clearAroundBase(grid, Math.floor(p2.x), Math.floor(p2.y), clearR);

    // Determine entrance directions (face each other)
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
    const dir1 = angleToCardinal(angle1);
    const dir2 = angleToCardinal(angle2);

    // Stamp compounds onto the map (size scales with map)
    const stamp = COMPOUND_STAMPERS[tier];
    const layout1 = stamp(grid, Math.floor(p1.x), Math.floor(p1.y), dir1, baseType);
    const layout2 = stamp(grid, Math.floor(p2.x), Math.floor(p2.y), dir2, baseType);

    // Carve a wide path between the two bases
    clearPath(grid, p1, p2, pathHW);

    // Connect each compound entrance to the road network
    connectCompoundToRoad(grid, layout1);
    connectCompoundToRoad(grid, layout2);

    return [layout1, layout2];
}

/**
 * Search inward from the coast along `angle` to find a spot with
 * enough dry land for a compound.  Only rejects water tiles -- hills
 * and buildings are ignored because clearAroundBase removes them.
 */
function findCoastalSpot(grid, cx, cy, maxR, angle, clearRadius) {
    const inset = clearRadius + 5; // stay inside the coast
    for (let r = maxR - inset; r > clearRadius + 5; r -= 1) {
        const gx = Math.round(cx + Math.cos(angle) * r);
        const gy = Math.round(cy + Math.sin(angle) * r);
        if (gx < clearRadius || gx >= grid.width - clearRadius) continue;
        if (gy < clearRadius || gy >= grid.height - clearRadius) continue;
        if (areaOnLand(grid, gx, gy, clearRadius)) {
            return { x: gx + 0.5, y: gy + 0.5 };
        }
    }
    // Fallback: search outward from a safe interior position
    return findClearSpot(
        grid,
        Math.round(cx + Math.cos(angle) * maxR * 0.4),
        Math.round(cy + Math.sin(angle) * maxR * 0.4),
        clearRadius,
    );
}

/** True if every tile in a square of radius `r` is on land (not water). */
function areaOnLand(grid, gx, gy, r) {
    for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
            if (grid.isWaterTile(grid.getTile(gx + dx, gy + dy))) return false;
        }
    return true;
}

/** Pick a cardinal direction from an angle. */
function angleToCardinal(angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "E" : "W";
    return dy > 0 ? "S" : "N";
}

/* -- Small compound (64x64): 10x10 square, 2 entrance towers -- */

/**
 * Index along the entrance edge (N/S use dx, E/W use dy), or -1 when
 * (dx, dy) is not on that edge.  Shared by the square-compound stampers.
 */
function entranceEdgePos(dir, dx, dy, size) {
    if (dir === "N" && dy === 0) return dx;
    if (dir === "S" && dy === size - 1) return dx;
    if (dir === "W" && dx === 0) return dy;
    if (dir === "E" && dx === size - 1) return dy;
    return -1;
}

/**
 * Stamp a square compound: sand interior, a classified perimeter
 * (walls/towers/gaps via `classifyPerimeter`), then the HQ tiles.  The two
 * square tiers differ only in `half` and how the perimeter is classified.
 */
function stampSquareCompound(grid, cx, cy, dir, baseType, half, classifyPerimeter) {
    const SIZE = half * 2;
    const ox = cx - half,
        oy = cy - half;
    const hqOnly = baseType === "hq_only";

    fillSand(grid, ox, oy, SIZE);
    const walls = [],
        towers = [];

    if (!hqOnly) placePerimeter(grid, ox, oy, SIZE, classifyPerimeter, walls, towers);

    const hqTilesArr = hqTiles(ox, oy, half, dir);
    return finishLayout(grid, ox, oy, half, SIZE, walls, towers, hqTilesArr, dir);
}

/* -- Small compound (64x64): 10x10 square, 2 entrance towers -- */

function stampCompoundSmall(grid, cx, cy, dir, baseType) {
    const half = COMPOUND_HALF.small;
    const SIZE = half * 2;
    return stampSquareCompound(grid, cx, cy, dir, baseType, half, (dx, dy) => {
        const edgePos = entranceEdgePos(dir, dx, dy, SIZE);
        if (edgePos < 0) return "wall";
        if (edgePos === 4 || edgePos === 5) return "gap";
        if (edgePos === 3 || edgePos === 6) return "tower";
        return "wall";
    });
}

/* -- Medium compound (128x128): 14x14 square, 4 corner towers -- */

function stampCompoundMedium(grid, cx, cy, dir, baseType) {
    const half = COMPOUND_HALF.medium;
    const SIZE = half * 2;
    const corners = new Set(["0,0", `${SIZE - 1},0`, `0,${SIZE - 1}`, `${SIZE - 1},${SIZE - 1}`]);
    return stampSquareCompound(grid, cx, cy, dir, baseType, half, (dx, dy) => {
        if (corners.has(`${dx},${dy}`)) return "tower";
        const edgePos = entranceEdgePos(dir, dx, dy, SIZE);
        if (edgePos < 0) return "wall";
        const mid = SIZE / 2;
        if (edgePos === mid - 1 || edgePos === mid) return "gap";
        return "wall";
    });
}

/* -- Large compound (192x192): circular r=10, 6 towers -- */

function stampCompoundLarge(grid, cx, cy, dir, baseType) {
    const RADIUS = COMPOUND_HALF.large; // circle radius in tiles
    const SIZE = RADIUS * 2 + 1; // bounding box
    const half = RADIUS;
    const ox = cx - half,
        oy = cy - half;
    const hqOnly = baseType === "hq_only";

    // Fill circular area with sand
    for (let dy = 0; dy < SIZE; dy++) {
        for (let dx = 0; dx < SIZE; dx++) {
            const ddx = dx - half,
                ddy = dy - half;
            if (ddx * ddx + ddy * ddy <= (RADIUS + 0.5) * (RADIUS + 0.5)) {
                grid.setTile(ox + dx, oy + dy, T.SAND);
            }
        }
    }

    const walls = [],
        towers = [];

    if (!hqOnly) {
        // Entrance direction angle
        const dirAngle = dir === "E" ? 0 : dir === "S" ? Math.PI / 2 : dir === "W" ? Math.PI : -Math.PI / 2;

        // Place 6 tower angles: 2 flanking entrance, 4 evenly around rest
        const entranceSpread = Math.PI / 12; // 15 degrees
        const towerAngles = [dirAngle - entranceSpread, dirAngle + entranceSpread];
        for (let i = 1; i <= 4; i++) {
            towerAngles.push(dirAngle + entranceSpread + (i * (2 * Math.PI - 2 * entranceSpread)) / 5);
        }

        // Entrance towers (first 2) sit on the wall ring;
        // the other 4 are placed just outside so they have
        // clear line-of-sight over the wall.
        const entranceTowerSet = new Set();
        for (let ti = 0; ti < 2; ti++) {
            const a = towerAngles[ti];
            const tx = half + Math.round(Math.cos(a) * RADIUS);
            const ty = half + Math.round(Math.sin(a) * RADIUS);
            entranceTowerSet.add(`${tx},${ty}`);
        }

        // Outer towers: RADIUS + 2 so they sit outside the wall
        const outerTowerPositions = [];
        for (let ti = 2; ti < towerAngles.length; ti++) {
            const a = towerAngles[ti];
            const tx = ox + half + Math.round(Math.cos(a) * (RADIUS + 2));
            const ty = oy + half + Math.round(Math.sin(a) * (RADIUS + 2));
            outerTowerPositions.push({ gx: tx, gy: ty });
        }

        // Entrance gap: tiles within +/-gapAngle of entrance direction
        const gapAngle = Math.PI / 16; // ~11 degrees gap on each side

        // Walk the circular perimeter — walls + entrance towers
        for (let dy = 0; dy < SIZE; dy++) {
            for (let dx = 0; dx < SIZE; dx++) {
                const ddx = dx - half,
                    ddy = dy - half;
                const dist = Math.sqrt(ddx * ddx + ddy * ddy);
                // Only perimeter tiles (ring at RADIUS +/- 0.7)
                if (dist < RADIUS - 0.7 || dist > RADIUS + 0.7) continue;

                const gx = ox + dx,
                    gy = oy + dy;
                const tileAngle = Math.atan2(ddy, ddx);
                let angleDiff = tileAngle - dirAngle;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                if (Math.abs(angleDiff) < gapAngle) {
                    grid.setTile(gx, gy, T.DIRT);
                } else if (entranceTowerSet.has(`${dx},${dy}`)) {
                    towers.push({ gx, gy });
                    grid.setTile(gx, gy, T.BASE_STRUCTURE);
                } else {
                    walls.push({ gx, gy });
                    grid.setTile(gx, gy, T.BASE_STRUCTURE);
                }
            }
        }

        // Place outer towers on sand just outside the wall
        for (const pos of outerTowerPositions) {
            grid.setTile(pos.gx, pos.gy, T.BASE_STRUCTURE);
            towers.push(pos);
        }
    }

    const hqTilesArr = hqTiles(ox, oy, half, dir);
    return finishLayout(grid, ox, oy, half, SIZE, walls, towers, hqTilesArr, dir);
}

/* -- Shared compound helpers -- */

/** Fill a square area with sand. */
function fillSand(grid, ox, oy, size) {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) grid.setTile(ox + dx, oy + dy, T.SAND);
}

/** Place perimeter wall/tower/gap tiles for a square compound. */
function placePerimeter(grid, ox, oy, size, roleFn, walls, towers) {
    for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
            if (dx > 0 && dx < size - 1 && dy > 0 && dy < size - 1) continue;
            const role = roleFn(dx, dy);
            const gx = ox + dx,
                gy = oy + dy;
            if (role === "gap") {
                grid.setTile(gx, gy, T.DIRT);
            } else if (role === "tower") {
                towers.push({ gx, gy });
                grid.setTile(gx, gy, T.BASE_STRUCTURE);
            } else {
                walls.push({ gx, gy });
                grid.setTile(gx, gy, T.BASE_STRUCTURE);
            }
        }
    }
}

/** HQ tile pair, perpendicular to entrance direction, centred in compound. */
function hqTiles(ox, oy, half, dir) {
    const mid = half;
    if (dir === "E" || dir === "W") {
        return [
            { gx: ox + mid, gy: oy + mid - 1 },
            { gx: ox + mid, gy: oy + mid },
        ];
    }
    return [
        { gx: ox + mid, gy: oy + mid },
        { gx: ox + mid + 1, gy: oy + mid },
    ];
}

/** Build the final layout object and stamp HQ tiles. */
function finishLayout(grid, ox, oy, half, size, walls, towers, hqTilesArr, dir) {
    for (const t of hqTilesArr) grid.setTile(t.gx, t.gy, T.BASE_STRUCTURE);
    const hqCenter = {
        x: (hqTilesArr[0].gx + hqTilesArr[1].gx) / 2 + 0.5,
        y: (hqTilesArr[0].gy + hqTilesArr[1].gy) / 2 + 0.5,
    };
    return {
        structures: [
            ...towers.map((p) => ({ type: "baseTower", tiles: [{ gx: p.gx, gy: p.gy }] })),
            ...walls.map((p) => ({ type: "baseWall", tiles: [{ gx: p.gx, gy: p.gy }] })),
            { type: "baseHQ", tiles: hqTilesArr.map((t) => ({ gx: t.gx, gy: t.gy })), center: hqCenter },
        ],
        hqCenter,
        center: { x: ox + half, y: oy + half },
        dir,
        ox,
        oy,
        size,
        half,
    };
}

/** Connect a compound entrance to the nearest road tile. */
function connectCompoundToRoad(grid, layout) {
    const { ox, oy, dir, size } = layout;
    const half = Math.floor(size / 2);
    let ex, ey;
    if (dir === "N") {
        ex = ox + half;
        ey = oy - 1;
    } else if (dir === "S") {
        ex = ox + half;
        ey = oy + size;
    } else if (dir === "E") {
        ex = ox + size;
        ey = oy + half;
    } else {
        ex = ox - 1;
        ey = oy + half;
    }

    // Find nearest road tile
    let bestX = -1,
        bestY = -1,
        bestD = Infinity;
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (!grid.isRoad(x, y)) continue;
            const d = Math.hypot(x - ex, y - ey);
            if (d < bestD) {
                bestD = d;
                bestX = x;
                bestY = y;
            }
        }
    }
    if (bestX >= 0) {
        layDirtRoad(grid, { x: ex, y: ey }, { x: bestX, y: bestY });
    }
}

/**
 * Pick a random spawn point inside a compound's interior.
 * @param {number} cx  compound centre grid X
 * @param {number} cy  compound centre grid Y
 * @param {number} half  compound half-extent in tiles (from the layout)
 * @param {() => number} [rng]  random source (defaults to Math.random)
 */
export function getBaseSpawnPoint(grid, cx, cy, half = COMPOUND_HALF.small, rng = Math.random) {
    const interior = (half - 1) * 2;
    const ox = Math.floor(cx) - half,
        oy = Math.floor(cy) - half;

    for (let attempt = 0; attempt < 100; attempt++) {
        const gx = ox + 1 + Math.floor(rng() * interior);
        const gy = oy + 1 + Math.floor(rng() * interior);
        const wx = gx + 0.5,
            wy = gy + 0.5;
        if (canStand(grid, wx, wy, VEHICLES.tank.size)) {
            return { x: wx, y: wy };
        }
    }
    return { x: cx + 0.5, y: cy + 0.5 };
}

/** Remove hills/rocks in a large circle around a base, replacing them with grass. */
function clearAroundBase(grid, gx, gy, r) {
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            const tx = gx + dx,
                ty = gy + dy;
            const t = grid.getTile(tx, ty);
            if (grid.isSolid(t) && t !== T.BASE_STRUCTURE) {
                grid.setTile(tx, ty, T.GRASS);
            }
        }
    }
}

/**
 * Carve a straight passable corridor of half-width `hw` tiles
 * between two points.  Removes hills/rocks -> grass, and
 * converts water -> sand so the path is always walkable.
 */
function clearPath(grid, p1, p2, hw) {
    const dx = p2.x - p1.x,
        dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const px = -dy / len,
        py = dx / len; // perpendicular

    const steps = Math.ceil(len * 2); // oversample for no gaps
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = p1.x + dx * t;
        const cy = p1.y + dy * t;
        for (let w = -hw; w <= hw; w++) {
            const gx = Math.floor(cx + px * w);
            const gy = Math.floor(cy + py * w);
            const tile = grid.getTile(gx, gy);
            if (tile === T.BASE_STRUCTURE) {
            } else if (grid.isSolid(tile)) {
                grid.setTile(gx, gy, T.GRASS);
            } else if (grid.isWaterTile(tile)) {
                grid.setTile(gx, gy, T.SAND);
            }
        }
    }
}

/** Search outward from (tx,ty) for a spot with `r` tiles of clear grass. */
function findClearSpot(grid, tx, ty, r) {
    const maxRing = Math.max(12, Math.round(Math.min(grid.width, grid.height) * 0.2));
    for (let ring = 0; ring < maxRing; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
                if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const gx = tx + dx,
                    gy = ty + dy;
                if (areaPassable(grid, gx, gy, r)) {
                    return { x: gx + 0.5, y: gy + 0.5 };
                }
            }
        }
    }
    return { x: tx + 0.5, y: ty + 0.5 };
}

function areaPassable(grid, gx, gy, r) {
    for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (!grid.isPassable(gx + dx + 0.5, gy + dy + 0.5)) return false;
    return true;
}

/** Find a random passable spawn point, far from (ax, ay). */
export function getSpawnPoint(grid, ax, ay, minDist = 10, rng = Math.random) {
    for (let attempt = 0; attempt < 300; attempt++) {
        const x = randomInt(6, grid.width - 7, rng) + 0.5;
        const y = randomInt(6, grid.height - 7, rng) + 0.5;
        const t = grid.getTile(Math.floor(x), Math.floor(y));
        // Prefer flat ground for spawning
        if (t !== T.GRASS && t !== T.DARK_GRASS) continue;
        if (ax !== undefined && distance(x, y, ax, ay) < minDist) continue;
        return { x, y };
    }
    return { x: grid.width / 2, y: grid.height / 2 };
}
