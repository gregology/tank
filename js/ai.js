/**
 * AI controller for a tank.
 *
 * Navigation is driven by **A* pathfinding**: the bot computes a route
 * on the tile grid and follows waypoints.  Combat targeting is separate
 * — the bot aims the turret at enemies/towers while navigating.
 *
 * The turret rotates independently from the hull using turretLeft /
 * turretRight virtual keys.  turretAngle is a hull-relative offset,
 * so the AI computes the desired world-space turret angle, subtracts
 * the hull angle to get the desired offset, then steers toward it.
 *
 * Subsystem damage awareness:
 *   - turretDisabled: AI aims by rotating the entire hull toward targets
 *   - trackDamaged:   AI can only pivot, so it rotates to face targets
 *                     and fires; navigation is abandoned
 *
 * IFV awareness:
 *   - Fixed gun: fires forward only — does not override navigation to aim,
 *     instead fires opportunistically when hull faces near a target.
 *   - Faster fire rate with lower fire delay.
 *
 * AI Roles (team mode only):
 *   - cavalry:  rush straight to enemy tower, engage anything in path
 *   - sniper:   find firing position at range, bombard tower from distance
 *   - defender: patrol near friendly tower, intercept incoming enemies
 *   - scout:    wide flanking route to enemy tower, engage only close threats
 *
 * When stuck, the bot shoots destructible terrain to blast a path.
 */

import { CONFIG } from './config.js';
import { Pathfinder } from './pathfinder.js';

/* ── Role names ───────────────────────────────────────────── */

export const AI_ROLES = {
    CAVALRY:  'cavalry',
    SNIPER:   'sniper',
    DEFENDER: 'defender',
    SCOUT:    'scout',
};

/**
 * Pick a random role using weighted selection from CONFIG.ROLE_WEIGHTS.
 */
export function pickRole() {
    const w = CONFIG.ROLE_WEIGHTS;
    const entries = Object.entries(w);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let r = Math.random() * total;
    for (const [role, weight] of entries) {
        r -= weight;
        if (r <= 0) return role;
    }
    return entries[entries.length - 1][0];
}

export class AIController {
    constructor(keyMap, map) {
        this.keyMap = keyMap;
        this.keys   = {};

        // Role (set externally for team mode, null for duel modes)
        this.role = null;

        // Friendly tower reference (set by game.js for team mode)
        this.friendlyTower = null;

        // Scout flank point (computed once per life)
        this._flankPoint = null;
        this._flankReached = false;

        // Sniper firing position (computed once per life)
        this._sniperPos = null;

        // Defender patrol target (rotates around friendly tower)
        this._patrolAngle = Math.random() * Math.PI * 2;
        this._patrolTimer = 0;

        // Pathfinding
        this._pf         = map ? new Pathfinder(map) : null;
        this._path        = [];       // [{x,y}] waypoints
        this._pathTimer   = Math.random() * 0.3;
        this._pathGoal    = null;

        // Firing
        this.fireDelay = 0;

        // Stuck detection
        this._posHistory  = [];
        this._sampleTimer = 0;
        this.stuckTime    = 0;

        // Evade (last resort)
        this.evading    = false;
        this.evadeDir   = 1;
        this.evadeTimer = 0;

        // Wobble
        this.aimWobble   = 0;
        this.wobbleTimer = 0;
    }

    isDown(code)  { return !!this.keys[code]; }
    wasPressed(_) { return false; }
    endFrame()    {}

    /**
     * Reset per-life cached state (called on respawn).
     */
    resetLife() {
        this._flankPoint  = null;
        this._flankReached = false;
        this._sniperPos   = null;
        this._patrolAngle = Math.random() * Math.PI * 2;
        this._patrolTimer = 0;
        this._path        = [];
        this._pathTimer   = 0;
        this._posHistory  = [];
        this.stuckTime    = 0;
        this.evading      = false;
    }

    /* ════════════════════════════════════════════════════════ *
     *  Main think                                              *
     * ════════════════════════════════════════════════════════ */

