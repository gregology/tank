/**
 * Tank entity – handles movement, rotation, firing cooldown, and respawn.
 *
 * Movement model:  W/↑ = drive forward in the direction the tank faces,
 * S/↓ = reverse (slower), A/← and D/→ = rotate in place.
 */

import { CONFIG } from './config.js';
import { normalizeAngle } from './utils.js';

export class Tank {
    constructor(playerNumber, color, darkColor) {
        this.playerNumber = playerNumber;
        this.color     = color;
        this.darkColor = darkColor;

        // World-space state
        this.x     = 0;
        this.y     = 0;
        this.angle = 0;          // radians – 0 = east in world space

        // Gameplay
        this.alive        = true;
        this.score        = 0;
        this.fireCooldown = 0;
        this.respawnTimer = 0;

        // Visual feedback
        this.flashTimer  = 0;    // invulnerability flash after respawn
        this.recoilTimer = 0;    // barrel recoil animation
        this.treadPhase  = 0;    // 0‒1 tread scroll offset (animated)
    }

    /* ── per-frame update ─────────────────────────────────── */

    update(dt, input, keyMap, map) {
        // Tick timers even when dead (respawn countdown)
        if (!this.alive) {
            this.respawnTimer -= dt;
            if (this.respawnTimer <= 0) {
                this.alive = true;
                this.flashTimer = 1.0;  // 1 s of invuln-flash
            }
            return;
        }

        if (this.flashTimer  > 0) this.flashTimer  -= dt;
        if (this.fireCooldown > 0) this.fireCooldown -= dt;
        if (this.recoilTimer  > 0) this.recoilTimer  -= dt;

        const oldX = this.x, oldY = this.y;

        // ── Rotation
        const rotating = input.isDown(keyMap.left) || input.isDown(keyMap.right);
        if (input.isDown(keyMap.left))  this.angle -= CONFIG.TANK_ROTATION_SPEED * dt;
        if (input.isDown(keyMap.right)) this.angle += CONFIG.TANK_ROTATION_SPEED * dt;
        this.angle = normalizeAngle(this.angle);

        // ── Forward / reverse
        let move = 0;
        if (input.isDown(keyMap.forward))  move =  1;
        if (input.isDown(keyMap.backward)) move = -CONFIG.TANK_REVERSE_FACTOR;

        if (move !== 0) {
            const speed = CONFIG.TANK_SPEED * move;
            const nx = this.x + Math.cos(this.angle) * speed * dt;
            const ny = this.y + Math.sin(this.angle) * speed * dt;

            // Slide along obstacles – try each axis independently
            if (this._canOccupy(nx, this.y, map)) this.x = nx;
            if (this._canOccupy(this.x, ny, map)) this.y = ny;
        }

        // ── Tread animation (scrolls when moving or rotating in place)
        const dx = this.x - oldX, dy = this.y - oldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.0001 || rotating) {
            this.treadPhase = (this.treadPhase
                + Math.max(dist * 6, rotating ? dt * 2.5 : 0)) % 1;
        }
    }

    /* ── firing ───────────────────────────────────────────── */

    canFire() { return this.alive && this.fireCooldown <= 0; }

    fire() {
        this.fireCooldown = CONFIG.BULLET_COOLDOWN;
        this.recoilTimer  = 0.1;
    }

    /* ── damage ───────────────────────────────────────────── */

    kill() {
        this.alive = false;
        this.respawnTimer = CONFIG.TANK_RESPAWN_TIME;
    }

    respawnAt(x, y) {
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
    }

    /* ── collision helper ─────────────────────────────────── */

    _canOccupy(wx, wy, map) {
        const s = CONFIG.TANK_SIZE * 0.85;
        return map.isPassable(wx - s, wy - s)
            && map.isPassable(wx + s, wy - s)
            && map.isPassable(wx - s, wy + s)
            && map.isPassable(wx + s, wy + s);
    }
}
