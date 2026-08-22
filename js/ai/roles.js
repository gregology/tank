/**
 * AI role strategies: where to navigate and what to shoot at.
 *
 * Each role (cavalry / sniper / defender / scout) is a plain strategy
 * object with a `goal(ai, ctx)` hook, dispatched by
 * `chooseGoalAndTarget` from the bot's `ai.role`.  The no-role fallback
 * (duel modes) is `DEFAULT_ROLE`.  A new role is a new entry in
 * `ROLE_STRATEGIES` — no changes anywhere else.
 *
 * The strategy receives the controller (`ai`, for per-life state held on
 * the opaque `ai.roleState` object) and a context object
 * `{ dt, me, enemies, map, objective }`; each hook destructures only
 * what it needs.  This is the seam for future group behaviour: a
 * "column" or "pheromone" strategy would read shared swarm state from
 * the context (or the map) instead of computing its own goal.
 *
 * Shared position scoring (`findBestPosition` / `computeFlankPoint`) lives
 * in `js/ai/positioning.js`; per-role per-life state lives on the
 * controller's opaque `roleState` object.
 */

import { CONFIG, VEHICLES } from "../config.js";
import { computeFlankPoint, findBestPosition } from "./positioning.js";
import { bestTarget, targetPriorityOf } from "./targeting.js";

/* ── Role names ───────────────────────────────────────────── */

export const AI_ROLES = {
    CAVALRY: "cavalry",
    SNIPER: "sniper",
    DEFENDER: "defender",
    SCOUT: "scout",
};

/**
 * Pick a random role using per-vehicle weighted selection.
 * Each vehicle type in VEHICLES has its own roleWeights map.
 * A weight of 0 means that role is never assigned.
 *
 * @param {string} vehicleType  'tank', 'ifv', or 'drone'
 */
export function pickRoleForVehicle(vehicleType = "tank", rng = Math.random) {
    const w = VEHICLES[vehicleType]?.roleWeights ?? VEHICLES.tank.roleWeights;
    const entries = Object.entries(w).filter(([, v]) => v > 0);
    if (entries.length === 0) return AI_ROLES.CAVALRY; // fallback
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let r = rng() * total;
    for (const [role, weight] of entries) {
        r -= weight;
        if (r <= 0) return role;
    }
    return entries[entries.length - 1][0];
}

/**
 * Dispatch to the role strategy for choosing where to navigate and what
 * to shoot at.  Falls back to the original "charge at objective"
 * behaviour when no role is set (duel modes) or no objective exists.
 *
 * @returns {{ navGoal: {x,y}|null, fireTarget: {x,y,dist}|null }}
 */
export function chooseGoalAndTarget(ai, dt, me, enemies, map, objective) {
    const strategy = ai.role && objective ? ROLE_STRATEGIES[ai.role] : null;
    return (strategy ?? DEFAULT_ROLE).goal(ai, { dt, me, enemies, map, objective });
}