    think(dt, me, enemies, map, objective = null) {
        this.keys = {};
        if (!me.alive) return;
        if (!this._pf) this._pf = new Pathfinder(map);

        this.fireDelay -= dt;
        this._updateWobble(dt);
        this._updateStuck(dt, me);

        // ── Tracks disabled: can only pivot and shoot ──
        if (me.trackDamaged) {
            this._thinkImmobilised(dt, me, enemies, map, objective);
            return;
        }

        // ── Stuck escalation ──
        if (this.stuckTime > 1.0 && !this.evading) {
            this._handleStuck(me, map);
            return;
        }
        if (this.evading) { this._evade(dt, me, map); return; }

        // ── Choose navigation goal and combat target ──
        const { navGoal, fireTarget } = this._chooseGoalAndTarget(
            dt, me, enemies, map, objective);

        if (!navGoal) { this._patrol(); return; }

        // ── Update path ──
        this._updatePath(dt, me, navGoal, map);

        // ── Follow path: pick the best waypoint ──
        const wp = this._pickWaypoint(me, map);

        // ── DRIVE toward waypoint (hull rotation) ──
        const wpDist = Math.hypot(wp.x - me.x, wp.y - me.y);
        const driveAngle = Math.atan2(wp.y - me.y, wp.x - me.x);
        let driveDiff = driveAngle - me.angle;
        while (driveDiff >  Math.PI) driveDiff -= Math.PI * 2;
        while (driveDiff < -Math.PI) driveDiff += Math.PI * 2;

        const hasPath = this._path.length > 0;
        const absDiff = Math.abs(driveDiff);

        if (hasPath && wpDist > 0.8) {
            if (absDiff < Math.PI * 0.8) {
                this.keys[this.keyMap.forward] = true;
            } else {
                this.keys[this.keyMap.backward] = true;
            }
        } else if (!hasPath && wpDist > 2.0 && absDiff < 0.6) {
            this.keys[this.keyMap.forward] = true;
        }

        if (driveDiff >  0.08) this.keys[this.keyMap.right] = true;
        if (driveDiff < -0.08) this.keys[this.keyMap.left]  = true;

        if (this.keys[this.keyMap.forward]) {
            this._nudge(me, map);
        }

        // ── AIM + FIRE at combat target ──
        if (fireTarget) {
            this._aimAndFire(me, fireTarget, map);
        }
    }

    /* ════════════════════════════════════════════════════════ *
     *  Role-based goal & target selection                      *
     * ════════════════════════════════════════════════════════ */

    /**
     * Dispatches to the appropriate role strategy for choosing
     * where to navigate and what to shoot at.
     *
     * Falls back to the original "charge at objective" behaviour
     * when no role is set (duel modes, pvb).
     *
     * @returns {{ navGoal: {x,y}|null, fireTarget: {x,y,dist}|null }}
     */
    _chooseGoalAndTarget(dt, me, enemies, map, objective) {
        if (this.role && objective) {
            switch (this.role) {
                case AI_ROLES.CAVALRY:
                    return this._cavalryGoal(me, enemies, objective);
                case AI_ROLES.SNIPER:
                    return this._sniperGoal(dt, me, enemies, map, objective);
                case AI_ROLES.DEFENDER:
                    return this._defenderGoal(dt, me, enemies, objective);
                case AI_ROLES.SCOUT:
                    return this._scoutGoal(me, enemies, map, objective);
            }
        }
        // Default behaviour (duel mode / no role / objective destroyed)
        return this._defaultGoal(me, enemies, objective);
    }

    /* ── Default (original behaviour) ─────────────────────── */

    _defaultGoal(me, enemies, objective) {
        const nearEnemy = this._nearestAlive(me, enemies);
        let navGoal    = null;
        let fireTarget = null;

        if (objective) {
            navGoal = { x: objective.x, y: objective.y };
            const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
            if (objDist < 25) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }
        }

