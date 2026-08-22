/**
 * AI role strategies: where to navigate and what to shoot at.
 *
 * Each role (cavalry / sniper / defender / scout) is a plain strategy
 * object with a `goal(ai, ctx)` hook, dispatched by
 * `chooseGoalAndTarget` from the bot's `ai.role`.  The no-role fallback
 * (duel modes) is `DEFAULT_ROLE`.  A new role is a new entry in
 * `ROLE_STRATEGIES` — no changes anywhere else.
 *
 * The strategy receives the controller (`ai`, for per-life state like
 * `_sniperPos` / `_flankPoint` / patrol angle) and a context object
 * `{ dt, me, enemies, map, objective }`; each hook destructures only
 * what it needs.  This is the seam for future group behaviour: a
 * "column" or "pheromone" strategy would read shared swarm state from
 * the context (or the map) instead of computing its own goal.
 *
 * `findBestPosition` / `computeFlankPoint` are the shared position
 * scoring used by the sniper and scout (per-role weights in CONFIG).
 */

import { CONFIG, VEHICLES } from "../config.js";
import { bestTarget } from "./targeting.js";

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
    if (entries.length === 0) return "cavalry"; // fallback
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
            if (objDist < 25) {
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
            if (!ai._sniperPos) {
                ai._sniperPos = findBestPosition(me, objective, map, CONFIG.SNIPER_POSITION_WEIGHTS, fireRange);
                // Flank waypoint toward the firing position so the sniper
                // doesn't walk in a straight line.
                ai._flankPoint = computeFlankPoint(me, ai._sniperPos, map, CONFIG.SNIPER_POSITION_WEIGHTS);
            }

            const posReached = ai._sniperPos && Math.hypot(ai._sniperPos.x - me.x, ai._sniperPos.y - me.y) < 2;

            // Phase 1: flank toward the firing position
            if (!ai._flankReached && ai._flankPoint) {
                const flankDist = Math.hypot(ai._flankPoint.x - me.x, ai._flankPoint.y - me.y);
                if (flankDist < 3) {
                    ai._flankReached = true;
                } else {
                    navGoal = { x: ai._flankPoint.x, y: ai._flankPoint.y };
                    // Fire at tower if already in range while flanking
                    if (objDist < fireRange + 5) {
                        fireTarget = { x: objective.x, y: objective.y, dist: objDist };
                    }
                }
            }

            // Phase 2: navigate to firing position or hold
            if (!navGoal) {
                if (posReached) {
                    navGoal = { x: me.x, y: me.y };
                    if (objDist < fireRange + 5) {
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
                    navGoal = ai._sniperPos || { x: objective.x, y: objective.y };
                    if (objDist < fireRange + 5) {
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
                if ((priorities[e.targetType] ?? 1) <= 0) continue;
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
                // Patrol around friendly tower
                ai._patrolTimer -= dt;
                if (ai._patrolTimer <= 0) {
                    ai._patrolAngle += 0.8 + ai.rng() * 1.0;
                    ai._patrolTimer = 3.0 + ai.rng() * 2.0;
                }
                const r = CONFIG.DEFENDER_PATROL_RADIUS;
                navGoal = {
                    x: ft.x + Math.cos(ai._patrolAngle) * r,
                    y: ft.y + Math.sin(ai._patrolAngle) * r,
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
            if (!ai._flankPoint) {
                ai._flankPoint = computeFlankPoint(me, objective, map);
            }

            const flankDist = Math.hypot(ai._flankPoint.x - me.x, ai._flankPoint.y - me.y);
            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);

            // Once we reach the flank point, lock into phase 2 permanently
            if (!ai._flankReached && flankDist < 3) {
                ai._flankReached = true;
            }

            if (!ai._flankReached) {
                // Phase 1: navigate to flank point
                navGoal = { x: ai._flankPoint.x, y: ai._flankPoint.y };
            } else {
                // Phase 2: rush the tower from the flank
                navGoal = { x: objective.x, y: objective.y };
            }

            // Fire at tower when in range
            if (objDist < 25) {
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
            if (objDist < 25) {
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

/* ════════════════════════════════════════════════════════════ *
 *  Position scoring — shared by sniper & scout                  *
 * ════════════════════════════════════════════════════════════ */

/**
 * Evaluate candidate positions around the objective and return
 * the best one according to weighted scoring criteria.
 *
 * Criteria (all normalised to 0–1 before weighting):
 *   cover — projectile-blocking tiles within POSITION_COVER_RADIUS
 *   flank — perpendicular offset from the direct me→objective line
 *   range — closeness to idealRange from the objective
 *   los   — clear line-of-sight to the objective
 *
 * @param {object}  me         bot's current position
 * @param {object}  objective  target position
 * @param {object}  map        GameMap
 * @param {object}  weights    { cover, flank, range, los }
 * @param {number}  idealRange distance from objective to sample candidates
 * @returns {{ x: number, y: number }}
 */
export function findBestPosition(me, objective, map, weights, idealRange) {
    const samples = CONFIG.POSITION_SAMPLES;
    const coverR = CONFIG.POSITION_COVER_RADIUS;

    // Direct line from me to objective (for flank scoring)
    const dirX = objective.x - me.x;
    const dirY = objective.y - me.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    // Unit perpendicular vector
    const perpX = -dirY / dirLen;
    const perpY = dirX / dirLen;

    let bestPos = null;
    let bestScore = -Infinity;

    // Find the max possible cover in the area for normalisation
    let maxCover = 1;
    const candidateList = [];

    for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        // Try multiple radii: ideal range, and slightly closer/farther
        for (const rFactor of [1.0, 0.85, 1.15]) {
            const r = idealRange * rFactor;
            const cx = objective.x + Math.cos(angle) * r;
            const cy = objective.y + Math.sin(angle) * r;

            // Clamp to map bounds
            const px = Math.max(3, Math.min(map.width - 4, cx));
            const py = Math.max(3, Math.min(map.height - 4, cy));
            if (!map.isPassable(px, py)) continue;

            const cover = weights.cover > 0 ? map.countCoverTiles(px, py, coverR) : 0;
            if (cover > maxCover) maxCover = cover;
            candidateList.push({ x: px, y: py, cover, rFactor });
        }
    }

    if (candidateList.length === 0) {
        // Fallback: angle from objective toward us
        const a = Math.atan2(me.y - objective.y, me.x - objective.x);
        return {
            x: objective.x + Math.cos(a) * idealRange,
            y: objective.y + Math.sin(a) * idealRange,
        };
    }

    for (const c of candidateList) {
        // ── Cover score (0–1): nearby blocking tiles
        const coverScore = maxCover > 0 ? c.cover / maxCover : 0;

        // ── Flank score (0–1): perpendicular distance from the
        //    direct me→objective line, normalised by idealRange
        const relX = c.x - me.x;
        const relY = c.y - me.y;
        const perpDist = Math.abs(relX * perpX + relY * perpY);
        const flankScore = Math.min(1, perpDist / (idealRange * 0.8));

        // ── Range score (0–1): 1.0 at ideal range, falls off
        const distToObj = Math.hypot(c.x - objective.x, c.y - objective.y);
        const rangeError = Math.abs(distToObj - idealRange) / idealRange;
        const rangeScore = Math.max(0, 1 - rangeError);

        // ── LOS score (0 or 1): can we see the objective?
        const losScore = weights.los > 0 ? (map.hasLineOfSight(c.x, c.y, objective.x, objective.y) ? 1 : 0) : 0;

        const score =
            coverScore * (weights.cover || 0) +
            flankScore * (weights.flank || 0) +
            rangeScore * (weights.range || 0) +
            losScore * (weights.los || 0);

        if (score > bestScore) {
            bestScore = score;
            bestPos = { x: c.x, y: c.y };
        }
    }

    return bestPos;
}

/**
 * Compute a flank waypoint using the position scoring system.
 * The midpoint distance is used as the ideal range so candidates
 * form a ring around the midpoint between bot and objective.
 */
export function computeFlankPoint(me, objective, map, weights = null) {
    const dist = Math.hypot(objective.x - me.x, objective.y - me.y);
    if (dist < 1) return { x: objective.x, y: objective.y };

    // Use midpoint as the "objective" for the candidate ring, with half
    // the distance as the ideal range — candidates land in a ring
    // perpendicular to the approach line.
    const mid = {
        x: (me.x + objective.x) / 2,
        y: (me.y + objective.y) / 2,
    };
    const w = weights || CONFIG.SCOUT_POSITION_WEIGHTS;
    const idealRange = dist * 0.4;

    return findBestPosition(me, mid, map, w, idealRange);
}
