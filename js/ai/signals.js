/**
 * Pheromone signal fields — the shared per-faction swarm state.
 *
 * Each faction owns one SignalFields instance: a set of tile-grid
 * overlays (one per channel) that friendly vehicles deposit into and
 * read from.  The channels mimic colony-insect pheromones:
 *
 *   recruit — "follow me": emitted by every vehicle; strong emitters
 *             (tanks, humans) become convoy spearheads.
 *   trail   — "this way to the objective": laid by vehicles whose
 *             faction knows an objective.  Deposit strength falls off
 *             with the depositor's journey length and each tile keeps
 *             only the strongest deposit, so a shorter route always
 *             out-competes a longer one and decay forgets the loser.
 *   alarm   — "I'm under attack": broadcast by a hit vehicle at its own
 *             position, so the signal tracks a retreating victim and
 *             vanishes the moment it is destroyed or escapes.
 *   food    — "objective here": a beacon at each known enemy objective;
 *             needs constant refresh, so it fades quickly once the
 *             objective is destroyed.
 *
 * Deposits are rates (strength × dt); decay is a per-channel half-life.
 * The fields are read by the swarm arbitration (js/ai/arbitration.js).
 */

import { CONFIG } from "../config.js";

export const SIGNAL_CHANNELS = Object.freeze(["recruit", "trail", "alarm", "food"]);

export class SignalFields {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this._grids = {};
        for (const channel of SIGNAL_CHANNELS) {
            this._grids[channel] = new Float32Array(width * height);
        }
    }

    /** Tile index for a world position, or -1 when off the map. */
    _index(wx, wy) {
        const gx = Math.floor(wx),
            gy = Math.floor(wy);
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return -1;
        return gy * this.width + gx;
    }

    /** Add to a tile (rate-based channels), capped at SIGNAL_MAX. */
    deposit(channel, wx, wy, amount) {
        const i = this._index(wx, wy);
        if (i < 0) return;
        const grid = this._grids[channel];
        grid[i] = Math.min(grid[i] + amount, CONFIG.SIGNAL_MAX);
    }

    /** Keep only the strongest deposit (the trail channel — a tile on a
     *  shorter route must never be diluted by traffic on a longer one). */
    depositMax(channel, wx, wy, amount) {
        const i = this._index(wx, wy);
        if (i < 0) return;
        const grid = this._grids[channel];
        if (amount > grid[i]) grid[i] = amount;
    }

    /** Field value at a world position (0 off the map). */
    valueAt(channel, wx, wy) {
        const i = this._index(wx, wy);
        return i < 0 ? 0 : this._grids[channel][i];
    }

    /** Exponential decay: every channel halves per its CONFIG half-life. */
    decay(dt) {
        for (const channel of SIGNAL_CHANNELS) {
            const halfLife = CONFIG.SIGNAL_HALFLIVES[channel];
            const factor = 0.5 ** (dt / halfLife);
            const grid = this._grids[channel];
            for (let i = 0; i < grid.length; i++) grid[i] *= factor;
        }
    }
}
