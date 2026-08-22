import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG } from "../js/config.js";
import { Particle, ParticleSystem } from "../js/particles.js";

describe("Particle", () => {
    it("stores constructor state", () => {
        const p = new Particle(1, 2, 0.5, -1, "#fff", 0.8, 3);
        assert.equal(p.x, 1);
        assert.equal(p.y, 2);
        assert.equal(p.vx, 0.5);
        assert.equal(p.vy, -1);
        assert.equal(p.color, "#fff");
        assert.equal(p.lifetime, 0.8);
        assert.equal(p.maxLife, 0.8);
        assert.equal(p.size, 3);
        assert.ok(p.alive);
    });

    it("moves, damps velocity, and ages each update", () => {
        const p = new Particle(0, 0, 10, 0, "#fff", 1.0, 1);
        p.update(0.1);
        assert.ok(p.x >= 0.99 && p.x <= 1.01, `x=${p.x}`);
        assert.equal(p.vx, 9.6); // 10 * 0.96
        assert.equal(p.lifetime, 0.9);
    });

    it("alpha is lifetime fraction and never negative", () => {
        const p = new Particle(0, 0, 0, 0, "#fff", 1.0, 1);
        assert.equal(p.alpha, 1.0);
        p.update(0.25);
        assert.equal(p.alpha, 0.75);
        p.update(5);
        assert.equal(p.alpha, 0);
    });

    it("dies when lifetime expires", () => {
        const p = new Particle(0, 0, 0, 0, "#fff", 0.05, 1);
        p.update(0.1);
        assert.ok(!p.alive);
    });
});

describe("ParticleSystem", () => {
    it("update removes dead particles", () => {
        const sys = new ParticleSystem();
        sys.particles.push(new Particle(0, 0, 0, 0, "#fff", 0.05, 1));
        sys.particles.push(new Particle(0, 0, 0, 0, "#fff", 10, 1));
        sys.update(0.1);
        assert.equal(sys.particles.length, 1);
    });

    it("update survives an empty system", () => {
        const sys = new ParticleSystem();
        assert.doesNotThrow(() => sys.update(0.1));
    });

    it("_add respects MAX_PARTICLES", () => {
        const sys = new ParticleSystem();
        for (let i = 0; i < CONFIG.MAX_PARTICLES + 50; i++) {
            sys._add(0, 0, 0, 0, "#fff", 1, 1);
        }
        assert.equal(sys.particles.length, CONFIG.MAX_PARTICLES);
    });
});

describe("ParticleSystem emitters", () => {
    const expected = [
        ["explosion", 38], // 28 fire + 10 smoke
        ["muzzleFlash", 6],
        ["ifvFlash", 3],
        ["impact", 8],
        ["tinyImpact", 3],
        ["droneExplosion", 24], // 18 fire + 6 smoke
        ["spgFlash", 18], // 12 fire + 6 smoke
        ["artilleryImpact", 38], // 22 fire + 8 debris + 8 smoke
        ["smoke", 1],
    ];

    for (const [effect, count] of expected) {
        it(`${effect} spawns ${count} particles`, () => {
            const sys = new ParticleSystem();
            sys.emit(effect, 0, 0, 0);
            assert.equal(sys.particles.length, count);
            assert.ok(sys.particles.every((p) => p.alive));
        });
    }

    it("unknown effects are a no-op", () => {
        const sys = new ParticleSystem();
        sys.emit("nonsense", 0, 0, 0);
        assert.equal(sys.particles.length, 0);
    });
});
