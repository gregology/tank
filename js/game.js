/**
 * Core game state — unified mode system.
 *
 * All modes are driven by MODE_DEFS from config.js:
 *   duel_split    — 1v1 split screen, tanks only
 *   duel_bot      — 1v1 human vs bot, full screen, tanks only
 *   skirmish_coop — 2v2 co-op split screen (2 humans vs 2 bots), tanks only
 *   battle_split  — 5v5 split screen (1 human+4 bots vs 1 human+4 bots), all vehicles+bases
 *   battle_coop   — 5v5 co-op split screen (2 humans+3 bots vs 5 bots), all vehicles+bases
 *   battle_solo   — 5v5 human vs bots (1 human+4 bots vs 5 bots), all vehicles+bases
 *
 * Events: fire, hit, destroy, impact, destroy_tile, win,
 *         artillery_impact, drone_strike
 */

import { AIController, pickRoleForVehicle } from "./ai.js";
import { Bullet } from "./bullet.js";
import { Camera } from "./camera.js";
import { CONFIG, MODE_DEFS, VEHICLES } from "./config.js";
import { GameMap } from "./map.js";
import { ParticleSystem } from "./particles.js";
import { Tank } from "./tank.js";
import { distance, worldToScreen } from "./utils.js";

/* ── small bot-only key codes (never collide with real keys) ── */
const BOT_KEYS = {
    forward: "_bf",
    backward: "_bb",
    left: "_bl",
    right: "_br",
    turretLeft: "_btl",
    turretRight: "_btr",
    fire: "_bx",
};

/* ── Vehicle type selection ─────────────────────────────── */

/** Pick a random vehicle type from an allowed list using spawn weights. */
function pickVehicleType(allowed) {
    if (allowed.length === 1) return allowed[0];
    const entries = allowed.map((t) => [t, VEHICLES[t]]);
    const total = entries.reduce((s, [, v]) => s + v.spawnWeight, 0);
    let r = Math.random() * total;
    for (const [type, v] of entries) {
        r -= v.spawnWeight;
        if (r <= 0) return type;
    }
    return entries[entries.length - 1][0];
}

/* ── Tower data class ─────────────────────────────────────── */

class Tower {
    constructor(x, y, team, color, darkColor) {
        this.x = x;
        this.y = y;
        this.team = team;
        this.color = color;
        this.darkColor = darkColor;
        this.hp = CONFIG.TOWER_HP;
        this.maxHp = CONFIG.TOWER_HP;
        this.alive = true;
    }
}

/* ================================================================== */

export class Game {
    constructor(input, mode = "duel_split") {
        this.input = input;
        this.mode = mode;
        this.modeDef = MODE_DEFS[mode];
        this.map = new GameMap();
        this.particles = new ParticleSystem();
        /** @type {Bullet[]} */
        this.bullets = [];
        this.gameTime = 0;
        this.gameOver = false;
        this.winner = null; // 1 or 2 (team that won)
        /** @type {Record<string,Function[]>} */
        this._listeners = {};

        this._init();
    }

    /* ── accessors ────────────────────────────────────────── */

    /** Every tank in the game. */
    get allTanks() {
        return this._allTanks;
    }
    /** Towers (empty in non-base modes). */
    get towers() {
        return this._towers;
    }
    /** The first human tank (for single-viewport modes / HUD). */
    get humanTank() {
        return this._humanTanks[0];
    }
    /** All human-controlled tanks. */
    get humanTanks() {
        return this._humanTanks;
    }
    /** All cameras (one per human player). */
    get cameras() {
        return this._cameras;
    }
    /** Whether to render split screen. */
    get splitScreen() {
        return this.modeDef.split;
    }
    /** Team kill scores (for non-base modes). */
    get teamScores() {
        return this._teamScores;
    }

    // Backward-compat aliases used by renderer
    get tank1() {
        return this._redTeam[0];
    }
    get tank2() {
        return this._blueTeam[0];
    }
    get camera1() {
        return this._cameras[0];
    }
    get camera2() {
        return this._cameras[1] ?? this._cameras[0];
    }

