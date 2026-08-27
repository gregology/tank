import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TILE_PROPS } from "../js/config.js";
import { layRoad, spanningTree } from "../js/map/generation/roads.js";
import { Pathfinder } from "../js/pathfinder.js";
import { customMap, GameMap, randomMap, T, VEHICLES, wallV } from "./helpers.js";

describe("Map generation", () => {
    it("creates a map matching CONFIG dimensions", () => {
        const map = new GameMap();
        assert.equal(map.width, 128);
        assert.equal(map.height, 128);
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
        const map = new GameMap(128, 128, 1.0, undefined, 5); // seeded: an unseeded map flakes the count

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

describe("Villages, bridges, and the road network", () => {
    // Bugs these catch: buildings blocking bridge approaches, multi-lane
    // decks reading as extra roads, and villages without internal streets.
    const riverMap = (seed) => new GameMap(128, 128, 1.0, undefined, seed, "compound");
    const isBldg = (t) =>
        t === T.BLDG_SMALL || t === T.BLDG_MEDIUM || t === T.BLDG_LARGE || t === T.BARN || t === T.SILO;

    it("no building sits within 2 tiles of a bridge span", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const map = riverMap(seed);
            for (const b of map.bridges) {
                for (let y = b.span.y0 - 2; y <= b.span.y1 + 2; y++) {
                    for (let x = b.span.x0 - 2; x <= b.span.x1 + 2; x++) {
                        assert.ok(
                            !isBldg(map.getTile(x, y)),
                            `seed ${seed}: building at ${x},${y} crowds the bridge at ${b.centre.x.toFixed(0)},${b.centre.y.toFixed(0)}`,
                        );
                    }
                }
            }
        }
    });

    it("every bridge is exactly one lane wide", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const map = riverMap(seed);
            for (const b of map.bridges) {
                // count bridge tiles across the channel (the lane axis)
                const cx = Math.floor(b.centre.x),
                    cy = Math.floor(b.centre.y);
                const laneAxis = b.axis === "v" ? [1, 0] : [0, 1];
                let width = 1; // the centre tile
                for (const sign of [-1, 1]) {
                    for (let k = 1; k <= 3; k++) {
                        const t = map.getTile(cx + laneAxis[0] * k * sign, cy + laneAxis[1] * k * sign);
                        if (t === T.BRIDGE_STONE || t === T.BRIDGE_WOOD) width++;
                        else break;
                    }
                }
                assert.equal(
                    width,
                    1,
                    `seed ${seed}: bridge at ${b.centre.x.toFixed(0)},${b.centre.y.toFixed(0)} should be one lane, got ${width}`,
                );
            }
        }
    });

    it("villages are places: streets inside, dense buildings, and many of them", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const map = riverMap(seed);
            let buildings = 0;
            for (const t of map.tiles) if (isBldg(t)) buildings++;
            assert.ok(buildings >= 60, `seed ${seed}: villages should be dense (${buildings} buildings)`);
            // internal streets: village main streets + lanes add junctions
            let junctions = 0;
            for (let y = 1; y < 127; y++) {
                for (let x = 1; x < 127; x++) {
                    if (!map.isRoad(x, y)) continue;
                    let links = 0;
                    for (const [dx, dy] of [
                        [1, 0],
                        [-1, 0],
                        [0, 1],
                        [0, -1],
                    ])
                        if (map.isRoad(x + dx, y + dy)) links++;
                    if (links >= 3) junctions++;
                }
            }
            assert.ok(junctions >= 4, `seed ${seed}: village streets should create junctions (${junctions})`);
        }
    });
});

