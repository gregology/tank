/**
 * Base structure definitions.
 *
 * Parallel to VEHICLES — every gameplay value that varies between
 * structure types lives here.  targetPriority only appears on
 * structures that can shoot (baseTower).
 */
export const BASE_STRUCTURES = {
    baseWall: {
        hp: 3,
        size: 0.5,
        visHeight: 10,
    },
    baseTower: {
        hp: 5,
        size: 0.5,
        visHeight: 20,
        fireRange: 15,
        bulletSpeed: 13.0,
        bulletDamage: 0.1,
        bulletCooldown: 0.15,
        targetPriority: { spg: 3, tank: 3, drone: 10, ifv: 3, squad: 5 },
    },
    baseHQ: {
        hp: 20,
        size: 0.5,
        visHeight: 14,
    },
};
