/**
 * AI controller for a tank — the orchestration glue over the js/ai/
 * package (arbitration, targeting, navigation, recovery, aiming).
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
 * Swarm AI (js/ai/arbitration.js):
 *   There are no assigned roles.  Every think, the bot re-decides its
 *   goal from reactive, colony-insect-inspired layers — rally to alarm
 *   pheromones, fall into convoys behind stronger recruitment emitters,
 *   follow objective beacons and trails, or explore weak-signal ground.
 *   Per-vehicle `signals.follow` weights in VEHICLES gate each layer.
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
import { chooseGoalAndTarget } from "./ai/arbitration.js";
import { steerToGoal } from "./ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "./ai/recovery.js";
import { Pathfinder } from "./pathfinder.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

export class AIController {
    constructor(map, rng = Math.random) {
        this.keys = {};
        this._rng = rng;

        // Per-life state owned by the arbitration layers (convoy side,
        // exploration goal/timer).
        this.state = {};

        // Enemy structures the bot may target (set per-think by the mode).
        this._enemyStructures = [];

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
        this.state = {};
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

    /** Invalidate the cached pathfinder after terrain changes. */
    invalidatePath() {
        this._pf?.invalidate();
    }

    /* ════════════════════════════════════════════════════════ *
     *  Main think                                              *
     * ════════════════════════════════════════════════════════ */

    /**
     * Run one think step.
     *
     * @param {object} [swarm]  the faction's shared swarm context
     *        { signals, friendlies, humans } — null outside team play
     *        (and in navigation-only simulations), which skips the
     *        pheromone layers and leaves plain objective navigation.
     */
    think(dt, me, enemies, map, objective = null, enemyStructures = [], swarm = null) {
        this.keys = {};
        if (!me.alive) return;
        if (!this._pf) this._pf = new Pathfinder(map);
        this._enemyStructures = enemyStructures;

        this.fireDelay -= dt;
        updateWobble(this, dt);
        updateStuck(this, dt, me);

        const ctx = { enemies, map, objective, swarm };

        // Vehicle behaviours that drive the whole think (drones fly their
        // own loop; squads hold while digging in; immobilised vehicles pivot)
        // consume the frame.
        if (getVehicleBehaviour(me.vehicleType).aiThink(this, dt, me, ctx)) return;

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
        const { navGoal, fireTarget } = chooseGoalAndTarget(this, dt, me, ctx);

        // ── Follow the goal (direct steering when close, else A*) ──
        steerToGoal(this, dt, me, navGoal, map);

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