describe("Road network primitives", () => {
    it("spanningTree connects every node with exactly n-1 edges", () => {
        // Bug caught: a village dropped from the chain becomes an
        // unreachable island of pavement.  n-1 edges + full coverage =
        // a tree.
        const nodes = [
            { x: 0, y: 0 },
            { x: 10, y: 2 },
            { x: 5, y: 12 },
            { x: 20, y: 20 },
            { x: 18, y: 4 },
        ];
        const edges = spanningTree(nodes);
        assert.equal(edges.length, nodes.length - 1, "a tree has n-1 edges");
        const covered = new Set(edges.flat());
        assert.equal(covered.size, nodes.length, "every node is connected");
    });

    it("spanningTree of a single node has no edges", () => {
        assert.deepEqual(spanningTree([{ x: 1, y: 1 }]), []);
    });

    it("roads on open ground never staircase (TT roads run in long straight lines)", () => {
        // Bug caught: A*-laid roads wiggled tile-by-tile toward the
        // target — a pseudo-diagonal that reads as noise on the iso grid.
        // The turn-penalized router runs in long straight segments (8-way:
        // diagonals included, which project as the screen's 0°/90°).
        const map = customMap([]);
        layRoad(map, { x: 10, y: 10 }, { x: 40, y: 25 }, T.TARMAC);
        const road = [];
        for (let y = 0; y < 64; y++)
            for (let x = 0; x < 64; x++) if (map.getTile(x, y) === T.TARMAC) road.push({ x, y });
        assert.ok(road.length > 20, "the road exists");
        // few bends: a road tile is "straight" when two of its road
        // neighbours are opposite each other (N+S, E+W, or a diagonal
        // pair); the router's turn penalty keeps bends rare
        let bends = 0;
        for (const t of road) {
            const has = (dx, dy) => road.some((o) => o.x === t.x + dx && o.y === t.y + dy);
            const straight =
                (has(1, 0) && has(-1, 0)) ||
                (has(0, 1) && has(0, -1)) ||
                (has(1, 1) && has(-1, -1)) ||
                (has(1, -1) && has(-1, 1));
            if (!straight) bends++;
        }
        assert.ok(bends <= 6, `too many bend tiles (${bends}) — the road staircases`);
    });

    it("a road blocked by water falls back to A* and never fords", () => {
        // Bug caught: roads walking straight into the river and resuming
        // on the far bank.  No road tile may sit adjacent to water without
        // a bridge between them.
        const map = customMap(wallV(20, 5, 58, T.SHALLOW_WATER)); // a river channel down the middle
        map.setTile(20, 30, T.BRIDGE_STONE); // one crossing
        layRoad(map, { x: 10, y: 30 }, { x: 30, y: 30 }, T.TARMAC);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                if (map.getTile(x, y) !== T.TARMAC) continue;
                assert.ok(!map.isWaterTile(map.getTile(x, y)), "roads never stamp water");
            }
        }
        // the road crosses via the bridge: tarmac exists on both banks
        let west = false,
            east = false;
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                if (map.getTile(x, y) !== T.TARMAC) continue;
                if (x < 20) west = true;
                if (x > 20) east = true;
            }
        }
        assert.ok(west && east, "the road reaches both banks");
    });

    it("villages pop up along the road network (junctions and ribbon runs)", () => {
        // Bug caught: villages as self-contained grids disconnected from
        // the road map.  Villages now grow on the network: village
        // buildings must sit adjacent to road tiles.
        const map = new GameMap(128, 128, 1.0, undefined, 3, "compound");
        let buildings = 0,
            roadAdjacent = 0;
        for (let y = 1; y < 127; y++) {
            for (let x = 1; x < 127; x++) {
                const t = map.getTile(x, y);
                if (t !== T.BLDG_SMALL && t !== T.BLDG_MEDIUM && t !== T.BLDG_LARGE) continue;
                buildings++;
                const nearRoad = [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                    [2, 0],
                    [-2, 0],
                    [0, 2],
                    [0, -2],
                ].some(([dx, dy]) => map.isRoad(x + dx, y + dy));
                if (nearRoad) roadAdjacent++;
            }
        }
        assert.ok(buildings > 15, `villages exist (${buildings} buildings)`);
        assert.ok(roadAdjacent >= buildings * 0.9, `villages sit on roads (${roadAdjacent}/${buildings})`);
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

    it("every tile declares opacity; sight-blocking is the opaque axis, not solidity", () => {
        // Bug caught: a future tile type (tree lines are opaque but
        // passable, sight-only cover) silently dropping the axis would be
        // see-through forever — and bullets must keep reading `solid`.
        for (const t of Object.values(T)) {
            assert.notEqual(TILE_PROPS[t]?.opaque, undefined, `tile ${t} must declare opaque`);
        }
        // Flat deterministic map — generation could otherwise plant a
        // building on the sampled tile and flake the assertions.
        const map = customMap([]);
        map.setTile(5, 5, T.HILL);
        assert.ok(map.blocksSight(5.5, 5.5), "hills block sight");
        assert.ok(!map.blocksSight(6.5, 5.5), "open ground doesn't");
        assert.ok(!map.blocksProjectile(6.5, 5.5), "…and doesn't stop bullets either");
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
    const countBy = (layout, type) => layout.structures.filter((s) => s.type === type).length;
    const hqTiles = (layout) => layout.structures.find((s) => s.type === "baseHQ").tiles.length;

    it("places compounds far apart (repulsion), with centre-facing entrances", () => {
        // The placement invariants: bases are random per seed but always
        // far apart, and each entrance opens toward the map centre.
        for (let seed = 1; seed <= 5; seed++) {
            const { layouts } = randomMap(128, 128, seed);
            const [l1, l2] = layouts;
            const d = Math.hypot(l2.hqCenter.x - l1.hqCenter.x, l2.hqCenter.y - l1.hqCenter.y);
            assert.ok(d > 60, `seed ${seed}: compounds should be far apart, got ${d.toFixed(0)}`);
            for (const l of [l1, l2]) {
                const toCentre = { x: 64 - l.center.x, y: 64 - l.center.y };
                const dominant =
                    Math.abs(toCentre.x) >= Math.abs(toCentre.y)
                        ? toCentre.x > 0
                            ? "E"
                            : "W"
                        : toCentre.y > 0
                          ? "S"
                          : "N";
                assert.equal(l.dir, dominant, `seed ${seed}: entrance should face the map centre`);
            }
        }
    });

    it("creates sand interior and structure walls", () => {
        const { map, layouts } = randomMap();
        const [l1] = layouts;
        let sandCount = 0;
        let structCount = 0;
        const size = l1.size;
        for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
                const t = map.getTile(l1.ox + dx, l1.oy + dy);
                if (t === T.SAND) sandCount++;
                if (t === T.BASE_STRUCTURE) structCount++;
            }
        }
        assert.ok(sandCount > 20, `compound should have sand interior, got ${sandCount}`);
        assert.ok(structCount > 20, `compound should have structure walls, got ${structCount}`);
    });

    it("clears terrain around bases", () => {
        const { map, layouts } = randomMap();
        const [l1] = layouts;
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

    it("small compound (64x64) has 2 watch towers", () => {
        const { layouts } = randomMap(64, 64);
        const [l1] = layouts;
        assert.equal(countBy(l1, "baseTower"), 2, "should have 2 watch tower positions");
        assert.equal(hqTiles(l1), 2, "HQ should occupy 2 tiles");
        assert.ok(countBy(l1, "baseWall") > 20, `should have many walls, got ${countBy(l1, "baseWall")}`);
    });

    it("medium compound (128x128) has 4 corner towers", () => {
        const { layouts } = randomMap(128, 128);
        const [l1] = layouts;
        assert.equal(countBy(l1, "baseTower"), 4, "should have 4 watch tower positions");
        assert.equal(hqTiles(l1), 2, "HQ should occupy 2 tiles");
        assert.equal(l1.size, 14, "compound size should be 14");
    });

    it("large compound (192x192) has 6 towers and is circular", () => {
        const { layouts } = randomMap(192, 192);
        const [l1] = layouts;
        assert.equal(countBy(l1, "baseTower"), 6, "should have 6 watch tower positions");
        assert.equal(hqTiles(l1), 2, "HQ should occupy 2 tiles");
        assert.equal(l1.size, 21, "compound size should be 21 (diameter of r=10 circle)");
        assert.ok(
            countBy(l1, "baseWall") > 30,
            `circular compound should have many walls, got ${countBy(l1, "baseWall")}`,
        );
    });

    it("base spawn points are fully passable", () => {
        const { map, layouts } = randomMap();
        const [l1] = layouts;
        const s = VEHICLES.tank.size * 0.85;
        for (let i = 0; i < 20; i++) {
            const sp = map.getBaseSpawnPoint(l1.center.x, l1.center.y, l1.half);
            assert.ok(
                map.isPassable(sp.x - s, sp.y - s) &&
                    map.isPassable(sp.x + s, sp.y - s) &&
                    map.isPassable(sp.x - s, sp.y + s) &&
                    map.isPassable(sp.x + s, sp.y + s),
                `spawn (${sp.x.toFixed(1)},${sp.y.toFixed(1)}) should have full clearance`,
            );
        }
    });

    it("base spawn points work for all map sizes", () => {
        const s = VEHICLES.tank.size * 0.85;
        for (const sz of [64, 128, 192]) {
            const { map, layouts } = randomMap(sz, sz);
            const [l1] = layouts;
            for (let i = 0; i < 10; i++) {
                const sp = map.getBaseSpawnPoint(l1.center.x, l1.center.y, l1.half);
                assert.ok(
                    map.isPassable(sp.x - s, sp.y - s) &&
                        map.isPassable(sp.x + s, sp.y - s) &&
                        map.isPassable(sp.x - s, sp.y + s) &&
                        map.isPassable(sp.x + s, sp.y + s),
                    `spawn on ${sz}x${sz} map should be passable`,
                );
            }
        }
    });
});

function roadsNear(map, p) {
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            const t = map.getTile(Math.floor(p.x) + dx, Math.floor(p.y) + dy);
            if (t === T.DIRT || t === T.TARMAC) return true;
        }
    }
    return false;
}

