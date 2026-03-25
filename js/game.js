/**
 * Core game state.
 *
 * Supports three modes:
 *   'pvp'  — 2 humans, split screen
 *   'pvb'  — 1 human vs 1 AI, full screen
 *   'team' — 5 v 5 (1 human + 4 AI  vs  5 AI), full screen, towers
 *
 * Events: fire, hit, destroy, impact, destroy_tile, win
 */

import { CONFIG } from './config.js';
import { GameMap } from './map.js';
import { Tank } from './tank.js';
import { Bullet } from './bullet.js';
import { ParticleSystem } from './particles.js';
import { Camera } from './camera.js';
import { AIController } from './ai.js';
import { distance, worldToScreen } from './utils.js';

/* ── small bot-only key codes (never collide with real keys) ── */
const BOT_KEYS = {
    forward: '_bf', backward: '_bb',
    left: '_bl', right: '_br', fire: '_bx',
};

/* ── Tower data class ─────────────────────────────────────── */

class Tower {
    constructor(x, y, team, color, darkColor) {
        this.x = x;  this.y = y;
        this.team = team;
        this.color = color;
        this.darkColor = darkColor;
        this.hp    = CONFIG.TOWER_HP;
        this.maxHp = CONFIG.TOWER_HP;
        this.alive = true;
    }
}

/* ================================================================== */

export class Game {
    constructor(input, mode = 'pvp') {
        this.input = input;
        this.mode  = mode;
        this.map   = new GameMap();
        this.particles = new ParticleSystem();
        /** @type {Bullet[]} */
        this.bullets = [];
        this.gameTime = 0;
        this.gameOver = false;
        this.winner   = null;      // 1 or 2 (team that won)
        /** @type {Record<string,Function[]>} */
        this._listeners = {};

        if (mode === 'team') this._initTeam();
        else                 this._initDuel();
    }

    /* ── accessors (uniform across modes) ─────────────────── */

    /** Every tank in the game. */
    get allTanks() {
        return this._allTanks ?? [this.tank1, this.tank2];
    }
    /** Towers (empty in duel modes). */
    get towers() { return this._towers ?? []; }
    /** The tank the human controls (for camera / HUD). */
    get humanTank() { return this._humanTank ?? this.tank1; }

    /* ── event bus ─────────────────────────────────────────── */

    on(event, fn)  { (this._listeners[event] ??= []).push(fn); }
    emit(event, d) { for (const fn of this._listeners[event] ?? []) fn(d); }

    /* ── update dispatch ──────────────────────────────────── */

    update(dt) {
        if (this.gameOver) return;
        this.gameTime += dt;
        if (this.mode === 'team') this._updateTeam(dt);
        else                      this._updateDuel(dt);
    }

    restart() {
        this.bullets = [];
        this.particles = new ParticleSystem();
        this.gameOver = false;
        this.winner   = null;
        this.map      = new GameMap();
        if (this.mode === 'team') this._initTeam();
        else                      this._initDuel();
    }

    /* ═══════════════════════════════════════════════════════ *
     *  DUEL MODE (pvp / pvb)                                  *
     * ═══════════════════════════════════════════════════════ */

    _initDuel() {
        this.tank1 = new Tank(1, '#cc3333', '#882222');
        this.tank1.team = 1;
        this.tank2 = new Tank(2, '#3366dd', '#223399');
        this.tank2.team = 2;
        this._allTanks = [this.tank1, this.tank2];
        this._towers = [];
        this._humanTank = this.tank1;

        this.ai = this.mode === 'pvb'
            ? new AIController(CONFIG.PLAYER2_KEYS) : null;

        this.camera1 = new Camera();
        this.camera2 = new Camera();
        this.camera1.smoothing = CONFIG.CAMERA_SMOOTHING;
        this.camera2.smoothing = CONFIG.CAMERA_SMOOTHING;

        this._spawnDuel();
    }

    _spawnDuel() {
        const s1 = this.map.getSpawnPoint();
        this.tank1.respawnAt(s1.x, s1.y);
        this.tank1.alive = true; this.tank1.angle = Math.PI / 4;
        const s2 = this.map.getSpawnPoint(s1.x, s1.y);
        this.tank2.respawnAt(s2.x, s2.y);
        this.tank2.alive = true; this.tank2.angle = -3 * Math.PI / 4;
        const sc1 = worldToScreen(this.tank1.x, this.tank1.y);
        this.camera1.setPosition(sc1.x, sc1.y);
        const sc2 = worldToScreen(this.tank2.x, this.tank2.y);
        this.camera2.setPosition(sc2.x, sc2.y);
    }

