/**
 * IFV behaviour — an autocannon-armed vehicle with a fixed forward gun.
 *
 * Shares the direct-fire `fire` with tanks (the muzzle-flash and sound
 * differences are data-driven in VEHICLES.ifv) and overrides only the
 * AI aim: the IFV fires opportunistically without overriding navigation,
 * so it shoots when the hull happens to face near a target.
 */

import { ACTIONS } from "../config.js";
import { angleDiff } from "../utils.js";
import { tank } from "./tank.js";

export const ifv = {
    ...tank,

    aim(ai, me, { target }, map) {
        const desiredWorld = Math.atan2(target.y - me.y, target.x - me.x);
        if (Math.abs(angleDiff(me.turretWorld, desiredWorld)) > 0.4) return;
        if (ai.fireDelay > 0) return;

        if (map.hasLineOfSight(me.x, me.y, target.x, target.y)) {
            ai.keys[ACTIONS.fire] = true;
            ai.fireDelay = 0.1 + ai.rng() * 0.08;
        }
    },
};
