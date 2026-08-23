/**
 * Lightweight particle system for explosions, muzzle flashes, and impacts.
 *
 * Particles live in **world space** so they scroll correctly with the
 * camera; the renderer projects them to screen space.
 *
 * Effects are data-driven: `EFFECTS` maps an effect key to a list of
 * "bursts" (count, direction mode, colour, speed/life/size ranges), and the
 * single `emit(effect, x, y, angle)` reads that table.  A new visual effect
 * is one table row, not a new hand-rolled loop.
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

/* ── Effect data ──────────────────────────────────────────── */

/**
 * Resolve a burst's colour: a fixed palette pick, a grey ramp, or a
 * brown "dirt" ramp.
 */
function resolveColor(color) {
    if (color.type === "grey") {
        const g = randomInt(color.lo, color.hi);
        return `rgb(${g},${g},${g})`;
    }
    if (color.type === "dirt") {
        const g = randomInt(color.lo, color.hi);
        return `rgb(${g + color.rOff},${g},${g - color.bOff})`;
    }
    return color.colors[randomInt(0, color.colors.length - 1)];
}

/**
 * Effect key → bursts.  Each burst: `count` particles, a `mode` ("radial",
 * "directional", or "drift"), a `color`, and `speed` / `life` / `size`
 * ranges.  "directional" bursts also take a `spread` (radians).
 */
const EFFECTS = {
    explosion: [
        {
            count: 28,
            mode: "radial",
            color: { type: "fixed", colors: ["#ff2200", "#ff6600", "#ffaa00", "#ffee66", "#ffffff"] },
            speed: [1.0, 4.5],
            life: [0.3, 1.0],
            size: [2, 6],
        },
        {
            count: 10,
            mode: "radial",
            color: { type: "grey", lo: 30, hi: 70 },
            speed: [0.4, 2.0],
            life: [0.6, 1.5],
            size: [3, 7],
        },
    ],
    muzzleFlash: [
        {
            count: 6,
            mode: "directional",
            spread: 0.35,
            color: { type: "fixed", colors: ["#ffcc00", "#ffffff", "#ff8800"] },
            speed: [2, 5],
            life: [0.08, 0.25],
            size: [1, 3],
        },
    ],
    ifvFlash: [
        {
            count: 3,
            mode: "directional",
            spread: 0.25,
            color: { type: "fixed", colors: ["#88ff44", "#ccff88", "#ffffff"] },
            speed: [1.5, 3.5],
            life: [0.05, 0.12],
            size: [1, 2],
        },
    ],
    impact: [
        {
            count: 8,
            mode: "radial",
            color: { type: "fixed", colors: ["#aaaaaa", "#ffcc00", "#ff8800"] },
            speed: [1, 3],
            life: [0.15, 0.4],
            size: [1, 3],
        },
    ],
    tinyImpact: [
        {
            count: 3,
            mode: "radial",
            color: { type: "fixed", colors: ["#88cc44", "#aaddaa", "#ccff88"] },
            speed: [0.5, 1.5],
            life: [0.08, 0.2],
            size: [1, 2],
        },
    ],
    droneExplosion: [
        {
            count: 18,
            mode: "radial",
            color: { type: "fixed", colors: ["#ff4400", "#ff8800", "#ffcc00", "#ffffff"] },
            speed: [1.5, 5.0],
            life: [0.2, 0.6],
            size: [1, 4],
        },
        {
            count: 6,
            mode: "radial",
            color: { type: "fixed", colors: ["#222"] },
            speed: [0.3, 1.5],
            life: [0.5, 1.2],
            size: [2, 5],
        },
    ],
    spgFlash: [
        {
            count: 12,
            mode: "directional",
            spread: 0.5,
            color: { type: "fixed", colors: ["#ffaa00", "#ffdd44", "#ffffff", "#ff6600"] },
            speed: [2, 6],
            life: [0.1, 0.4],
            size: [2, 5],
        },
        {
            count: 6,
            mode: "radial",
            color: { type: "grey", lo: 50, hi: 90 },
            speed: [0.5, 2.0],
            life: [0.3, 0.8],
            size: [3, 6],
        },
    ],
    artilleryImpact: [
        {
            count: 22,
            mode: "radial",
            color: { type: "fixed", colors: ["#ff3300", "#ff7700", "#ffbb00", "#ffee66", "#ffffff"] },
            speed: [1.5, 5.0],
            life: [0.3, 0.9],
            size: [2, 6],
        },
        {
            count: 8,
            mode: "radial",
            color: { type: "dirt", lo: 60, hi: 100, rOff: 20, bOff: 20 },
            speed: [0.8, 3.0],
            life: [0.4, 1.0],
            size: [2, 5],
        },
        {
            count: 8,
            mode: "radial",
            color: { type: "grey", lo: 25, hi: 55 },
            speed: [0.3, 1.5],
            life: [0.6, 1.5],
            size: [3, 7],
        },
    ],
    smoke: [
        {
            count: 1,
            mode: "drift",
            color: { type: "grey", lo: 35, hi: 75 },
            speed: [-0.3, 0.3],
            life: [0.4, 0.9],
            size: [2, 5],
        },
    ],
};

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

    /** Emit a named effect at (x, y); `angle` is for directional bursts. */
    emit(effect, x, y, angle = 0) {
        for (const burst of EFFECTS[effect] ?? []) {
            for (let i = 0; i < burst.count; i++) {
                this._spawnBurst(x, y, angle, burst);
            }
        }
    }

    _spawnBurst(x, y, angle, burst) {
        const color = resolveColor(burst.color);
        const life = randomFloat(burst.life[0], burst.life[1]);
        const size = randomFloat(burst.size[0], burst.size[1]);

        let vx;
        let vy;
        if (burst.mode === "directional") {
            const a = angle + randomFloat(-burst.spread, burst.spread);
            const s = randomFloat(burst.speed[0], burst.speed[1]);
            vx = Math.cos(a) * s;
            vy = Math.sin(a) * s;
        } else if (burst.mode === "drift") {
            vx = randomFloat(burst.speed[0], burst.speed[1]);
            vy = randomFloat(burst.speed[0], burst.speed[1]);
        } else {
            const a = randomFloat(0, Math.PI * 2);
            const s = randomFloat(burst.speed[0], burst.speed[1]);
            vx = Math.cos(a) * s;
            vy = Math.sin(a) * s;
        }

        this._add(x, y, vx, vy, color, life, size);
    }

    /* ── internal ─────────────────────────────────────────── */

    _add(x, y, vx, vy, color, lifetime, size) {
        if (this.particles.length >= CONFIG.MAX_PARTICLES) return;
        this.particles.push(new Particle(x, y, vx, vy, color, lifetime, size));
    }
}
