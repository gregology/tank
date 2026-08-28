/**
 * Vehicle information for the menu screens: the info pages (name,
 * tagline, colours, description) and the stat-bar comparison.
 *
 * The stat bars derive from VEHICLES (config.js) through the
 * `STAT_METRICS` table — one declarative row per bar.  Values are
 * player-facing simplifications, not raw gameplay numbers.
 */

import { VEHICLES } from "../config.js";

export const VEHICLE_INFO = [
    {
        type: "tank",
        name: "TANK",
        tagline: "Main Battle Tank",
        color: "#cc3333",
        dark: "#882222",
        desc: [
            "The backbone of any fighting force.",
            "Independent rotating turret lets you",
            "aim while driving in any direction.",
            "",
            "2-hit directional armour system:",
            " \u2022 Front hit \u2192 turret disabled",
            " \u2022 Side hit  \u2192 track disabled",
            " \u2022 Rear hit  \u2192 instant kill",
            " \u2022 2nd hit   \u2192 destroyed",
        ],
    },
    {
        type: "ifv",
        name: "IFV",
        tagline: "Infantry Fighting Vehicle",
        color: "#3366dd",
        dark: "#223399",
        desc: [
            "Fast wheeled recon vehicle with a",
            "rapid-fire autocannon. Fixed forward",
            "gun \u2014 aim by steering the hull.",
            "",
            "High speed makes it perfect for",
            "flanking and scouting. Very fragile:",
            "any single hit is an instant kill.",
            "",
            "4 shots = 1 tank shell of damage.",
        ],
    },
    {
        type: "drone",
        name: "DRONE",
        tagline: "Kamikaze Quadcopter",
        color: "#44bb44",
        dark: "#228822",
        desc: [
            "Extremely fast first-person-view drone",
            "that flies over ALL terrain including",
            "water, hills, rocks, and buildings.",
            "",
            "No gun \u2014 press FIRE to detonate!",
            "Deals area-of-effect blast damage",
            "that falls off with distance.",
            "",
            "One-use: always self-destructs.",
        ],
    },
    {
        type: "spg",
        name: "SPG",
        tagline: "Self-Propelled Gun",
        color: "#dd8833",
        dark: "#885522",
        desc: [
            "Heavy artillery that lobs shells in",
            "a high arc OVER terrain obstacles.",
            "",
            "HOLD fire to charge range, then",
            "RELEASE to launch. Longer hold =",
            "longer range (up to 25 units).",
            "",
            "Devastating splash damage on impact.",
            "Slow and fragile \u2014 stay at range!",
        ],
    },
    {
        type: "squad",
        name: "SQUAD",
        tagline: "Infantry Fireteam",
        color: "#55aa44",
        dark: "#337722",
        desc: [
            "Five-man squad that fights on its own.",
            "Each member auto-fires at its target:",
            " \u2022 Rocket-propelled grenade \u2192 vehicles",
            " \u2022 Shotgun                  \u2192 drones",
            " \u2022 Rifles / machine guns    \u2192 enemy squads",
            "",
            "Members drop as the squad takes hits.",
            "FIRE to dig in; buildings give cover.",
        ],
    },
];

/**
 * One row per stat bar.  `value(vehicle, type)` returns the raw value;
 * the bars cap it at `max` and render one decimal.
 */
export const STAT_METRICS = [
    { label: "SPEED", key: "speed", max: 7, value: (v) => v.speed },
    // Player-facing simplifications override the raw gameplay numbers via
    // explicit `display*` fields on VEHICLES (see config/vehicles.js).
    { label: "DAMAGE", key: "dmg", max: 2, value: (v) => v.displayDamage ?? v.blastDamage ?? v.bulletDamage ?? 0 },
    { label: "ARMOUR", key: "armour", max: 3, value: (v) => v.displayArmour ?? 1 },
    {
        label: "FIRE RATE",
        key: "rof",
        max: 6,
        value: (v) =>
            v.firesBullets === false ? null : (v.displayFireRate ?? (v.bulletCooldown > 0 ? 1 / v.bulletCooldown : 0)),
    },
];

/** Raw stat-bar value for a vehicle type and metric key. */
export function getStatValue(type, key) {
    const metric = STAT_METRICS.find((m) => m.key === key);
    return metric ? metric.value(VEHICLES[type], type) : 0;
}

/**
 * Player-facing stat summary for a vehicle, derived from `VEHICLES` (the
 * data leaf) — speed and turret come straight from the table, while damage
 * and fire-rate read the explicit `displayDmg` / `displayRoF` labels.
 */
export function vehicleStats(type) {
    const v = VEHICLES[type];
    return {
        SPEED: v.speed,
        ARMOUR: v.displayArmour ?? 1,
        DAMAGE: v.displayDmg,
        "RATE OF FIRE": v.displayRoF,
        TURRET: v.turret === "independent" ? "Yes" : "No",
    };
}
