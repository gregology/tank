/**
 * Infantry squad combat helpers.
 *
 * A squad is one Tank entity (the leader), but it owns a `Squad`
 * component made of individual soldiers.  Each soldier has its own
 * position, life, and weapon cooldown, so the squad can move and fight
 * like a real group rather than a rigid block.
 *
 * pickSquadTarget() is the shared target-selection logic, kept out of
 * game.js so it can be unit-tested without constructing a full Game.
 */

import { pickTarget } from "./ai/targeting.js";
import { SQUAD_ATTENTION_ORDER, VEHICLES } from "./config.js";
import { Formation } from "./formation.js";
import { distance } from "./utils.js";

/**
 * Choose a target for one squad member.
 *
 * Prefers `primaryTargets` and falls back to `fallbackTargets` (plinking).
 * Picks the closest in-range candidate with line-of-sight; any primary
 * target beats any fallback one regardless of distance.
 *
 * Callers must pass only pre-filtered candidates (alive, enemy team).
 *
 * @param {{x:number, y:number}} origin    position the member fires from
 * @param {object} member                  a SQUAD_MEMBERS entry
 * @param {Array<object>} candidates       targets with x/y + targetType
 * @param {(x1:number, y1:number, x2:number, y2:number) => boolean} hasLineOfSight
 * @returns {{ entity: object, isFallback: boolean } | null}
 */
export function pickSquadTarget(origin, member, candidates, hasLineOfSight) {
    const primary = new Set(member.primaryTargets);
    const fallback = new Set(member.fallbackTargets);

    // Express primary/fallback as priorities through the shared weighted
    // core (`pickTarget`): primary targets get a huge weight so they beat
    // any fallback regardless of distance; fallbacks get a token weight.
    const priorities = {};
    for (const e of candidates) {
        const type = e.targetType ?? e.entityType;
        priorities[type] = primary.has(type) ? 1e6 : fallback.has(type) ? 1 : 0;
    }

    const pick = pickTarget(candidates, priorities, origin, { range: member.range, hasLineOfSight });
    if (!pick) return null;
    const type = pick.target.targetType ?? pick.target.entityType;
    return { entity: pick.target, isFallback: !primary.has(type) };
}

/**
 * The squad component owned by a squad-type Tank.
 *
 * Owns the soldiers, the dig-in state machine, and the squad's damage
 * model.  Positions are world-space and authoritative: rendering, firing,
 * hit tests, and run-over all read them.
 */
export class Squad {
    constructor(tank) {
        this.tank = tank;
        this.members = SQUAD_ATTENTION_ORDER.map((type) => ({
            type,
            x: tank.x,
            y: tank.y,
            alive: true,
            cooldown: 0,
        }));
        this.formation = new Formation();
        // Dig-in state machine: roaming → diggingIn (timed) → dugIn → roaming.
        this.digIn = { state: "roaming", timer: 0 };
        this.partialDamage = 0; // fractional damage carried between hits
    }

    /* ── derived state ─────────────────────────────────────── */

    get membersAlive() {
        return this.members.reduce((n, m) => n + (m.alive ? 1 : 0), 0);
    }
    get aliveMembers() {
        return this.members.filter((m) => m.alive);
    }
    get hpFraction() {
        return this.members.length > 0 ? this.membersAlive / this.members.length : 0;
    }
    get dugIn() {
        return this.digIn.state === "dugIn";
    }
    /** Soldiers cannot fire while performing the dig-in transition. */
    get canFire() {
        return this.digIn.state !== "diggingIn";
    }
    /** Soldiers can move only while roaming (digging in / dug in = immobile). */
    get canMove() {
        return this.digIn.state === "roaming";
    }
    /** A non-dug-in soldier can be run over; dug-in soldiers are protected. */
    get isCrushable() {
        return this.digIn.state !== "dugIn";
    }

    /* ── dig-in state machine ──────────────────────────────── */

