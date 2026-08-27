/**
 * A* pathfinding on the tile grid.
 *
 * Finds the shortest walkable route between two world positions,
 * returning a list of waypoints (tile centres).  Uses 8-directional
 * movement with diagonal-cut checks so bots don't clip corners.
 *
 * The grid is small (64 × 64 = 4 096 tiles) so even with a simple
 * binary-heap open set, a full search takes well under 1 ms.
 */

/* ── tiny binary min-heap keyed by fScore ─────────────────── */

export class MinHeap {
    constructor() {
        this.d = [];
    }
    get size() {
        return this.d.length;
    }
    push(node) {
        this.d.push(node);
        this._up(this.d.length - 1);
    }
    pop() {
        const top = this.d[0];
        const last = this.d.pop();
        if (this.d.length > 0) {
            this.d[0] = last;
            this._down(0);
        }
        return top;
    }
    _up(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.d[i].f >= this.d[p].f) break;
            [this.d[i], this.d[p]] = [this.d[p], this.d[i]];
            i = p;
        }
    }
    _down(i) {
        const n = this.d.length;
        for (;;) {
            let s = i;
            const l = 2 * i + 1,
                r = l + 1;
            if (l < n && this.d[l].f < this.d[s].f) s = l;
            if (r < n && this.d[r].f < this.d[s].f) s = r;
            if (s === i) break;
            [this.d[i], this.d[s]] = [this.d[s], this.d[i]];
            i = s;
        }
    }
}

import { VEHICLES } from "./config.js";

/**
 * Path clearance uses the largest ground-vehicle size: a route only
 * exists where every ground vehicle actually FITS (canStand's
 * four-corner box), so bots are never routed into gaps they can't
 * squeeze through.  (Drones fly and don't pathfind.)
 */
const CLEARANCE = Math.max(
    ...Object.values(VEHICLES)
        .filter((v) => !v.flies)
        .map((v) => v.size),
);

/* ── 8 directions: [dx, dy, cost] ─────────────────────────── */

const DIRS = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, 1.41],
    [1, -1, 1.41],
    [-1, 1, 1.41],
    [1, 1, 1.41],
];

/* ── Pathfinder ───────────────────────────────────────────── */

export class Pathfinder {
    constructor(map) {
        this.map = map;
        this._w = map.width;
        this._h = map.height;
        // Scratch buffers allocated lazily on the first search and
        // refilled per call — a per-call allocation of ~150 KB per
        // search is pure GC churn (heap-thrash OOM in heavy sims), but
        // eager allocation makes every short-lived Pathfinder pay for
        // buffers it may never use (generation stamps many).
        this._scratch = null;
        this._open = new MinHeap();
    }

    get _bufs() {
        if (!this._scratch) {
            const n = this._w * this._h;
            this._scratch = {
                g: new Float32Array(n),
                f: new Float32Array(n),
                from: new Int32Array(n),
                closed: new Uint8Array(n),
                inOpen: new Uint8Array(n),
            };
        }
        return this._scratch;
    }

