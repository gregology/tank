/**
 * Render-package tests.
 *
 * What these catch (see test/AGENTS.md — name the bug before writing the
 * test):
 *
 * 1. Depth-sort contract — a regression in `collectDepthItems` (flat tiles
 *    leaking into the sorted pass, wrong bucket for elevated tiles, lost
 *    drone +2 bonus, wrong within-bucket order) is the highest-risk visual
 *    bug in the codebase and the one the split could introduce.
 * 2. No-throw smoke — every draw entry point runs against a recording 2D
 *    context without throwing, for every tile type, vehicle type, damage
 *    state, HUD state, and game type.  A refactor that breaks drawing
 *    (wrong arg order, missing field on the sprite contract, bad import)
 *    fails here instead of being found by playing the game.
 * 3. Sprite guards — dead/hidden tanks draw nothing (the alive/flash
 *    guard must stay in front of every vehicle sprite).
 *
 * The game objects passed to the renderers are hand-built fixtures using
 * real entities (Tank, Bullet, BaseWall…), so the render package is
 * exercised through its documented seam — the shape of `Game`'s accessors
 * — without dragging the whole match simulation into the coverage report.
 * The fake 2D context is deliberately not pixel-accurate: these are
 * contract tests, not golden-image tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG, TILES as T, VEHICLES } from "../js/config.js";
import { drawMenuVehicle } from "../js/menu/background.js";
import { drawBuilding } from "../js/render/buildings.js";
import { drawArcingBullet, drawBullet, drawParticle } from "../js/render/effects.js";
import { drawBattleHUD, drawScoreHUD } from "../js/render/hud.js";
import { drawMinimap } from "../js/render/minimap.js";
import { drawGameOver, drawTargetIndicator } from "../js/render/overlay.js";
import { drawBaseHQ, drawBaseStructure } from "../js/render/structures.js";
import { drawTile } from "../js/render/tiles.js";
import { drawVehicle } from "../js/render/vehicles.js";
import { collectDepthItems, drawDepthBuckets, drawViewportBorders, renderViewport } from "../js/render/viewport.js";
import { Renderer } from "../js/renderer.js";
import { BaseHQ, BaseWall, BaseWatchTower, Bullet, customMap, fakeCtx } from "./helpers.js";

/* ── helpers ──────────────────────────────────────────────── */

/** A fake tank in the same shape menu.js feeds drawVehicle. */
function fakeTank(vehicleType, overrides = {}) {
    return {
        alive: true,
        flashTimer: 0,
        vehicleType,
        angle: 0.7,
        turretWorld: 1.1,
        color: "#cc3333",
        darkColor: "#882222",
        damaged: false,
        leftTrackDisabled: false,
        rightTrackDisabled: false,
        turretDisabled: false,
        recoilTimer: 0,
        treadPhase: 0.4,
        isCharging: false,
        chargeTime: 0,
        x: 0,
        y: 0,
        team: 1,
        flies: VEHICLES[vehicleType]?.unitClass === "air",
        ...overrides,
    };
}

/** A game-like fixture in the exact shape the render package consumes. */
function gameFixture(overrides = {}) {
    return {
        map: customMap([]),
        gameTime: 0,
        allTanks: [],
        baseStructures: [],
        bullets: [],
        particles: { particles: [] },
        bases: [],
        _bots: [],
        factions: [],
        scores: new Map(),
        factionLabel: (id) => (id === 1 ? "P1" : "BOT"),
        gameOver: false,
        winner: null,
        winnerLabel: "",
        winnerColor: "#888",
        ...overrides,
    };
}

/** A base-compound marker as the minimap/HUD read it. */
function baseFixture(team, overrides = {}) {
    return {
        team,
        color: team === 1 ? "#cc3333" : "#3366dd",
        origin: { x: 20, y: 20 },
        compoundSize: 10,
        hq: { alive: true, hp: 50, maxHp: 100, x: 22, y: 22 },
        ...overrides,
    };
}

/** Every tile type that drawTile must handle. */
const ALL_TILES = [
    T.DEEP_WATER,
    T.SHALLOW_WATER,
    T.SAND,
    T.DIRT,
    T.PAVED,
    T.GRASS,
    T.DARK_GRASS,
    T.HILL,
    T.ROCK,
    T.BLDG_SMALL,
    T.BLDG_MEDIUM,
    T.BLDG_LARGE,
];