    /* ── event bus ─────────────────────────────────────────── */

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }
    emit(event, d) {
        for (const fn of this._listeners[event] ?? []) fn(d);
    }

    /* ── update / restart ─────────────────────────────────── */

    update(dt) {
        if (this.gameOver) return;
        this.gameTime += dt;
        this._update(dt);
    }

    restart() {
        this.bullets = [];
        this.particles = new ParticleSystem();
        this.gameOver = false;
        this.winner = null;
        this.map = new GameMap();
        this._init();
    }

    /* ═══════════════════════════════════════════════════════ *
     *  UNIFIED INIT                                           *
     * ═══════════════════════════════════════════════════════ */

    _init() {
        const def = this.modeDef;
        const [t1Humans, t1Bots] = def.teams[0];
        const [t2Humans, t2Bots] = def.teams[1];
        const keyMaps = [CONFIG.PLAYER1_KEYS, CONFIG.PLAYER2_KEYS];

        this._redTeam = [];
        this._blueTeam = [];
        this._humanTanks = [];
        this._humanKeys = [];
        this._cameras = [];
        this._bots = [];
        this._towers = [];
        this._teamScores = { 1: 0, 2: 0 };

        let nextId = 1;
        let humanIdx = 0;

        // ── Team 1 (red) ──
        for (let i = 0; i < t1Humans + t1Bots; i++) {
            const t = new Tank(nextId++, "#cc3333", "#882222");
            t.team = 1;
            t.vehicleType = pickVehicleType(def.vehicles);
            this._redTeam.push(t);

            if (i < t1Humans) {
                this._humanTanks.push(t);
                this._humanKeys.push(keyMaps[humanIdx++]);
                const cam = new Camera();
                cam.smoothing = CONFIG.CAMERA_SMOOTHING;
                this._cameras.push(cam);
            }
        }

        // ── Team 2 (blue) ──
        for (let i = 0; i < t2Humans + t2Bots; i++) {
            const t = new Tank(nextId++, "#3366dd", "#223399");
            t.team = 2;
            t.vehicleType = pickVehicleType(def.vehicles);
            this._blueTeam.push(t);

            if (i < t2Humans) {
                this._humanTanks.push(t);
                this._humanKeys.push(keyMaps[humanIdx++]);
                const cam = new Camera();
                cam.smoothing = CONFIG.CAMERA_SMOOTHING;
                this._cameras.push(cam);
            }
        }

        this._allTanks = [...this._redTeam, ...this._blueTeam];

        // ── Towers (base modes only) ──
        if (def.bases) {
            const [tp1, tp2] = this.map.findTowerPositions();
            this._towers = [
                new Tower(tp1.x, tp1.y, 1, "#cc3333", "#882222"),
                new Tower(tp2.x, tp2.y, 2, "#3366dd", "#223399"),
            ];
        }

        // ── AI bots ──
        for (const t of this._redTeam) {
            if (this._humanTanks.includes(t)) continue;
            const ai = new AIController(BOT_KEYS, this.map);
            ai.role = pickRoleForVehicle(t.vehicleType);
            if (def.bases) ai.friendlyTower = this._towers[0];
            this._bots.push({
                ai,
                tank: t,
                enemies: this._blueTeam,
                objective: def.bases ? this._towers[1] : null,
            });
        }
        for (const t of this._blueTeam) {
            if (this._humanTanks.includes(t)) continue;
            const ai = new AIController(BOT_KEYS, this.map);
            ai.role = pickRoleForVehicle(t.vehicleType);
            if (def.bases) ai.friendlyTower = this._towers[1];
            this._bots.push({
                ai,
                tank: t,
                enemies: this._redTeam,
                objective: def.bases ? this._towers[0] : null,
            });
        }

        this._spawn();
    }

    _spawn() {
        const def = this.modeDef;

        if (def.bases) {
            // ── Base spawn: near towers ──
            const t1 = this._towers[0],
                t2 = this._towers[1];
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
        } else {
            // ── Random spawn: spread out, then face opponents ──
            const allTeams = [this._redTeam, this._blueTeam];
            let lastX = -1,
                lastY = -1;
            for (const team of allTeams) {
                for (const t of team) {
                    const sp = this.map.getSpawnPoint(lastX, lastY);
                    t.respawnAt(sp.x, sp.y);
                    t.alive = true;
                    lastX = sp.x;
                    lastY = sp.y;
                }
            }
            // Face toward opposing team centre
            const avg = (arr, fn) => arr.reduce((s, t) => s + fn(t), 0) / (arr.length || 1);
            const rcx = avg(this._redTeam, (t) => t.x),
                rcy = avg(this._redTeam, (t) => t.y);
            const bcx = avg(this._blueTeam, (t) => t.x),
                bcy = avg(this._blueTeam, (t) => t.y);
            for (const t of this._redTeam) t.angle = Math.atan2(bcy - t.y, bcx - t.x) + (Math.random() - 0.5) * 0.3;
            for (const t of this._blueTeam) t.angle = Math.atan2(rcy - t.y, rcx - t.x) + (Math.random() - 0.5) * 0.3;
        }

        // Init cameras
        for (let i = 0; i < this._humanTanks.length; i++) {
            const sc = worldToScreen(this._humanTanks[i].x, this._humanTanks[i].y);
            this._cameras[i].setPosition(sc.x, sc.y);
        }
    }

    /* ═══════════════════════════════════════════════════════ *
     *  UNIFIED UPDATE                                         *
     * ═══════════════════════════════════════════════════════ */

    _update(dt) {
        const def = this.modeDef;

        // ── AI think ──
        for (const { ai, tank, enemies, objective } of this._bots) {
            if (!tank.alive) continue;
            const obj = def.bases && objective?.alive ? objective : null;
            // For non-base modes give AI the nearest enemy as objective
            const target = obj ?? (enemies.find((e) => e.alive) || null);
            ai.think(dt, tank, enemies, this.map, target);
        }

        // ── Movement — humans (only when alive) ──
        for (let i = 0; i < this._humanTanks.length; i++) {
            if (this._humanTanks[i].alive) {
                this._humanTanks[i].update(dt, this.input, this._humanKeys[i], this.map);
            }
        }
        // ── Movement — bots ──
        for (const { ai, tank } of this._bots) {
            if (tank.alive) tank.update(dt, ai, BOT_KEYS, this.map);
        }

        this._separatePairs(this._allTanks);
        if (def.bases) this._pushFromTowers();

        // ── Firing — humans ──
        for (let i = 0; i < this._humanTanks.length; i++) {
            if (this._humanTanks[i].alive) {
                this._handleFiring(this._humanTanks[i], this.input, this._humanKeys[i], dt);
            }
        }
        // ── Firing — bots ──
        for (const { ai, tank } of this._bots) {
            if (tank.alive) this._handleFiring(tank, ai, BOT_KEYS, dt);
        }

        this._tickBullets(dt);
        this._checkBulletHits();
        if (def.bases) this._checkBulletTowers();
        this.bullets = this.bullets.filter((b) => b.alive);
        this.particles.update(dt);
        this._emitDamageSmoke(dt);

        // ── Cameras ──
        for (let i = 0; i < this._humanTanks.length; i++) {
            this._updateCamera(this._cameras[i], this._humanTanks[i], dt);
        }

        // ── Respawns ──
        this._handleRespawns(dt);

        // ── Win check ──
        this._checkWin();
    }

    /* ── respawn logic ────────────────────────────────────── */

    _handleRespawns(dt) {
        const def = this.modeDef;
        for (const t of this._allTanks) {
            if (t.alive) continue;
            t.respawnTimer -= dt;
            if (t.respawnTimer <= 0) {
                if (def.bases) {
                    // Spawn at base
                    const tw = this._towers[t.team - 1];
                    const sp = tw?.alive ? this.map.getBaseSpawnPoint(tw.x, tw.y) : this.map.getSpawnPoint();
                    t.respawnAt(sp.x, sp.y);
                }
                // Non-base: position was already set when killed
                t.alive = true;
                t.flashTimer = 1;
                // Re-randomise vehicle type on respawn
                t.vehicleType = pickVehicleType(def.vehicles);
                // Re-assign AI role
                const bot = this._bots.find((b) => b.tank === t);
                if (bot) {
                    bot.ai.role = pickRoleForVehicle(t.vehicleType);
                    bot.ai.resetLife();
                }
            }
        }
    }

    /* ── win condition ────────────────────────────────────── */

    _checkWin() {
        const def = this.modeDef;
        if (def.bases) {
            // Tower destruction
            for (const tw of this._towers) {
                if (!tw.alive) {
                    this.gameOver = true;
                    this.winner = tw.team === 1 ? 2 : 1;
                    this.emit("win", { winner: this.winner });
                    return;
                }
            }
        } else {
            // Score-based
            if (this._teamScores[1] >= CONFIG.WIN_SCORE) {
                this.gameOver = true;
                this.winner = 1;
                this.emit("win", { winner: 1 });
            } else if (this._teamScores[2] >= CONFIG.WIN_SCORE) {
                this.gameOver = true;
                this.winner = 2;
                this.emit("win", { winner: 2 });
            }
        }
    }

    /** Label for the winner on the game-over screen. */
    get winnerLabel() {
        if (!this.winner) return "";
        const def = this.modeDef;
        const total = def.teams[0][0] + def.teams[0][1] + def.teams[1][0] + def.teams[1][1];
        if (total === 2 && !def.bases) {
            // 1v1 duel
            if (def.teams[1][0] === 0 && def.teams[0][0] === 1) {
                // Human vs bot
                return this.winner === 1 ? "PLAYER" : "BOT";
            }
            return this.winner === 1 ? "PLAYER 1" : "PLAYER 2";
        }
        return this.winner === 1 ? "RED TEAM" : "BLUE TEAM";
    }

    /* ═══════════════════════════════════════════════════════ *
     *  SHARED helpers                                         *
     * ═══════════════════════════════════════════════════════ */

    _handleFiring(tank, input, keys, dt = 0.016) {
        // Drones don't fire bullets — they detonate on contact
        if (tank.vehicleType === "drone") {
            this._handleDroneAttack(tank, input, keys);
            return;
        }
        // SPGs use hold-to-charge mechanic
        if (tank.vehicleType === "spg") {
            this._handleSPGFiring(tank, input, keys, dt);
            return;
        }
        if (input.isDown(keys.fire) && tank.canFire()) {
            tank.fire();
            const fireAngle = tank.turretWorld;
            const vStats = VEHICLES[tank.vehicleType];
            const b = new Bullet(
                tank.x,
                tank.y,
                fireAngle,
                tank.playerNumber,
                tank.team,
                vStats.bulletDamage,
                vStats.bulletSpeed,
            );
            this.bullets.push(b);
            const tipX = tank.x + Math.cos(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            const tipY = tank.y + Math.sin(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            if (tank.vehicleType === "ifv") this.particles.emitIFVFlash(tipX, tipY, fireAngle);
            else this.particles.emitMuzzleFlash(tipX, tipY, fireAngle);
            this.emit("fire", { tank, bullet: b });
        }
    }

    _handleSPGFiring(tank, input, keys, dt) {
        if (!tank.alive) return;

        const fireHeld = input.isDown(keys.fire);
        const vStats = VEHICLES.spg;

        if (fireHeld && tank.fireCooldown <= 0) {
            tank.isCharging = true;
            tank.chargeTime += dt;
            const maxCharge = (vStats.maxRange - vStats.minRange) / vStats.chargeRate;
            if (tank.chargeTime > maxCharge) tank.chargeTime = maxCharge;
        } else if (tank.isCharging && !fireHeld) {
            const range = Math.min(vStats.minRange + tank.chargeTime * vStats.chargeRate, vStats.maxRange);
            tank.isCharging = false;
            tank.chargeTime = 0;
            tank.fire();

            const fireAngle = tank.turretWorld;
            const b = new Bullet(
                tank.x,
                tank.y,
                fireAngle,
                tank.playerNumber,
                tank.team,
                vStats.bulletDamage,
                vStats.bulletSpeed,
                true,
                range,
            );
            this.bullets.push(b);

            const tipX = tank.x + Math.cos(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            const tipY = tank.y + Math.sin(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            this.particles.emitSPGFlash(tipX, tipY, fireAngle);
            this.emit("fire", { tank, bullet: b });
        } else {
            tank.isCharging = false;
            tank.chargeTime = 0;
        }
    }

    _handleArtilleryImpact(b) {
        const splashR = VEHICLES.spg.splashRadius;

        for (const t of this.allTanks) {
            if (!t.alive || b.team === t.team) continue;
            const d = distance(b.x, b.y, t.x, t.y);
            if (d >= splashR + t.size) continue;

            const effectiveDist = Math.max(0, d - t.size);
            const dmg = b.damage * Math.max(0, 1 - effectiveDist / splashR);
            if (dmg <= 0) continue;

            const zone = t.getHitZone(b.x, b.y);
            const result = t.applyHit(zone, dmg);

            if (result === "destroyed") {
                this.particles.emitExplosion(t.x, t.y);
                this.emit("destroy", { tank: t });
                this._onKill(b.team, t);
            } else if (result === "damaged") {
                this.particles.emitImpact(b.x, b.y);
                this.emit("hit", { tank: t, zone });
            } else if (result === "absorbed") {
                this.particles.emitTinyImpact(b.x, b.y);
            }
        }

        for (const tw of this.towers) {
            if (!tw.alive || b.team === tw.team) continue;
            const d = distance(b.x, b.y, tw.x, tw.y);
            if (d >= splashR + CONFIG.TOWER_RADIUS) continue;

            const edgeDist = Math.max(0, d - CONFIG.TOWER_RADIUS);
            const dmg = b.damage * Math.max(0, 1 - edgeDist / splashR);
            if (dmg <= 0) continue;

            tw.hp -= dmg;
            this.emit("impact", {});
            if (tw.hp <= 0) {
                tw.alive = false;
                this.particles.emitExplosion(tw.x, tw.y);
                this.emit("destroy", { tower: tw });
            }
        }

        const gx = Math.floor(b.x),
            gy = Math.floor(b.y);
        if (this.map.damageTile(gx, gy, b.damage)) {
            this.particles.emitExplosion(gx + 0.5, gy + 0.5);
            this.emit("destroy_tile", { gx, gy });
            this._invalidatePathfinders();
        }

        this.particles.emitArtilleryImpact(b.x, b.y);
        this.emit("artillery_impact", { bullet: b });
    }

    _handleDroneAttack(drone, input, keys) {
        if (!input.isDown(keys.fire) || !drone.alive) return;

        const vStats = VEHICLES.drone;
        const blastR = vStats.blastRadius;
        const maxDmg = vStats.blastDamage;

        for (const t of this.allTanks) {
            if (!t.alive || t.team === drone.team) continue;
            const d = distance(drone.x, drone.y, t.x, t.y);
            if (d >= blastR) continue;

            const dmg = maxDmg * Math.max(0, 1 - d / blastR);
            if (dmg <= 0) continue;

            const zone = t.getHitZone(drone.x, drone.y);
            const result = t.applyHit(zone, dmg);

            if (result === "destroyed") {
                this.particles.emitExplosion(t.x, t.y);
                this.emit("destroy", { tank: t });
                this._onKill(drone.team, t);
            } else if (result === "damaged") {
                this.particles.emitImpact(drone.x, drone.y);
                this.emit("hit", { tank: t, zone });
            } else if (result === "absorbed") {
                this.particles.emitTinyImpact(drone.x, drone.y);
            }
        }

        for (const tw of this.towers) {
            if (!tw.alive || tw.team === drone.team) continue;
            const d = distance(drone.x, drone.y, tw.x, tw.y);
            if (d >= blastR + CONFIG.TOWER_RADIUS) continue;

            const edgeDist = Math.max(0, d - CONFIG.TOWER_RADIUS);
            const dmg = maxDmg * Math.max(0, 1 - edgeDist / blastR);
            if (dmg <= 0) continue;

            tw.hp -= dmg;
            this.particles.emitImpact(drone.x, drone.y);
            this.emit("impact", {});
            if (tw.hp <= 0) {
                tw.alive = false;
                this.particles.emitExplosion(tw.x, tw.y);
                this.emit("destroy", { tower: tw });
            }
        }

        this.particles.emitDroneExplosion(drone.x, drone.y);
        this.emit("drone_strike", { drone });
        drone.kill();
    }

    /**
     * Called when an enemy tank is destroyed.
     * In non-base modes: increment killer team score + immediate respawn.
     * In base modes: timed respawn is handled by _handleRespawns().
     */
    _onKill(killerTeam, deadTank) {
        if (!this.modeDef.bases) {
            this._teamScores[killerTeam]++;
            // Set respawn position immediately (tank stays dead for TANK_RESPAWN_TIME)
            const sp = this.map.getSpawnPoint();
            deadTank.respawnAt(sp.x, sp.y);
        }
    }

    _tickBullets(dt) {
        for (const b of this.bullets) {
            const wasAlive = b.alive;
            b.update(dt, this.map);
            if (wasAlive && !b.alive) {
                if (b.arcing && b.landed) {
                    this._handleArtilleryImpact(b);
                } else if (!b.arcing && this.map.blocksProjectile(b.x, b.y)) {
                    this.particles.emitImpact(b.x, b.y);
                    this.emit("impact", { bullet: b });
                    const gx = Math.floor(b.x),
                        gy = Math.floor(b.y);
                    if (this.map.damageTile(gx, gy, b.damage)) {
                        this.particles.emitExplosion(gx + 0.5, gy + 0.5);
                        this.emit("destroy_tile", { gx, gy });
                        this._invalidatePathfinders();
                    }
                }
            }
        }
    }

    _checkBulletHits() {
        for (const b of this.bullets) {
            if (!b.alive || b.arcing) continue;
            for (const t of this.allTanks) {
                if (!t.alive || b.team === t.team) continue;
                if (distance(b.x, b.y, t.x, t.y) < t.size) {
                    b.alive = false;

                    const zone = t.getHitZone(b.x, b.y);
                    const result = t.applyHit(zone, b.damage);

                    if (result === "destroyed") {
                        this.particles.emitExplosion(t.x, t.y);
                        this.emit("destroy", { tank: t });
                        this._onKill(b.team, t);
                    } else if (result === "damaged") {
                        this.particles.emitImpact(b.x, b.y);
                        this.emit("hit", { tank: t, zone });
                    } else {
                        this.particles.emitTinyImpact(b.x, b.y);
                    }
                    break;
                }
            }
        }
    }

    _checkBulletTowers() {
        for (const b of this.bullets) {
            if (!b.alive || b.arcing) continue;
            for (const tw of this._towers) {
                if (!tw.alive || b.team === tw.team) continue;
                if (distance(b.x, b.y, tw.x, tw.y) < CONFIG.TOWER_RADIUS) {
                    b.alive = false;
                    tw.hp -= b.damage;
                    this.particles.emitImpact(b.x, b.y);
                    this.emit("impact", {});
                    if (tw.hp <= 0) {
                        tw.alive = false;
                        this.particles.emitExplosion(tw.x, tw.y);
                        this.emit("destroy", { tower: tw });
                    }
                    break;
                }
            }
        }
    }

    _pushFromTowers() {
        for (const t of this._allTanks) {
            if (!t.alive || t.vehicleType === "drone") continue;
            for (const tw of this._towers) {
                if (!tw.alive) continue;
                const d = distance(t.x, t.y, tw.x, tw.y);
                const min = VEHICLES[t.vehicleType].size + CONFIG.TOWER_RADIUS;
                if (d < min && d > 0.001) {
                    const nx = (t.x - tw.x) / d;
                    const ny = (t.y - tw.y) / d;
                    const newX = tw.x + nx * min;
                    const newY = tw.y + ny * min;
                    if (this._canStand(newX, newY)) {
                        t.x = newX;
                        t.y = newY;
                    }
                }
            }
        }
    }

    _emitDamageSmoke(dt) {
        for (const t of this.allTanks) {
            if (!t.alive || !t.damaged) continue;
            t.smokeTimer -= dt;
            if (t.smokeTimer <= 0) {
                t.smokeTimer = 0.15 + Math.random() * 0.1;
                this.particles.emitSmoke(t.x, t.y);
            }
        }
    }

    _separatePairs(tanks) {
        const alive = tanks.filter((t) => t.alive);
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i],
                    b = alive[j];
                const aDrone = a.vehicleType === "drone";
                const bDrone = b.vehicleType === "drone";
                if (aDrone !== bDrone) continue;
                const d = distance(a.x, a.y, b.x, b.y);
                const min = VEHICLES[a.vehicleType].size + VEHICLES[b.vehicleType].size;
                if (d < min && d > 0.001) {
                    const o = (min - d) / 2;
                    const nx = (b.x - a.x) / d,
                        ny = (b.y - a.y) / d;
                    const ax = a.x - nx * o,
                        ay = a.y - ny * o;
                    const bx = b.x + nx * o,
                        by = b.y + ny * o;
                    if (this._canStand(ax, ay, VEHICLES[a.vehicleType].size)) {
                        a.x = ax;
                        a.y = ay;
                    }
                    if (this._canStand(bx, by, VEHICLES[b.vehicleType].size)) {
                        b.x = bx;
                        b.y = by;
                    }
                }
            }
        }
    }

    _invalidatePathfinders() {
        for (const { ai } of this._bots) ai._pf?.invalidate();
    }

    _canStand(x, y, vehicleSize = VEHICLES.tank.size) {
        const s = vehicleSize * 0.85;
        return (
            this.map.isPassable(x - s, y - s) &&
            this.map.isPassable(x + s, y - s) &&
            this.map.isPassable(x - s, y + s) &&
            this.map.isPassable(x + s, y + s)
        );
    }

    _updateCamera(cam, tank, dt) {
        if (tank.alive) {
            const s = worldToScreen(tank.x, tank.y);
            const la = VEHICLES[tank.vehicleType]?.cameraLookAhead ?? CONFIG.CAMERA_LOOK_AHEAD;
            const aim = tank.turretWorld;
            const dx = Math.cos(aim) * la;
            const dy = Math.sin(aim) * la;
            cam.follow(s.x + (dx - dy) * (CONFIG.TILE_WIDTH / 2), s.y + (dx + dy) * (CONFIG.TILE_HEIGHT / 2), dt);
        }
    }
}
