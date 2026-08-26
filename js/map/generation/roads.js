/**
 * Road laying — the shared dirt-road primitive.
 *
 * Cardinal-step paths (every tile shares a full edge with the next), so
 * roads never connect diagonally-only.  Used by the settlements stage
 * (village chains) and by base-compound layout (entrance stubs).
 */

import { distance } from "../../utils.js";
import { hash } from "../noise.js";
import { styleFor } from "./terrain.js";

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
 * Connect nodes with a nearest-neighbour spanning tree.  Returns the
 * edge list as [i, j] index pairs — every node reachable, no cycles.
 * Pure: the roads stage feeds it villages, bridge ends, and compound
 * entrances; where each road gets laid is a separate concern
 * (`layDirtRoad`).
 */
export function spanningTree(nodes) {
    if (nodes.length < 2) return [];
    const connected = [0];
    const remaining = new Set(nodes.keys());
    remaining.delete(0);
    const edges = [];
    while (remaining.size > 0) {
        let bestI = -1,
            bestJ = -1,
            bestD = Infinity;
        for (const ci of connected) {
            for (const ri of remaining) {
                const d = distance(nodes[ci].x, nodes[ci].y, nodes[ri].x, nodes[ri].y);
                if (d < bestD) {
                    bestD = d;
                    bestI = ci;
                    bestJ = ri;
                }
            }
        }
        if (bestJ < 0) break;
        edges.push([bestI, bestJ]);
        connected.push(bestJ);
        remaining.delete(bestJ);
    }
    return edges;
}