describe("Water features + bridges", () => {
    // Bugs these catch: a map with no river (the choke-point design
    // failing to generate), a missing/extra-narrow bridge, a bridge on
    // the direct base-to-base line (a direct-LoS siege corridor), or
    // bases that become unreachable.
    const riverMap = (seed, size = 128) => {
        const map = new GameMap(size, size, 1.0, undefined, seed, "compound");
        return { map, layouts: map.baseLayouts };
    };
    const waterAt = (map, x, y) => map.isWaterTile(map.getTile(x, y));
    const inlandWaterCount = (map) => {
        // Water beyond the coast band = rivers/lakes/tributaries
        let n = 0;
        const cx = map.width / 2,
            cy = map.height / 2,
            maxR = Math.min(map.width, map.height) / 2 - 1;
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (Math.hypot(x - cx, y - cy) < maxR * 0.8 && map.isWaterTile(map.getTile(x, y))) n++;
            }
        }
        return n;
    };

    it("every map has inland water (at least one river)", () => {
        for (const size of [64, 128, 192]) {
            const { map } = riverMap(3, size);
            assert.ok(inlandWaterCount(map) > 20, `${size}² should have inland water, got ${inlandWaterCount(map)}`);
        }
    });

    it("larger maps get more water (tributaries + lakes)", () => {
        const small = inlandWaterCount(riverMap(3, 64).map);
        const large = inlandWaterCount(riverMap(3, 192).map);
        assert.ok(large > small * 1.5, `larger maps carry more water (${small} → ${large})`);
    });

    it("the river separates the two bases (the direct line crosses water)", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const { map, layouts } = riverMap(seed);
            const [l1, l2] = layouts;
            let crosses = false;
            for (let t = 0.05; t < 0.95; t += 0.02) {
                const x = Math.floor(l1.center.x + (l2.center.x - l1.center.x) * t);
                const y = Math.floor(l1.center.y + (l2.center.y - l1.center.y) * t);
                if (waterAt(map, x, y)) {
                    crosses = true;
                    break;
                }
            }
            assert.ok(crosses, `seed ${seed}: the direct base-to-base line must cross water`);
        }
    });

    it("bridges exist (≥2 clusters), are wide enough for a tank, and none sit on the direct base line", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const { map, layouts } = riverMap(seed);
            const [l1, l2] = layouts;
            let bridges = 0;
            let onDirectLine = 0;
            const minDim = 128 * 0.12;
            for (let y = 0; y < 128; y++) {
                for (let x = 0; x < 128; x++) {
                    if (map.getTile(x, y) !== T.BRIDGE_STONE && map.getTile(x, y) !== T.BRIDGE_WOOD) continue;
                    bridges++;
                    // distance from the base-to-base segment
                    const dx = l2.center.x - l1.center.x,
                        dy = l2.center.y - l1.center.y;
                    const len2 = dx * dx + dy * dy || 1;
                    const t = Math.max(0, Math.min(1, ((x - l1.center.x) * dx + (y - l1.center.y) * dy) / len2));
                    const d = Math.hypot(x - (l1.center.x + dx * t), y - (l1.center.y + dy * t));
                    if (d < minDim) onDirectLine++;
                    // every bridge tile fits a tank and has a bridge neighbour (2-wide)
                    assert.ok(
                        map.canStand(x + 0.5, y + 0.5, VEHICLES.tank.size),
                        `seed ${seed}: bridge at ${x},${y} fits a tank`,
                    );
                }
            }
            assert.ok(bridges >= 4, `seed ${seed}: bridges exist (${bridges} tiles)`);
            assert.equal(onDirectLine, 0, `seed ${seed}: no bridge tiles on the direct base line`);
        }
    });

    it("every bridge span is joined by a road on each bank", () => {
        // Bug caught: bridges stranded without roads read as decoration,
        // not network — and the compounds' entrance road stubs silently
        // no-opped when they ran before any road existed.
        for (let seed = 1; seed <= 5; seed++) {
            const { map } = riverMap(seed);
            assert.ok(map.bridges.length >= 2, `seed ${seed}: bridges recorded`);
            for (const bridge of map.bridges) {
                // A road must visibly lead to the span (either approach).
                let joined = false;
                for (let k = -12; k <= 12 && !joined; k++) {
                    const px = bridge.centre.x + bridge.normal.x * k;
                    const py = bridge.centre.y + bridge.normal.y * k;
                    if (roadsNear(map, { x: px, y: py })) joined = true;
                }
                assert.ok(
                    joined,
                    `seed ${seed}: bridge at ${bridge.centre.x.toFixed(0)},${bridge.centre.y.toFixed(0)} should have a road meeting its span`,
                );
            }
        }
    });

    it("every bridge is axis-aligned and crossable by a tank (no angled spans)", () => {
        // Bug caught: angled bridges left tiles touching corner-to-corner,
        // which the pathfinder's anti-corner-cutting rule refuses —
        // vehicles routed ~200 tiles around the map instead of crossing.
        for (let seed = 1; seed <= 6; seed++) {
            const { map } = riverMap(seed);
            for (const bridge of map.bridges) {
                assert.ok(
                    (bridge.normal.x === 1 && bridge.normal.y === 0) ||
                        (bridge.normal.x === 0 && bridge.normal.y === 1),
                    `seed ${seed}: bridge at ${bridge.centre.x.toFixed(0)},${bridge.centre.y.toFixed(0)} must cross due N/S or E/W`,
                );
                const pf = new Pathfinder(map);
                const path = pf.findPath(bridge.ends[0].x, bridge.ends[0].y, bridge.ends[1].x, bridge.ends[1].y);
                assert.ok(
                    path && path.length <= 20,
                    `seed ${seed}: bridge at ${bridge.centre.x.toFixed(0)},${bridge.centre.y.toFixed(0)} must be a short crossing, got ${path?.length}`,
                );
            }
        }
    });

    it("bases are connected through bridges only (remove bridges → unreachable)", () => {
        for (let seed = 1; seed <= 5; seed++) {
            const { map, layouts } = riverMap(seed);
            const [l1, l2] = layouts;
            const pf = new Pathfinder(map);
            const path = pf.findPath(l1.center.x, l1.center.y, l2.center.x, l2.center.y);
            assert.ok(path, `seed ${seed}: bases connected`);
            assert.ok(
                path.some((w) => {
                    const t = map.getTile(Math.floor(w.x), Math.floor(w.y));
                    return t === T.BRIDGE_STONE || t === T.BRIDGE_WOOD;
                }),
                `seed ${seed}: the route crosses a bridge`,
            );
            const saved = [];
            for (let i = 0; i < map.tiles.length; i++) {
                if (map.tiles[i] === T.BRIDGE_STONE || map.tiles[i] === T.BRIDGE_WOOD) {
                    saved.push([i, map.tiles[i]]);
                    map.tiles[i] = T.SHALLOW_WATER;
                }
            }
            const pf2 = new Pathfinder(map);
            assert.equal(
                pf2.findPath(l1.center.x, l1.center.y, l2.center.x, l2.center.y),
                null,
                `seed ${seed}: without bridges, no land route between the bases`,
            );
            for (const [i, t] of saved) map.tiles[i] = t;
        }
    });
});

