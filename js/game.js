/**
 * Core game state – owns the map, tanks, bullets, particles, cameras,
 * and runs the update loop.
 *
 * Emits events so other systems (sound, UI) can react without tight
 * coupling.  Use `game.on(event, callback)` to subscribe.
 *
 * Events:
 *   'fire'     { tank, bullet }
 *   'hit'      { bullet, victim, killer }
 *   'destroy'  { tank }
 *   'respawn'  { tank }
 *   'win'      { winner }
 */

import { CONFIG } from './config.js';
import { GameMap } from './map.js';
import { Tank } from './tank.js';
import { Bullet } from './bullet.js';
import { ParticleSystem } from './particles.js';
import { Camera } from './camera.js';
import { distance, worldToScreen } from './utils.js';

export class Game {
    constructor(input) {
        this.input = input;
        this.map   = new GameMap();
        this.particles = new ParticleSystem();

        /** @type {Bullet[]} */
        this.bullets = [];

        // ── Players
        this.tank1 = new Tank(1, '#cc3333', '#882222');
        this.tank2 = new Tank(2, '#3366dd', '#223399');

        // ── Cameras (one per viewport)
        this.camera1 = new Camera();
        this.camera2 = new Camera();

        // ── State
        this.gameTime = 0;
        this.gameOver = false;
        this.winner   = null;

        /** @type {Record<string, Function[]>} */
        this._listeners = {};

        this._initialSpawn();
    }

    /* ── event bus ─────────────────────────────────────────── */

    on(event, fn)  { (this._listeners[event] ??= []).push(fn); }
    emit(event, data) {
        for (const fn of this._listeners[event] ?? []) fn(data);
    }

    /* ── main update ──────────────────────────────────────── */

    update(dt) {
        if (this.gameOver) return;
        this.gameTime += dt;

        // Tanks
        this.tank1.update(dt, this.input, CONFIG.PLAYER1_KEYS, this.map);
        this.tank2.update(dt, this.input, CONFIG.PLAYER2_KEYS, this.map);

        // Tank-tank push-apart
        this._separateTanks();

        // Firing
        this._handleFiring(this.tank1, CONFIG.PLAYER1_KEYS);
        this._handleFiring(this.tank2, CONFIG.PLAYER2_KEYS);

        // Bullets
        for (const b of this.bullets) {
            const wasAlive = b.alive;
            b.update(dt, this.map);
            // emit impact particles when bullet hits terrain
            if (wasAlive && !b.alive) {
                this.particles.emitImpact(b.x, b.y);
            }
        }

        // Collisions
        this._checkBulletHits();
        this.bullets = this.bullets.filter(b => b.alive);

        // Particles
        this.particles.update(dt);

        // Cameras
        this._updateCamera(this.camera1, this.tank1, dt);
        this._updateCamera(this.camera2, this.tank2, dt);

        // Win check
        this._checkWin();
    }

    /* ── reset for a new round ────────────────────────────── */

    restart() {
        this.tank1.score = 0;
        this.tank2.score = 0;
        this.bullets = [];
        this.particles = new ParticleSystem();
        this.gameOver = false;
        this.winner   = null;
        this._initialSpawn();
    }

    /* ── private ──────────────────────────────────────────── */

    _initialSpawn() {
        const s1 = this.map.getSpawnPoint();
        this.tank1.respawnAt(s1.x, s1.y);
        this.tank1.alive = true;
        this.tank1.angle = Math.PI / 4;

        const s2 = this.map.getSpawnPoint(s1.x, s1.y);
        this.tank2.respawnAt(s2.x, s2.y);
        this.tank2.alive = true;
        this.tank2.angle = -3 * Math.PI / 4;

        // Snap cameras immediately
        const sc1 = worldToScreen(this.tank1.x, this.tank1.y);
        this.camera1.setPosition(sc1.x, sc1.y);
        const sc2 = worldToScreen(this.tank2.x, this.tank2.y);
        this.camera2.setPosition(sc2.x, sc2.y);
    }

    _handleFiring(tank, keys) {
        if (this.input.isDown(keys.fire) && tank.canFire()) {
            tank.fire();
            const b = new Bullet(tank.x, tank.y, tank.angle, tank.playerNumber);
            this.bullets.push(b);
            // muzzle flash
            const tipX = tank.x + Math.cos(tank.angle) * CONFIG.TANK_BARREL_LENGTH;
            const tipY = tank.y + Math.sin(tank.angle) * CONFIG.TANK_BARREL_LENGTH;
            this.particles.emitMuzzleFlash(tipX, tipY, tank.angle);
            this.emit('fire', { tank, bullet: b });
        }
    }

    _checkBulletHits() {
        const tanks = [this.tank1, this.tank2];

        for (const b of this.bullets) {
            if (!b.alive) continue;
            for (const t of tanks) {
                if (!t.alive) continue;
                if (b.owner === t.playerNumber) continue;   // no self-hit
                if (distance(b.x, b.y, t.x, t.y) < CONFIG.TANK_SIZE) {
                    b.alive = false;
                    const killer = b.owner === 1 ? this.tank1 : this.tank2;
                    this.emit('hit', { bullet: b, victim: t, killer });
                    this._destroyTank(t, killer);
                    break;
                }
            }
        }
    }

    _destroyTank(tank, killer) {
        this.particles.emitExplosion(tank.x, tank.y);
        tank.kill();
        killer.score++;
        this.emit('destroy', { tank });

        // pick a respawn location away from the killer
        const other = tank === this.tank1 ? this.tank2 : this.tank1;
        const sp = this.map.getSpawnPoint(other.x, other.y);
        tank.respawnAt(sp.x, sp.y);
    }

    _separateTanks() {
        const t1 = this.tank1, t2 = this.tank2;
        if (!t1.alive || !t2.alive) return;
        const d = distance(t1.x, t1.y, t2.x, t2.y);
        const minD = CONFIG.TANK_SIZE * 2;
        if (d < minD && d > 0.001) {
            const overlap = (minD - d) / 2;
            const nx = (t2.x - t1.x) / d;
            const ny = (t2.y - t1.y) / d;
            t1.x -= nx * overlap;
            t1.y -= ny * overlap;
            t2.x += nx * overlap;
            t2.y += ny * overlap;
        }
    }

    _updateCamera(cam, tank, dt) {
        if (tank.alive) {
            const s = worldToScreen(tank.x, tank.y);
            cam.follow(s.x, s.y, dt);
        }
    }

    _checkWin() {
        if (this.tank1.score >= CONFIG.WIN_SCORE) {
            this.gameOver = true;
            this.winner = 1;
            this.emit('win', { winner: 1 });
        } else if (this.tank2.score >= CONFIG.WIN_SCORE) {
            this.gameOver = true;
            this.winner = 2;
            this.emit('win', { winner: 2 });
        }
    }
}