    startDigIn() {
        if (this.digIn.state === "roaming") {
            this.digIn = { state: "diggingIn", timer: VEHICLES.squad.digInTime };
        }
    }
    cancelDigIn() {
        if (this.digIn.state === "diggingIn") this.digIn = { state: "roaming", timer: 0 };
    }
    standUp() {
        this.digIn = { state: "roaming", timer: 0 };
    }

    /* ── per-frame update ──────────────────────────────────── */

    /**
     * Tick the dig-in timer and steer members.  Members only move while
     * roaming; digging in and dug in hold them in place.
     */
    update(dt, map) {
        if (this.digIn.state === "diggingIn") {
            this.digIn.timer -= dt;
            if (this.digIn.timer <= 0) this.digIn = { state: "dugIn", timer: 0 };
        }
        if (this.digIn.state === "roaming") {
            this.formation.update(dt, this.tank, map, this.members);
        }
    }

    /* ── damage model ──────────────────────────────────────── */

    /**
     * Apply damage to the squad.  Each whole point of damage kills the next
     * alive member in canonical order (fractional remainder carries).
     *
     * @returns {"destroyed" | "absorbed"}
     */
    applyDamage(damage) {
        const total = this.partialDamage + damage;
        let kills = Math.floor(total);
        this.partialDamage = total - kills;
        for (const m of this.members) {
            if (kills <= 0) break;
            if (m.alive) {
                m.alive = false;
                kills--;
            }
        }
        return this.membersAlive === 0 ? "destroyed" : "absorbed";
    }

    /**
     * Incoming-damage multiplier after cover/dig-in reduction (0..1).
     * Squads get mechanical cover near intact buildings and a further
     * reduction while dug in, capped at maxDamageReduction.
     */
    damageMultiplier(map) {
        const v = VEHICLES.squad;
        let reduction = this.dugIn ? v.digInReduction : 0;
        if (map.hasIntactBuildingNear(this.tank.x, this.tank.y, v.coverRadius)) {
            reduction = Math.max(reduction, v.coverReduction);
        }
        reduction = Math.min(reduction, v.maxDamageReduction);
        return 1 - reduction;
    }

    /**
     * Run over a specific member.
     * @returns {boolean} true if the squad was destroyed (last member).
     */
    crushMember(index) {
        const m = this.members[index];
        if (!m?.alive || !this.isCrushable) return false;
        m.alive = false;
        return this.membersAlive === 0;
    }

    /**
     * Index of the first crushable soldier under `vehicle` (i.e. within its
     * collision radius), or -1.  Ground vehicles use this to run soldiers over.
     */
    crushedMemberBy(vehicle) {
        if (!this.isCrushable) return -1;
        const r = vehicle.size;
        for (let i = 0; i < this.members.length; i++) {
            const m = this.members[i];
            if (m.alive && distance(vehicle.x, vehicle.y, m.x, m.y) < r) return i;
        }
        return -1;
    }

    /* ── body surface (multi-member hitbox + hp) ───────────── */

    /** Distance to the nearest alive member (falls back to the leader). */
    distanceToPoint(x, y) {
        const d = this.nearestMemberDistance(x, y);
        return Number.isFinite(d) ? d : distance(x, y, this.tank.x, this.tank.y);
    }

    /** Radius used for AoE falloff (one soldier). */
    get hitRadius() {
        return VEHICLES.squad.soldierRadius;
    }

    /** True if a point is inside any alive member. */
    hitTest(x, y) {
        return this.bulletHit(x, y);
    }

    /* ── distributed hitbox helpers ────────────────────────── */

    /** True if (bx, by) is within `soldierRadius` of any alive member. */
    bulletHit(bx, by) {
        const r = VEHICLES.squad.soldierRadius;
        for (const m of this.members) {
            if (m.alive && distance(bx, by, m.x, m.y) < r) return true;
        }
        return false;
    }

    /** Distance to the nearest alive member (Infinity if none). */
    nearestMemberDistance(x, y) {
        let best = Infinity;
        for (const m of this.members) {
            if (!m.alive) continue;
            const d = distance(x, y, m.x, m.y);
            if (d < best) best = d;
        }
        return best;
    }
}