describe("Farms: fields, tree lines, barns/silos", () => {
    // Bugs these catch: tree lines that don't block sight (the feature's
    // point), tree lines that block movement/bullets (they're sight-ONLY
    // cover), fields that block anything (purely cosmetic), barns/silos
    // not behaving like buildings, and farms that never generate.

    it("tree lines block sight but not movement or bullets", () => {
        const map = customMap([]);
        map.setTile(5, 5, T.TREE);
        assert.ok(map.blocksSight(5.5, 5.5), "trees block sight");
        assert.ok(!map.blocksProjectile(5.5, 5.5), "bullets pass through trees");
        assert.ok(map.isPassable(5.5, 5.5, VEHICLES.tank.size), "vehicles drive through tree lines");
        assert.ok(map.tileHeight(T.TREE) > 0, "trees join the depth pass (they occlude visually)");
    });

    it("a tree line breaks line-of-sight across it", () => {
        const map = customMap([]);
        for (let y = 2; y <= 8; y++) map.setTile(5, y, T.TREE);
        assert.ok(!map.hasLineOfSight(2.5, 5.5, 8.5, 5.5), "no LOS through the tree line");
        assert.ok(map.hasLineOfSight(2.5, 5.5, 4.5, 5.5), "LOS fine up to the trees");
    });

    it("fields are passable and cosmetic (no gameplay flags)", () => {
        const map = customMap([]);
        map.setTile(5, 5, T.FIELD);
        assert.ok(map.isPassable(5.5, 5.5), "fields are passable");
        assert.ok(!map.blocksSight(5.5, 5.5) && !map.blocksProjectile(5.5, 5.5), "fields block nothing");
    });

    it("barns and silos act like buildings (solid, destructible, squad cover)", () => {
        const map = customMap([]);
        map.setTile(5, 5, T.BARN);
        map.setTile(7, 5, T.SILO);
        for (const [gx, kind] of [
            [5, T.BARN],
            [7, T.SILO],
        ]) {
            assert.ok(!map.isPassable(gx + 0.5, 5.5), "farm buildings block movement");
            assert.ok(map.blocksProjectile(gx + 0.5, 5.5), "farm buildings block bullets");
            assert.ok(map.blocksSight(gx + 0.5, 5.5), "farm buildings block sight");
            assert.ok(map.isIntactBuilding(gx, 5), "farm buildings count as intact buildings (squad cover)");
            assert.ok(TILE_PROPS[kind].hp > 0, "farm buildings are destructible");
        }
    });

    it("farmland districts generate: aligned field patchwork, hedgerows, barns and silos", () => {
        // The aerial-photo invariants: fields exist at district scale,
        // fields are big rectangles (not patches), hedgerow trees hug
        // field borders, and every district has its farm buildings.
        for (let seed = 1; seed <= 5; seed++) {
            const map = new GameMap(128, 128, 1.0, undefined, seed, "compound");
            let fields = 0,
                trees = 0,
                barns = 0,
                silos = 0;
            for (const t of map.tiles) {
                if (t === T.FIELD) fields++;
                if (t === T.TREE) trees++;
                if (t === T.BARN) barns++;
                if (t === T.SILO) silos++;
            }
            assert.ok(
                fields > 80,
                `seed ${seed}: a farmland district exists at meaningful scale (${fields} field tiles)`,
            );
            assert.ok(trees > 60, `seed ${seed}: hedgerows exist (${trees})`);
            assert.ok(barns > 0 && silos > 0, `seed ${seed}: barns + silos exist (${barns}/${silos})`);

            // hedgerows: most trees touch a field
            let bordering = 0;
            for (let y = 0; y < 128; y++) {
                for (let x = 0; x < 128; x++) {
                    if (map.getTile(x, y) !== T.TREE) continue;
                    const touchesField = [
                        [1, 0],
                        [-1, 0],
                        [0, 1],
                        [0, -1],
                    ].some(([dx, dy]) => map.getTile(x + dx, y + dy) === T.FIELD);
                    if (touchesField) bordering++;
                }
            }
            assert.ok(bordering > trees * 0.7, `seed ${seed}: hedgerows border fields (${bordering}/${trees})`);

            // fields are rectangles, not speckle: most field tiles have a
            // field neighbour in the same row AND the same column
            let rect = 0;
            for (let y = 0; y < 128; y++) {
                for (let x = 0; x < 128; x++) {
                    if (map.getTile(x, y) !== T.FIELD) continue;
                    const rowMate = map.getTile(x - 1, y) === T.FIELD || map.getTile(x + 1, y) === T.FIELD;
                    const colMate = map.getTile(x, y - 1) === T.FIELD || map.getTile(x, y + 1) === T.FIELD;
                    if (rowMate && colMate) rect++;
                }
            }
            assert.ok(rect > fields * 0.7, `seed ${seed}: fields form rectangles (${rect}/${fields})`);
        }
    });
});

