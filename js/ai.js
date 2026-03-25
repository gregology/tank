/**
 * AI controller for a tank.
 *
 * Implements the same `isDown` / `wasPressed` / `endFrame` interface as
 * InputManager so it can be used as a drop-in replacement.
 *
 * Behaviours:
 *   • Pick nearest enemy or head to objective (tower)
 *   • Rotate toward target, advance when far
 *   • Fire when aimed + line-of-sight
 *   • Multi-probe obstacle avoidance with wall-following memory
 *   • Reverse when head-on stuck, random evade as last resort
 *   • Patrol when no targets available
 */

export class AIController {
    constructor(keyMap) {
        this.keyMap = keyMap;
        this.keys = {};

        // Timing
        this.fireDelay   = 0;

        // Stuck detection
        this.lastX       = 0;
        this.lastY       = 0;
        this.stuckTime   = 0;

        // Evade state (last resort random manoeuvre)
        this.evading     = false;
        this.evadeDir    = 1;
        this.evadeTimer  = 0;

        // Wall-follow memory: when we steer to avoid an obstacle,
        // remember the direction so we commit to going around one side.
        this.avoidDir    = 0;      // -1 left, +1 right, 0 none
        this.avoidTimer  = 0;      // seconds remaining to hold the bias

        // Aim wobble (less robotic)
        this.aimWobble   = 0;
        this.wobbleTimer = 0;
    }

    /* ── public interface ─────────────────────────────────── */

    isDown(code)  { return !!this.keys[code]; }
    wasPressed(_) { return false; }
    endFrame()    {}

    /* ── main think ───────────────────────────────────────── */

    think(dt, me, enemies, map, objective = null) {
        this.keys = {};
        if (!me.alive) return;

        this.fireDelay -= dt;

        // Wobble
        this.wobbleTimer -= dt;
        if (this.wobbleTimer <= 0) {
            this.aimWobble   = (Math.random() - 0.5) * 0.18;
            this.wobbleTimer = 0.4 + Math.random() * 0.8;
        }

        // Stuck detection
        const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
        this.stuckTime = moved < 0.005
            ? this.stuckTime + dt
            : Math.max(0, this.stuckTime - dt * 3);
        this.lastX = me.x;
        this.lastY = me.y;

        // Decay avoid bias
        if (this.avoidTimer > 0) this.avoidTimer -= dt;
        else this.avoidDir = 0;

        // ── Stage 1: stuck → try reversing, then random evade ──
        if (this.stuckTime > 0.3 && !this.evading) {
            // First try: reverse for a bit
            if (this.stuckTime < 0.8) {
                this.keys[this.keyMap.backward] = true;
                // Turn while reversing
                this.keys[this.avoidDir >= 0
                    ? this.keyMap.right : this.keyMap.left] = true;
                return;
            }
            // Longer stuck → full random evade
            this.evading    = true;
            this.evadeTimer = 0.5 + Math.random() * 0.8;
            this.evadeDir   = Math.random() > 0.5 ? 1 : -1;
            this.stuckTime  = 0;
        }

        if (this.evading) { this._evade(dt); return; }

        // ── Stage 2: pick target ──
        let aimX, aimY, dist;
        const nearest = this._nearestEnemy(me, enemies);

        if (nearest && nearest.dist < 15) {
            aimX = nearest.tank.x;  aimY = nearest.tank.y;
            dist = nearest.dist;
        } else if (objective) {
            aimX = objective.x;  aimY = objective.y;
            dist = Math.hypot(objective.x - me.x, objective.y - me.y);
        } else if (nearest) {
            aimX = nearest.tank.x;  aimY = nearest.tank.y;
            dist = nearest.dist;
        } else {
            this._patrol(); return;
        }

        // ── Stage 3: aim ──
        const targetAngle = Math.atan2(aimY - me.y, aimX - me.x) + this.aimWobble;
        let diff = targetAngle - me.angle;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const AIM = 0.1;
        if (diff >  AIM) this.keys[this.keyMap.right] = true;
        if (diff < -AIM) this.keys[this.keyMap.left]  = true;

        // ── Stage 4: move ──
        const aimed = Math.abs(diff) < 0.4;
        if (dist > 5 || (dist > 2.0 && aimed)) {
            this.keys[this.keyMap.forward] = true;
        }

        // ── Stage 5: obstacle avoidance ──
        if (this.keys[this.keyMap.forward]) {
            this._avoidObstacles(me, map, diff);
        }

        // ── Stage 6: fire ──
        if (Math.abs(diff) < AIM * 2.5 && dist < 25 && this.fireDelay <= 0) {
            if (this._los(me.x, me.y, aimX, aimY, map)) {
                this.keys[this.keyMap.fire] = true;
                this.fireDelay = 0.25 + Math.random() * 0.35;
            }
        }
    }

