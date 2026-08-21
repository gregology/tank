import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Camera } from "../js/camera.js";

describe("Camera", () => {
    it("starts at origin with default smoothing", () => {
        const cam = new Camera();
        assert.equal(cam.x, 0);
        assert.equal(cam.y, 0);
        assert.equal(cam.smoothing, 2.5);
    });

    it("setPosition jumps instantly", () => {
        const cam = new Camera();
        cam.setPosition(100, -50);
        assert.equal(cam.x, 100);
        assert.equal(cam.y, -50);
    });

    it("follow moves toward the target each frame", () => {
        const cam = new Camera();
        cam.setPosition(0, 0);
        cam.follow(100, 0, 0.1); // t = 0.25
        assert.equal(cam.x, 25);
        assert.equal(cam.y, 0);
        cam.follow(100, 0, 0.1);
        assert.equal(cam.x, 43.75);
    });

    it("follow clamps the blend factor at 1 (snaps for large dt)", () => {
        const cam = new Camera();
        cam.setPosition(10, 10);
        cam.follow(40, 60, 5); // t = min(1, 12.5) = 1
        assert.equal(cam.x, 40);
        assert.equal(cam.y, 60);
    });

    it("follow is a no-op when already at the target", () => {
        const cam = new Camera();
        cam.setPosition(5, 5);
        cam.follow(5, 5, 0.1);
        assert.equal(cam.x, 5);
        assert.equal(cam.y, 5);
    });
});
