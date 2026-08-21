import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vehiclesSeparate } from "../js/collision.js";

const v = (vehicleType, team) => ({ vehicleType, team });

describe("vehiclesSeparate (collision policy)", () => {
    it("separates solid vehicles from each other (same or enemy team)", () => {
        assert.equal(vehiclesSeparate(v("tank", 1), v("tank", 1)), true);
        assert.equal(vehiclesSeparate(v("tank", 1), v("ifv", 1)), true);
        assert.equal(vehiclesSeparate(v("tank", 1), v("ifv", 2)), true);
    });

    it("separates squads from squads", () => {
        assert.equal(vehiclesSeparate(v("squad", 1), v("squad", 1)), true);
        assert.equal(vehiclesSeparate(v("squad", 1), v("squad", 2)), true);
    });

    it("keeps friendly vehicles out of their own squads", () => {
        assert.equal(vehiclesSeparate(v("tank", 1), v("squad", 1)), true);
        assert.equal(vehiclesSeparate(v("squad", 2), v("ifv", 2)), true);
    });

    it("lets enemy vehicles drive through squads (run-over)", () => {
        assert.equal(vehiclesSeparate(v("tank", 2), v("squad", 1)), false);
        assert.equal(vehiclesSeparate(v("ifv", 2), v("squad", 1)), false);
        assert.equal(vehiclesSeparate(v("spg", 2), v("squad", 1)), false);
    });

    it("drones fly over ground vehicles but not other drones", () => {
        assert.equal(vehiclesSeparate(v("drone", 1), v("tank", 2)), false);
        assert.equal(vehiclesSeparate(v("drone", 1), v("squad", 2)), false);
        assert.equal(vehiclesSeparate(v("drone", 1), v("drone", 2)), true);
    });
});
