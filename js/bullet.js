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

        // Arcing shells need enough lifetime to reach their target;
        // normal bullets use the global constant.
        this.lifetime =
            arcing && speed > 0
                ? targetDistance / speed + 1.0 // flight time + margin
                : CONFIG.BULLET_LIFETIME;
        this.distanceTraveled = 0;
        this.landed = false; // true when shell reaches target distance
    }

    update(dt, map) {
        if (!this.alive) return;

        const dx = Math.cos(this.angle) * this.speed * dt;
        const dy = Math.sin(this.angle) * this.speed * dt;
        this.x += dx;
        this.y += dy;
        this.lifetime -= dt;

        if (this.arcing) {
            // Arcing shells fly over terrain — only die by distance or map edge
            this.distanceTraveled += Math.sqrt(dx * dx + dy * dy);
            if (this.distanceTraveled >= this.targetDistance) {
                this.alive = false;
                this.landed = true;
                return;
            }
            if (this.x < -1 || this.x > map.width + 1 || this.y < -1 || this.y > map.height + 1) {
                this.alive = false;
                return;
            }
        } else {
            // Normal bullet: destroyed by solid obstacles
            if (map.blocksProjectile(this.x, this.y)) {
                this.alive = false;
                return;
            }
            if (this.x < -1 || this.x > map.width + 1 || this.y < -1 || this.y > map.height + 1) {
                this.alive = false;
                return;
            }
        }

        // Timeout
        if (this.lifetime <= 0) this.alive = false;
    }

    /** Progress through the arc (0 = just fired, 1 = landing). */
    get arcProgress() {
        if (!this.arcing || this.targetDistance <= 0) return 0;
        return Math.min(1, this.distanceTraveled / this.targetDistance);
    }
}
