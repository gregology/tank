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
 *      trail   — units en route to an objective, strength ∝ 1/distance
 *                travelled, so shorter journeys lay stronger routes
 *   3. ticks every faction's fields (decay + diffusion).
 *
 * The system reads only observable state (positions, lastHitAt, the
 * bot's current goal kind) — vehicles never call into each other.
 */

import { BASE_STRUCTURES } from "../config.js";

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

        t.underAttack = t.lastHitAt != null && game.gameTime - t.lastHitAt < tuning.ALARM_MEMORY;
        if (t.underAttack) fields.deposit("alarm", t.x, t.y, tuning.ALARM_DEPOSIT);
    }

    for (const obj of swarm.intel.objectives()) {
        fields.deposit("food", obj.x, obj.y, tuning.FOOD_DEPOSIT);
    }

    for (const { ai, tank } of game.bots) {
        if (tank.team !== factionId || !tank.alive) continue;
        // A bot leads a convoy while moving or while actively pursuing a
        // goal; a parked, purposeless bot leads nothing (no idle-blob
        // gravity wells) — but a besieging leader keeps its convoy massed.
        tank.convoyLeadable =
            (tank.recentSpeed ?? 0) >= 0.5 || ["objective", "trail", "rally"].includes(ai.currentGoal?.kind);
        tank.pursuingObjective = ai.currentGoal?.kind === "objective";
        const goal = ai.currentGoal;
        if (goal?.kind !== "objective" && goal?.kind !== "trail") continue;
        const strength = tuning.TRAIL_DEPOSIT / (1 + tank.distanceTravelled / 10);
        fields.deposit("trail", tank.x, tank.y, strength);
    }
}

/** Accumulate distance travelled (drives the trail-strength falloff)
 *  and keep a smoothed recent speed (a bot only leads a convoy while
 *  it's actually going somewhere). */
function trackTravel(swarm, t, tickInterval) {
    const last = swarm._lastPos.get(t);
    if (last) {
        const dist = Math.hypot(t.x - last.x, t.y - last.y);
        t.distanceTravelled += dist;
        t.recentSpeed = (t.recentSpeed ?? 0) * 0.6 + (dist / tickInterval) * 0.4;
    }
    swarm._lastPos.set(t, { x: t.x, y: t.y });
}
