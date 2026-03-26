/**
 * Lightweight particle system for explosions, muzzle flashes, and impacts.
 *
 * Particles live in **world space** so they scroll correctly with the
 * camera; the renderer projects them to screen space.
 */

import { CONFIG } from "./config.js";
import { randomFloat, randomInt } from "./utils.js";

/* ── Single particle ──────────────────────────────────────── */

export class Particle {
    constructor(x, y, vx, vy, color, lifetime, size) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.lifetime = lifetime;
        this.maxLife = lifetime;
        this.size = size;
        this.alive = true;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.96;
        this.vy *= 0.96;
        this.lifetime -= dt;
        if (this.lifetime <= 0) this.alive = false;
    }

    get alpha() {
        return Math.max(0, this.lifetime / this.maxLife);
    }
}

/* ── System that manages many particles ───────────────────── */

export class ParticleSystem {
    constructor() {
        /** @type {Particle[]} */
        this.particles = [];
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            if (!this.particles[i].alive) {
                this.particles.splice(i, 1);
            }
        }
    }

    /* ── emitters ─────────────────────────────────────────── */

    /** Big fiery explosion when a tank is destroyed. */
    emitExplosion(x, y) {
        const fireColors = ["#ff2200", "#ff6600", "#ffaa00", "#ffee66", "#ffffff"];
        for (let i = 0; i < 28; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(1.0, 4.5);
            this._add(
                x,
                y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                fireColors[randomInt(0, fireColors.length - 1)],
                randomFloat(0.3, 1.0),
                randomFloat(2, 6),
            );
        }
        // smoke
        for (let i = 0; i < 10; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(0.4, 2.0);
            const g = randomInt(30, 70);
            this._add(
                x,
                y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                `rgb(${g},${g},${g})`,
                randomFloat(0.6, 1.5),
                randomFloat(3, 7),
            );
        }
    }

    /** Small flash at the barrel tip when firing. */
    emitMuzzleFlash(x, y, angle) {
        const colors = ["#ffcc00", "#ffffff", "#ff8800"];
        for (let i = 0; i < 6; i++) {
            const spread = randomFloat(-0.35, 0.35);
            const s = randomFloat(2, 5);
            this._add(
                x,
                y,
                Math.cos(angle + spread) * s,
                Math.sin(angle + spread) * s,
                colors[randomInt(0, 2)],
                randomFloat(0.08, 0.25),
                randomFloat(1, 3),
            );
        }
    }

    /** Small green flash for IFV autocannon. */
    emitIFVFlash(x, y, angle) {
        const colors = ["#88ff44", "#ccff88", "#ffffff"];
        for (let i = 0; i < 3; i++) {
            const spread = randomFloat(-0.25, 0.25);
            const s = randomFloat(1.5, 3.5);
            this._add(
                x,
                y,
                Math.cos(angle + spread) * s,
                Math.sin(angle + spread) * s,
                colors[randomInt(0, 2)],
                randomFloat(0.05, 0.12),
                randomFloat(1, 2),
            );
        }
    }

    /** Spark when a bullet hits terrain. */
    emitImpact(x, y) {
        const colors = ["#aaaaaa", "#ffcc00", "#ff8800"];
        for (let i = 0; i < 8; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(1, 3);
            this._add(
                x,
                y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                colors[randomInt(0, 2)],
                randomFloat(0.15, 0.4),
                randomFloat(1, 3),
            );
        }
    }

    /** Tiny spark for absorbed partial damage (IFV bullets). */
    emitTinyImpact(x, y) {
        const colors = ["#88cc44", "#aaddaa", "#ccff88"];
        for (let i = 0; i < 3; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(0.5, 1.5);
            this._add(
                x,
                y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                colors[randomInt(0, 2)],
                randomFloat(0.08, 0.2),
                randomFloat(1, 2),
            );
        }
    }

    /** Drone detonation — sharp directional blast with sparks. */
    emitDroneExplosion(x, y) {
        const fireColors = ["#ff4400", "#ff8800", "#ffcc00", "#ffffff"];
        for (let i = 0; i < 18; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(1.5, 5.0);
            this._add(
                x,
                y,
                Math.cos(a) * s,
                Math.sin(a) * s,
                fireColors[randomInt(0, fireColors.length - 1)],
                randomFloat(0.2, 0.6),
                randomFloat(1, 4),
            );
        }
        // Dark smoke from electronics
        for (let i = 0; i < 6; i++) {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(0.3, 1.5);
            this._add(x, y, Math.cos(a) * s, Math.sin(a) * s, "#222", randomFloat(0.5, 1.2), randomFloat(2, 5));
        }
    }

    /** Continuous smoke puff from a damaged tank. */
    emitSmoke(x, y) {
        const g = randomInt(35, 75);
        this._add(
            x,
            y,
            randomFloat(-0.3, 0.3),
            randomFloat(-0.3, 0.3),
            `rgb(${g},${g},${g})`,
            randomFloat(0.4, 0.9),
            randomFloat(2, 5),
        );
    }

    /* ── internal ─────────────────────────────────────────── */

    _add(x, y, vx, vy, color, lifetime, size) {
        if (this.particles.length >= CONFIG.MAX_PARTICLES) return;
        this.particles.push(new Particle(x, y, vx, vy, color, lifetime, size));
    }
}
