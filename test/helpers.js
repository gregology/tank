/**
 * Shared test utilities: map builders, bot simulation, assertions.
 */

import { AI_ROLES, AIController, pickRoleForVehicle } from "../js/ai.js";
import { Bullet } from "../js/bullet.js";
import { BASE_STRUCTURES, CONFIG, TILES as T, VEHICLES } from "../js/config.js";
import { Base, BaseHQ, BaseWall, BaseWatchTower, GameEntity } from "../js/entity.js";
import { GameMap } from "../js/map.js";
import { Pathfinder } from "../js/pathfinder.js";
import { Tank } from "../js/tank.js";
import { distance } from "../js/utils.js";

export {
    AI_ROLES,
    AIController,
    BASE_STRUCTURES,
    Base,
    BaseHQ,
    BaseWall,
    BaseWatchTower,
    Bullet,
    CONFIG,
    distance,
    GameEntity,
    GameMap,
    Pathfinder,
    pickRoleForVehicle,
    T,
    Tank,
    VEHICLES,
};

/* ── Seeded PRNG (mulberry32) ─────────────────────────────── */

/**
 * Return a deterministic PRNG seeded with `seed`.
 * Produces values in [0, 1) — a drop-in replacement for Math.random().
 */
export function seededRng(seed) {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const BOT_KEYS = {
    forward: "_bf",
    backward: "_bb",
    left: "_bl",
    right: "_br",
    turretLeft: "_btl",
    turretRight: "_btr",
    fire: "_bx",
};

/* ── Map builders ─────────────────────────────────────────── */

/** Create a fresh random map with base compounds. */
export function randomMap() {
    const map = new GameMap();
    const layouts = map.buildBaseCompounds();
    // Backward-compat: "towers" returns passable spawn points near compound centres
    const towers = layouts.map((l) => map.getBaseSpawnPoint(l.center.x, l.center.y));
    return { map, layouts, towers };
}

/**
 * Create a fully deterministic flat grass map and stamp obstacles on it.
 * Every tile is GRASS — no random terrain, no water.  Tests run the
 * same regardless of seed.
 */
export function customMap(obstacles) {
    const map = new GameMap();
    // Override EVERY tile to grass
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) map.setTile(x, y, T.GRASS);
    for (const o of obstacles) map.setTile(o.x, o.y, o.tile ?? T.HILL);
    return map;
}

/** Build a horizontal wall from (x1,y) to (x2,y). */
export function wallH(y, x1, x2, tile = T.HILL) {
    const obs = [];
    for (let x = x1; x <= x2; x++) obs.push({ x, y, tile });
    return obs;
}

/** Build a vertical wall from (x,y1) to (x,y2). */
export function wallV(x, y1, y2, tile = T.HILL) {
    const obs = [];
    for (let y = y1; y <= y2; y++) obs.push({ x, y, tile });
    return obs;
}

/** Build an L-shaped wall. */
export function wallL(cx, cy, armH, armV, tile = T.HILL) {
    return [...wallH(cy, cx, cx + armH, tile), ...wallV(cx, cy - armV, cy, tile)];
}

/** Build a U-shaped wall (open at the top). */
export function wallU(cx, cy, width, depth, tile = T.HILL) {
    return [
        ...wallV(cx, cy, cy + depth, tile),
        ...wallH(cy + depth, cx, cx + width, tile),
        ...wallV(cx + width, cy, cy + depth, tile),
    ];
}

/** Build a zigzag: N horizontal walls with alternating gaps. */
export function zigzag(startY, spacing, count, x1, x2, gapSide = "alternate") {
    const obs = [];
    for (let i = 0; i < count; i++) {
        const y = startY + i * spacing;
        const gapLeft = gapSide === "alternate" ? i % 2 === 0 : gapSide === "left";
        for (let x = x1; x <= x2; x++) {
            if (gapLeft && x <= x1 + 1) continue; // gap on left
            if (!gapLeft && x >= x2 - 1) continue; // gap on right
            obs.push({ x, y });
        }
    }
    return obs;
}

/* ── Bot simulation ───────────────────────────────────────── */

/**
 * Create a bot tank + AI at the given position.
 */
export function createBot(x, y, angle = 0, map = null, rng = undefined) {
    const tank = new Tank(1, "#cc3333", "#882222");
    tank.team = 1;
    tank.alive = true;
    tank.x = x;
    tank.y = y;
    tank.angle = angle;
    tank.turretAngle = 0;
    const ai = new AIController(BOT_KEYS, map, rng);
    return { tank, ai };
}

