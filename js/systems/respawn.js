/**
 * Respawn system — revive dead tanks and re-roll their vehicle/role.
 *
 * This used to live as `Game._handleRespawns`.  The mode strategy decides
 * *where* a tank respawns (battle: inside the compound; skirmish: the spot
 * reserved at kill time); this system owns the countdown, the vehicle-type
 * re-roll, and the AI role/life reset.
 */

import { pickRoleForVehicle } from "../ai.js";
import { pickVehicleType } from "../vehicles/index.js";

/** Count down respawn timers and revive tanks whose timer has elapsed. */
export function handleRespawns(game, dt) {
    for (const t of game.allTanks) {
        if (t.alive) continue;
        t.respawnTimer -= dt;
        if (t.respawnTimer <= 0) {
            const sp = game.mode.respawn(game, t);
            if (sp) t.respawnAt(sp.x, sp.y);
            t.alive = true;
            t.flashTimer = 1;
            // Re-randomise vehicle type on respawn.
            t.vehicleType = pickVehicleType(game.typeDef.vehicles);
            // Re-assign AI role for bots (via the public world-model handle).
            const bot = game.getBot(t);
            if (bot) {
                bot.ai.role = pickRoleForVehicle(t.vehicleType);
                bot.ai.resetLife();
            }
        }
    }
}
