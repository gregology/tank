/**
 * AI controller for a tank — the orchestration glue over the js/ai/
 * package (roles, targeting, navigation, recovery, aiming).
 *
 * Navigation is driven by **A* pathfinding**: the bot computes a route
 * on the tile grid and follows waypoints.  Combat targeting is separate
 * — the bot aims the turret at enemies/towers while navigating.
 *
 * The turret rotates independently from the hull using turretLeft /
 * turretRight virtual keys.  turretAngle is a hull-relative offset,
 * so the AI computes the desired world-space turret angle, subtracts
 * the hull angle to get the desired offset, then steers toward it
 * (see js/ai/aiming.js).
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
 *   The per-role goal/target logic lives in js/ai/roles.js.
 *
 * Target priority: each vehicle type has a targetPriority table in
 * VEHICLES (config.js) that maps target vehicle types → desirability
 * weights.  The AI scores candidates as  weight / distance and picks the
 * highest-scoring one (js/ai/targeting.js).  A weight of 0 means "never
 * engage" — the AI won't fire at, navigate toward, or (for drones)
 * detonate on that target type.
 *
 * When stuck, the bot shoots destructible terrain to blast a path
 * (js/ai/recovery.js).
 */

import { steerTurretTo, updateWobble } from "./ai/aiming.js";
import { patrol, pickWaypoint, steerToPoint, updatePath } from "./ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "./ai/recovery.js";
import { chooseGoalAndTarget } from "./ai/roles.js";
import { bestTarget, targetPriorityOf } from "./ai/targeting.js";
import { ACTIONS, BASE_STRUCTURES, VEHICLES } from "./config.js";
import { Pathfinder } from "./pathfinder.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

export { AI_ROLES, pickRoleForVehicle } from "./ai/roles.js";

export class AIController {
    constructor(map, rng = Math.random) {
        this.keys = {};
        this._rng = rng;

        // Role (set externally for team mode, null for duel modes)
        this.role = null;

        // Base references (set by game.js for team mode)
        this.friendlyBase = null;
        this._enemyStructures = [];

        // Scout flank point (computed once per life)
        this._flankPoint = null;
        this._flankReached = false;

        // Sniper firing position (computed once per life)
        this._sniperPos = null;

        // Defender patrol target (rotates around friendly tower)
        this._patrolAngle = this._rng() * Math.PI * 2;
        this._patrolTimer = 0;

        // Pathfinding
        this._pf = map ? new Pathfinder(map) : null;
        this._path = []; // [{x,y}] waypoints
        this._pathTimer = this._rng() * 0.3;
        this._pathGoal = null;

        // Firing
        this.fireDelay = 0;

        // Stuck detection
        this._posHistory = [];
        this._sampleTimer = 0;
        this.stuckTime = 0;

        // Evade (last resort)
        this.evading = false;
        this.evadeDir = 1;
        this.evadeTimer = 0;

        // Wobble
        this.aimWobble = 0;
        this.wobbleTimer = 0;
    }

    isDown(action) {
        return !!this.keys[action];
    }
    /** Binary input source — analog channels are 1 when held, 0 otherwise. */
    analog(action) {
        return this.keys[action] ? 1 : 0;
    }
    wasPressed(_action) {
        return false;
    }
    endFrame() {}

    /**
     * Reset per-life cached state (called on respawn).
     */
    resetLife() {
        this._flankPoint = null;
        this._flankReached = false;
        this._sniperPos = null;
        this._patrolAngle = this._rng() * Math.PI * 2;
        this._patrolTimer = 0;
        this._path = [];
        this._pathTimer = 0;
        this._posHistory = [];
        this.stuckTime = 0;
        this.evading = false;
    }

    /** Deterministic random source (injected rng, defaults to Math.random). */
    rng() {
        return this._rng();
    }

    /** Hold position: clear navigation and stuck state. */
    holdPosition() {
        this._path = [];
        this._posHistory = [];
        this.stuckTime = 0;
    }

    /* ════════════════════════════════════════════════════════ *
     *  Main think                                              *
     * ════════════════════════════════════════════════════════ */

    think(dt, me, enemies, map, objective = null, enemyStructures = []) {
        this.keys = {};
        if (!me.alive) return;
        if (!this._pf) this._pf = new Pathfinder(map);
        this._enemyStructures = enemyStructures;

        this.fireDelay -= dt;
        updateWobble(this, dt);
        updateStuck(this, dt, me);

        // Vehicle behaviours that drive the whole think (drones fly their
        // own loop; squads hold while digging in) consume the frame.
        if (getVehicleBehaviour(me.vehicleType).aiThink(this, dt, me, enemies, map, objective)) return;

        // ── Tracks disabled: can only pivot and shoot ──
        if (me.trackDamaged) {
            this._thinkImmobilised(dt, me, enemies, map, objective);
            return;
        }

        // ── Stuck escalation ──
        if (this.stuckTime > 1.0 && !this.evading) {
            handleStuck(this, me, map);
            return;
        }
        if (this.evading) {
            evade(this, dt, me, map);
            return;
        }

        // ── Choose navigation goal and combat target ──
        const { navGoal, fireTarget } = chooseGoalAndTarget(this, dt, me, enemies, map, objective);

        if (!navGoal) {
            patrol(this);
            return;
        }

        // ── Update path and follow it ──
        updatePath(this, dt, me, navGoal);
        const wp = pickWaypoint(this, me, map);
        steerToPoint(this, me, wp, { hasPath: this._path.length > 0, map });

        // ── AIM + FIRE at combat target ──
        if (fireTarget) {
            this._aimAndFire(me, fireTarget, map);
        }
    }

