import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clamp, distance, lerp, normalizeAngle, randomFloat, randomInt, worldToScreen } from "../js/utils.js";

describe("Isometric projection", () => {
    it("worldToScreen maps the world origin to the screen origin", () => {
        const s = worldToScreen(0, 0);
        assert.equal(s.x, 0);
        assert.equal(s.y, 0);
    });

    it("worldToScreen projects the world axes onto the screen diagonals", () => {
        const right = worldToScreen(1, 0);
        const down = worldToScreen(0, 1);
        // +x and +y both move down-screen; +x drifts right, +y drifts left
        assert.ok(right.x > 0 && right.y > 0);
        assert.ok(down.x < 0 && down.y > 0);
    });
});

describe("Math utilities", () => {
    it("clamp constrains values", () => {
        assert.equal(clamp(5, 0, 10), 5);
        assert.equal(clamp(-1, 0, 10), 0);
        assert.equal(clamp(20, 0, 10), 10);
    });

    it("lerp interpolates", () => {
        assert.equal(lerp(0, 10, 0.5), 5);
        assert.equal(lerp(0, 10, 0), 0);
        assert.equal(lerp(0, 10, 1), 10);
    });

    it("distance computes Euclidean distance", () => {
        assert.equal(distance(0, 0, 3, 4), 5);
        assert.equal(distance(1, 1, 1, 1), 0);
    });

    it("normalizeAngle wraps to [0, 2π)", () => {
        assert.ok(normalizeAngle(-Math.PI) >= 0);
        assert.ok(normalizeAngle(3 * Math.PI) < Math.PI * 2);
        assert.ok(Math.abs(normalizeAngle(0) - 0) < 0.001);
    });

    it("randomInt returns integers in range", () => {
        for (let i = 0; i < 50; i++) {
            const v = randomInt(3, 7);
            assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
        }
    });

    it("randomFloat returns floats in range", () => {
        for (let i = 0; i < 50; i++) {
            const v = randomFloat(1.0, 2.0);
            assert.ok(v >= 1.0 && v <= 2.0);
        }
    });
});
