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
