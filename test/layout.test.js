import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutViewports } from "../js/layout.js";

describe("layoutViewports", () => {
    it("1 player fills the screen", () => {
        assert.deepEqual(layoutViewports(1, 1000, 500), [{ x: 0, y: 0, w: 1000, h: 500 }]);
    });

    it("2 players are side-by-side, full height", () => {
        assert.deepEqual(layoutViewports(2, 1000, 500), [
            { x: 0, y: 0, w: 500, h: 500 },
            { x: 500, y: 0, w: 500, h: 500 },
        ]);
    });

    it("3 players: centred top + two bottom, equal-sized cells", () => {
        assert.deepEqual(layoutViewports(3, 1000, 500), [
            { x: 250, y: 0, w: 500, h: 250 },
            { x: 0, y: 250, w: 500, h: 250 },
            { x: 500, y: 250, w: 500, h: 250 },
        ]);
    });

    it("4 players: 2×2 grid", () => {
        assert.deepEqual(layoutViewports(4, 1000, 500), [
            { x: 0, y: 0, w: 500, h: 250 },
            { x: 500, y: 0, w: 500, h: 250 },
            { x: 0, y: 250, w: 500, h: 250 },
            { x: 500, y: 250, w: 500, h: 250 },
        ]);
    });

    it("clamps to at most 4 players", () => {
        assert.equal(layoutViewports(9, 1000, 500).length, 4);
    });

    it("clamps to at least 1 player", () => {
        assert.deepEqual(layoutViewports(0, 1000, 500), [{ x: 0, y: 0, w: 1000, h: 500 }]);
    });

    it("every cell is a quarter of the screen for 3 players", () => {
        for (const r of layoutViewports(3, 1000, 500)) {
            assert.equal(r.w, 500);
            assert.equal(r.h, 250);
        }
    });
});