    /* ── behaviours ───────────────────────────────────────── */

    _nearestEnemy(me, enemies) {
        let best = null, bestD = Infinity;
        for (const e of enemies) {
            if (!e.alive) continue;
            const d = Math.hypot(e.x - me.x, e.y - me.y);
            if (d < bestD) { best = e; bestD = d; }
        }
        return best ? { tank: best, dist: bestD } : null;
    }

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

    _patrol() {
        this.keys[this.keyMap.forward] = true;
        if (Math.sin(performance.now() / 700) > 0.3)
            this.keys[this.keyMap.right] = true;
    }

    /**
     * Multi-probe obstacle avoidance with wall-following memory.
     * Probes at several angles and distances to find a clear path.
     * Once a steer direction is chosen, it's held for a short time
     * so the bot commits to going around one side of an obstacle.
     */
    _avoidObstacles(me, map, aimDiff) {
        const k = this.keyMap;
        const a = me.angle;

        // Probe at 3 distances: close, mid, far
        const blocked = (angle, dist) => !map.isPassable(
            me.x + Math.cos(angle) * dist,
            me.y + Math.sin(angle) * dist);

        const fwdBlocked = blocked(a, 0.8) || blocked(a, 1.5);
        if (!fwdBlocked) return;   // clear ahead

        // If we already have an avoid direction, keep using it
        if (this.avoidDir !== 0 && this.avoidTimer > 0) {
            this.keys[this.avoidDir > 0 ? k.right : k.left] = true;
            // If the angled path is also blocked, stop driving forward
            const sideA = a + this.avoidDir * 0.8;
            if (blocked(sideA, 1.0)) {
                this.keys[k.forward] = false;
            }
            return;
        }

        // Probe wider angles to find best direction
        // Score each side: how many of the probe angles are clear
        let leftScore = 0, rightScore = 0;
        const probeAngles = [0.4, 0.8, 1.2, 1.6];
        const probeDists  = [0.8, 1.3];

        for (const pa of probeAngles) {
            for (const pd of probeDists) {
                if (!blocked(a - pa, pd)) leftScore++;
                if (!blocked(a + pa, pd)) rightScore++;
            }
        }

        // Bias toward the target direction so we go around the
        // obstacle on the side closest to our goal
        if (aimDiff < -0.1) leftScore += 2;
        if (aimDiff >  0.1) rightScore += 2;

        // Choose the clearer side (or random if tied)
        let dir;
        if (leftScore > rightScore)      dir = -1;
        else if (rightScore > leftScore) dir = 1;
        else dir = Math.random() > 0.5 ? 1 : -1;

        this.avoidDir   = dir;
        this.avoidTimer = 0.6 + Math.random() * 0.6;   // commit for a while

        this.keys[dir > 0 ? k.right : k.left] = true;

        // If even the angled path is blocked, stop forward and just rotate
        const sideA = a + dir * 0.8;
        if (blocked(sideA, 1.0)) {
            this.keys[k.forward] = false;
        }
    }

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
