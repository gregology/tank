/**
 * AI controller for a tank.
 *
 * Implements the same `isDown` / `wasPressed` / `endFrame` interface as
 * InputManager so it can be used as a drop-in replacement.  Each frame
 * the AI observes the world and decides which virtual keys to "press".
 *
 * Behaviours:
 *   • Rotate toward the enemy
 *   • Advance when far away
 *   • Fire when aimed and has line-of-sight
 *   • Avoid obstacles by probing left / right
 *   • Unstick itself after being blocked for too long
 *   • Patrol randomly when the enemy is dead
 */

export class AIController {
    /**
     * @param {object} keyMap  The CONFIG.PLAYER*_KEYS object whose
     *                         code strings the AI will "press".
     */
    constructor(keyMap) {
        this.keyMap = keyMap;

        /** Virtual key state for this frame. */
        this.keys = {};

        // ── Timing / state ──
        this.fireDelay   = 0;     // cooldown so it doesn't fire every frame
        this.lastX       = 0;
        this.lastY       = 0;
        this.stuckTime   = 0;
        this.evading     = false;
        this.evadeDir    = 1;
        this.evadeTimer  = 0;

        // ── Aim wobble (makes AI feel less robotic) ──
        this.aimWobble     = 0;
        this.wobbleTimer   = 0;
    }

    /* ── public interface (matches InputManager) ──────────── */

    isDown(code)    { return !!this.keys[code]; }
    wasPressed(_)   { return false; }
    endFrame()      { /* nothing to clear */ }

    /* ── called once per frame by Game.update ─────────────── */

    think(dt, me, enemy, map) {
        this.keys = {};
        if (!me.alive) return;

        this.fireDelay -= dt;

        // ── Aim wobble update ──
        this.wobbleTimer -= dt;
        if (this.wobbleTimer <= 0) {
            this.aimWobble   = (Math.random() - 0.5) * 0.18;
            this.wobbleTimer = 0.4 + Math.random() * 0.8;
        }

        // ── Stuck detection ──
        const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
        this.stuckTime = (moved < 0.005) ? this.stuckTime + dt
                                          : Math.max(0, this.stuckTime - dt * 2);
        this.lastX = me.x;
        this.lastY = me.y;

        if (this.stuckTime > 0.4 && !this.evading) {
            this.evading    = true;
            this.evadeTimer = 0.4 + Math.random() * 0.6;
            this.evadeDir   = Math.random() > 0.5 ? 1 : -1;
        }

        if (this.evading) {
            this._evade(dt);
            return;
        }

        // ── No target → patrol ──
        if (!enemy.alive) {
            this._patrol(dt);
            return;
        }

        // ── Targeting ──
        const dx   = enemy.x - me.x;
        const dy   = enemy.y - me.y;
        const dist = Math.hypot(dx, dy);
        const targetAngle = Math.atan2(dy, dx) + this.aimWobble;

        let diff = targetAngle - me.angle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Rotate toward target
        const AIM = 0.1;   // radians – "close enough" to fire
        if (diff >  AIM) this.keys[this.keyMap.right] = true;
        if (diff < -AIM) this.keys[this.keyMap.left]  = true;

        // Advance
        const aimed = Math.abs(diff) < 0.35;
        if (dist > 5 || (dist > 2.5 && aimed)) {
            this.keys[this.keyMap.forward] = true;
        }

        // Obstacle avoidance (only when driving forward)
        if (this.keys[this.keyMap.forward]) {
            this._avoidObstacles(me, map);
        }

        // Fire
        if (Math.abs(diff) < AIM * 2.5 && dist < 25 && this.fireDelay <= 0) {
            if (this._los(me.x, me.y, enemy.x, enemy.y, map)) {
                this.keys[this.keyMap.fire] = true;
                this.fireDelay = 0.25 + Math.random() * 0.35;
            }
        }
    }

    /* ── private behaviours ───────────────────────────────── */

    _evade(dt) {
        this.evadeTimer -= dt;
        const k = this.keyMap;
        this.keys[this.evadeDir > 0 ? k.right : k.left] = true;
        this.keys[k.forward] = true;
        if (this.evadeTimer <= 0) {
            this.evading   = false;
            this.stuckTime = 0;
        }
    }

    _patrol(dt) {
        this.keys[this.keyMap.forward] = true;
        // Gentle weave
        if (Math.sin(performance.now() / 700) > 0.3) {
            this.keys[this.keyMap.right] = true;
        }
    }

    /** Probe 1 unit ahead; if blocked, steer around. */
    _avoidObstacles(me, map) {
        const k = this.keyMap;
        const D = 1.2;
        const ax = me.x + Math.cos(me.angle) * D;
        const ay = me.y + Math.sin(me.angle) * D;
        if (map.isPassable(ax, ay)) return;          // clear ahead

        const lx = me.x + Math.cos(me.angle - 0.5) * D;
        const ly = me.y + Math.sin(me.angle - 0.5) * D;
        const rx = me.x + Math.cos(me.angle + 0.5) * D;
        const ry = me.y + Math.sin(me.angle + 0.5) * D;

        if (map.isPassable(lx, ly)) {
            this.keys[k.left]  = true;
            this.keys[k.right] = false;
        } else if (map.isPassable(rx, ry)) {
            this.keys[k.right] = true;
            this.keys[k.left]  = false;
        } else {
            this.keys[k.forward] = false;
            this.keys[k.right]   = true;
        }
    }

    /** Ray-march line-of-sight check. */
    _los(x1, y1, x2, y2, map) {
        const dx = x2 - x1, dy = y2 - y1;
        const d  = Math.hypot(dx, dy);
        const n  = Math.ceil(d * 3);
        for (let i = 1; i < n; i++) {
            const t = i / n;
            if (map.blocksProjectile(x1 + dx * t, y1 + dy * t)) return false;
        }
        return true;
    }
}