/* ── 1. The depth-sort contract ───────────────────────────── */

describe("collectDepthItems — two-pass depth-sort contract", () => {
    const items = (buckets) => buckets.flat().filter(Boolean);
    const tileAt = (buckets, gx, gy) => items(buckets).find((i) => i.kind === "tile" && i.gx === gx && i.gy === gy);
    const entitiesAt = (buckets, kind) => items(buckets).filter((i) => i.kind === kind);
    const INF = 1e9; // no culling

    it("puts elevated tiles in bucket gx+gy+1, never flat tiles", () => {
        const map = customMap([
            { x: 5, y: 5, tile: T.HILL },
            { x: 8, y: 8, tile: T.ROCK },
        ]);
        const buckets = collectDepthItems(gameFixture({ map }), -INF, INF, -INF, INF);

        assert.ok(tileAt(buckets, 5, 5), "HILL tile should be collected");
        assert.ok(tileAt(buckets, 8, 8), "ROCK tile should be collected");

        const hill = tileAt(buckets, 5, 5);
        const hillBucket = buckets.findIndex((b) => b?.includes(hill));
        assert.equal(hillBucket, 5 + 5 + 1, "elevated tile depth = gx+gy+1");

        // Every flat tile (GRASS, and any water/sand generated) must stay out.
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                if (map.tileHeight(map.getTile(gx, gy)) === 0) {
                    assert.equal(tileAt(buckets, gx, gy), undefined, `flat tile at (${gx},${gy}) leaked into pass 2`);
                }
            }
        }
    });

    it("sorts entities by world depth; within a bucket tiles come before tanks", () => {
        const map = customMap([{ x: 5, y: 5, tile: T.HILL }]);
        const tanks = [
            { x: 5.5, y: 5.5, vehicleType: "tank", alive: true, respawnTimer: 0 },
            { x: 6.4, y: 6.4, vehicleType: "tank", alive: true, respawnTimer: 0 },
        ];
        const buckets = collectDepthItems(gameFixture({ map, allTanks: tanks }), -INF, INF, -INF, INF);

        // Tank at (5.5,5.5): floor(11) = 11 → same bucket as the hill.
        const bucket11 = buckets[11];
        assert.ok(bucket11, "bucket 11 should exist");
        assert.equal(bucket11[0].kind, "tile", "tile drawn before entities in the same bucket");
        const tankDepths = entitiesAt(buckets, "vehicle").map((i) => i.entity);
        assert.deepEqual(tankDepths.map((t) => `${t.x},${t.y}`).sort(), ["5.5,5.5", "6.4,6.4"]);
        assert.equal(buckets[12]?.length, 1, "tank at (6.4,6.4) → floor(12.8) = bucket 12");
    });

    it("gives drones a +2 depth bonus so they fly above buildings", () => {
        const map = customMap([{ x: 5, y: 5, tile: T.BLDG_LARGE }]);
        const drone = { x: 5.5, y: 5.5, vehicleType: "drone", alive: true, respawnTimer: 0, flies: true };
        const buckets = collectDepthItems(gameFixture({ map, allTanks: [drone] }), -INF, INF, -INF, INF);

        assert.equal(buckets[11]?.length, 1, "building at depth 11");
        const droneBucket = buckets.findIndex((b) => b?.some((i) => i.kind === "vehicle"));
        assert.equal(droneBucket, 11 + 2, "drone gets +2 over its ground depth");
    });

    it("skips dead tanks but draws dead-while-respawning tanks", () => {
        const map = customMap([]);
        const tanks = [
            { x: 10, y: 10, vehicleType: "tank", alive: false, respawnTimer: 0 },
            { x: 20, y: 20, vehicleType: "tank", alive: false, respawnTimer: 2 },
            { x: 30, y: 30, vehicleType: "tank", alive: true, respawnTimer: 0 },
        ];
        const buckets = collectDepthItems(gameFixture({ map, allTanks: tanks }), -INF, INF, -INF, INF);
        const drawn = entitiesAt(buckets, "vehicle").map((i) => i.entity.x);
        assert.deepEqual(
            drawn.sort((a, b) => a - b),
            [20, 30],
        );
    });

    it("culls entities outside the visible area", () => {
        const map = customMap([]);
        const tanks = [
            { x: 5, y: 5, vehicleType: "tank", alive: true, respawnTimer: 0 },
            { x: 500, y: 500, vehicleType: "tank", alive: true, respawnTimer: 0 },
        ];
        // Bounds are screen-space: (5,5) → (0,160); (500,500) → (0,16000).
        const buckets = collectDepthItems(gameFixture({ map, allTanks: tanks }), -40, 140, 120, 240);
        assert.equal(entitiesAt(buckets, "vehicle").length, 1, "far-away tank must be culled");
    });

    it("collects structures, bullets, and particles with their world depth", () => {
        const map = customMap([]);
        const structure = { x: 4, y: 4, alive: true };
        const bullet = { x: 6, y: 6, alive: true };
        const particle = { x: 8, y: 8 };
        const buckets = collectDepthItems(
            gameFixture({
                map,
                baseStructures: [structure],
                bullets: [bullet],
                particles: { particles: [particle] },
            }),
            -INF,
            INF,
            -INF,
            INF,
        );
        assert.equal(
            buckets[8].some((i) => i.kind === "structure"),
            true,
        );
        assert.equal(
            buckets[12].some((i) => i.kind === "bullet"),
            true,
        );
        assert.equal(
            buckets[16].some((i) => i.kind === "particle"),
            true,
        );
    });
});

