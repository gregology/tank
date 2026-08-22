/**
 * Arcing-shell projectile behaviour (SPG artillery).
 *
 * A shell flies over terrain and dies only when it reaches its target
 * distance (landing), leaves the map, or times out.  On landing it applies
 * radial splash damage via the shared `applyBlast` primitive plus the
 * impact-tile damage and the artillery impact particle/event.
 */

import { VEHICLES } from "../config.js";
import { GAME_EVENTS } from "../events.js";
import { applyBlast } from "../vehicles/aoe.js";

export const shell = {
    update(b, dt, map) {
        const dx = Math.cos(b.angle) * b.speed * dt;
        const dy = Math.sin(b.angle) * b.speed * dt;
        b.x += dx;
        b.y += dy;
        b.lifetime -= dt;
        b.distanceTraveled += Math.hypot(dx, dy);

        // Shells fly over terrain — only die by distance, map edge, or timeout.
        if (b.distanceTraveled >= b.targetDistance) {
            b.alive = false;
            b.landed = true;
            return;
        }
        if (b.x < -1 || b.x > map.width + 1 || b.y < -1 || b.y > map.height + 1) {
            b.alive = false;
            return;
        }
        if (b.lifetime <= 0) b.alive = false;
    },

    /** Artillery splash: radial damage to tanks and structures, then the impact tile. */
    onLand(game, b) {
        applyBlast(game, b.x, b.y, VEHICLES.spg.splashRadius, b.damage, b.team);
        game.damageTileAt(Math.floor(b.x), Math.floor(b.y), b.damage);
        game.particles.emit("artilleryImpact", b.x, b.y);
        game.emit(GAME_EVENTS.ARTILLERY_IMPACT, { bullet: b });
    },
};
