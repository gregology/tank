/**
 * Discovery system — faction knowledge of enemy objectives.
 *
 * Objectives (today: the enemy base; the abstraction exists so future
 * modes can add more, e.g. capture points) are not omnisciently known:
 * a faction learns about one when one of its units gets within sight
 * range with a clear line of sight.  Known objectives live on the
 * faction's `knownObjectives` set, and the mode strategy's `aiObjective`
 * only ever returns a *known* objective — an undiscovered objective is
 * invisible to that faction's bots.
 *
 * The `objective_discovered` event is the seam the pheromone "food"
 * beacon will subscribe to: discovery is what attracts the swarm.
 */

import { CONFIG } from "../config.js";
import { GAME_EVENTS } from "../events.js";

/** Add newly sighted objectives to each faction's known-objective set. */
export function runDiscovery(game) {
    for (const faction of game.factions) {
        for (const objective of game.mode.potentialObjectives(game, faction)) {
            if (!objective.alive || faction.knownObjectives.has(objective)) continue;
            if (!spottedByAny(game, faction, objective)) continue;
            faction.knownObjectives.add(objective);
            game.emit(GAME_EVENTS.OBJECTIVE_DISCOVERED, { faction, objective });
        }
    }
}

/**
 * True if any alive unit of the faction can see the objective.  A
 * compound objective (a Base) is spotted when *any* of its structures
 * is visible — the HQ hides behind its own walls, so seeing the wall
 * ring is what "discovering the base" means.
 */
function spottedByAny(game, faction, objective) {
    const range = CONFIG.OBJECTIVE_DISCOVERY_RANGE;
    const targets = objective.allStructures ?? [objective];
    for (const e of faction.entities) {
        if (!e.alive) continue;
        for (const t of targets) {
            if (!t.alive) continue;
            if (Math.hypot(t.x - e.x, t.y - e.y) > range) continue;
            if (game.map.hasLineOfSight(e.x, e.y, t.x, t.y, { skipTarget: true })) return true;
        }
    }
    return false;
}
