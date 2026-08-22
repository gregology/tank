/**
 * Collision-interaction systems — separation, structure push-out, and
 * run-over resolution.
 *
 * These three passes used to live as `Game._separatePairs` /
 * `Game.pushFromStructures` / `Game._resolveCrushes`.  The separation
 * *policy* (which pairs separate) stays a pure function in
 * `js/collision.js`; this module owns the *math* that applies it, plus
 * the structure push-out and the capability-based crush interaction.
 */

import { vehiclesSeparate } from "../collision.js";
import { VEHICLES } from "../config.js";
import { GAME_EVENTS } from "../events.js";
import { distance } from "../utils.js";

/** Push overlapping solid vehicles apart so they don't overlap. */
export function separatePairs(game, tanks) {
    const alive = tanks.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
            const a = alive[i],
                b = alive[j];
            if (!vehiclesSeparate(a, b)) continue;
            const d = distance(a.x, a.y, b.x, b.y);
            const min = VEHICLES[a.vehicleType].size + VEHICLES[b.vehicleType].size;
            if (d < min && d > 0.001) {
                const o = (min - d) / 2;
                const nx = (b.x - a.x) / d,
                    ny = (b.y - a.y) / d;
                const ax = a.x - nx * o,
                    ay = a.y - ny * o;
                const bx = b.x + nx * o,
                    by = b.y + ny * o;
                if (game.map.canStand(ax, ay, VEHICLES[a.vehicleType].size)) {
                    a.x = ax;
                    a.y = ay;
                }
                if (game.map.canStand(bx, by, VEHICLES[b.vehicleType].size)) {
                    b.x = bx;
                    b.y = by;
                }
            }
        }
    }
}

/** Push ground vehicles out of the tiles occupied by base structures. */
export function pushFromStructures(game) {
    for (const t of game.allTanks) {
        if (!t.alive || t.flies) continue;
        for (const s of game.baseStructures) {
            if (!s.alive) continue;
            for (const pos of s.tilePositions) {
                const sx = pos.gx + 0.5,
                    sy = pos.gy + 0.5;
                const d = distance(t.x, t.y, sx, sy);
                const min = VEHICLES[t.vehicleType].size + 0.5;
                if (d < min && d > 0.001) {
                    const nx = (t.x - sx) / d;
                    const ny = (t.y - sy) / d;
                    const newX = sx + nx * min;
                    const newY = sy + ny * min;
                    if (game.map.canStand(newX, newY)) {
                        t.x = newX;
                        t.y = newY;
                    }
                }
            }
        }
    }
}

/**
 * Ground vehicles run over exposed (non-dug-in) infantry.  The interaction
 * is expressed through capabilities (`canCrush` vs `crushable`) rather than
 * unit-class checks, so a new soft or crushing unit inherits it.
 */
export function resolveCrushes(game) {
    for (const target of game.allTanks) {
        if (!target.alive || !target.crushable) continue;

        for (const v of game.allTanks) {
            if (!v.alive || v.team === target.team || !v.canCrush) continue;

            const idx = target.crushedMemberBy(v);
            if (idx < 0) continue;

            if (target.crushMember(idx)) {
                target.kill();
                game.particles.emit("explosion", target.x, target.y);
                game.emit(GAME_EVENTS.DESTROY, { entity: target });
                game.mode.onKill(game, v.team, target);
            }
        }
    }
}