/* ── 2. Smoke tests — every draw entry point ──────────────── */

describe("tiles smoke", () => {
    it("draws every tile type without throwing", () => {
        for (const tile of ALL_TILES) {
            const { ctx, calls } = fakeCtx();
            const map = customMap([]);
            assert.doesNotThrow(() => drawTile(ctx, { gx: 3, gy: 4, tile, sx: 96, sy: 224 }, 0, map), `tile ${tile}`);
            assert.ok(calls.length > 0, `tile ${tile} should draw`);
        }
    });

    it("draws damage overlays on damaged hills (incl. critical flash)", () => {
        const map = customMap([{ x: 5, y: 5, tile: T.HILL }]);
        map.damageTile(5, 5, CONFIG.HILL_HP * 0.6); // frac 0.4 → overlay, no flash
        const { ctx, calls } = fakeCtx();
        drawTile(ctx, { gx: 5, gy: 5, tile: T.HILL, sx: 0, sy: 0 }, 0, map);
        assert.ok(calls.filter((c) => c === "stroke").length > 0, "cracks should be stroked");

        // Fresh critical map (frac 0.33 ≤ 0.34); time 0.1 → sin(1) ≈ 0.84 > 0.5 → flash fires.
        const crit = customMap([{ x: 5, y: 5, tile: T.HILL }]);
        crit.damageTile(5, 5, CONFIG.HILL_HP * 0.67);
        const { ctx: ctx2, calls: calls2 } = fakeCtx();
        drawTile(ctx2, { gx: 5, gy: 5, tile: T.HILL, sx: 0, sy: 0 }, 0.1, crit);
        // Flash phase off (time 0 → sin(0) = 0): cracks, no flash fill.
        const { ctx: ctx3, calls: calls3 } = fakeCtx();
        drawTile(ctx3, { gx: 5, gy: 5, tile: T.HILL, sx: 0, sy: 0 }, 0, crit);
        assert.ok(calls3.filter((c) => c === "stroke").length > 0, "flash-off critical damage still cracks");
        assert.ok(
            calls2.filter((c) => c === "fill").length > calls3.filter((c) => c === "fill").length,
            "flash-on should add an extra fill over flash-off",
        );
    });
});

describe("buildings smoke", () => {
    const BUILDING_TILES = [T.BLDG_SMALL, T.BLDG_MEDIUM, T.BLDG_LARGE];
    it("draws intact, damaged, and collapsed buildings", () => {
        for (const tile of BUILDING_TILES) {
            for (const frac of [1, 0.7, 0.4]) {
                const { ctx, calls } = fakeCtx();
                assert.doesNotThrow(() => drawBuilding(ctx, 64, 160, tile, frac, 3, 4, 0.1), `${tile} frac=${frac}`);
                assert.ok(calls.length > 0, `${tile} frac=${frac} should draw`);
            }
        }
    });
});

