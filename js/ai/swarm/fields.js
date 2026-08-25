/**
 * Pheromone signal fields — the colony's shared memory.
 *
 * One SignalFields instance per faction holds one tile-grid field per
 * signal type.  Everything the swarm "knows" is deposited here by
 * js/systems/swarm.js and read by the behaviours in
 * js/ai/swarm/behaviours.js; vehicles never communicate directly.
 *
 * Decay and diffusion are NOT baked in at construction: `tick(params)`
 * reads them from the live tuning object each update, so the sandbox's
 * sliders take effect mid-match.
 *
 * The signal type vocabulary is data (`SIGNALS`); a new signal type is
 * one entry here plus its deposit/sense sites.
 */

/** The signal types, with the tuning keys that drive each. */
export const SIGNALS = {
    trail: { decay: "TRAIL_DECAY", diffusion: "TRAIL_DIFFUSION" },
    alarm: { decay: "ALARM_DECAY", diffusion: "ALARM_DIFFUSION" },
    route: { decay: "ROUTE_DECAY", diffusion: "ROUTE_DIFFUSION" },
    food: { decay: "FOOD_DECAY", diffusion: "FOOD_DIFFUSION" },
    visited: { decay: "VISITED_DECAY", diffusion: null },
};

/** Hard ceiling per cell so repeated deposits can't grow without bound. */
const MAX_FIELD = 50;

export class SignalFields {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.grids = {};
        for (const kind of Object.keys(SIGNALS)) {
            this.grids[kind] = new Float32Array(width * height);
        }
        this._scratch = new Float32Array(width * height);
    }

    /** Deposit `amount` of a signal at a world position (clamped). */
    deposit(kind, wx, wy, amount) {
        const gx = Math.floor(wx),
            gy = Math.floor(wy);
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return;
        const i = gy * this.width + gx;
        const grid = this.grids[kind];
        grid[i] = Math.min(MAX_FIELD, grid[i] + amount);
    }

    /** Signal value at a world position. */
    sample(kind, wx, wy) {
        const gx = Math.floor(wx),
            gy = Math.floor(wy);
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return 0;
        return this.grids[kind][gy * this.width + gx];
    }

    /**
     * The strongest cell of a signal within `radius` tiles of a world
     * position.  Returns { x, y, value } (cell centre) or null when the
     * strongest value is below `min`.
     */
    strongestInRadius(kind, wx, wy, radius, min = 0) {
        const grid = this.grids[kind];
        const cx = Math.floor(wx),
            cy = Math.floor(wy);
        const r = Math.ceil(radius);
        let best = null,
            bestValue = min;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const gx = cx + dx,
                    gy = cy + dy;
                if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) continue;
                const v = grid[gy * this.width + gx];
                if (v > bestValue) {
                    bestValue = v;
                    best = { x: gx + 0.5, y: gy + 0.5, value: v };
                }
            }
        }
        return best;
    }

    /**
     * Like strongestInRadius, but only considers cells closer to (tx, ty)
     * than the caller is — following a trail must make progress toward
     * its destination, not just wander toward any nearby puddle.
     */
    strongestToward(kind, wx, wy, tx, ty, radius, min = 0) {
        const grid = this.grids[kind];
        const cx = Math.floor(wx),
            cy = Math.floor(wy);
        const distHere = Math.hypot(tx - wx, ty - wy);
        const r = Math.ceil(radius);
        let best = null,
            bestValue = min;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const gx = cx + dx,
                    gy = cy + dy;
                if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) continue;
                if (Math.hypot(tx - (gx + 0.5), ty - (gy + 0.5)) >= distHere) continue;
                const v = grid[gy * this.width + gx];
                if (v > bestValue) {
                    bestValue = v;
                    best = { x: gx + 0.5, y: gy + 0.5, value: v };
                }
            }
        }
        return best;
    }

    /**
     * Erase a signal around a world position — used when an objective is
     * destroyed, so its attraction dies with it instead of decaying over
     * minutes while the swarm marches on a corpse.
     */
    clearAround(kind, wx, wy, radius) {
        const grid = this.grids[kind];
        const cx = Math.floor(wx),
            cy = Math.floor(wy);
        const r = Math.ceil(radius);
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const gx = cx + dx,
                    gy = cy + dy;
                if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) continue;
                grid[gy * this.width + gx] = 0;
            }
        }
    }

    /**
     * One field update: every cell decays, then spreads a fraction of its
     * value to its 4 neighbours (diffusion).  Decay is what makes stale
     * routes fade and dead victims stop rallying the swarm.
     */
    tick(params) {
        for (const [kind, spec] of Object.entries(SIGNALS)) {
            const grid = this.grids[kind];
            const decay = params[spec.decay];
            const spread = spec.diffusion ? params[spec.diffusion] : 0;
            for (let i = 0; i < grid.length; i++) grid[i] *= decay;
            if (spread > 0) this._diffuse(grid, spread);
        }
    }

    _diffuse(grid, spread) {
        const w = this.width,
            h = this.height,
            out = this._scratch;
        out.set(grid);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const give = grid[i] * spread * 0.25;
                if (give <= 0) continue;
                out[i] -= give * 4;
                if (x > 0) out[i - 1] += give;
                if (x < w - 1) out[i + 1] += give;
                if (y > 0) out[i - w] += give;
                if (y < h - 1) out[i + w] += give;
            }
        }
        grid.set(out);
    }
}