export const ROLE_STRATEGIES = {
    /* ── Cavalry: aggressive rush to enemy tower ──────────── */

    cavalry: {
        goal(ai, { me, enemies, objective }) {
            const navGoal = { x: objective.x, y: objective.y };
            let fireTarget = null;

            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
            if (objDist < CONFIG.OBJECTIVE_ENGAGE_RANGE) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }

            // Engage nearby enemies (don't detour to chase — just shoot)
            const bestEnemy = bestTarget(ai, me, enemies);
            if (bestEnemy && bestEnemy.dist < 10) {
                fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
            }

            return { navGoal, fireTarget };
        },
    },

    /* ── Sniper: find firing position, bombard from range ─── */

    sniper: {
        goal(ai, { me, enemies, map, objective }) {
            let navGoal = null;
            let fireTarget = null;

            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
            const fireRange = CONFIG.SNIPER_FIRE_RANGE;
            const minRange = CONFIG.SNIPER_MIN_RANGE;

            // Phase 0: compute firing position + flank waypoint (once per life)
            if (!ai.roleState.sniperPos) {
                ai.roleState.sniperPos = findBestPosition(
                    me,
                    objective,
                    map,
                    CONFIG.SNIPER_POSITION_WEIGHTS,
                    fireRange,
                );
                // Flank waypoint toward the firing position so the sniper
                // doesn't walk in a straight line.
                ai.roleState.flankPoint = computeFlankPoint(
                    me,
                    ai.roleState.sniperPos,
                    map,
                    CONFIG.SNIPER_POSITION_WEIGHTS,
                );
            }

            const posReached =
                ai.roleState.sniperPos &&
                Math.hypot(ai.roleState.sniperPos.x - me.x, ai.roleState.sniperPos.y - me.y) < 2;

            // Phase 1: flank toward the firing position
            if (!ai.roleState.flankReached && ai.roleState.flankPoint) {
                const flankDist = Math.hypot(ai.roleState.flankPoint.x - me.x, ai.roleState.flankPoint.y - me.y);
                if (flankDist < 3) {
                    ai.roleState.flankReached = true;
                } else {
                    navGoal = { x: ai.roleState.flankPoint.x, y: ai.roleState.flankPoint.y };
                    // Fire at tower if already in range while flanking
                    if (objDist < fireRange + CONFIG.SNIPER_FIRE_MARGIN) {
                        fireTarget = { x: objective.x, y: objective.y, dist: objDist };
                    }
                }
            }

            // Phase 2: navigate to firing position or hold
            if (!navGoal) {
                if (posReached) {
                    navGoal = { x: me.x, y: me.y };
                    if (objDist < fireRange + CONFIG.SNIPER_FIRE_MARGIN) {
                        fireTarget = { x: objective.x, y: objective.y, dist: objDist };
                    }
                } else if (objDist < minRange) {
                    // Too close — back off
                    const awayAngle = Math.atan2(me.y - objective.y, me.x - objective.x);
                    navGoal = {
                        x: objective.x + Math.cos(awayAngle) * fireRange,
                        y: objective.y + Math.sin(awayAngle) * fireRange,
                    };
                    fireTarget = { x: objective.x, y: objective.y, dist: objDist };
                } else {
                    navGoal = ai.roleState.sniperPos || { x: objective.x, y: objective.y };
                    if (objDist < fireRange + CONFIG.SNIPER_FIRE_MARGIN) {
                        fireTarget = { x: objective.x, y: objective.y, dist: objDist };
                    }
                }
            }

            // Self-defence: engage enemies only when very close
            const bestEnemy = bestTarget(ai, me, enemies);
            if (bestEnemy && bestEnemy.dist < CONFIG.SNIPER_ENGAGE_RANGE) {
                fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
            }

            return { navGoal, fireTarget };
        },
    },

    /* ── Defender: patrol and guard friendly tower ────────── */

    defender: {
        goal(ai, { dt, me, enemies, objective }) {
            let navGoal = null;
            let fireTarget = null;

            const ft = ai.friendlyBase;
            if (!ft?.alive) {
                // Friendly base destroyed — fall back to cavalry rush
                return ROLE_STRATEGIES.cavalry.goal(ai, { me, enemies, objective });
            }

            // Check for enemies near the friendly tower (filtered by priority)
            const engageRange = CONFIG.DEFENDER_ENGAGE_RANGE;
            const priorities = VEHICLES[me.vehicleType]?.targetPriority ?? {};
            let closestThreat = null,
                closestDist = Infinity;
            for (const e of enemies) {
                if (!e.alive) continue;
                if (targetPriorityOf(priorities, e.targetType) <= 0) continue;
                const d = Math.hypot(e.x - ft.x, e.y - ft.y);
                if (d < engageRange && d < closestDist) {
                    closestThreat = e;
                    closestDist = d;
                }
            }

            if (closestThreat) {
                // Intercept the closest threat to our tower
                navGoal = { x: closestThreat.x, y: closestThreat.y };
                fireTarget = {
                    x: closestThreat.x,
                    y: closestThreat.y,
                    dist: Math.hypot(closestThreat.x - me.x, closestThreat.y - me.y),
                };
            } else {
                // Patrol around friendly tower (lazily initialised here so the
                // role owns its own state, not the controller).
                if (ai.roleState.patrolAngle == null) ai.roleState.patrolAngle = ai.rng() * Math.PI * 2;
                if (ai.roleState.patrolTimer == null) ai.roleState.patrolTimer = 0;
                ai.roleState.patrolTimer -= dt;
                if (ai.roleState.patrolTimer <= 0) {
                    ai.roleState.patrolAngle += 0.8 + ai.rng() * 1.0;
                    ai.roleState.patrolTimer = 3.0 + ai.rng() * 2.0;
                }
                const r = CONFIG.DEFENDER_PATROL_RADIUS;
                navGoal = {
                    x: ft.x + Math.cos(ai.roleState.patrolAngle) * r,
                    y: ft.y + Math.sin(ai.roleState.patrolAngle) * r,
                };

                // Fire at any enemy within personal range
                const bestEnemy = bestTarget(ai, me, enemies);
                if (bestEnemy && bestEnemy.dist < 10) {
                    fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
                }
            }

            return { navGoal, fireTarget };
        },
    },

    /* ── Scout: wide flanking route to enemy tower ────────── */

    scout: {
        goal(ai, { me, enemies, map, objective }) {
            let navGoal = null;
            let fireTarget = null;

            // Compute flank waypoint once per life
            if (!ai.roleState.flankPoint) {
                ai.roleState.flankPoint = computeFlankPoint(me, objective, map);
            }

            const flankDist = Math.hypot(ai.roleState.flankPoint.x - me.x, ai.roleState.flankPoint.y - me.y);
            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);

            // Once we reach the flank point, lock into phase 2 permanently
            if (!ai.roleState.flankReached && flankDist < 3) {
                ai.roleState.flankReached = true;
            }

            if (!ai.roleState.flankReached) {
                // Phase 1: navigate to flank point
                navGoal = { x: ai.roleState.flankPoint.x, y: ai.roleState.flankPoint.y };
            } else {
                // Phase 2: rush the tower from the flank
                navGoal = { x: objective.x, y: objective.y };
            }

            // Fire at tower when in range
            if (objDist < CONFIG.OBJECTIVE_ENGAGE_RANGE) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }

            // Only engage enemies that are very close (self-defence)
            const bestEnemy = bestTarget(ai, me, enemies);
            if (bestEnemy && bestEnemy.dist < 6) {
                fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
            }

            return { navGoal, fireTarget };
        },
    },
};

/* ── Default (no role / duel modes): charge at the objective ── */

const DEFAULT_ROLE = {
    goal(ai, { me, enemies, objective }) {
        const bestEnemy = bestTarget(ai, me, enemies);
        let navGoal = null;
        let fireTarget = null;

        if (objective) {
            navGoal = { x: objective.x, y: objective.y };
            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
            if (objDist < CONFIG.OBJECTIVE_ENGAGE_RANGE) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }
        }

        if (bestEnemy && bestEnemy.dist < 10) {
            fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
            if (!objective && bestEnemy.dist < 8) {
                navGoal = { x: bestEnemy.target.x, y: bestEnemy.target.y };
            }
        }

        if (!navGoal && bestEnemy) {
            navGoal = { x: bestEnemy.target.x, y: bestEnemy.target.y };
            fireTarget = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
        }

        return { navGoal, fireTarget };
    },
};
