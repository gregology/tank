/**
 * Swarm arbitration — where to navigate and what to shoot at.
 *
 * This replaces the old per-life role strategies (cavalry / sniper /
 * defender / scout) with reactive, colony-insect-inspired rules.  Every
 * think, the bot re-decides from the *current* situation — nothing is
 * assigned at spawn.  The layers, in priority order:
 *
 *   1. alarm    rally to the strongest nearby alarm deposit — a friendly
 *               is under attack there (the signal dies with the victim).
 *   2. convoy   fall in behind a nearby stronger recruitment emitter
 *               that has a *purpose* (a known objective, or a human at
 *               the wheel) — idle groups at home disperse instead of
 *               blobbing.  Joining is also suppressed where the local
 *               recruit field is already saturated (crowding aversion).
 *               Ground vehicles queue in a line behind the leader (tanks
 *               emit most, so they spearhead; humans emit more, so bots
 *               follow them); `flank` vehicles (squad, drone) hold a
 *               perpendicular offset instead.
 *   3. food     move to a nearby objective beacon.
 *   4. objective head for the faction's known objective, preferring the
 *               strongest trail tile that still makes progress (shorter
 *               routes lay stronger trails, so traffic converges on the
 *               best corridor).  Vehicles with a `maxRange` (artillery)
 *               hold once the objective is inside it.
 *   5. explore  biased wander toward tiles with weak friendly recruit +
 *               trail signal and away from the faction's home anchor,
 *               so the swarm spreads out and discovers.
 *
 * A vehicle's *identity* is how it responds: the `signals.follow`
 * weights in VEHICLES gate each layer per vehicle type (0 = ignore).
 * The chosen goal then passes through separation steering
 * (js/ai/separation.js), which offsets it away from nearby friendlies
 * so converging vehicles spread out instead of stacking on one point.
 * Combat targeting stays separate: the bot fires at the best enemy in
 * range while navigating, never detouring to chase.
 */

import { CONFIG, VEHICLES } from "../config.js";
import { applySpacing } from "./separation.js";
import { bestTarget } from "./targeting.js";

/**
 * Choose the navigation goal and combat target for this think.
 *
 * @param {object} ai   the AIController (per-life swarm state on `ai.state`)
 * @param {number} dt   frame delta
 * @param {object} me   the bot's own tank
 * @param {object} ctx  { enemies, map, objective, swarm } — swarm is
 *                      { signals, friendlies, humans } or null (no fields)
 * @returns {{ navGoal: {x,y}, fireTarget: {x,y,dist}|null }}
 */
export function chooseGoalAndTarget(ai, dt, me, { enemies, map, objective, swarm = null }) {
    const weights = VEHICLES[me.vehicleType]?.signals?.follow ?? {};

    // ── Combat target: best enemy in range, else the objective itself ──
    let fireTarget = null;
    const bestEnemy = bestTarget(ai, me, enemies);
    if (bestEnemy && bestEnemy.dist < CONFIG.ENGAGE_RANGE) {
        fireTarget = bestEnemy;
    }
    if (!fireTarget && objective && objective.alive !== false) {
        const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
        if (objDist < CONFIG.OBJECTIVE_ENGAGE_RANGE) {
            fireTarget = { target: objective, dist: objDist };
        }
    }

    const navGoal = pickNavGoal(ai, dt, me, { map, objective, swarm, weights });
    return { navGoal: swarm ? applySpacing(me, swarm.friendlies, navGoal, map) : navGoal, fireTarget };
}

function pickNavGoal(ai, dt, me, { map, objective, swarm, weights }) {
    if (swarm) {
        if (weights.alarm > 0) {
            const alarm = strongestTile(swarm.signals, "alarm", me, CONFIG.SIGNAL_ALARM_RESPONSE_RADIUS);
            if (alarm) return alarm;
        }
        if (weights.recruit > 0 && swarm.signals.valueAt("recruit", me.x, me.y) < CONFIG.CONVOY_CROWD_LIMIT) {
            const leader = pickConvoyLeader(me, swarm, objective);
            if (leader) return convoyStation(ai, me, leader, swarm);
        }
        if (weights.food > 0) {
            const food = strongestTile(swarm.signals, "food", me, CONFIG.SIGNAL_SENSE_RADIUS);
            if (food) return food;
        }
    }

    if (objective && objective.alive !== false) {
        const maxRange = VEHICLES[me.vehicleType]?.maxRange;
        if (maxRange && Math.hypot(objective.x - me.x, objective.y - me.y) <= maxRange * 0.9) {
            return { x: me.x, y: me.y }; // artillery holds at shelling range
        }
        if (swarm && weights.trail > 0) {
            const trail = bestProgressTrailTile(swarm.signals, me, objective);
            if (trail) return trail;
        }
        return { x: objective.x, y: objective.y };
    }

    return explorePoint(ai, dt, me, map, swarm);
}

/* ── alarm / food: local field maxima ─────────────────────── */

/** The centre of the strongest tile of `channel` within `radius`, or null. */
function strongestTile(fields, channel, pos, radius) {
    const gx = Math.floor(pos.x),
        gy = Math.floor(pos.y);
    let best = null,
        bestV = CONFIG.SIGNAL_SENSE_MIN;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const v = fields.valueAt(channel, gx + dx + 0.5, gy + dy + 0.5);
            if (v > bestV) {
                bestV = v;
                best = { x: gx + dx + 0.5, y: gy + dy + 0.5 };
            }
        }
    }
    return best;
}

