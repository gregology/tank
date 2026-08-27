/**
 * Base structure definitions.
 *
 * Parallel to VEHICLES — every gameplay value that varies between
 * structure types lives here.  targetPriority only appears on
 * structures that can shoot (baseTower).
 *
 * isObjective + objectivePriority drive the swarm's food signal: only
 * objective structures attract the swarm once discovered, and higher
 * priority objectives win when several are known (the seam for a
 * future mode with multiple capturable objectives).
 */
export const BASE_STRUCTURES = {
    baseWall: {
        hp: 8, // a breach takes ~3 shell hits — rushes cost time, the colony can rally
        size: 0.5,
        visHeight: 10,
        category: "wall",
    },
    baseTower: {
        hp: 5,
        size: 0.5,
        visHeight: 20,
        isShooter: true,
        fireRange: 15,
        bulletSpeed: 13.0,
        bulletDamage: 0.1,
        bulletCooldown: 0.15,
        fireSound: "ifv",
        targetPriority: { spg: 3, tank: 3, drone: 10, ifv: 3, squad: 5 },
        category: "tower",
    },
    baseHQ: {
        hp: 20,
        size: 0.5,
        visHeight: 14,
        category: "hq",
        isObjective: true,
        objectivePriority: 10,
    },
};
