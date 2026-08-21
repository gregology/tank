/**
 * Formation — a reusable follower/steering system for groups of agents.
 *
 * A leader (any object with x/y/angle) moves freely; members follow their
 * assigned formation slots using local steering, so the group behaves like
 * a real squad rather than a rigid block:
 *
 *   arrive            — seek the slot, slowing as they reach it
 *   separation        — push apart from siblings (don't stack)
 *   obstacle avoidance — project to the nearest passable tile (slide around walls)
 *   wall affinity     — a gentle bias toward buildings so members hug cover
 *
 * The formation tightens as members die: remaining members re-form toward
 * the leader (the group "gravitates to the centre").
 *
 * The map is a duck-typed interface: `isPassable(x, y)` is required;
 * `nearestBuilding(x, y, maxDist)` and `nearestPassable(x, y)` are optional.
 */

import { VEHICLES } from "./config.js";

/** Default 5-soldier wedge, in local space (+x forward, +y right). */
export const DEFAULT_SQUAD_SLOTS = [
    [0.32, 0],
    [0.0, -0.3],
    [0.0, 0.3],
    [-0.28, -0.16],
    [-0.28, 0.16],
];

export class Formation {
    /**
     * @param {object} [opts]
     * @param {Array<[number, number]>} [opts.slots]         formation slot offsets
     * @param {number} [opts.maxSpeed]                        member max steering speed
     * @param {number} [opts.spacing]                         minimum separation
     * @param {number} [opts.wallAffinity]                    0..1 building-hug bias
     */
    constructor({
        slots = DEFAULT_SQUAD_SLOTS,
        maxSpeed = VEHICLES.squad.memberSpeed,
        spacing = VEHICLES.squad.formationSpacing,
        wallAffinity = VEHICLES.squad.wallAffinity,
    } = {}) {
        this.slots = slots;
        this.maxSpeed = maxSpeed;
        this.spacing = spacing;
        this.wallAffinity = wallAffinity;
    }

    /**
     * Steer every alive member toward its slot for this frame.
     *
     * @param {number} dt  seconds
     * @param {{x:number, y:number, angle:number}} leader
     * @param {object} map  see module docs
     * @param {Array<{x:number, y:number, alive:boolean}>} members
     */
    update(dt, leader, map, members) {
        const alive = members.filter((m) => m.alive);
        const count = alive.length;
        if (count === 0) return;

        for (let i = 0; i < count; i++) {
            const slot = this._slotFor(i, count);
            const target = this._slotToWorld(leader, slot);
            this._steer(alive[i], target, dt, map, alive);
        }
    }

    /** Slot for the i-th of `count` alive members, tightened as count shrinks. */
    _slotFor(index, count) {
        const n = this.slots.length;
        const slot = this.slots[Math.min(index, n - 1)];
        // Full spread at full strength, collapsing to the leader when one remains.
        const scale = n > 1 ? (count - 1) / (n - 1) : 0;
        return [slot[0] * scale, slot[1] * scale];
    }

    /** Rotate a local slot offset into a world position under the leader. */
    _slotToWorld(leader, [lx, ly]) {
        const ca = Math.cos(leader.angle),
            sa = Math.sin(leader.angle);
        return {
            x: leader.x + lx * ca - ly * sa,
            y: leader.y + lx * sa + ly * ca,
        };
    }

    _steer(m, target, dt, map, alive) {
        // ── Arrive: seek the slot, slowing as we close in ──
        const dx = target.x - m.x;
        const dy = target.y - m.y;
        const dist = Math.hypot(dx, dy);
        let vx = 0,
            vy = 0;
        if (dist > 0.0001) {
            const speed = Math.min(this.maxSpeed, dist * 4);
            vx = (dx / dist) * speed;
            vy = (dy / dist) * speed;
        }

        // ── Separation: don't stack on siblings ──
        for (const o of alive) {
            if (o === m) continue;
            const sx = m.x - o.x,
                sy = m.y - o.y;
            const d = Math.hypot(sx, sy);
            if (d < this.spacing && d > 0.0001) {
                const push = ((this.spacing - d) / this.spacing) * this.maxSpeed;
                vx += (sx / d) * push;
                vy += (sy / d) * push;
            }
        }

        // ── Wall affinity: gentle bias toward nearby buildings ──
        if (this.wallAffinity > 0 && map.nearestBuilding) {
            const b = map.nearestBuilding(m.x, m.y, 2.0);
            if (b) {
                const bx = b.x - m.x,
                    by = b.y - m.y;
                const bd = Math.hypot(bx, by) || 1;
                // Stronger when already close — pulls members onto the wall.
                const falloff = Math.max(0, 1 - bd / 2.0);
                vx += (bx / bd) * this.wallAffinity * this.maxSpeed * falloff;
                vy += (by / bd) * this.wallAffinity * this.maxSpeed * falloff;
            }
        }

        // ── Integrate + obstacle avoidance (project to passable) ──
        let nx = m.x + vx * dt;
        let ny = m.y + vy * dt;
        if (!map.isPassable(nx, ny)) {
            if (map.isPassable(nx, m.y)) {
                ny = m.y;
            } else if (map.isPassable(m.x, ny)) {
                nx = m.x;
            } else if (map.nearestPassable) {
                const p = map.nearestPassable(nx, ny);
                if (p) {
                    nx = p.x;
                    ny = p.y;
                }
            }
        }
        m.x = nx;
        m.y = ny;
    }
}
