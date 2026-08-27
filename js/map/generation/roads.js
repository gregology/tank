/**
 * Road laying — Transport Tycoon-style: roads run straight along one
 * grid axis, then turn 90° (an L).  Never a staircase — on the iso grid
 * that reads as a fake diagonal, and TT roads only ever run along the
 * two axes.  When the L hits water or obstacles the road follows an A*
 * route instead (which crosses rivers at bridges).
 *
 * The network anchors on the actual destinations — compound entrances,
 * farm barns, bridge ends — connected by a nearest-neighbour tree of
 * tarmac arteries, plus a few dirt side lanes for the rural mix.
 * Villages come later (they grow around this network — see
 * settlements.js).
 */

import { TILES as T } from "../../config.js";
import { MinHeap } from "../../pathfinder.js";
import { distance } from "../../utils.js";
import { entrancePoint } from "../compounds.js";
import { hash } from "../noise.js";

/** Lay a road from a to b along a turn-penalized route. */
export function layRoad(grid, a, b, tile) {
    const path = roadRoute(grid, a, b);
    if (!path) return false; // unreachable — no road at all, never a ford
    for (const t of path) stampRoadTile(grid, t.x, t.y, tile);
    return true;
}

/** Can a road tile exist here? Natural ground (not fields — trunks
 *  wrap around farmland), an existing road, or a bridge. */
function roadCarries(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    if (t === undefined) return false;
    if (t === T.FIELD) return false;
    return isNaturalGround(grid, gx, gy) || grid.isRoad(gx, gy);
}

/**
 * Route a road between two points: Dijkstra over (tile, travel
 * direction) where continuing straight costs 1 and turning 90° costs
 * extra — so roads run in long straight runs with few, clean 90° turns,
 * never a staircase.  Cardinal moves only (TT roads have no diagonals);
 * the route crosses rivers at bridges (the only passable water tiles).
 */
function roadRoute(grid, a, b) {
    const w = grid.width,
        h = grid.height;
    const ax = Math.floor(a.x),
        ay = Math.floor(a.y);
    let bx = Math.floor(b.x),
        by = Math.floor(b.y);
    // 8-way: grid diagonals project to the screen's horizontal/vertical —
    // the 45°/0°/90° road angles.  Turn cost scales with the turn angle.
    // The anchors are buildings (barns) — solid tiles: route NEXT to them.
    if (!roadCarries(grid, bx, by)) {
        const alt = nearestCarrying(grid, bx, by);
        if (!alt) return null;
        bx = alt.x;
        by = alt.y;
    }
    const DIRS = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];
    const TURN_COST_45 = 1.2,
        TURN_COST_90 = 2.5,
        TURN_COST_135 = 4.5;
    const turnCost = (a, b) => {
        const angle = Math.abs(a - b);
        return [0, TURN_COST_45, TURN_COST_90, TURN_COST_135][Math.min(angle, 8 - angle)] ?? 99;
    };
    const stateKey = (x, y, d) => (y * w + x) * 8 + d;
    const dist = new Map();
    const from = new Map();
    const open = new MinHeap();
    const push = (k, cost, parent) => {
        if (cost >= (dist.get(k) ?? Infinity)) return;
        dist.set(k, cost);
        from.set(k, parent);
        open.push({ k, f: cost });
    };
    for (let d = 0; d < 8; d++) push(stateKey(ax, ay, d), 0, -1);

    let bestGoal = -1;
    while (open.size > 0) {
        const { k, f: cost } = open.pop();
        if (cost > (dist.get(k) ?? Infinity)) continue; // stale
        const x = Math.floor(k / 8) % w,
            y = Math.floor(k / (8 * w)),
            d = k % 8;
        if (x === bx && y === by) {
            bestGoal = k;
            break;
        }
        for (let nd = 0; nd < 8; nd++) {
            const nx = x + DIRS[nd][0],
                ny = y + DIRS[nd][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (!roadCarries(grid, nx, ny)) continue;
            // diagonal steps may not cut across a water/solid corner —
            // water cannot carry a road, so it's never the open side
            if (nd >= 4 && (isWater(grid, x + DIRS[nd][0], y) || isWater(grid, x, y + DIRS[nd][1]))) continue;
            const stepCost = nd >= 4 ? Math.SQRT2 : 1; // diagonals move √2 further per step
            push(stateKey(nx, ny, nd), cost + stepCost + turnCost(d, nd), k);
        }
    }
    if (bestGoal < 0) return null;
    const path = [];
    let cur = bestGoal;
    while (cur !== -1 && cur !== undefined) {
        path.push({ x: Math.floor(cur / 8) % w, y: Math.floor(cur / (8 * w)) });
        cur = from.get(cur);
    }
    return path.reverse();
}

/** Connect nodes with a nearest-neighbour spanning tree.  Returns the
 *  edge list as [i, j] index pairs — every node reachable, no cycles.
 *  Pure: the roads stage feeds it anchors; where each road gets laid is
 *  a separate concern (`layRoad`). */
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

/**
 * Lay the road network: tarmac arteries connecting the compound
 * entrances, farm barns, and bridge ends (a nearest-neighbour tree),
 * plus a couple of dirt side lanes between nearby anchors for the
 * rural mix.  Villages grow around this network afterwards.
 */
export function layRoadNetwork(grid, ctx) {
    const entrances = (grid.baseLayouts ?? []).map(entrancePoint);
    const farms = ctx.farms ?? [];
    const bridgeEnds = (ctx.bridges ?? []).flatMap((b) => b.ends);
    const anchors = [...entrances, ...farms, ...bridgeEnds];

    const edges = spanningTree(anchors);
    for (const [i, j] of edges) layRoad(grid, anchors[i], anchors[j], T.TARMAC);

    // Dirt side lanes: a couple of short hops between nearby anchors
    const lanes = Math.min(2, anchors.length);
    for (let k = 0; k < lanes; k++) {
        const i = Math.floor(hash(grid, 3100 + k * 13, 2200) * anchors.length);
        const near = anchors
            .map((a, j) => ({ j, d: distance(a.x, a.y, anchors[i].x, anchors[i].y) }))
            .filter((e) => e.j !== i)
            .sort((p, q) => p.d - q.d)[k + 1];
        if (near) layRoad(grid, anchors[i], anchors[near.j], T.DIRT);
    }
}

/** Stamp a road tile: natural ground only — bridges and existing roads
 *  keep their look. */
function stampRoadTile(grid, gx, gy, tile) {
    if (isNaturalGround(grid, gx, gy)) grid.setTile(gx, gy, tile);
}

/** True for tiles a road may be stamped over (natural ground only —
 *  never water, bridges, structures, or existing roads).  Trees are
 *  stampable: a road through a hedgerow is the farmer's gap. */
function isNaturalGround(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    return t === T.GRASS || t === T.DARK_GRASS || t === T.SAND || t === T.FIELD || t === T.TREE;
}

function isWater(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    return t !== undefined && grid.isWaterTile(t);
}

/** Nearest road-carrying tile to (gx, gy) — spiral search. */
function nearestCarrying(grid, gx, gy) {
    for (let r = 1; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (roadCarries(grid, gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy };
            }
        }
    }
    return null;
}
