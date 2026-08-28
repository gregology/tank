/**
 * Config-options tests (js/config/options.js).
 *
 * Bugs these catch:
 *   - the map-size list and the map-width → index mapping drifting apart
 *     (a width that no longer resolves to its team-size index),
 *   - an unknown map width falling through to an undefined index instead
 *     of the sane medium default.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAP_SIZES, mapSizeIndexFor } from "../js/config.js";

describe("map sizes", () => {
    it("orders small, medium, large", () => {
        assert.deepEqual(
            MAP_SIZES.map((s) => s.w),
            [64, 128, 192],
        );
    });

    it("maps a map width to its index, defaulting unknown widths to medium", () => {
        assert.equal(mapSizeIndexFor(64), 0);
        assert.equal(mapSizeIndexFor(128), 1);
        assert.equal(mapSizeIndexFor(192), 2);
        assert.equal(mapSizeIndexFor(999), 1);
    });
});
