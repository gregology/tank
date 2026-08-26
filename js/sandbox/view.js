/**
 * Sandbox view — top-down debug rendering of a match for tuning.
 *
 * Deliberately separate from the game's isometric renderer: tuning needs
 * to SEE the pheromone fields (their strength and spread), not pretty
 * pixels.  Draws tiles, one signal field as a heat overlay, units
 * (coloured by faction, ringed by their current goal kind), and the
 * faction's discovered objectives.
 *
 * Pure canvas calls over the game state — testable with the recording
 * fakeCtx.
 */

import { TILE_VISUALS, VEHICLES } from "../config.js";

/** Heat colour per signal kind (rgb; alpha comes from field strength). */
export const FIELD_COLORS = {
    trail: "0,210,255",
    route: "255,190,60",
    alarm: "255,60,60",
    food: "80,220,80",
    visited: "120,80,220",
};

/** Goal-kind ring colours — what each bot is currently doing. */
export const GOAL_COLORS = {
    objective: "#7f7",
    rally: "#f66",
    trail: "#6cf",
    convoy: "#fc3",
    hunt: "#f96",
    explore: "#999",
};

/**
 * @param {object} ctx     2D context
 * @param {object} game    the running Game
 * @param {object} opts    { field, factionId, width, height } — field is a
 *                         signal kind or null for no overlay
 */
export function drawSandbox(ctx, game, opts) {
    const map = game.map;
    const scale = Math.min(opts.width / map.width, opts.height / map.height);

    // Tiles
    for (let gy = 0; gy < map.height; gy++) {
        for (let gx = 0; gx < map.width; gx++) {
            ctx.fillStyle = TILE_VISUALS[map.getTile(gx, gy)]?.mapColor ?? "#000";
            ctx.fillRect(gx * scale, gy * scale, scale + 0.5, scale + 0.5);
        }
    }

    // Pheromone heat overlay (one faction's one field).  Alpha scales to
    // the field's CURRENT maximum — tuning changes absolute strengths by
    // orders of magnitude (trail values are ~100× smaller than alarm's),
    // so a fixed scale leaves some fields invisible.  The legend keeps
    // the absolute scale visible; an empty field says so instead of
    // looking broken (trail is literally all-zero before the first
    // objective is discovered).
    if (opts.field) {
        const swarm = game.swarms.get(opts.factionId);
        const grid = swarm?.fields.grids[opts.field];
        let fieldMax = 0;
        if (grid) for (const v of grid) if (v > fieldMax) fieldMax = v;
        if (grid && fieldMax >= 0.05) {
            const rgb = FIELD_COLORS[opts.field] ?? "255,255,255";
            const alphaScale = 0.85 / fieldMax;
            for (let gy = 0; gy < map.height; gy++) {
                for (let gx = 0; gx < map.width; gx++) {
                    const v = grid[gy * map.width + gx];
                    if (v < 0.05) continue;
                    ctx.fillStyle = `rgba(${rgb},${Math.min(0.85, v * alphaScale).toFixed(2)})`;
                    ctx.fillRect(gx * scale, gy * scale, scale + 0.5, scale + 0.5);
                }
            }
        }
        ctx.fillStyle = "#fff";
        ctx.font = "11px monospace";
        ctx.textAlign = "left";
        ctx.fillText(
            fieldMax >= 0.05 ? `${opts.field} (max ${fieldMax.toFixed(2)})` : `${opts.field}: no signal yet`,
            6,
            opts.height - 8,
        );
    }

    // Discovered objectives of the watched faction get a marker
    const swarm = game.swarms.get(opts.factionId);
    if (swarm) {
        ctx.strokeStyle = "#fff";
        for (const obj of swarm.intel.objectives()) {
            ctx.strokeRect(obj.x * scale - 4, obj.y * scale - 4, 8, 8);
        }
    }

    // Units: faction colour dot + goal-kind ring
    for (const t of game.allTanks) {
        if (!t.alive) continue;
        const x = t.x * scale,
            y = t.y * scale;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, scale * (VEHICLES[t.vehicleType]?.size ?? 0.45)), 0, Math.PI * 2);
        ctx.fill();
        const bot = game.getBot(t);
        const kind = bot?.ai.currentGoal?.kind;
        if (kind) {
            ctx.strokeStyle = GOAL_COLORS[kind] ?? "#fff";
            ctx.beginPath();
            ctx.arc(x, y, Math.max(3, scale * 0.7), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Structures (top-down blocks in faction colour)
    for (const s of game.baseStructures) {
        if (!s.alive) continue;
        ctx.fillStyle = s.color;
        for (const pos of s.tilePositions) {
            ctx.fillRect(pos.gx * scale, pos.gy * scale, scale + 0.5, scale + 0.5);
        }
    }
}
