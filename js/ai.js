/**
 * AI controller for a tank — the orchestration glue over the js/ai/
 * package (swarm behaviours, targeting, navigation, recovery, aiming).
 *
 * There are no assigned roles.  Every bot reacts to its faction's shared
 * pheromone fields (js/ai/swarm/): discovered objectives attract, allies
 * under attack rally the neighbourhood, routes to objectives light up,
 * unexplored ground pulls, and stronger attractors gather convoys.
 * Vehicle personality is *how it responds* to those signals, expressed
 * as the `swarm` data block in VEHICLES — not code.
 *
 * Navigation is driven by **A* pathfinding**: the swarm picks the goal,
 * the pathfinder routes to it (this is what will let bots funnel
 * through hard choke points like bridges).  Combat targeting is
 * separate — the bot aims the turret at enemies while navigating.
 * Structures are fog-of-war: only discovered ones (sight + LOS, tracked
 * by the faction's intel) can be targeted.
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
 * When stuck, the bot shoots destructible terrain to blast a path
 * (js/ai/recovery.js).
 */

import { steerTurretTo, updateWobble } from "./ai/aiming.js";
import { patrol, pickWaypoint, steerToPoint, updatePath } from "./ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "./ai/recovery.js";
import { chooseSwarmGoal, spacingOffset } from "./ai/swarm/behaviours.js";
import { Swarm } from "./ai/swarm/index.js";
import { CONFIG } from "./config.js";
import { Pathfinder } from "./pathfinder.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

export class AIController {
    constructor(map, rng = Math.random, swarm = null) {
        this.keys = {};
        this._rng = rng;

        /**
         * The faction's shared colony state.  The Game injects it; a bot
         * built without one (unit tests) gets a private colony.
         */
        this.swarm = swarm ?? new Swarm(map?.width ?? CONFIG.MAP_WIDTH, map?.height ?? CONFIG.MAP_HEIGHT);
        /** Friendly vehicles (self included) for convoy/spacing reads. */
        this.allies = [];

        // Pathfinding
        this._pf = map ? new Pathfinder(map) : null;
        this._path = []; // [{x,y}] waypoints
        this._pathTimer = this._rng() * 0.3;
        this._pathGoal = null;

        /** The behaviour driving navigation right now ({kind, x, y}). */
        this.currentGoal = null;

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
        this._path = [];
        this._pathTimer = 0;
        this._posHistory = [];
        this.stuckTime = 0;
        this.evading = false;
        this.currentGoal = null;
        this._exploreGoal = null;
        this._exploreTimer = 0;
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

    think(dt, me, enemies, map) {
        this.keys = {};
        if (!me.alive) return;
        if (!this._pf) this._pf = new Pathfinder(map);

        this.fireDelay -= dt;
        updateWobble(this, dt);
        updateStuck(this, dt, me);

        // Vehicle behaviours that drive the whole think (drones fly their
        // own loop; squads hold while digging in; immobilised vehicles pivot)
        // consume the frame.
        if (getVehicleBehaviour(me.vehicleType).aiThink(this, dt, me, enemies, map)) return;

        // ── Stuck escalation ──
        if (this.stuckTime > 1.0 && !this.evading) {
            handleStuck(this, me, map);
            return;
        }
        if (this.evading) {
            evade(this, dt, me, map);
            return;
        }

        // ── The swarm picks the goal; combat targeting picks the target ──
        const { navGoal, fireTarget } = chooseSwarmGoal(this, dt, me, enemies, map);
        this.currentGoal = navGoal;

        if (!navGoal) {
            patrol(this);
            return;
        }

        // ── Update path and follow it, bent by personal space ──
        updatePath(this, dt, me, navGoal);
        const wp = pickWaypoint(this, me, map);
        const spacing = spacingOffset(this, me);
        steerToPoint(this, me, { x: wp.x + spacing.x, y: wp.y + spacing.y }, { hasPath: this._path.length > 0, map });

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