/**
 * Simulate a bot navigating from its current position to a target.
 *
 * @param {object}  bot        { tank, ai } from createBot()
 * @param {object}  target     { x, y } world position
 * @param {object}  map        GameMap
 * @param {object}  [opts]
 * @param {number}  [opts.seconds=20]      max simulation time
 * @param {Tank[]}  [opts.enemies=[]]      enemy tanks
 * @param {object}  [opts.objective=null]  objective position for AI
 * @returns {{ reachedTarget, finalDist, maxStuck, elapsed, positions }}
 */
export function simulateNavigation(bot, target, map, opts = {}) {
    const { seconds = 20, enemies = [], objective = null, arrivalDist = 2.0 } = opts;

    const dt = 0.016;
    const frames = Math.ceil(seconds / dt);
    const { tank, ai } = bot;
    const positions = [];
    let maxStuck = 0;
    let arrived = false;
    let arrivedFrame = -1;

    for (let f = 0; f < frames; f++) {
        ai.think(dt, tank, enemies, map, objective ?? target);
        tank.update(dt, ai, BOT_KEYS, map);

        if (ai.stuckTime > maxStuck) maxStuck = ai.stuckTime;

        const d = Math.hypot(target.x - tank.x, target.y - tank.y);

        // Sample position periodically
        if (f % 60 === 0) {
            positions.push({
                t: +(f * dt).toFixed(2),
                x: +tank.x.toFixed(2),
                y: +tank.y.toFixed(2),
                dist: +d.toFixed(2),
                stuck: +ai.stuckTime.toFixed(2),
            });
        }

        if (!arrived && d < arrivalDist) {
            arrived = true;
            arrivedFrame = f;
        }
    }

    const finalDist = Math.hypot(target.x - tank.x, target.y - tank.y);
    return {
        reachedTarget: arrived,
        finalDist: +finalDist.toFixed(2),
        maxStuck: +maxStuck.toFixed(2),
        elapsed: arrived ? +(arrivedFrame * dt).toFixed(2) : seconds,
        positions,
    };
}

/**
 * Run a multi-bot team simulation with separation.
 */
export function simulateTeam(map, redSpawn, blueSpawn, redTarget, blueTarget, opts = {}) {
    const { seconds = 30, botsPerTeam = 5 } = opts;
    const dt = 0.016;
    const frames = Math.ceil(seconds / dt);

    const bots = [];
    for (let i = 0; i < botsPerTeam; i++) {
        const r = createBot(
            redSpawn.x + (Math.random() - 0.5) * 3,
            redSpawn.y + (Math.random() - 0.5) * 3,
            Math.random() * Math.PI * 2,
            map,
        );
        r.tank.team = 1;
        r.tank.playerNumber = i + 1;
        r.target = redTarget;
        bots.push(r);

        const b = createBot(
            blueSpawn.x + (Math.random() - 0.5) * 3,
            blueSpawn.y + (Math.random() - 0.5) * 3,
            Math.random() * Math.PI * 2,
            map,
        );
        b.tank.team = 2;
        b.tank.playerNumber = botsPerTeam + i + 1;
        b.target = blueTarget;
        bots.push(b);
    }

    const canStand = (x, y) => {
        const s = VEHICLES.tank.size * 0.85;
        return (
            map.isPassable(x - s, y - s) &&
            map.isPassable(x + s, y - s) &&
            map.isPassable(x - s, y + s) &&
            map.isPassable(x + s, y + s)
        );
    };

    for (let f = 0; f < frames; f++) {
        const allTanks = bots.map((b) => b.tank);
        for (const b of bots) {
            const enemies = allTanks.filter((t) => t.team !== b.tank.team && t.alive);
            b.ai.think(dt, b.tank, enemies, map, { x: b.target.x, y: b.target.y, alive: true });
            b.tank.update(dt, b.ai, BOT_KEYS, map);
        }
        // Separation
        const alive = allTanks.filter((t) => t.alive);
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const d = distance(alive[i].x, alive[i].y, alive[j].x, alive[j].y);
                const min = VEHICLES.tank.size * 2;
                if (d < min && d > 0.001) {
                    const o = (min - d) / 2;
                    const nx = (alive[j].x - alive[i].x) / d;
                    const ny = (alive[j].y - alive[i].y) / d;
                    const ax = alive[i].x - nx * o,
                        ay = alive[i].y - ny * o;
                    const bx = alive[j].x + nx * o,
                        by = alive[j].y + ny * o;
                    if (canStand(ax, ay)) {
                        alive[i].x = ax;
                        alive[i].y = ay;
                    }
                    if (canStand(bx, by)) {
                        alive[j].x = bx;
                        alive[j].y = by;
                    }
                }
            }
        }
    }

    const results = bots.map((b) => {
        const d = Math.hypot(b.target.x - b.tank.x, b.target.y - b.tank.y);
        return { team: b.tank.team, finalDist: +d.toFixed(1), stuck: +b.ai.stuckTime.toFixed(1) };
    });
    return results;
}
