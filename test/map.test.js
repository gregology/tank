import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameMap, T, VEHICLES } from "./helpers.js";

describe("Map generation", () => {
    it("creates a 64x64 map", () => {
        const map = new GameMap();
        assert.equal(map.width, 64);
        assert.equal(map.height, 64);
    });

    it("generates different maps each time (different seeds)", () => {
        const m1 = new GameMap();
        const m2 = new GameMap();
        assert.notEqual(m1.seed, m2.seed);
    });

    it("has water around the edges", () => {
        const map = new GameMap();
        const corners = [
            [0, 0],
            [63, 0],
            [0, 63],
            [63, 63],
        ];
        for (const [x, y] of corners) {
            const t = map.getTile(x, y);
            assert.ok(t === T.DEEP_WATER || t === T.SHALLOW_WATER, `corner (${x},${y}) should be water, got ${t}`);
        }
    });

    it("has passable terrain in the interior", () => {
        const map = new GameMap();
        let passable = 0;
        for (let y = 16; y < 48; y++) {
            for (let x = 16; x < 48; x++) {
                if (map.isPassable(x + 0.5, y + 0.5)) passable++;
            }
        }
        assert.ok(passable > 200, `interior should have passable tiles, got ${passable}`);
    });

    it("has buildings for cover", () => {
        const map = new GameMap();
        let buildings = 0;
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const t = map.getTile(x, y);
                if (t === T.BLDG_SMALL || t === T.BLDG_MEDIUM || t === T.BLDG_LARGE) buildings++;
            }
        }
        assert.ok(buildings > 15, `should have buildings, got ${buildings}`);
    });
});

describe("Map passability", () => {
    it("grass and sand are passable; structures are not", () => {
        const map = new GameMap();
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const t = map.getTile(x, y);
                if (t === T.GRASS || t === T.DARK_GRASS || t === T.SAND) {
                    assert.ok(map.isPassable(x + 0.5, y + 0.5));
                }
                if (map.isSolid(t) || t === T.DEEP_WATER) {
                    assert.ok(!map.isPassable(x + 0.5, y + 0.5));
                }
            }
        }
    });

    it("solid tiles block projectiles; open tiles do not", () => {
        const map = new GameMap();
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const t = map.getTile(x, y);
                if (map.isSolid(t)) {
                    assert.ok(map.blocksProjectile(x + 0.5, y + 0.5));
                }
                if (t === T.GRASS || t === T.SAND) {
                    assert.ok(!map.blocksProjectile(x + 0.5, y + 0.5));
                }
            }
        }
    });
});

describe("Destructible terrain", () => {
    it("small buildings take 3 hits to destroy", () => {
        const map = new GameMap();
        // Manually place a building to test
        map.setTile(30, 30, T.BLDG_SMALL);
        assert.ok(!map.damageTile(30, 30), "hit 1: not destroyed");
        assert.ok(!map.damageTile(30, 30), "hit 2: not destroyed");
        assert.ok(map.damageTile(30, 30), "hit 3: destroyed");
        assert.equal(map.getTile(30, 30), T.GRASS);
        assert.ok(map.isPassable(30.5, 30.5));
    });

    it("large buildings take 8 hits to destroy", () => {
        const map = new GameMap();
        map.setTile(30, 30, T.BLDG_LARGE);
        for (let i = 0; i < 7; i++) {
            assert.ok(!map.damageTile(30, 30), `hit ${i + 1}: not destroyed`);
        }
        assert.ok(map.damageTile(30, 30), "hit 8: destroyed");
        assert.equal(map.getTile(30, 30), T.GRASS);
    });

    it("getDamageFraction decreases with hits", () => {
        const map = new GameMap();
        map.setTile(30, 30, T.BLDG_MEDIUM); // 5 HP
        assert.equal(map.getDamageFraction(30, 30), 1);
        map.damageTile(30, 30);
        const frac = map.getDamageFraction(30, 30);
        assert.ok(frac > 0 && frac < 1, `fraction should be between 0 and 1, got ${frac}`);
        assert.equal(frac, 4 / 5);
    });

    it("buildings block projectiles and movement", () => {
        const map = new GameMap();
        map.setTile(30, 30, T.BLDG_MEDIUM);
        assert.ok(!map.isPassable(30.5, 30.5), "building should block movement");
        assert.ok(map.blocksProjectile(30.5, 30.5), "building should block bullets");
    });
});

describe("Tower positions", () => {
    it("places towers on opposite sides of the island", () => {
        const map = new GameMap();
        const [tp1, tp2] = map.findTowerPositions();
        const d = Math.hypot(tp2.x - tp1.x, tp2.y - tp1.y);
        assert.ok(d > 20, `towers should be far apart, got ${d.toFixed(0)}`);
    });

    it("creates sand bases around towers", () => {
        const map = new GameMap();
        const [tp1] = map.findTowerPositions();
        const gx = Math.floor(tp1.x),
            gy = Math.floor(tp1.y);
        let sandCount = 0;
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                if (map.getTile(gx + dx, gy + dy) === T.SAND) sandCount++;
            }
        }
        assert.ok(sandCount > 30, `base should have sand, got ${sandCount}`);
    });

    it("clears terrain around bases (radius 10)", () => {
        const map = new GameMap();
        const [tp1] = map.findTowerPositions();
        const gx = Math.floor(tp1.x),
            gy = Math.floor(tp1.y);
        for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
                if (dx * dx + dy * dy > 64) continue;
                const t = map.getTile(gx + dx, gy + dy);
                assert.ok(t !== T.HILL && t !== T.ROCK, `(${gx + dx},${gy + dy}) near base should not be hill/rock`);
            }
        }
    });

    it("clears a direct path between towers", () => {
        const map = new GameMap();
        const [tp1, tp2] = map.findTowerPositions();
        const dx = tp2.x - tp1.x,
            dy = tp2.y - tp1.y;
        const len = Math.hypot(dx, dy);
        const steps = Math.ceil(len * 2);
        let blocked = 0;
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            if (!map.isPassable(tp1.x + dx * t, tp1.y + dy * t)) blocked++;
        }
        assert.equal(blocked, 0, "direct path between towers should be clear");
    });

    it("base spawn points are fully passable", () => {
        const map = new GameMap();
        const [tp1] = map.findTowerPositions();
        const s = VEHICLES.tank.size * 0.85;
        for (let i = 0; i < 20; i++) {
            const sp = map.getBaseSpawnPoint(tp1.x, tp1.y);
            assert.ok(
                map.isPassable(sp.x - s, sp.y - s) &&
                    map.isPassable(sp.x + s, sp.y - s) &&
                    map.isPassable(sp.x - s, sp.y + s) &&
                    map.isPassable(sp.x + s, sp.y + s),
                `spawn (${sp.x.toFixed(1)},${sp.y.toFixed(1)}) should have full clearance`,
            );
        }
    });
});
