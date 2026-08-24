/**
 * Signal system — the per-frame pheromone pass.
 *
 * Owns decay and every deposit into the per-faction SignalFields
 * (js/ai/signals.js):
 *
 *   recruit — every alive vehicle emits at its tile; human-driven
 *             vehicles emit SIGNAL_HUMAN_EMIT× stronger so bots fall in
 *             behind a human convoy leader.
 *   alarm   — a vehicle whose underAttackTimer is running (set by the
 *             `hit` event) broadcasts at its own position.  Only alive
 *             vehicles broadcast: the signal dies with the victim.
 *   trail   — vehicles whose faction knows an objective mark their
 *             route; strength falls off with journey length so shorter
 *             routes win (depositMax keeps the strongest per tile).
 *   food    — every known, alive objective gets a beacon at its
 *             position.  A destroyed objective stops being refreshed
 *             and its beacon decays away.
 *
 * The fields are read by the swarm arbitration (js/ai/arbitration.js).
 */

import { CONFIG, VEHICLES } from "../config.js";

export function runSignals(game, dt) {
    for (const faction of game.factions) faction.signals.decay(dt);

    for (const tank of game.allTanks) {
        if (!tank.alive) continue;
        const faction = game.factions.find((f) => f.id === tank.team);
        if (!faction) continue;
        const signals = VEHICLES[tank.vehicleType].signals;
        const emit = game.humanTanks.includes(tank) ? CONFIG.SIGNAL_HUMAN_EMIT : 1;

        faction.signals.deposit("recruit", tank.x, tank.y, signals.recruit * emit * dt);

        if (tank.underAttackTimer > 0) {
            tank.underAttackTimer -= dt;
            faction.signals.deposit("alarm", tank.x, tank.y, CONFIG.SIGNAL_ALARM_STRENGTH * dt);
        }

        if (hasKnownObjective(faction)) {
            const falloff = 1 + tank.distanceTravelled * CONFIG.SIGNAL_TRAIL_DISTANCE_FACTOR;
            faction.signals.depositMax("trail", tank.x, tank.y, (signals.trail * emit) / falloff);
        }
    }

    for (const faction of game.factions) {
        for (const objective of faction.knownObjectives) {
            if (!objective.alive) continue;
            const rate = CONFIG.SIGNAL_FOOD_STRENGTH * (objective.priority ?? 1) * dt;
            faction.signals.deposit("food", objective.x, objective.y, rate);
        }
    }
}

function hasKnownObjective(faction) {
    for (const objective of faction.knownObjectives) {
        if (objective.alive) return true;
    }
    return false;
}
