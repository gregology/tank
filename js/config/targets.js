/**
 * Target-type vocabulary and class-based priority defaults.
 *
 * `TARGET_TYPES` is the canonical list of every targetable kind (vehicle
 * types + base-structure types).  `TARGET_CLASS_DEFAULTS` gives each class
 * a sensible priority, so a NEW target type is a single entry here — it
 * inherits its class's default weight for every shooter, and a shooter
 * overrides it only when it cares (see `targetPriorityOf` in
 * js/ai/targeting.js).  This replaces the old "add a new target type and
 * edit every shooter's targetPriority row" (O(N²)) with a class default
 * plus per-shooter overrides.
 */

export const TARGET_TYPES = Object.freeze({
    tank: { class: "vehicle" },
    ifv: { class: "vehicle" },
    spg: { class: "vehicle" },
    drone: { class: "air" },
    squad: { class: "infantry" },
    baseWall: { class: "structure" },
    baseTower: { class: "structure" },
    baseHQ: { class: "structure" },
});

/** Default priority weight per target class (0 = never engage by default). */
export const TARGET_CLASS_DEFAULTS = Object.freeze({
    vehicle: 5,
    air: 3,
    infantry: 5,
    structure: 5,
});
