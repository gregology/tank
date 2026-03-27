import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    clamp,
    distance,
    lerp,
    normalizeAngle,
    randomFloat,
    randomInt,
    screenToWorld,
    worldDirToScreen,
    worldToScreen,
} from "../js/utils.js";

describe("Isometric projection", () => {
    it("worldToScreen round-trips with screenToWorld", () => {
        const wx = 10,
            wy = 20;
        const s = worldToScreen(wx, wy);
        const w = screenToWorld(s.x, s.y);
        assert.ok(Math.abs(w.x - wx) < 0.001);
        assert.ok(Math.abs(w.y - wy) < 0.001);
    });

    it("worldDirToScreen returns screen-space direction", () => {
        const d = worldDirToScreen(1, 0);
        assert.ok(typeof d.x === "number");
        assert.ok(typeof d.y === "number");
        assert.ok(d.x !== 0 || d.y !== 0);
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
