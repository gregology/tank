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
        // own loop; squads hold while digging in; immobilised vehicles pivot)
        // consume the frame.
        if (getVehicleBehaviour(me.vehicleType).aiThink(this, dt, me, enemies, map, objective)) return;

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
            this.aimAndFire(me, fireTarget, map);
        }
    }

    /**
     * Rotate turret toward the target and fire when aimed — dispatched to
     * the vehicle's aim strategy (tank turret-aim, IFV opportunistic,
     * SPG hold-to-charge).  If turret is disabled, aims by rotating the
     * hull instead.
     */
    aimAndFire(me, target, map) {
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
     * Fire at a destructible tile directly ahead of the turret.
     * (Public seam — vehicle aim strategies call this when stuck.)
     */
    tryShootWall(me, map) {
        tryShootWall(this, me, map);
    }
}
