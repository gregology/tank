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
 * When stuck, the bot shoots destructible terrain to blast a path.
 */

import { Pathfinder } from './pathfinder.js';

export class AIController {
    constructor(keyMap, map) {
        this.keyMap = keyMap;
        this.keys   = {};

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
