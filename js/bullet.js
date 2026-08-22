/**
 * A projectile fired by a tank.
 *
 * Bullets travel in a straight line, are destroyed on hitting solid
 * terrain (hills / rocks) or after a timeout, and pass freely over
 * water and sand.
 *
 * Each bullet carries a `damage` value (1.0 for tank, 0.25 for IFV)
 * and its own `speed` (IFV bullets travel 1.5× faster).
 */

import { CONFIG, VEHICLES } from "./config.js";
import { getProjectileBehaviour } from "./projectiles/index.js";

export class Bullet {
    /**
     * @param {number} x      world X of the firing tank
     * @param {number} y      world Y of the firing tank
     * @param {number} angle  firing angle (radians)
     * @param {number} owner  player number (1 or 2)
     * @param {number} team   team number (0, 1, or 2)
     * @param {number} damage damage multiplier (1.0 = tank, 0.25 = IFV)
     * @param {number} speed  bullet speed (world-units / second)
     * @param {boolean} arcing       true for SPG shells that arc over terrain
     * @param {number}  targetDistance  range to impact point (arcing only)
     * @param {number}  [lifetime]      explicit lifetime in seconds (defaults
     *                                  to CONFIG.BULLET_LIFETIME; squad weapons
     *                                  use it to enforce their range)
     * @param {string}  [kind]          projectile behaviour key; defaults to
     *                                  "shell" for arcing shots, else "direct"
     * @param {boolean} [tracer]        draw as a small tracer (IFV/small-arms)
     */
    constructor(
        x,
        y,
        angle,
        owner,
        team = 0,
        damage = 1.0,
        speed = VEHICLES.tank.bulletSpeed,
        arcing = false,
        targetDistance = 0,
        lifetime = null,
        kind = null,
        tracer = false,
    ) {
        const offset = CONFIG.TANK_BARREL_LENGTH + 0.08;
        this.x = x + Math.cos(angle) * offset;
        this.y = y + Math.sin(angle) * offset;
        this.angle = angle;
        this.owner = owner;
        this.team = team;
        this.damage = damage;
        this.speed = speed;
        this.alive = true;

        // Arcing shell support (SPG)
        this.arcing = arcing;
        this.targetDistance = targetDistance;
        // Projectile kind dispatches the movement/impact lifecycle
        // (js/projectiles/).  "direct" bullets stop on terrain; "shell" is
        // the arcing artillery shell that splashes on landing.  A caller may
        // pass a `kind` explicitly to add a new projectile behaviour.
        this.kind = kind ?? (arcing ? "shell" : "direct");
        this.tracer = tracer;

        // Arcing shells need enough lifetime to reach their target;
        // normal bullets use the global constant (or an explicit value).
        this.lifetime = lifetime ?? (arcing && speed > 0 ? targetDistance / speed + 1.0 : CONFIG.BULLET_LIFETIME);
        this.distanceTraveled = 0;
        this.landed = false; // true when shell reaches target distance
        this.hitTerrain = false; // true when a direct bullet is stopped by terrain
    }

    update(dt, map) {
        if (!this.alive) return;
        getProjectileBehaviour(this.kind).update(this, dt, map);
    }

    /** Progress through the arc (0 = just fired, 1 = landing). */
    get arcProgress() {
        if (!this.arcing || this.targetDistance <= 0) return 0;
        return Math.min(1, this.distanceTraveled / this.targetDistance);
    }
}
