/**
 * Settlements stage — village clusters, the dirt-road chain between
 * them, and roadside buildings.
 *
 * Villages are placed with a minimum separation, connected by a
 * nearest-neighbour chain of 1-tile-wide cardinal-step dirt roads (no
 * isolated villages), with buildings scattered along roads.
 */

import { distance } from "../../utils.js";
import { hash } from "../noise.js";
import { layDirtRoad, spanningTree } from "./roads.js";
import { styleFor } from "./terrain.js";

/**
 * Place village clusters (min 14 tiles apart), connect with dirt
 * roads, then scatter roadside buildings along the connecting roads.
 */
export function placeVillages(grid) {
    const cx = grid.width / 2,
        cy = grid.height / 2,
        maxR = Math.min(grid.width, grid.height) / 2 - 1;
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

    // Step 2: connect villages with dirt roads (nearest-neighbour tree)
    if (villageCentres.length < 2) return;
    const roadSegments = spanningTree(villageCentres).map(([i, j]) => ({
        a: villageCentres[i],
        b: villageCentres[j],
    }));
    for (const { a, b } of roadSegments) layDirtRoad(grid, a, b);

    // Step 3: scatter a few buildings along the dirt roads between villages
    for (let seg = 0; seg < roadSegments.length; seg++) {
        scatterRoadsideBuildings(grid, roadSegments[seg].a, roadSegments[seg].b, seg);
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
