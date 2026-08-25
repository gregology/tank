/**
 * Swarm behaviours — how a vehicle turns the colony's signals into a
 * goal.  There are no roles: every unit runs the same small set of
 * candidate behaviours over the shared pheromone fields, and identity
 * is purely *how strongly* a vehicle responds to each signal (the
 * `swarm` block in VEHICLES — tanks attract and spearhead, squads and
 * drones flank, SPGs keep their range).
 *
 * Each candidate returns { x, y, kind, strength }; the strongest wins
 * (argmax — goals stay discrete so A* targets don't oscillate).  All
 * weight constants come from the live tuning object (`ai.swarm.tuning`),
 * so sliders and sweeps apply immediately.
 *
 * The candidates, in spirit:
 *   rally      — an ally under attack deposits alarm; close allies come
 *   objective  — a discovered, living objective attracts (food signal)
 *   trail      — routes to objectives lit by units already en route;
 *                shorter journeys lay stronger trails, so the swarm's
 *                routes optimize over time and stale ones fade
 *   convoy     — follow a stronger attractor (tanks lead, humans lead
 *                more); flanking vehicles fan out to the sides
 *   hunt       — visible enemies pull (closes the deal in skirmish)
 *   explore    — the fallback: head for ground the colony hasn't covered
 *
 * Spacing is NOT a candidate: `spacingOffset` bends the immediate steer
 * point away from crowded neighbours so converging units (including
 * flying ones, which ignore ground collision) don't stack.
 */

import { VEHICLES } from "../../config.js";
import { bestTarget } from "../targeting.js";

/**
 * Choose where to navigate and what to shoot at.
 *
 * @returns {{ navGoal: {x,y,kind}|null, fireTarget: {target,dist}|null }}
 */
export function chooseSwarmGoal(ai, dt, me, enemies, map) {
    const cfg = VEHICLES[me.vehicleType]?.swarm ?? VEHICLES.tank.swarm;
    const tuning = ai.swarm.tuning;
    const fields = ai.swarm.fields;
    const intel = ai.swarm.intel;

    const candidates = [
        rallyCandidate(me, fields, tuning, cfg),
        objectiveCandidate(me, intel, tuning, cfg),
        trailCandidate(me, fields, intel, tuning, cfg),
        convoyCandidate(ai, me, tuning, cfg),
        huntCandidate(me, enemies, tuning, cfg),
        exploreCandidate(ai, me, map, tuning, cfg, dt),
    ];

    let navGoal = null;
    for (const c of candidates) {
        if (c && (!navGoal || c.strength > navGoal.strength)) navGoal = c;
    }

    let fireTarget = bestTarget(ai, me, enemies, { range: cfg.engageRange });
    if (!fireTarget) {
        // Siege: the colony knows where the enemy nest is even when no
        // unit currently sees it — grind toward it.  Bullets physically
        // chew through walls/towers on the way in, so pressure persists
        // between assault waves instead of stalling at the gate.
        const obj = intel.objectives()[0];
        if (obj) {
            const d = Math.hypot(obj.x - me.x, obj.y - me.y);
            if (d < cfg.engageRange) fireTarget = { target: obj, dist: d };
        }
    }
    return { navGoal, fireTarget };
}

/* ── candidates ───────────────────────────────────────────── */

/** An ally under attack signals; come running.  Discipline rules keep
 *  rally from becoming a death-magnet: a unit under fire itself is
 *  already AT the fight (it fights, it doesn't rally), its own alarm
 *  cloud doesn't count, and distant alarms pull weaker than close ones
 *  so a push isn't recalled by a faraway skirmish. */
function rallyCandidate(me, fields, tuning, cfg) {
    if (me.underAttack) return null; // I'm already AT the fight — fight, don't rally
    const peak = fields.strongestInRadius("alarm", me.x, me.y, tuning.ALARM_RANGE, 0.1);
    if (!peak) return null;
    const d = Math.hypot(peak.x - me.x, peak.y - me.y);
    if (d < 4) return null;
    return {
        x: peak.x,
        y: peak.y,
        kind: "rally",
        strength: peak.value * cfg.alarm * tuning.W_RALLY * (1 - d / tuning.ALARM_RANGE),
    };
}