    /* ════════════════════════════════════════════════════════ *
     *  Drone behaviour (FPV kamikaze)                          *
     * ════════════════════════════════════════════════════════ */

    /**
     * Drone AI: use role-based goal selection for navigation target,
     * then fly directly (no pathfinding — drones fly over terrain).
     *
     * Detonation is manual — the bot presses fire when close enough
     * for significant damage.  Damage falls off with distance, so
     * the bot tries to get nearly on top of the target before firing.
     *
     * Detonation respects targetPriority: the drone won't waste its
     * one-shot explosion on a target with priority 0 (e.g. other drones).
     */
    thinkDrone(dt, me, enemies, _map, objective) {
        const { navGoal, fireTarget } = chooseGoalAndTarget(this, dt, me, enemies, _map, objective);

        // If we have a fire target nearby, prioritise diving at it
        let target = navGoal;
        if (fireTarget && fireTarget.dist < 20) {
            target = { x: fireTarget.x, y: fireTarget.y };
        }

        if (!target) {
            patrol(this);
            return;
        }

        // ── Navigate directly (drones fly over everything) ──
        const desired = Math.atan2(target.y - me.y, target.x - me.x);
        let diff = desired - me.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (diff > 0.08) this.keys[ACTIONS.right] = true;
        if (diff < -0.08) this.keys[ACTIONS.left] = true;

        const dist = Math.hypot(target.x - me.x, target.y - me.y);
        if (Math.abs(diff) < Math.PI * 0.7 && dist > 0.5) {
            this.keys[ACTIONS.forward] = true;
        }

        // ── Detonate when nearly on top of a valid target ──
        // AI wants point-blank for max damage (≥ 0.7× at this range).
        // Skip targets with priority 0 — don't waste the explosion.
        const detonateRange = VEHICLES.drone.blastRadius * 0.3 + VEHICLES.tank.size;
        const priorities = VEHICLES[me.vehicleType]?.targetPriority ?? {};
        for (const e of enemies) {
            if (!e.alive) continue;
            if (targetPriorityOf(priorities, e.targetType) <= 0) continue;
            const d = Math.hypot(e.x - me.x, e.y - me.y);
            if (d < detonateRange) {
                this.keys[ACTIONS.fire] = true;
                return;
            }
        }
        // Check objective (tower)
        if (objective?.alive) {
            const d = Math.hypot(objective.x - me.x, objective.y - me.y);
            if (d < detonateRange + BASE_STRUCTURES.baseHQ.size) {
                this.keys[ACTIONS.fire] = true;
            }
        }
    }

    /* ════════════════════════════════════════════════════════ *
     *  Immobilised behaviour                                   *
     * ════════════════════════════════════════════════════════ */

    /**
     * Behaviour when tracks are disabled: can't move, only pivot.
     * Rotate hull toward nearest threat and fire.
     */
    _thinkImmobilised(_dt, me, enemies, map, objective) {
        const bestEnemy = bestTarget(this, me, enemies);
        let target = null;

        if (bestEnemy && bestEnemy.dist < 15) {
            target = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
        } else if (objective) {
            const d = Math.hypot(objective.x - me.x, objective.y - me.y);
            target = { x: objective.x, y: objective.y, dist: d };
        } else if (bestEnemy) {
            target = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
        }

        if (!target) return;

        // Rotate hull toward target (since we can't drive)
        const desired = Math.atan2(target.y - me.y, target.x - me.x);
        let diff = desired - me.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (diff > 0.08) this.keys[ACTIONS.right] = true;
        if (diff < -0.08) this.keys[ACTIONS.left] = true;

        // Also aim turret if it's functional
        this._aimAndFire(me, target, map);
    }

    /* ════════════════════════════════════════════════════════ *
     *  Combat — independent turret aiming                      *
     * ════════════════════════════════════════════════════════ */

    /**
     * Rotate turret toward the target and fire when aimed — dispatched to
     * the vehicle's aim strategy (tank turret-aim, IFV opportunistic,
     * SPG hold-to-charge).  If turret is disabled, aims by rotating the
     * hull instead.
     */
    _aimAndFire(me, target, map) {
        getVehicleBehaviour(me.vehicleType).aim(this, me, target, map);
    }

    /**
     * Steer turret offset so turretWorld approaches desiredWorldAngle.
     * (Public seam — vehicle aim strategies call this.)
     */
    steerTurretTo(me, desiredWorld) {
        steerTurretTo(this, me, desiredWorld);
    }

    /**
     * Bot squads dig in when enemies are close AND building cover is
     * available; otherwise they stay mobile.  (Human squads toggle
     * dig-in with FIRE, handled in game.js.)
     */
    updateSquadDigIn(me, enemies, map) {
        const component = me.squad;
        if (!component) return;
        const v = VEHICLES.squad;
        const nearEnemy = enemies.some((e) => e.alive && Math.hypot(e.x - me.x, e.y - me.y) < v.coverRadius + 5);
        const inCover = map.hasIntactBuildingNear(me.x, me.y, v.coverRadius);
        if (nearEnemy && inCover) {
            if (component.digIn.state === "roaming") component.startDigIn();
        } else if (component.digIn.state !== "roaming") {
            component.standUp();
        }
    }

    /**
     * Fire at a destructible tile directly ahead of the turret.
     * (Public seam — vehicle aim strategies call this when stuck.)
     */
    tryShootWall(me, map) {
        tryShootWall(this, me, map);
    }
}
