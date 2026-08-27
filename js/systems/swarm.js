/**
 * Swarm system — the per-frame pheromone pass.
 *
 * Runs before the think pass in Game._update.  On each FIELD_TICK it:
 *   1. updates intel: a friendly unit (bots and humans alike) within
 *      SIGHT_RANGE with line of sight discovers an enemy structure (and
 *      thereby its base); destroyed knowledge is forgotten — attraction
 *      dies with it,
 *   2. deposits signals from observable world state:
 *      visited — wherever any unit stands (humans mark ground too)
 *      alarm   — living units hit within ALARM_MEMORY seconds (the
 *                signal dies with the victim: no rallying to a corpse)
 *      food    — known, alive objectives
 *      trail   — weak crumbs under every moving unit: the substrate a
 *                proven route later lights up from
 *      route   — when a unit PERSONALLY sights a known objective for the
 *                first time, its walked path lights up, strength ∝
 *                1/path length (shorter journeys = stronger routes);
 *                followers who reach the objective reinforce their own
 *                paths, so good routes brighten and stale ones fade
 *   3. ticks every faction's fields (decay + diffusion).
 *
 * The system reads only observable state (positions, lastHitAt, the
 * bot's current goal kind) — vehicles never call into each other.
 */

import { BASE_STRUCTURES } from "../config.js";

/** Tiles of route history kept per unit (~2 map-crossings at tank speed). */
const ROUTE_HISTORY_LIMIT = 192;

export function updateSwarms(game, dt) {
    for (const [factionId, swarm] of game.swarms) {
        swarm._tickTimer -= dt;
        if (swarm._tickTimer > 0) continue;
        swarm._tickTimer += swarm.tuning.FIELD_TICK;

        tickDiscovery(game, swarm, factionId);
        tickDeposits(game, swarm, factionId);
        swarm.fields.tick(swarm.tuning);
        pruneIntel(swarm);
    }
}

/* ── discovery ────────────────────────────────────────────── */

/**
 * Units with eyes on an enemy structure reveal it for their faction.
 * Seeing ANY structure of an enemy base also reveals the base itself as
 * an objective — the colony spotted the compound, it knows where the
 * enemy nest is.
 */
function tickDiscovery(game, swarm, factionId) {
    const structures = game.baseStructures;
    if (structures.length === 0) return; // skirmish: nothing to discover
    const sight = swarm.tuning.SIGHT_RANGE;
    for (const unit of game.allTanks) {
        if (!unit.alive || unit.team !== factionId) continue;
        for (const structure of structures) {
            if (!structure.alive || structure.team === factionId || swarm.intel.hasStructure(structure)) continue;
            const d = Math.hypot(structure.x - unit.x, structure.y - unit.y);
            if (d > sight) continue;
            // skipTarget: the structure's own solid tile must not block
            // sight of the structure itself.
            if (!game.map.hasLineOfSight(unit.x, unit.y, structure.x, structure.y, { skipTarget: true })) continue;
            swarm.intel.revealStructure(structure);
            const base = game.bases.find((b) => b.structures.includes(structure));
            if (base?.alive && structure.team !== factionId) {
                swarm.intel.revealObjective(base, BASE_STRUCTURES.baseHQ.objectivePriority ?? 1);
            }
        }
    }
}

/** Destroyed knowledge is forgotten — and a dead objective's food is
 *  erased on the spot, so the swarm never marches on a corpse. */
function pruneIntel(swarm) {
    for (const rec of swarm.intel.pruneDead()) {
        swarm.fields.clearAround("food", rec.x, rec.y, 6);
    }
}

/* ── deposits ─────────────────────────────────────────────── */