describe("Consolidated geometry queries", () => {
    it("canStand checks the four corners of the vehicle box", () => {
        const map = new GameMap();
        for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) map.setTile(x, y, T.GRASS);
        assert.equal(map.canStand(5.5, 5.5), true);
        // A blocking tile at one corner (6,6) flips the box at (5.7, 5.7):
        // tank corners (size*0.85 ≈ 0.38) reach tile (6,6).
        map.setTile(6, 6, T.HILL);
        assert.equal(map.canStand(5.7, 5.7), false);
    });

    it("canStand respects the vehicle size argument", () => {
        const map = new GameMap();
        for (let y = 4; y <= 7; y++) for (let x = 4; x <= 8; x++) map.setTile(x, y, T.GRASS);
        map.setTile(7, 5, T.HILL);
        // At (6.7, 5.5) a small vehicle's corners (size*0.85 = 0.085) stay in
        // tile (6,5), but a tank's corners (0.38) reach the hill at (7,5).
        assert.equal(map.canStand(6.7, 5.5, 0.1), true, "small vehicle clears the hill");
        assert.equal(map.canStand(6.7, 5.5, VEHICLES.tank.size), false, "tank reaches the hill corner");
    });

    it("hasLineOfSight is clear across open ground and blocked by a hill", () => {
        const map = new GameMap();
        for (let y = 5; y <= 7; y++) for (let x = 2; x <= 16; x++) map.setTile(x, y, T.GRASS);
        assert.equal(map.hasLineOfSight(2.5, 5.5, 15.5, 5.5), true);
        map.setTile(8, 5, T.HILL);
        assert.equal(map.hasLineOfSight(2.5, 5.5, 15.5, 5.5), false);
    });

    it("hasLineOfSight skipOrigin lets a shooter on a blocking tile see out", () => {
        const map = new GameMap();
        for (let y = 5; y <= 7; y++) for (let x = 2; x <= 16; x++) map.setTile(x, y, T.GRASS);
        // A watch tower sits on a BASE_STRUCTURE tile; without skipping the
        // origin tile it would block its own view.
        map.setTile(5, 5, T.BASE_STRUCTURE);
        assert.equal(map.hasLineOfSight(5.5, 5.5, 15.5, 5.5, { skipOrigin: true }), true);
        assert.equal(map.hasLineOfSight(5.5, 5.5, 15.5, 5.5), false, "origin tile blocks by default");
    });

    it("hasWalkableLine is clear across passable ground and blocked by obstacles", () => {
        const map = new GameMap();
        for (let y = 5; y <= 7; y++) for (let x = 2; x <= 16; x++) map.setTile(x, y, T.GRASS);
        assert.equal(map.hasWalkableLine(2.5, 5.5, 15.5, 5.5), true);
        map.setTile(8, 5, T.HILL);
        assert.equal(map.hasWalkableLine(2.5, 5.5, 15.5, 5.5), false);
    });

    it("hasWalkableLine requires the endpoint tile to be passable", () => {
        const map = new GameMap();
        for (let y = 5; y <= 7; y++) for (let x = 2; x <= 16; x++) map.setTile(x, y, T.GRASS);
        map.setTile(15, 5, T.HILL); // the destination tile itself
        assert.equal(map.hasWalkableLine(2.5, 5.5, 15.5, 5.5), false);
    });
});