/* ── convoy: follow a stronger emitter ────────────────────── */

function emitStrength(tank, swarm) {
    const base = VEHICLES[tank.vehicleType]?.signals?.recruit ?? 0;
    return swarm.humans?.includes(tank) ? base * CONFIG.SIGNAL_HUMAN_EMIT : base;
}

/**
 * The strongest nearby friendly emitting more recruitment than me —
 * provided it has a purpose: a human driver, or a faction that knows an
 * objective.  Without a purpose there is nothing to follow *to*, and
 * gating here is what stops idle convoys blobbing around the base.
 */
function pickConvoyLeader(me, swarm, objective) {
    const myEmit = emitStrength(me, swarm);
    let best = null,
        bestScore = 0;
    for (const f of swarm.friendlies) {
        if (f === me || !f.alive) continue;
        if (!objective && !swarm.humans?.includes(f)) continue;
        const emit = emitStrength(f, swarm);
        if (emit <= myEmit * CONFIG.CONVOY_EMIT_MARGIN) continue;
        const d = Math.hypot(f.x - me.x, f.y - me.y);
        if (d > CONFIG.CONVOY_JOIN_RANGE || d < 0.5) continue;
        const score = emit / d;
        if (score > bestScore) {
            best = f;
            bestScore = score;
        }
    }
    return best;
}

/** Where a follower stations itself relative to its convoy leader. */
function convoyStation(ai, me, leader, swarm) {
    if (VEHICLES[me.vehicleType]?.signals?.flank) {
        if (ai.state.convoySide == null) ai.state.convoySide = ai.rng() > 0.5 ? 1 : -1;
        const a = leader.angle + (Math.PI / 2) * ai.state.convoySide;
        return {
            x: leader.x + Math.cos(a) * CONFIG.CONVOY_FLANK_OFFSET,
            y: leader.y + Math.sin(a) * CONFIG.CONVOY_FLANK_OFFSET,
        };
    }
    // Queue behind the leader: every friendly already closer to the
    // leader than me pushes my station one gap further back.
    const myDist = Math.hypot(leader.x - me.x, leader.y - me.y);
    let ahead = 0;
    for (const f of swarm.friendlies) {
        if (f === me || f === leader || !f.alive) continue;
        if (Math.hypot(leader.x - f.x, leader.y - f.y) < myDist - 0.01) ahead++;
    }
    const gap = CONFIG.CONVOY_SPACING * (1 + ahead);
    return {
        x: leader.x - Math.cos(leader.angle) * gap,
        y: leader.y - Math.sin(leader.angle) * gap,
    };
}

/* ── trail: strongest tile that still makes progress ──────── */

function bestProgressTrailTile(fields, me, objective) {
    const radius = CONFIG.SIGNAL_SENSE_RADIUS;
    const gx = Math.floor(me.x),
        gy = Math.floor(me.y);
    const myDist = Math.hypot(objective.x - me.x, objective.y - me.y);
    let best = null,
        bestV = CONFIG.SIGNAL_SENSE_MIN,
        bestDist = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const tx = gx + dx + 0.5,
                ty = gy + dy + 0.5;
            const v = fields.valueAt("trail", tx, ty);
            if (v < CONFIG.SIGNAL_SENSE_MIN) continue;
            const distToObjective = Math.hypot(objective.x - tx, objective.y - ty);
            if (distToObjective >= myDist - 0.5) continue; // no progress — likely the way back
            if (v > bestV || (v === bestV && distToObjective < bestDist)) {
                best = { x: tx, y: ty };
                bestV = v;
                bestDist = distToObjective;
            }
        }
    }
    return best;
}

/* ── explore: wander toward weak-signal (unvisited) ground ── */

function explorePoint(ai, dt, me, map, swarm) {
    ai.state.exploreTimer = (ai.state.exploreTimer ?? 0) - dt;
    if (ai.state.exploreGoal && ai.state.exploreTimer > 0) return ai.state.exploreGoal;

    let best = null,
        bestScore = Infinity;
    for (let i = 0; i < CONFIG.EXPLORE_SAMPLES; i++) {
        const a = ai.rng() * Math.PI * 2;
        const r = CONFIG.EXPLORE_RADIUS * (0.5 + ai.rng() * 0.5);
        const x = Math.max(2, Math.min(map.width - 3, me.x + Math.cos(a) * r));
        const y = Math.max(2, Math.min(map.height - 3, me.y + Math.sin(a) * r));
        if (!map.isPassable(x, y)) continue;
        let score = ai.rng(); // jitter so equal-signal choices vary
        if (swarm) {
            score += swarm.signals.valueAt("recruit", x, y) + swarm.signals.valueAt("trail", x, y);
            if (swarm.home) {
                score -= CONFIG.EXPLORE_VENTURE_WEIGHT * Math.hypot(x - swarm.home.x, y - swarm.home.y);
            }
        }
        if (score < bestScore) {
            bestScore = score;
            best = { x, y };
        }
    }

    ai.state.exploreTimer = CONFIG.EXPLORE_INTERVAL * (0.75 + ai.rng() * 0.5);
    ai.state.exploreGoal = best ?? { x: me.x, y: me.y };
    return ai.state.exploreGoal;
}
