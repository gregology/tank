/**
 * Vehicle behaviour dispatch — the single strategy table keyed by
 * `vehicleType`.  Game and AI code never branch on the type string;
 * they call `getVehicleBehaviour(tank.vehicleType)` and use the hooks.
 *
 * Adding a new vehicle type: one module here (or a reused behaviour)
 * + one VEHICLES entry in config.js.  A new *class* of vehicle (e.g.
 * a flying gunship) can also override only the hooks it differs on —
 * `{ ...tank, fire: myFire }` — instead of touching Game.
 */

import { VEHICLES } from "../config.js";
import { drone } from "./drone.js";
import { ifv } from "./ifv.js";
import { spg } from "./spg.js";
import { squad } from "./squad.js";
import { tank } from "./tank.js";

export const VEHICLE_BEHAVIOURS = {
    tank,
    ifv,
    drone,
    spg,
    squad,
};

/** Look up the behaviour strategy for a vehicle type (defaults to the tank). */
export function getVehicleBehaviour(type) {
    return VEHICLE_BEHAVIOURS[type] ?? tank;
}

/** Pick a random vehicle type from an allowed list using spawn weights. */
export function pickVehicleType(allowed, rng = Math.random) {
    if (allowed.length === 1) return allowed[0];
    const entries = allowed.map((t) => [t, VEHICLES[t]]);
    const total = entries.reduce((s, [, v]) => s + v.spawnWeight, 0);
    let r = rng() * total;
    for (const [type, v] of entries) {
        r -= v.spawnWeight;
        if (r <= 0) return type;
    }
    return entries[entries.length - 1][0];
}