    _updateDuel(dt) {
        if (this.ai) this.ai.think(dt, this.tank2, [this.tank1], this.map);
        const input2 = this.ai ?? this.input;
        this.tank1.update(dt, this.input, CONFIG.PLAYER1_KEYS, this.map);
        this.tank2.update(dt, input2,     CONFIG.PLAYER2_KEYS, this.map);
        this._separatePairs(this._allTanks);
        this._handleFiring(this.tank1, this.input, CONFIG.PLAYER1_KEYS);
        this._handleFiring(this.tank2, input2,     CONFIG.PLAYER2_KEYS);
        this._tickBullets(dt);
        this._checkBulletHits();
        this.bullets = this.bullets.filter(b => b.alive);
        this.particles.update(dt);
        this._updateCamera(this.camera1, this.tank1, dt);
        this._updateCamera(this.camera2, this.tank2, dt);
        this._checkDuelWin();
    }

    _checkDuelWin() {
        if (this.tank1.score >= CONFIG.WIN_SCORE)
            { this.gameOver = true; this.winner = 1; this.emit('win', { winner: 1 }); }
        else if (this.tank2.score >= CONFIG.WIN_SCORE)
            { this.gameOver = true; this.winner = 2; this.emit('win', { winner: 2 }); }
    }

    /* ═══════════════════════════════════════════════════════ *
     *  TEAM MODE (5 v 5)                                      *
     * ═══════════════════════════════════════════════════════ */

    _initTeam() {
        const N = CONFIG.TEAM_SIZE;
        const reds  = [], blues = [];

        for (let i = 0; i < N; i++) {
            const r = new Tank(i + 1,     '#cc3333', '#882222');
            r.team = 1;
            reds.push(r);
            const b = new Tank(N + i + 1, '#3366dd', '#223399');
            b.team = 2;
            blues.push(b);
        }

        this._redTeam  = reds;
        this._blueTeam = blues;
        this._allTanks = [...reds, ...blues];
        this._humanTank = reds[0];

        // Towers
        const [tp1, tp2] = this.map.findTowerPositions();
        this._towers = [
            new Tower(tp1.x, tp1.y, 1, '#cc3333', '#882222'),
            new Tower(tp2.x, tp2.y, 2, '#3366dd', '#223399'),
        ];

        // AI bots — every tank except the human
        this._bots = [];
        for (const t of reds.slice(1)) {
            this._bots.push({ ai: new AIController(BOT_KEYS), tank: t,
                enemies: blues, objective: this._towers[1] });
        }
        for (const t of blues) {
            this._bots.push({ ai: new AIController(BOT_KEYS), tank: t,
                enemies: reds, objective: this._towers[0] });
        }

        // Camera
        this.camera1 = new Camera();
        this.camera1.smoothing = CONFIG.CAMERA_SMOOTHING;

        this._spawnTeam();
    }

    _spawnTeam() {
        const t1 = this._towers[0], t2 = this._towers[1];
        // Spawn each team inside their base's sand circle
        for (const t of this._redTeam) {
            const sp = this.map.getBaseSpawnPoint(t1.x, t1.y);
            t.respawnAt(sp.x, sp.y);
            t.alive = true;
            t.angle = Math.atan2(t2.y - t1.y, t2.x - t1.x) + (Math.random() - 0.5) * 0.5;
        }
        for (const t of this._blueTeam) {
            const sp = this.map.getBaseSpawnPoint(t2.x, t2.y);
            t.respawnAt(sp.x, sp.y);
            t.alive = true;
            t.angle = Math.atan2(t1.y - t2.y, t1.x - t2.x) + (Math.random() - 0.5) * 0.5;
        }
        const sc = worldToScreen(this._humanTank.x, this._humanTank.y);
        this.camera1.setPosition(sc.x, sc.y);
    }

    _updateTeam(dt) {
        // AI
        for (const { ai, tank, enemies, objective } of this._bots) {
            if (!tank.alive) continue;
            ai.think(dt, tank, enemies, this.map,
                objective.alive ? objective : null);
        }
        // Movement
        this._humanTank.update(dt, this.input, CONFIG.PLAYER1_KEYS, this.map);
        for (const { ai, tank } of this._bots) {
            if (tank.alive) tank.update(dt, ai, BOT_KEYS, this.map);
        }
        this._separatePairs(this._allTanks);
        this._pushFromTowers();

        // Firing
        this._handleFiring(this._humanTank, this.input, CONFIG.PLAYER1_KEYS);
        for (const { ai, tank } of this._bots) {
            if (tank.alive) this._handleFiring(tank, ai, BOT_KEYS);
        }

        this._tickBullets(dt);
        this._checkBulletHits();
        this._checkBulletTowers();
        this.bullets = this.bullets.filter(b => b.alive);
        this.particles.update(dt);
        this._updateCamera(this.camera1, this._humanTank, dt);

        // Respawn dead tanks at their team's base
        for (const t of this._allTanks) {
            if (t.alive) continue;
            t.respawnTimer -= dt;
            if (t.respawnTimer <= 0) {
                const tw = this._towers[t.team - 1];
                const sp = tw.alive
                    ? this.map.getBaseSpawnPoint(tw.x, tw.y)
                    : this.map.getSpawnPoint();
                t.respawnAt(sp.x, sp.y);
                t.alive = true;
                t.flashTimer = 1;
            }
        }

        this._checkTeamWin();
    }