describe("vehicle smoke", () => {
    it("draws every vehicle type without throwing", () => {
        for (const type of ["tank", "ifv", "spg", "drone", "squad"]) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawVehicle(ctx, fakeTank(type), 0, 0), type);
            assert.ok(calls.length > 20, `${type} should issue many draw calls (got ${calls.length})`);
        }
    });

    it("draws nothing for a dead or flash-hidden tank", () => {
        const { ctx: c1, calls: calls1 } = fakeCtx();
        drawVehicle(c1, fakeTank("tank", { alive: false }), 0, 0);
        assert.equal(calls1.length, 0, "dead tank must draw nothing");

        // Guard hides the sprite while sin(flashTimer * 20) > 0 — 0.1 → sin(2) ≈ 0.91 → hidden
        const { ctx: c2, calls: calls2 } = fakeCtx();
        drawVehicle(c2, fakeTank("tank", { flashTimer: 0.1 }), 0, 0);
        assert.equal(calls2.length, 0, "flash-hidden tank must draw nothing");

        // 0.5 → sin(10) ≈ -0.54 → visible
        const { ctx: c3, calls: calls3 } = fakeCtx();
        drawVehicle(c3, fakeTank("tank", { flashTimer: 0.5 }), 0, 0);
        assert.ok(calls3.length > 0, "visible flash-frame tank must draw");
    });

    it("draws damaged, track-disabled, and turret-disabled states", () => {
        const states = [
            { damaged: true },
            { leftTrackDisabled: true },
            { rightTrackDisabled: true },
            { turretDisabled: true },
            { recoilTimer: 0.05 },
        ];
        for (const state of states) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawVehicle(ctx, fakeTank("tank", state), 0, 0), JSON.stringify(state));
            assert.ok(calls.length > 0, JSON.stringify(state));
        }
    });

    it("draws the SPG charge ring, including the full-charge tick", () => {
        const { ctx, calls } = fakeCtx();
        const spg = fakeTank("spg", { isCharging: true, chargeTime: 999 }); // ≥ max charge
        drawVehicle(ctx, spg, 0, 0);
        assert.ok(calls.filter((c) => c === "arc").length >= 2, "charge ring + tick should both arc");
    });

    it("draws squad members in place of the fallback wedge when present", () => {
        const members = [
            { x: 0.3, y: 0, type: "rpg" },
            { x: -0.3, y: 0, type: "mg" },
        ];
        const withMembers = fakeTank("squad", { x: 0, y: 0, aliveMembers: members });
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawVehicle(ctx, withMembers, 0, 0));
        assert.ok(calls.filter((c) => c === "ellipse").length >= members.length, "one shadow per soldier");
    });

    it("draws sandbag rings while digging in and when dug in", () => {
        for (const state of ["diggingIn", "dugIn"]) {
            const { ctx, calls } = fakeCtx();
            const tank = fakeTank("squad", { squad: { digIn: { state } } });
            assert.doesNotThrow(() => drawVehicle(ctx, tank, 0, 0));
            assert.ok(calls.filter((c) => c === "fillRect").length > 0, `${state} should draw sandbags`);
        }
    });
});

describe("structures smoke", () => {
    it("draws wall, tower, and HQ, damaged and intact", () => {
        const wall = new BaseWall(1, "#cc3333", "#882222");
        wall.tilePositions = [{ gx: 10, gy: 10 }];
        const wallDmg = new BaseWall(1, "#cc3333", "#882222");
        wallDmg.tilePositions = [{ gx: 10, gy: 10 }];
        wallDmg.applyDamage(wallDmg.maxHp / 2);

        const tower = new BaseWatchTower(1, "#cc3333", "#882222");
        tower.tilePositions = [{ gx: 10, gy: 10 }];
        const towerDmg = new BaseWatchTower(1, "#cc3333", "#882222");
        towerDmg.tilePositions = [{ gx: 10, gy: 10 }];
        towerDmg.applyDamage(towerDmg.maxHp / 2);

        // HQ through the dispatch (covers the baseHQ case arm) + damaged overlay.
        const hq = new BaseHQ(1, "#cc3333", "#882222");
        hq.tilePositions = [
            { gx: 10, gy: 10 },
            { gx: 11, gy: 10 },
        ];
        const hqDmg = new BaseHQ(1, "#cc3333", "#882222");
        hqDmg.tilePositions = [
            { gx: 10, gy: 10 },
            { gx: 11, gy: 10 },
        ];
        hqDmg.applyDamage(hqDmg.maxHp / 2);

        for (const [label, s] of [
            ["wall", wall],
            ["wall damaged", wallDmg],
            ["tower", tower],
            ["tower damaged", towerDmg],
            ["HQ", hq],
            ["HQ damaged", hqDmg],
        ]) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawBaseStructure(ctx, s, 0, 0, 0.1), label);
            assert.ok(calls.length > 5, `${label} should draw`);
        }
    });

    it("draws the HQ in both orientations with its HP text", () => {
        for (const isHoriz of [true, false]) {
            const hq = new BaseHQ(1, "#cc3333", "#882222");
            hq.tilePositions = isHoriz
                ? [
                      { gx: 0, gy: 0 },
                      { gx: 1, gy: 0 },
                  ]
                : [
                      { gx: 0, gy: 0 },
                      { gx: 0, gy: 1 },
                  ];
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawBaseHQ(ctx, hq, 0, 0, 0.1), `horizontal=${isHoriz}`);
            assert.ok(calls.includes("fillText"), "HQ should print its HP text");
        }
    });
});

