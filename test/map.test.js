import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameMap, T, VEHICLES } from "./helpers.js";

describe("Map generation", () => {
    it("creates a map matching CONFIG dimensions", () => {
        const map = new GameMap();
        assert.equal(map.width, 100);
        assert.equal(map.height, 100);
    });

    it("generates different maps each time (different seeds)", () => {
        const m1 = new GameMap();
        const m2 = new GameMap();
        assert.notEqual(m1.seed, m2.seed);
    });

    it("has water around the edges", () => {
        const map = new GameMap();
        const last = map.width - 1;
        const corners = [
            [0, 0],
            [last, 0],
            [0, last],
            [last, last],
        ];
        for (const [x, y] of corners) {
            const t = map.getTile(x, y);
            assert.ok(t === T.DEEP_WATER || t === T.SHALLOW_WATER, `corner (${x},${y}) should be water, got ${t}`);
        }
    });

    it("has passable terrain in the interior", () => {
        const map = new GameMap();
        let passable = 0;
        const q1 = Math.floor(map.width * 0.25),
            q3 = Math.floor(map.width * 0.75);
        for (let y = q1; y < q3; y++) {
            for (let x = q1; x < q3; x++) {
                if (map.isPassable(x + 0.5, y + 0.5)) passable++;
            }
        }
        assert.ok(passable > 200, `interior should have passable tiles, got ${passable}`);
    });

    it("has buildings for cover", () => {
        const map = new GameMap();
        let buildings = 0;
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
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
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
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
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
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

describe("Base compounds", () => {
    it("places compounds on opposite sides of the island", () => {
        const map = new GameMap();
        const [l1, l2] = map.buildBaseCompounds();
        const d = Math.hypot(l2.hqCenter.x - l1.hqCenter.x, l2.hqCenter.y - l1.hqCenter.y);
        assert.ok(d > 15, `compounds should be far apart, got ${d.toFixed(0)}`);
    });

    it("creates sand interior and structure walls", () => {
        const map = new GameMap();
        const [l1] = map.buildBaseCompounds();
        let sandCount = 0;
        let structCount = 0;
        for (let dy = 0; dy < 10; dy++) {
            for (let dx = 0; dx < 10; dx++) {
                const t = map.getTile(l1.ox + dx, l1.oy + dy);
                if (t === T.SAND) sandCount++;
                if (t === T.BASE_STRUCTURE) structCount++;
            }
        }
        assert.ok(sandCount > 20, `compound should have sand interior, got ${sandCount}`);
        assert.ok(structCount > 20, `compound should have structure walls, got ${structCount}`);
    });

    it("clears terrain around bases", () => {
        const map = new GameMap();
        const [l1] = map.buildBaseCompounds();
        const gx = Math.floor(l1.center.x),
            gy = Math.floor(l1.center.y);
        for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
                if (dx * dx + dy * dy > 64) continue;
                const t = map.getTile(gx + dx, gy + dy);
                assert.ok(
                    t !== T.HILL && t !== T.ROCK && t !== T.BLDG_SMALL && t !== T.BLDG_MEDIUM && t !== T.BLDG_LARGE,
                    `(${gx + dx},${gy + dy}) near base should be clear of terrain`,
                );
            }
        }
    });

    it("compound has 2 watch tower positions and entrance gap", () => {
        const map = new GameMap();
        const [l1] = map.buildBaseCompounds();
        assert.equal(l1.towers.length, 2, "should have 2 watch tower positions");
        assert.equal(l1.hqTiles.length, 2, "HQ should occupy 2 tiles");
        assert.ok(l1.walls.length > 20, `should have many walls, got ${l1.walls.length}`);
    });

    it("base spawn points are fully passable", () => {
        const map = new GameMap();
        const [l1] = map.buildBaseCompounds();
        const s = VEHICLES.tank.size * 0.85;
        for (let i = 0; i < 20; i++) {
            const sp = map.getBaseSpawnPoint(l1.center.x, l1.center.y);
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