/** The highest-priority known objective pulls; keep-range vehicles hold off. */
function objectiveCandidate(me, intel, tuning, cfg) {
    const obj = intel.objectives()[0];
    if (!obj) return null;
    let goal = { x: obj.x, y: obj.y };
    if (cfg.keepRange > 0) {
        const d = Math.hypot(obj.x - me.x, obj.y - me.y);
        if (d < cfg.keepRange * 1.2) {
            if (d >= cfg.keepRange * 0.8) {
                goal = { x: me.x, y: me.y }; // in the band: hold
            } else {
                const a = Math.atan2(me.y - obj.y, me.x - obj.x);
                goal = { x: obj.x + Math.cos(a) * cfg.keepRange, y: obj.y + Math.sin(a) * cfg.keepRange };
            }
        }
    }
    return { ...goal, kind: "objective", strength: tuning.W_OBJECTIVE + obj.priority };
}

/** Follow a lit route toward the objective (progress-guaranteed). */
function trailCandidate(me, fields, intel, tuning, cfg) {
    const obj = intel.objectives()[0];
    if (!obj) return null;
    const hit = fields.strongestToward("trail", me.x, me.y, obj.x, obj.y, tuning.TRAIL_FOLLOW_RADIUS, tuning.TRAIL_MIN);
    if (!hit) return null;
    return { x: hit.x, y: hit.y, kind: "trail", strength: hit.value * cfg.trail * tuning.W_TRAIL };
}

/** Join a stronger attractor nearby; hang behind (or beside) it.
 *  Leadership requires purpose: a bot leads only while moving or
 *  actively pursuing a goal (the swarm system stamps `convoyLeadable`),
 *  so parked bots can't hold an idle blob — but a besieging leader
 *  keeps its convoy massed for the push.  Humans always attract:
 *  escorting a parked human is legitimate. */
function convoyCandidate(ai, me, tuning, cfg) {
    const cfgMe = VEHICLES[me.vehicleType]?.swarm ?? VEHICLES.tank.swarm;
    let leader = null,
        leaderScore = 0;
    for (const ally of ai.allies) {
        if (ally === me || !ally.alive) continue;
        const d = Math.hypot(ally.x - me.x, ally.y - me.y);
        if (d > tuning.CONVOY_RADIUS || d < 0.5) continue;
        const human = ai.swarm.isHumanDriven(ally);
        if (!human && !ally.convoyLeadable) continue;
        const aCfg = VEHICLES[ally.vehicleType]?.swarm ?? VEHICLES.tank.swarm;
        let attraction = aCfg.attraction;
        if (human) attraction += tuning.HUMAN_LEADER_BONUS;
        // Escort: a leader already marching on the objective is worth
        // following INTO the push — this is what makes the assault arrive
        // as a wave instead of trickling in one unit at a time.
        if (ally.pursuingObjective) attraction *= tuning.ESCORT_BONUS;
        if (attraction <= cfgMe.attraction) continue; // only follow stronger signals
        const score = attraction * (1 - d / tuning.CONVOY_RADIUS);
        if (score > leaderScore) {
            leaderScore = score;
            leader = ally;
        }
    }
    if (!leader) return null;
    const back = leader.angle + Math.PI;
    const perp = leader.angle + Math.PI / 2;
    return {
        x: leader.x + Math.cos(back) * tuning.CONVOY_SPACING + Math.cos(perp) * cfg.flank,
        y: leader.y + Math.sin(back) * tuning.CONVOY_SPACING + Math.sin(perp) * cfg.flank,
        kind: "convoy",
        strength: leaderScore * cfg.follow * tuning.W_CONVOY,
    };
}

/** Visible enemies pull — the closer, the stronger; beyond HUNT_RANGE
 *  they don't pull at all, so a distant scrum can't trap explorers. */
function huntCandidate(me, enemies, tuning, cfg) {
    let best = null,
        bestD = Infinity;
    for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        if (d < bestD) {
            bestD = d;
            best = e;
        }
    }
    if (!best || bestD > tuning.HUNT_RANGE) return null;
    return {
        x: best.x,
        y: best.y,
        kind: "hunt",
        strength: (cfg.aggression * tuning.W_HUNT) / Math.max(bestD, 2),
    };
}

/**
 * The fallback that prevents idle blobs: score a ring of candidate
 * points and walk toward the frontier — the ray whose *outward* ground
 * the colony has visited least, preferring ground FARTHER FROM HOME.
 * Sampling beyond the ring (1×/1.75×/2.5×) plus the outward bias makes
 * exploration sweep toward enemy territory instead of drunkard-walking
 * around home.  The pick is cached briefly so units commit to a
 * direction.
 */