describe("effects smoke", () => {
    it("draws tank shells, IFV tracers, arcing shells, and particles", () => {
        const { ctx: c1, calls: calls1 } = fakeCtx();
        drawBullet(c1, new Bullet(10, 10, 0, 1, 1), 64, 128, 0.5);
        assert.ok(calls1.filter((c) => c === "arc").length >= 3, "tank shell: glow + core + centre");

        const { ctx: c2, calls: calls2 } = fakeCtx();
        drawBullet(c2, new Bullet(10, 10, 0, 1, 1, 0.25, 13.5), 64, 128, 0.5);
        assert.ok(calls2.filter((c) => c === "arc").length >= 5, "IFV tracer: trail + glow + core + centre");

        const arcing = new Bullet(10, 10, 0, 1, 1, 1.0, 10, true, 100); // mid-flight arc
        arcing.distanceTraveled = 50;
        assert.equal(arcing.arcProgress, 0.5);
        const { ctx: c3, calls: calls3 } = fakeCtx();
        assert.doesNotThrow(() => drawArcingBullet(c3, arcing, 64, 128, 0.5));
        assert.ok(calls3.length > 10, "arcing shell should draw shadow, shell, and sparks");

        const { ctx: c4, calls: calls4 } = fakeCtx();
        drawParticle(c4, { alpha: 0.5, color: "#fff", size: 4, x: 1, y: 2 }, 64, 128);
        assert.ok(calls4.includes("fillRect"));
    });
});

describe("minimap + HUD smoke", () => {
    it("draws the minimap with every vehicle marker shape", () => {
        const allTanks = ["tank", "ifv", "spg", "drone", "squad"].map((type) =>
            fakeTank(type, { x: 5 + Math.random() * 40, y: 5 + Math.random() * 40 }),
        );
        const game = gameFixture({ allTanks, bases: [baseFixture(1), baseFixture(2)] });
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawMinimap(ctx, game, 1, 0, 0, 400, 300));
        assert.ok(calls.filter((c) => c === "fillRect").length > 10, "minimap should draw tiles");
    });

    it("draws role letters for allied bots on the minimap", () => {
        const botTank = fakeTank("tank", { x: 12, y: 12 });
        const game = gameFixture({
            allTanks: [botTank],
            _bots: [{ tank: botTank, ai: { role: "cavalry" } }],
        });
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawMinimap(ctx, game, 1, 0, 0, 400, 300));
        assert.ok(calls.includes("fillText"), "bot role letter should be drawn");
    });

    it("draws the score HUD alive and respawning", () => {
        const tank = fakeTank("tank", { x: 8, y: 8 });
        const game = gameFixture({
            allTanks: [tank],
            factions: [{ id: 1, color: "#cc3333", entities: [tank] }],
            scores: new Map([
                [1, 3],
                [2, 1],
            ]),
        });
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawScoreHUD(ctx, game, 0, 0, 0, 400, 300, tank));
        assert.ok(calls.includes("fillText"), "score HUD should print scores");

        tank.alive = false;
        const { ctx: c2, calls: calls2 } = fakeCtx();
        drawScoreHUD(c2, game, 0, 0, 0, 400, 300, tank);
        assert.ok(calls2.includes("fillText"), "respawn HUD should still draw");
    });

    it("draws the battle HUD for every focus vehicle type", () => {
        const enemy = fakeTank("tank", { x: 10, y: 10, team: 2, color: "#3366dd", darkColor: "#223399" });
        const game = gameFixture({
            allTanks: [enemy],
            baseStructures: [new BaseWall(2, "#3366dd", "#223399")],
            bases: [baseFixture(1), baseFixture(2)],
            _bots: [
                { tank: fakeTank("tank", { team: 1 }), ai: { role: "cavalry" } },
                { tank: fakeTank("tank", { team: 1, alive: false }), ai: { role: "sniper" } },
            ],
        });

        const focusCases = [
            { vehicleType: "tank", alive: true, color: "#cc3333", team: 1 },
            { vehicleType: "drone", alive: true, color: "#cc3333", team: 1, x: 10, y: 10 }, // adjacent to enemy → DMG bar
            { vehicleType: "drone", alive: true, color: "#cc3333", team: 1, x: 500, y: 500 }, // far → "FIRE to detonate"
            { vehicleType: "spg", alive: true, color: "#cc3333", team: 1, isCharging: true, chargeTime: 999 },
            { vehicleType: "spg", alive: true, color: "#cc3333", team: 1, isCharging: false, fireCooldown: 1.5 },
            { vehicleType: "spg", alive: true, color: "#cc3333", team: 1, isCharging: false, fireCooldown: 0 },
            {
                vehicleType: "squad",
                alive: true,
                color: "#cc3333",
                team: 1,
                membersAlive: 4,
                squad: { digIn: { state: "dugIn" } },
            },
            {
                vehicleType: "squad",
                alive: true,
                color: "#cc3333",
                team: 1,
                membersAlive: 3,
                squad: { digIn: { state: "diggingIn" } },
            },
        ];
        for (const focus of focusCases) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawBattleHUD(ctx, game, 0, 0, 0, 400, 300, focus), JSON.stringify(focus));
            assert.ok(calls.includes("fillText"), JSON.stringify(focus));
        }
    });

    it("draws the battle HUD for a dead focus tank", () => {
        const game = gameFixture({ bases: [baseFixture(1), baseFixture(2)] });
        const dead = { vehicleType: "tank", alive: false, color: "#cc3333", team: 1 };
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawBattleHUD(ctx, game, 0, 0, 0, 400, 300, dead));
        assert.ok(calls.includes("fillText"));
    });
});

