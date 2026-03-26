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

class MinHeap {
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

        // If goal tile itself is impassable, find the nearest passable
        // neighbour (so we can pathfind *next to* a tower/wall).
        if (!map.isPassable(g.gx + 0.5, g.gy + 0.5)) {
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

        const gArr = new Float32Array(w * h).fill(Infinity);
        const fArr = new Float32Array(w * h).fill(Infinity);
        const from = new Int32Array(w * h).fill(-1);
        const closed = new Uint8Array(w * h);
        const inOpen = new Uint8Array(w * h);

        gArr[sKey] = 0;
        fArr[sKey] = this._h8(s.gx, s.gy, g.gx, g.gy);

        const open = new MinHeap();
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
                if (!map.isPassable(nx + 0.5, ny + 0.5)) continue;

                if (dx !== 0 && dy !== 0) {
                    if (!map.isPassable(cx + dx + 0.5, cy + 0.5) || !map.isPassable(cx + 0.5, cy + dy + 0.5)) continue;
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
                if (!map.isPassable(x + 0.5, y + 0.5)) continue;
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
                    if (this.map.isPassable(nx + 0.5, ny + 0.5)) return { x: nx, y: ny };
                }
            }
        }
        return null;
    }
}