function exploreCandidate(ai, me, map, tuning, cfg, dt) {
    ai._exploreTimer = (ai._exploreTimer ?? 0) - dt;
    const cached = ai._exploreGoal;
    if (
        cached &&
        ai._exploreTimer > 0 &&
        map.isPassable(cached.x, cached.y) &&
        Math.hypot(cached.x - me.x, cached.y - me.y) > 2
    ) {
        return { ...cached, kind: "explore", strength: exploreStrength(cached.value, tuning, cfg) };
    }

    const fields = ai.swarm.fields;
    const home = ai.swarm.home;
    let best = null,
        bestValue = Infinity;
    for (let i = 0; i < tuning.EXPLORE_SAMPLES; i++) {
        const angle = (i / tuning.EXPLORE_SAMPLES) * Math.PI * 2 + ai.rng() * 0.5;
        const r = tuning.EXPLORE_RADIUS * (0.6 + ai.rng() * 0.4);
        const dx = Math.cos(angle),
            dy = Math.sin(angle);
        const px = Math.max(1, Math.min(map.width - 2, me.x + dx * r));
        const py = Math.max(1, Math.min(map.height - 2, me.y + dy * r));
        if (!map.isPassable(px, py)) continue;
        // Frontier probe: average the visited field along the ray beyond
        // the candidate — low means "unexplored country that way".
        // The rng tie-break matters: unexplored directions all tie at 0,
        // and a first-index pick would funnel every colony the same way.
        const v =
            (fields.sample("visited", px, py) +
                fields.sample("visited", me.x + dx * r * 1.75, me.y + dy * r * 1.75) +
                fields.sample("visited", me.x + dx * r * 2.5, me.y + dy * r * 2.5)) /
                3 -
            ai.rng() * 1e-3;
        // Outward bias: the enemy nest is not here, so it is elsewhere —
        // prefer candidates that expand the colony's reach from home.
        const outward = home
            ? tuning.EXPLORE_OUTWARD * Math.min(1, Math.hypot(px - home.x, py - home.y) / (2 * tuning.EXPLORE_RADIUS))
            : 0;
        // Heading persistence: without it, tied frontiers re-pick in a
        // random direction every few seconds and slow-turning units
        // oscillate in place instead of completing a leg.
        const persistence = tuning.EXPLORE_PERSIST * Math.cos(angle - me.angle);
        const score = v - outward - persistence;
        if (score < bestValue) {
            bestValue = score;
            best = { x: px, y: py, value: Math.max(0, v) };
        }
    }
    if (!best) return null;
    ai._exploreGoal = best;
    ai._exploreTimer = 2 + ai.rng() * 2;
    return { x: best.x, y: best.y, kind: "explore", strength: exploreStrength(best.value, tuning, cfg) };
}

/** Fresh ground scores highest; heavily retread ground barely pulls. */
function exploreStrength(visitedValue, tuning, cfg) {
    return (cfg.explore * tuning.W_EXPLORE * tuning.EXPLORE_NOVELTY) / (1 + visitedValue);
}

/* ── spacing ──────────────────────────────────────────────── */

/**
 * Steering-level personal space: a repulsion offset from friendly
 * neighbours closer than this vehicle's `personalSpace`.  Applied to
 * the steer point (not just physics), so units converging on one spot —
 * convoy positions, rallies, objectives — fan out instead of stacking.
 * This is the only spacing air units have (ground collision skips them).
 */
export function spacingOffset(ai, me) {
    const cfg = VEHICLES[me.vehicleType]?.swarm ?? VEHICLES.tank.swarm;
    const space = cfg.personalSpace;
    const gain = ai.swarm.tuning.SPACING_GAIN;
    let ox = 0,
        oy = 0;
    for (const ally of ai.allies) {
        if (ally === me || !ally.alive) continue;
        const dx = me.x - ally.x,
            dy = me.y - ally.y;
        const d = Math.hypot(dx, dy);
        if (d >= space || d < 0.001) continue;
        const push = ((space - d) / space) * gain;
        ox += (dx / d) * push;
        oy += (dy / d) * push;
    }
    return { x: ox, y: oy };
}