        if (nearEnemy && nearEnemy.dist < 10) {
            fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                           dist: nearEnemy.dist };
            if (!objective && nearEnemy.dist < 8) {
                navGoal = { x: nearEnemy.tank.x, y: nearEnemy.tank.y };
            }
        }

        if (!navGoal && nearEnemy) {
            navGoal = { x: nearEnemy.tank.x, y: nearEnemy.tank.y };
            fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                           dist: nearEnemy.dist };
        }

        return { navGoal, fireTarget };
    }

    /* ── Cavalry: aggressive rush to enemy tower ──────────── */

    /**
     * Rush straight to the enemy tower.  Engage any enemy in path
     * (closer than 10 tiles).  Always fire at tower when in range.
     */
    _cavalryGoal(me, enemies, objective) {
        let navGoal = { x: objective.x, y: objective.y };
        let fireTarget = null;

        const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
        if (objDist < 25) {
            fireTarget = { x: objective.x, y: objective.y, dist: objDist };
        }

        // Engage nearby enemies (don't detour to chase — just shoot)
        const nearEnemy = this._nearestAlive(me, enemies);
        if (nearEnemy && nearEnemy.dist < 10) {
            fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                           dist: nearEnemy.dist };
        }

        return { navGoal, fireTarget };
    }

    /* ── Sniper: find firing position, bombard from range ─── */

    /**
     * Navigate to a position at SNIPER_FIRE_RANGE from the enemy tower
     * and bombard it.  Avoids getting closer than SNIPER_MIN_RANGE.
     * Only engages enemies within SNIPER_ENGAGE_RANGE (self-defence).
     */
    _sniperGoal(dt, me, enemies, map, objective) {
        let navGoal    = null;
        let fireTarget = null;

        const objDist = Math.hypot(objective.x - me.x, objective.y - me.y);
        const fireRange = CONFIG.SNIPER_FIRE_RANGE;
        const minRange  = CONFIG.SNIPER_MIN_RANGE;

        // Compute a firing position once (and cache it for this life)
        if (!this._sniperPos) {
            this._sniperPos = this._findSniperPosition(me, objective, map);
        }

        const posReached = this._sniperPos &&
            Math.hypot(this._sniperPos.x - me.x, this._sniperPos.y - me.y) < 2;

        if (posReached) {
            // Hold position — fire at tower
            navGoal = { x: me.x, y: me.y }; // stay put
            if (objDist < fireRange + 5) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }
        } else if (objDist < minRange) {
            // Too close — back off toward sniper position or just away
            const awayAngle = Math.atan2(me.y - objective.y, me.x - objective.x);
            navGoal = {
                x: objective.x + Math.cos(awayAngle) * fireRange,
                y: objective.y + Math.sin(awayAngle) * fireRange,
            };
            // Still fire while retreating
            fireTarget = { x: objective.x, y: objective.y, dist: objDist };
        } else {
            // Navigate to firing position
            navGoal = this._sniperPos || { x: objective.x, y: objective.y };
            // Fire at tower if already in range
            if (objDist < fireRange + 5) {
                fireTarget = { x: objective.x, y: objective.y, dist: objDist };
            }
        }

        // Self-defence: engage enemies only when very close
        const nearEnemy = this._nearestAlive(me, enemies);
        if (nearEnemy && nearEnemy.dist < CONFIG.SNIPER_ENGAGE_RANGE) {
            fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                           dist: nearEnemy.dist };
        }

        return { navGoal, fireTarget };
    }

    /**
     * Find a passable position at sniper range from the objective.
     * Tries the angle from the bot's current position first, then samples.
     */
    _findSniperPosition(me, objective, map) {
        const range = CONFIG.SNIPER_FIRE_RANGE;
        // Prefer the angle from objective toward our current position
        const baseAngle = Math.atan2(me.y - objective.y, me.x - objective.x);
        for (let i = 0; i < 12; i++) {
            const a = baseAngle + (i % 2 === 0 ? 1 : -1) * Math.floor((i + 1) / 2) * 0.4;
            const px = objective.x + Math.cos(a) * range;
            const py = objective.y + Math.sin(a) * range;
            if (map.isPassable(px, py)) return { x: px, y: py };
        }
        // Fallback: just use the base angle
        return {
            x: objective.x + Math.cos(baseAngle) * range,
            y: objective.y + Math.sin(baseAngle) * range,
        };
    }

    /* ── Defender: patrol and guard friendly tower ────────── */

    /**
     * Patrol around the friendly tower.  If enemies are within
     * DEFENDER_ENGAGE_RANGE of the tower, intercept them.
     * Only pushes forward when no threats are near.
     */
    _defenderGoal(dt, me, enemies, objective) {
        let navGoal    = null;
        let fireTarget = null;

        const ft = this.friendlyTower;
        if (!ft || !ft.alive) {
            // Friendly tower destroyed — fall back to cavalry rush
            return this._cavalryGoal(me, enemies, objective);
        }

        // Check for enemies near the friendly tower
        const engageRange = CONFIG.DEFENDER_ENGAGE_RANGE;
        let closestThreat = null, closestDist = Infinity;
        for (const e of enemies) {
            if (!e.alive) continue;
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
                x: closestThreat.x, y: closestThreat.y,
                dist: Math.hypot(closestThreat.x - me.x, closestThreat.y - me.y),
            };
        } else {
            // Patrol around friendly tower
            this._patrolTimer -= dt;
            if (this._patrolTimer <= 0) {
                this._patrolAngle += 0.8 + Math.random() * 1.0;
                this._patrolTimer = 3.0 + Math.random() * 2.0;
            }
            const r = CONFIG.DEFENDER_PATROL_RADIUS;
            navGoal = {
                x: ft.x + Math.cos(this._patrolAngle) * r,
                y: ft.y + Math.sin(this._patrolAngle) * r,
            };

            // Fire at any enemy within personal range
            const nearEnemy = this._nearestAlive(me, enemies);
            if (nearEnemy && nearEnemy.dist < 10) {
                fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                               dist: nearEnemy.dist };
            }
        }

        return { navGoal, fireTarget };
    }

    /* ── Scout: wide flanking route to enemy tower ────────── */

    /**
     * Take a wide perpendicular detour to approach the enemy tower
     * from an unexpected angle.  Only engages enemies within 6 tiles.
     */
    _scoutGoal(me, enemies, map, objective) {
        let navGoal    = null;
        let fireTarget = null;

        // Compute flank waypoint once per life
        if (!this._flankPoint) {
            this._flankPoint = this._computeFlankPoint(me, objective, map);
        }

        const flankDist = Math.hypot(this._flankPoint.x - me.x,
                                     this._flankPoint.y - me.y);
        const objDist   = Math.hypot(objective.x - me.x, objective.y - me.y);

        // Once we reach the flank point, lock into phase 2 permanently
        if (!this._flankReached && flankDist < 3) {
            this._flankReached = true;
        }

        if (!this._flankReached) {
            // Phase 1: navigate to flank point
            navGoal = { x: this._flankPoint.x, y: this._flankPoint.y };
        } else {
            // Phase 2: rush the tower from the flank
            navGoal = { x: objective.x, y: objective.y };
        }

        // Fire at tower when in range
        if (objDist < 25) {
            fireTarget = { x: objective.x, y: objective.y, dist: objDist };
        }

        // Only engage enemies that are very close (self-defence)
        const nearEnemy = this._nearestAlive(me, enemies);
        if (nearEnemy && nearEnemy.dist < 6) {
            fireTarget = { x: nearEnemy.tank.x, y: nearEnemy.tank.y,
                           dist: nearEnemy.dist };
        }

        return { navGoal, fireTarget };
    }

    /**
     * Compute a flank waypoint that's offset perpendicular to the
     * direct line between the bot and the objective.
     */
    _computeFlankPoint(me, objective, map) {
        const dx = objective.x - me.x;
        const dy = objective.y - me.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return { x: objective.x, y: objective.y };

        // Midpoint between start and objective
        const mx = (me.x + objective.x) / 2;
        const my = (me.y + objective.y) / 2;

        // Perpendicular direction
        const px = -dy / dist;
        const py =  dx / dist;

        // Pick a random side (left or right of the direct line)
        const side = Math.random() > 0.5 ? 1 : -1;
        const offset = CONFIG.SCOUT_FLANK_OFFSET;

        // Try the ideal offset, then shrink if it's off the map or impassable
        for (let f = 1.0; f >= 0.3; f -= 0.15) {
            const fx = mx + px * offset * side * f;
            const fy = my + py * offset * side * f;
            // Clamp to map bounds with margin
            const cx = Math.max(3, Math.min(map.width - 4, fx));
            const cy = Math.max(3, Math.min(map.height - 4, fy));
            if (map.isPassable(cx, cy)) return { x: cx, y: cy };
        }

        // Fallback: try the other side
        for (let f = 1.0; f >= 0.3; f -= 0.15) {
            const fx = mx + px * offset * -side * f;
            const fy = my + py * offset * -side * f;
            const cx = Math.max(3, Math.min(map.width - 4, fx));
            const cy = Math.max(3, Math.min(map.height - 4, fy));
            if (map.isPassable(cx, cy)) return { x: cx, y: cy };
        }

        // Last resort: head straight for objective
        return { x: objective.x, y: objective.y };
    }

    /* ════════════════════════════════════════════════════════ *
     *  Immobilised behaviour                                   *
     * ════════════════════════════════════════════════════════ */

    /**
     * Behaviour when tracks are disabled: can't move, only pivot.
     * Rotate hull toward nearest threat and fire.
     */
    _thinkImmobilised(dt, me, enemies, map, objective) {
        const nearEnemy = this._nearestAlive(me, enemies);
        let target = null;

        if (nearEnemy && nearEnemy.dist < 15) {
            target = { x: nearEnemy.tank.x, y: nearEnemy.tank.y, dist: nearEnemy.dist };
        } else if (objective) {
            const d = Math.hypot(objective.x - me.x, objective.y - me.y);
            target = { x: objective.x, y: objective.y, dist: d };
        } else if (nearEnemy) {
            target = { x: nearEnemy.tank.x, y: nearEnemy.tank.y, dist: nearEnemy.dist };
        }

        if (!target) return;

        // Rotate hull toward target (since we can't drive)
        const desired = Math.atan2(target.y - me.y, target.x - me.x);
        let diff = desired - me.angle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (diff >  0.08) this.keys[this.keyMap.right] = true;
        if (diff < -0.08) this.keys[this.keyMap.left]  = true;

        // Also aim turret if it's functional
        this._aimAndFire(me, target, map);
    }

    /* ════════════════════════════════════════════════════════ *
     *  Pathfinding                                             *
     * ════════════════════════════════════════════════════════ */

    _updatePath(dt, me, goal, map) {
        this._pathTimer -= dt;
        const stale = this._pathGoal &&
            Math.hypot(goal.x - this._pathGoal.x,
                       goal.y - this._pathGoal.y) > 3;

        if (this._pathTimer <= 0 || this._path.length === 0 || stale) {
            this._pathTimer = 1.2 + Math.random() * 0.6;
            this._pathGoal  = { x: goal.x, y: goal.y };
            this._path = this._pf.findPath(me.x, me.y, goal.x, goal.y) ?? [];
        }
    }

    _pickWaypoint(me, map) {
        if (this._path.length === 0) {
            return this._pathGoal ?? { x: me.x, y: me.y };
        }

        while (this._path.length > 1) {
            const d = Math.hypot(this._path[0].x - me.x,
                                 this._path[0].y - me.y);
            if (d > 0.9) break;
            this._path.shift();
        }

        let best = 0;
        const limit = Math.min(this._path.length - 1, 8);
        for (let i = limit; i > 0; i--) {
            if (this._walkable(me.x, me.y,
                    this._path[i].x, this._path[i].y, map)) {
                best = i;
                break;
            }
        }
        return this._path[best];
    }

    /* ════════════════════════════════════════════════════════ *
     *  Combat — independent turret aiming                      *
     * ════════════════════════════════════════════════════════ */

    /**
     * Rotate turret toward the target and fire when aimed.
     * If turret is disabled, aims by rotating the hull instead.
     * If IFV, fires opportunistically without overriding navigation.
     */
    _aimAndFire(me, target, map) {
        const desiredWorld = Math.atan2(target.y - me.y, target.x - me.x);

        // ── IFV: fire opportunistically without overriding navigation ──
        // The hull is already being steered toward the nav goal, so don't
        // fight it — just fire when the forward gun happens to aim near a target.
        if (me.vehicleType === 'ifv') {
            const turretWorld = me.turretWorld;
            let diff = desiredWorld - turretWorld;
            while (diff >  Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.4) return;
            if (this.fireDelay > 0) return;

            if (this._los(me.x, me.y, target.x, target.y, map)) {
                this.keys[this.keyMap.fire] = true;
                this.fireDelay = 0.10 + Math.random() * 0.08;
            }
            return;
        }

        // ── Tank with disabled turret: aim by rotating hull ──
        if (me.turretDisabled) {
            let diff = desiredWorld - me.angle;
            while (diff >  Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (diff >  0.08) this.keys[this.keyMap.right] = true;
            if (diff < -0.08) this.keys[this.keyMap.left]  = true;

            if (Math.abs(diff) > 0.3) return;
        } else {
            // Normal turret aiming
            this._steerTurretTo(me, desiredWorld);

            const turretWorld = me.turretWorld;
            let diff = desiredWorld - turretWorld;
            while (diff >  Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.3) return;
        }

        if (this.fireDelay > 0) return;

        if (this._los(me.x, me.y, target.x, target.y, map)) {
            this.keys[this.keyMap.fire] = true;
            this.fireDelay = 0.25 + Math.random() * 0.35;
            return;
        }

        this._tryShootWall(me, map);
    }

    /**
     * Steer turret offset so turretWorld approaches desiredWorldAngle.
     */
    _steerTurretTo(me, desiredWorld) {
        let desiredOffset = desiredWorld - me.angle;
        while (desiredOffset >  Math.PI) desiredOffset -= Math.PI * 2;
        while (desiredOffset < -Math.PI) desiredOffset += Math.PI * 2;

        let currentOffset = me.turretAngle;
        while (currentOffset >  Math.PI) currentOffset -= Math.PI * 2;
        while (currentOffset < -Math.PI) currentOffset += Math.PI * 2;

        let diff = desiredOffset - currentOffset;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (diff >  0.05) this.keys[this.keyMap.turretRight] = true;
        if (diff < -0.05) this.keys[this.keyMap.turretLeft]  = true;
    }

    /* ════════════════════════════════════════════════════════ *
     *  Stuck handling                                          *
     * ════════════════════════════════════════════════════════ */

    _handleStuck(me, map) {
        const k = this.keyMap;
        if (this.stuckTime < 1.2) {
            this.keys[k.backward] = true;
            this.keys[Math.random() > 0.5 ? k.right : k.left] = true;
            if (!me.fixedGun) this._aimTurretForward(me);
            this._tryShootWall(me, map);
        } else if (this.stuckTime < 2.5) {
            this.evading    = true;
            this.evadeTimer = 0.6 + Math.random() * 0.8;
            this.evadeDir   = Math.random() > 0.5 ? 1 : -1;
        } else {
            this._blastNearestWall(me, map);
        }
    }

    _evade(dt, me, map) {
        this.evadeTimer -= dt;
        const k = this.keyMap;
        this.keys[this.evadeDir > 0 ? k.right : k.left] = true;
        this.keys[k.forward] = true;
        if (!me.fixedGun) this._aimTurretForward(me);
        this._tryShootWall(me, map);
        if (this.evadeTimer <= 0) {
            this.evading = false;
            this.stuckTime = 0;
            this._posHistory = [];
            this._pathTimer = 0;
        }
    }

    _aimTurretForward(me) {
        this._steerTurretTo(me, me.angle);
    }

    /* ════════════════════════════════════════════════════════ *
     *  Terrain shooting                                        *
     * ════════════════════════════════════════════════════════ */

    _tryShootWall(me, map) {
        if (this.fireDelay > 0) return;
        const tw = me.turretWorld;
        for (const d of [0.6, 1.0, 1.5]) {
            const ax = me.x + Math.cos(tw) * d;
            const ay = me.y + Math.sin(tw) * d;
            if (map.blocksProjectile(ax, ay)) {
                this.keys[this.keyMap.fire] = true;
                this.fireDelay = 0.3;
                return;
            }
        }
    }

    _blastNearestWall(me, map) {
        const k = this.keyMap;
        let bestD = Infinity, bestA = me.turretWorld;
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const gx = Math.floor(me.x) + dx;
                const gy = Math.floor(me.y) + dy;
                if (!map.blocksProjectile(gx + 0.5, gy + 0.5)) continue;
                const d = Math.hypot(gx + 0.5 - me.x, gy + 0.5 - me.y);
                if (d < bestD) {
                    bestD = d;
                    bestA = Math.atan2(gy + 0.5 - me.y, gx + 0.5 - me.x);
                }
            }
        }

        if (!me.fixedGun) {
            this._steerTurretTo(me, bestA);
        } else {
            // IFV / fixed gun: rotate hull to face wall
            let diff = bestA - me.angle;
            while (diff >  Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (diff >  0.08) this.keys[k.right] = true;
            if (diff < -0.08) this.keys[k.left]  = true;
        }

        const tw = me.turretWorld;
        let diff = bestA - tw;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.2 && this.fireDelay <= 0) {
            this.keys[k.fire] = true;
            this.fireDelay = 0.3;
        }
        this.keys[k.backward] = true;
        if (this.stuckTime > 4) {
            this.stuckTime = 0;
            this._posHistory = [];
            this._path = [];
        }
    }

    /* ════════════════════════════════════════════════════════ *
     *  Helpers                                                 *
     * ════════════════════════════════════════════════════════ */

    _nearestAlive(me, enemies) {
        let best = null, bestD = Infinity;
        for (const e of enemies) {
            if (!e.alive) continue;
            const d = Math.hypot(e.x - me.x, e.y - me.y);
            if (d < bestD) { best = e; bestD = d; }
        }
        return best ? { tank: best, dist: bestD } : null;
    }

    _updateWobble(dt) {
        this.wobbleTimer -= dt;
        if (this.wobbleTimer <= 0) {
            this.aimWobble   = (Math.random() - 0.5) * 0.15;
            this.wobbleTimer = 0.5 + Math.random() * 1.0;
        }
    }

    _updateStuck(dt, me) {
        this._sampleTimer -= dt;
        if (this._sampleTimer <= 0) {
            this._sampleTimer = 0.2;
            this._posHistory.push({ x: me.x, y: me.y, a: me.angle });
            if (this._posHistory.length > 12) this._posHistory.shift();
        }
        if (this._posHistory.length >= 5) {
            const old = this._posHistory[0];
            const drift = Math.hypot(me.x - old.x, me.y - old.y);
            let aDiff = Math.abs(me.angle - old.a);
            if (aDiff > Math.PI) aDiff = Math.PI * 2 - aDiff;
            const rotating = aDiff > 0.3;

            this.stuckTime = (drift < 0.4 && !rotating)
                ? this.stuckTime + dt
                : Math.max(0, this.stuckTime - dt * 4);
        }
    }

    _patrol() {
        this.keys[this.keyMap.forward] = true;
        if (Math.sin(performance.now() / 700) > 0.3)
            this.keys[this.keyMap.right] = true;
    }

    _nudge(me, map) {
        const k = this.keyMap, a = me.angle;
        const bk = (ang, d) => !map.isPassable(
            me.x + Math.cos(ang) * d, me.y + Math.sin(ang) * d);
        if (!bk(a, 0.6)) return;
        if (!bk(a - 0.5, 0.8))      this.keys[k.left] = true;
        else if (!bk(a + 0.5, 0.8)) this.keys[k.right] = true;
        else this.keys[k.forward] = false;
    }

    _walkable(x1, y1, x2, y2, map) {
        const dx = x2 - x1, dy = y2 - y1;
        const d = Math.hypot(dx, dy);
        const n = Math.ceil(d * 3);
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            if (!map.isPassable(x1 + dx * t, y1 + dy * t)) return false;
        }
        return true;
    }

    _los(x1, y1, x2, y2, map) {
        const dx = x2 - x1, dy = y2 - y1;
        const d = Math.hypot(dx, dy);
        const n = Math.ceil(d * 3);
        for (let i = 1; i < n; i++) {
            const t = i / n;
            if (map.blocksProjectile(x1 + dx * t, y1 + dy * t)) return false;
        }
        return true;
    }
}