function tickDeposits(game, swarm, factionId) {
    const tuning = swarm.tuning;
    const fields = swarm.fields;

    for (const t of game.allTanks) {
        if (!t.alive) continue;
        if (t.team !== factionId) continue;
        trackTravel(swarm, t, tuning.FIELD_TICK);

        fields.deposit("visited", t.x, t.y, tuning.VISITED_DEPOSIT);
        fields.deposit("trail", t.x, t.y, tuning.TRAIL_DEPOSIT);

        t.underAttack = t.lastHitAt != null && game.gameTime - t.lastHitAt < tuning.ALARM_MEMORY;
        if (t.underAttack) fields.deposit("alarm", t.x, t.y, tuning.ALARM_DEPOSIT);
    }

    for (const obj of swarm.intel.objectives()) {
        fields.deposit("food", obj.x, obj.y, tuning.FOOD_DEPOSIT);
        // Personal sighting: a unit "finds" an objective the same way the
        // faction did — sight + LOS of any of the objective's structures
        // (a compound's presence spans its walls, not just its centre).
        const structures = obj.entity.structures ?? [obj.entity];
        for (const t of game.allTanks) {
            if (!t.alive || t.team !== factionId || t.objectivesSeen.has(obj.entity)) continue;
            for (const s of structures) {
                if (!s.alive) continue;
                const d = Math.hypot(s.x - t.x, s.y - t.y);
                if (d > tuning.SIGHT_RANGE) continue;
                if (!game.map.hasLineOfSight(t.x, t.y, s.x, s.y, { skipTarget: true })) continue;
                t.objectivesSeen.add(obj.entity);
                lightRoute(swarm, t, tuning);
                break;
            }
        }
    }

    for (const { ai, tank } of game.bots) {
        if (tank.team !== factionId || !tank.alive) continue;
        // A bot leads a convoy while moving or while actively pursuing a
        // goal; a parked, purposeless bot leads nothing (no idle-blob
        // gravity wells) — but a besieging leader keeps its convoy
        // massed.  A track-crippled vehicle can never lead: it fights on
        // as a casualty, but the column must not wait for it.
        tank.convoyLeadable =
            !tank.trackDamaged &&
            ((tank.recentSpeed ?? 0) >= 0.5 || ["objective", "trail", "rally"].includes(ai.currentGoal?.kind));
        tank.pursuingObjective = ai.currentGoal?.kind === "objective";
    }
}

/**
 * A discoverer's walked path lights up as a followable route.  The
 * deposit is a GRADIENT: values rise toward the objective end of the
 * path, so following the strongest nearby cell traces the route around
 * obstacles — including legs that temporarily lead away from the
 * objective (detours), which a straight-line progress filter can never
 * represent.  Shorter journeys lay stronger routes (their gradient runs
 * hotter), and every follower that reaches the objective reinforces its
 * own path — so the colony's routes optimize over time.
 */
function lightRoute(swarm, t, tuning) {
    const len = t.routeHistory.length;
    if (len === 0) return;
    const base = tuning.TRAIL_LIT / (1 + len / tuning.TRAIL_LIT_NORM);
    for (let i = 0; i < len; i++) {
        const idx = t.routeHistory[i];
        const x = (idx % swarm.fields.width) + 0.5;
        const y = Math.floor(idx / swarm.fields.width) + 0.5;
        // 0.5–1.0 of base, rising toward the objective end of the path
        swarm.fields.depositMax("route", x, y, base * (0.5 + 0.5 * ((i + 1) / len)));
    }
}

/** Keep a smoothed recent speed (a bot only leads a convoy while it's
 *  actually going somewhere) and append the unit's tile to its route
 *  history when it enters a new one. */
function trackTravel(swarm, t, tickInterval) {
    const last = swarm._lastPos.get(t);
    if (last) {
        const dist = Math.hypot(t.x - last.x, t.y - last.y);
        t.recentSpeed = (t.recentSpeed ?? 0) * 0.6 + (dist / tickInterval) * 0.4;
    }
    const idx = Math.floor(t.y) * swarm.fields.width + Math.floor(t.x);
    if (t.routeHistory[t.routeHistory.length - 1] !== idx) {
        t.routeHistory.push(idx);
        if (t.routeHistory.length > ROUTE_HISTORY_LIMIT) t.routeHistory.shift();
    }
    swarm._lastPos.set(t, { x: t.x, y: t.y });
}