describe("overlay smoke", () => {
    it("draws the game-over screen with a winner", () => {
        const game = gameFixture({ gameOver: true, winner: 1, winnerLabel: "PLAYER 1", winnerColor: "#cc3333" });
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawGameOver(ctx, game, 800, 600));
        assert.ok(calls.includes("fillText"), "winner banner should print");
    });

    it("draws the SPG target indicator hot and cold", () => {
        for (const frac of [0.5, 1.0]) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawTargetIndicator(ctx, 100, 100, 50 * frac, 50, 0.3));
            assert.ok(calls.includes("stroke"), "indicator should stroke diamonds");
        }
    });
});

/* ── 3. Viewport orchestration ────────────────────────────── */

describe("renderViewport smoke", () => {
    function viewportGame() {
        return gameFixture({
            map: customMap([
                { x: 5, y: 5, tile: T.HILL },
                { x: 6, y: 6, tile: T.BLDG_MEDIUM },
            ]),
            allTanks: [
                fakeTank("tank", { x: 5.5, y: 5.5 }),
                fakeTank("drone", { x: 7, y: 7, angle: 0.2 }),
                fakeTank("spg", { x: 9, y: 9 }),
            ],
            baseStructures: [new BaseWall(1, "#cc3333", "#882222")],
            bullets: [new Bullet(3, 3, 0, 1, 1)],
            particles: { particles: [{ x: 4, y: 4, alpha: 0.5, color: "#fff", size: 4 }] },
        });
    }

    it("renders a full viewport without throwing", () => {
        const game = viewportGame();
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => renderViewport(ctx, game, game.allTanks[0], { x: 0, y: 0 }, 0, 0, 400, 300));
        assert.ok(calls.length > 500, "viewport should issue many draw calls");
    });

    it("renders the SPG targeting indicator when the focus tank charges", () => {
        const game = viewportGame();
        const spg = fakeTank("spg", { isCharging: true, chargeTime: 1, x: 9, y: 9 });
        const { ctx, calls } = fakeCtx();
        renderViewport(ctx, game, spg, { x: 0, y: 0 }, 0, 0, 400, 300);
        assert.ok(calls.includes("stroke"), "charging SPG should draw the target indicator");
    });

    it("drawDepthBuckets draws every kind back-to-front with save/restore per item", () => {
        const map = customMap([{ x: 5, y: 5, tile: T.HILL }]);
        const structure = new BaseWall(1, "#cc3333", "#882222");
        structure.x = 6.5;
        structure.y = 6.5;
        structure.tilePositions = [{ gx: 6, gy: 6 }];
        const fakeGame = gameFixture({
            map,
            allTanks: [fakeTank("tank", { x: 5.5, y: 5.5 })],
            baseStructures: [structure],
            bullets: [new Bullet(3, 3, 0, 1, 1)],
            particles: { particles: [{ x: 4, y: 4, alpha: 0.5, color: "#fff", size: 4 }] },
        });
        const buckets = collectDepthItems(fakeGame, -1e9, 1e9, -1e9, 1e9);
        const kinds = buckets
            .flat()
            .filter(Boolean)
            .map((i) => i.kind)
            .sort();
        assert.deepEqual(kinds, ["bullet", "particle", "structure", "tile", "vehicle"]);
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => drawDepthBuckets(ctx, buckets, fakeGame));
        const saves = calls.filter((c) => c === "save").length;
        const restores = calls.filter((c) => c === "restore").length;
        assert.ok(saves > 0 && saves === restores, "every item draw must save/restore");
    });

    it("draws viewport borders only for multi-viewport layouts", () => {
        const { ctx: c1, calls: calls1 } = fakeCtx();
        drawViewportBorders(c1, [{ x: 0, y: 0, w: 400, h: 300 }], 400, 300);
        assert.equal(calls1.length, 0, "single viewport → no borders");

        const { ctx: c2, calls: calls2 } = fakeCtx();
        drawViewportBorders(
            c2,
            [
                { x: 0, y: 0, w: 400, h: 300 },
                { x: 400, y: 0, w: 400, h: 300 },
            ],
            800,
            300,
        );
        assert.ok(calls2.includes("stroke"), "two viewports → interior border drawn");

        // Vertically stacked viewports exercise the horizontal-edge branch.
        const { ctx: c3, calls: calls3 } = fakeCtx();
        drawViewportBorders(
            c3,
            [
                { x: 0, y: 0, w: 400, h: 300 },
                { x: 0, y: 300, w: 400, h: 300 },
            ],
            400,
            600,
        );
        assert.ok(calls3.filter((c) => c === "moveTo").length > 0, "stacked viewports → horizontal border drawn");
    });
});

