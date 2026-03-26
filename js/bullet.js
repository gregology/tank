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

import { CONFIG } from "./config.js";

export class Bullet {
    /**
     * @param {number} x      world X of the firing tank
     * @param {number} y      world Y of the firing tank
     * @param {number} angle  firing angle (radians)
     * @param {number} owner  player number (1 or 2)
     * @param {number} team   team number (0, 1, or 2)
     * @param {number} damage damage multiplier (1.0 = tank, 0.25 = IFV)
     * @param {number} speed  bullet speed (world-units / second)
     */
    constructor(x, y, angle, owner, team = 0, damage = 1.0, speed = CONFIG.BULLET_SPEED) {
        const offset = CONFIG.TANK_BARREL_LENGTH + 0.08;
        this.x = x + Math.cos(angle) * offset;
        this.y = y + Math.sin(angle) * offset;
        this.angle = angle;
        this.owner = owner;
        this.team = team;
        this.damage = damage;
        this.speed = speed;
        this.alive = true;
        this.lifetime = CONFIG.BULLET_LIFETIME;
    }

    update(dt, map) {
        if (!this.alive) return;

        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;
        this.lifetime -= dt;

        // Destroyed by solid obstacles
        if (map.blocksProjectile(this.x, this.y)) {
            this.alive = false;
            return;
        }

        // Off the map edge
        if (this.x < -1 || this.x > map.width + 1 || this.y < -1 || this.y > map.height + 1) {
            this.alive = false;
            return;
        }

        // Timeout
        if (this.lifetime <= 0) this.alive = false;
    }
}
