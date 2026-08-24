/**
 * Tuning override tests (js/config/overrides.js + js/config/tuning.js).
 *
 * The bugs these tests catch:
 *  - a dotted path silently not applying → --implement writes values that
 *    never reach the game (the whole persistence seam is dead);
 *  - a renamed config key or a typo in the generated file being silently
 *    ignored → the optimizer "adopts" values that tune nothing;
 *  - non-object leaves being treated as nested paths.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOverrides } from "../js/config/overrides.js";
import { TUNING_OVERRIDES } from "../js/config/tuning.js";

describe("applyOverrides", () => {
    it("applies flat and nested dotted paths", () => {
        const target = { a: 1, nested: { b: 2, deep: { c: 3 } } };
        applyOverrides(target, { a: 10, "nested.b": 20, "nested.deep.c": 30 });
        assert.deepEqual(target, { a: 10, nested: { b: 20, deep: { c: 30 } } });
    });

    it("empty overrides are a no-op", () => {
        const target = { a: 1 };
        applyOverrides(target, {});
        assert.equal(target.a, 1);
    });

    it("throws on an unknown path instead of tuning nothing", () => {
        assert.throws(() => applyOverrides({ a: 1 }, { b: 2 }), /unknown tuning override: b/);
        assert.throws(() => applyOverrides({ a: 1 }, { "a.b": 2 }), /unknown tuning override: a\.b/);
    });
});

describe("TUNING_OVERRIDES", () => {
    it("has the CONFIG and VEHICLES tables the config package applies", () => {
        assert.ok(typeof TUNING_OVERRIDES.CONFIG === "object");
        assert.ok(typeof TUNING_OVERRIDES.VEHICLES === "object");
    });
});