/* ── 4. The public shell (Renderer + menu preview) ────────── */

describe("Renderer shell", () => {
    it("constructs and renders skirmish, battle, and game-over frames", () => {
        const { ctx, calls } = fakeCtx();
        const fakeCanvas = { width: 800, height: 600, getContext: () => ctx };
        const oldWindow = globalThis.window;
        globalThis.window = { addEventListener: () => {} };
        try {
            const renderer = new Renderer(fakeCanvas);

            // Skirmish: score HUD, no bases.
            const tank = fakeTank("tank", { x: 8, y: 8 });
            const skirmish = gameFixture({
                humanTanks: [tank],
                cameras: [{ x: 0, y: 0 }],
                allTanks: [tank],
                factions: [{ id: 1, color: "#cc3333", entities: [tank] }],
                scores: new Map([[1, 0]]),
            });
            assert.doesNotThrow(() => renderer.render(skirmish));
            assert.ok(calls.length > 0, "render should touch the context");

            // Battle: base HUD branch.
            const battle = gameFixture({
                hasBases: true,
                humanTanks: [tank],
                cameras: [{ x: 0, y: 0 }],
                allTanks: [tank],
                bases: [baseFixture(1), baseFixture(2)],
            });
            assert.doesNotThrow(() => renderer.render(battle));

            // Game over: overlay branch.
            const over = gameFixture({
                gameOver: true,
                winner: 1,
                winnerLabel: "PLAYER 1",
                winnerColor: "#cc3333",
                humanTanks: [tank],
                cameras: [{ x: 0, y: 0 }],
                allTanks: [tank],
            });
            assert.doesNotThrow(() => renderer.render(over));
        } finally {
            globalThis.window = oldWindow;
        }
    });
});

describe("menu vehicle preview", () => {
    it("draws every vehicle preview through the shared sprite module", () => {
        for (const type of ["tank", "ifv", "spg", "drone", "squad"]) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawMenuVehicle(ctx, 0, 0, 0.7, type, "#cc3333", "#882222", 1, 0.4), type);
            assert.ok(calls.length > 0, `${type} preview should draw`);
        }
    });
});