    /**
     * Find a path from world (sx,sy) to world (gx,gy).
     * @returns {{x:number,y:number}[]|null}  Waypoints (tile centres)
     *          or null if unreachable.
     */
    findPath(sx, sy, gx, gy) {
        const w = this._w,
            h = this._h,
            map = this.map;
        const s = { gx: Math.floor(sx), gy: Math.floor(sy) };
        const g = { gx: Math.floor(gx), gy: Math.floor(gy) };

        // Off-grid endpoints would form out-of-bounds keys — typed-array
        // OOB reads return undefined, which _rebuild's `!== -1` guard
        // can't stop: the walk would loop forever (the 4 GB OOM).
        if (s.gx < 0 || s.gx >= w || s.gy < 0 || s.gy >= h) return null;
        if (g.gx < 0 || g.gx >= w || g.gy < 0 || g.gy >= h) return null;

        // If goal tile itself doesn't fit a vehicle, find the nearest
        // tile that does (so we can pathfind *next to* a tower/wall).
        if (!map.canStand(g.gx + 0.5, g.gy + 0.5, CLEARANCE)) {
            const alt = this._nearestPassable(g.gx, g.gy);
            if (!alt) return null;
            g.gx = alt.x;
            g.gy = alt.y;
        }

        // Pre-compute wall-proximity cost for every tile.
        // Tiles adjacent to impassable terrain get a penalty so the
        // path naturally gives walls a wide berth.
        if (!this._wallCost) this._buildWallCost();
        const wallCost = this._wallCost;

        const key = (x, y) => y * w + x;
        const sKey = key(s.gx, s.gy),
            gKey = key(g.gx, g.gy);
        if (sKey === gKey) return [];

        const bufs = this._bufs;
        const gArr = bufs.g.fill(Infinity);
        const fArr = bufs.f.fill(Infinity);
        const from = bufs.from.fill(-1);
        const closed = bufs.closed.fill(0);
        const inOpen = bufs.inOpen.fill(0);

        gArr[sKey] = 0;
        fArr[sKey] = this._h8(s.gx, s.gy, g.gx, g.gy);

        const open = this._open;
        open.d.length = 0;
        open.push({ k: sKey, f: fArr[sKey] });
        inOpen[sKey] = 1;

        while (open.size > 0) {
            const { k: cur } = open.pop();
            if (cur === gKey) return this._rebuild(from, cur, w);

            if (closed[cur]) continue;
            closed[cur] = 1;

            const cx = cur % w,
                cy = (cur / w) | 0;

            for (const [dx, dy, baseCost] of DIRS) {
                const nx = cx + dx,
                    ny = cy + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const nk = key(nx, ny);
                if (closed[nk]) continue;
                if (!map.canStand(nx + 0.5, ny + 0.5, CLEARANCE)) continue;

                if (dx !== 0 && dy !== 0) {
                    if (
                        !map.canStand(cx + dx + 0.5, cy + 0.5, CLEARANCE) ||
                        !map.canStand(cx + 0.5, cy + dy + 0.5, CLEARANCE)
                    )
                        continue;
                }

                const tg = gArr[cur] + baseCost + wallCost[nk];
                if (tg >= gArr[nk]) continue;

                from[nk] = cur;
                gArr[nk] = tg;
                const f = tg + this._h8(nx, ny, g.gx, g.gy);
                fArr[nk] = f;
                if (!inOpen[nk]) {
                    open.push({ k: nk, f });
                    inOpen[nk] = 1;
                }
            }
        }

        return null;
    }

    /**
     * Build a cost overlay so paths prefer tiles away from walls.
     * Only checks the 8 immediate neighbours — a light penalty that
     * steers bots toward the centre of corridors without making
     * routes unreasonably long.
     */
    _buildWallCost() {
        const w = this._w,
            h = this._h,
            map = this.map;
        this._wallCost = new Float32Array(w * h);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!map.canStand(x + 0.5, y + 0.5, CLEARANCE)) continue;
                let adj = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (!map.isPassable(x + dx + 0.5, y + dy + 0.5)) adj++;
                    }
                }
                // 0.3 per adjacent wall: tile next to 1 wall costs 1.3,
                // in a corner (3 walls) costs 1.9, open tile costs 1.0.
                this._wallCost[y * w + x] = adj * 0.3;
            }
        }
    }

    /** Call when terrain changes (tile destroyed) to rebuild costs. */
    invalidate() {
        this._wallCost = null;
    }

    /** Octile-distance heuristic (admissible for 8-dir). */
    _h8(x1, y1, x2, y2) {
        const dx = Math.abs(x2 - x1),
            dy = Math.abs(y2 - y1);
        return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
    }

    /** Trace `from` links back to build the waypoint list. */
    _rebuild(from, cur, w) {
        const path = [];
        while (cur !== -1) {
            path.push({ x: (cur % w) + 0.5, y: ((cur / w) | 0) + 0.5 });
            cur = from[cur];
        }
        path.reverse();
        if (path.length > 1) path.shift(); // drop start tile
        return path;
    }

    /** Find the nearest passable tile to (gx, gy) via spiral search. */
    _nearestPassable(gx, gy) {
        for (let r = 1; r < 6; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = gx + dx,
                        ny = gy + dy;
                    if (this.map.canStand(nx + 0.5, ny + 0.5, CLEARANCE)) return { x: nx, y: ny };
                }
            }
        }
        return null;
    }
}