    _checkBulletTowers() {
        for (const b of this.bullets) {
            if (!b.alive) continue;
            for (const tw of this._towers) {
                if (!tw.alive || b.team === tw.team) continue;
                if (distance(b.x, b.y, tw.x, tw.y) < CONFIG.TOWER_RADIUS) {
                    b.alive = false;
                    tw.hp--;
                    this.particles.emitImpact(b.x, b.y);
                    this.emit('impact', {});
                    if (tw.hp <= 0) {
                        tw.alive = false;
                        this.particles.emitExplosion(tw.x, tw.y);
                        this.emit('destroy', { tower: tw });
                    }
                    break;
                }
            }
        }
    }

    _pushFromTowers() {
        for (const t of this._allTanks) {
            if (!t.alive) continue;
            for (const tw of this._towers) {
                if (!tw.alive) continue;
                const d = distance(t.x, t.y, tw.x, tw.y);
                const min = CONFIG.TANK_SIZE + CONFIG.TOWER_RADIUS;
                if (d < min && d > 0.001) {
                    const nx = (t.x - tw.x) / d;
                    const ny = (t.y - tw.y) / d;
                    t.x = tw.x + nx * min;
                    t.y = tw.y + ny * min;
                }
            }
        }
    }

    _checkTeamWin() {
        for (const tw of this._towers) {
            if (!tw.alive) {
                this.gameOver = true;
                this.winner = tw.team === 1 ? 2 : 1;   // opposing team wins
                this.emit('win', { winner: this.winner });
                return;
            }
        }
    }

    /* ═══════════════════════════════════════════════════════ *
     *  SHARED helpers                                         *
     * ═══════════════════════════════════════════════════════ */

    _handleFiring(tank, input, keys) {
        if (input.isDown(keys.fire) && tank.canFire()) {
            tank.fire();
            const b = new Bullet(tank.x, tank.y, tank.angle,
                                 tank.playerNumber, tank.team);
            this.bullets.push(b);
            const tipX = tank.x + Math.cos(tank.angle) * CONFIG.TANK_BARREL_LENGTH;
            const tipY = tank.y + Math.sin(tank.angle) * CONFIG.TANK_BARREL_LENGTH;
            this.particles.emitMuzzleFlash(tipX, tipY, tank.angle);
            this.emit('fire', { tank, bullet: b });
        }
    }

    _tickBullets(dt) {
        for (const b of this.bullets) {
            const wasAlive = b.alive;
            b.update(dt, this.map);
            if (wasAlive && !b.alive && this.map.blocksProjectile(b.x, b.y)) {
                this.particles.emitImpact(b.x, b.y);
                this.emit('impact', { bullet: b });
                const gx = Math.floor(b.x), gy = Math.floor(b.y);
                if (this.map.damageTile(gx, gy)) {
                    this.particles.emitExplosion(gx + 0.5, gy + 0.5);
                    this.emit('destroy_tile', { gx, gy });
                }
            }
        }
    }

    _checkBulletHits() {
        for (const b of this.bullets) {
            if (!b.alive) continue;
            for (const t of this.allTanks) {
                if (!t.alive || b.team === t.team) continue;
                if (distance(b.x, b.y, t.x, t.y) < CONFIG.TANK_SIZE) {
                    b.alive = false;
                    this.particles.emitExplosion(t.x, t.y);
                    t.kill();
                    this.emit('destroy', { tank: t });
                    // In duel modes, track score
                    if (this.mode !== 'team') {
                        const killer = b.owner === this.tank1.playerNumber
                            ? this.tank1 : this.tank2;
                        killer.score++;
                    }
                    // Respawn (duel): pick spot away from killer
                    if (this.mode !== 'team') {
                        const other = t === this.tank1 ? this.tank2 : this.tank1;
                        const sp = this.map.getSpawnPoint(other.x, other.y);
                        t.respawnAt(sp.x, sp.y);
                    }
                    break;
                }
            }
        }
    }

    _separatePairs(tanks) {
        const alive = tanks.filter(t => t.alive);
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i], b = alive[j];
                const d = distance(a.x, a.y, b.x, b.y);
                const min = CONFIG.TANK_SIZE * 2;
                if (d < min && d > 0.001) {
                    const o = (min - d) / 2;
                    const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
                    a.x -= nx * o; a.y -= ny * o;
                    b.x += nx * o; b.y += ny * o;
                }
            }
        }
    }

    _updateCamera(cam, tank, dt) {
        if (tank.alive) {
            const s = worldToScreen(tank.x, tank.y);
            const la = CONFIG.CAMERA_LOOK_AHEAD;
            const dx = Math.cos(tank.angle) * la;
            const dy = Math.sin(tank.angle) * la;
            cam.follow(s.x + (dx - dy) * (CONFIG.TILE_WIDTH / 2),
                       s.y + (dx + dy) * (CONFIG.TILE_HEIGHT / 2), dt);
        }
    }
}
