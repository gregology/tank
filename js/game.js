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
import { BASE_STRUCTURES, CONFIG, MODE_DEFS, TILES as T, VEHICLES } from "./config.js";
import { Base, BaseHQ, BaseWall, BaseWatchTower } from "./entity.js";
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

/* ================================================================== */

export class Game {
    constructor(input, mode = "duel_split", settings = {}) {
        this.input = input;
        this.mode = mode;
        this.modeDef = MODE_DEFS[mode];
        this.settings = settings;

        // Build map with settings-driven dimensions and density
        const mapW = settings.mapSize?.w;
        const mapH = settings.mapSize?.h;
        const density = settings.buildingDensity;
        this.map = new GameMap(mapW, mapH, density);
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
    /** Base compounds (empty in non-base modes). */
    get bases() {
        return this._bases;
    }
    /** All base structures from both teams (flat list). */
    get baseStructures() {
        return this._allStructures;
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
        const s = this.settings;
        this.map = new GameMap(s.mapSize?.w, s.mapSize?.h, s.buildingDensity);
        this._init();
    }

    /* ═══════════════════════════════════════════════════════ *
     *  UNIFIED INIT                                           *
     * ═══════════════════════════════════════════════════════ */

    _init() {
        const def = this.modeDef;
        const s = this.settings;

        // Compute team composition: if teamSize setting is present,
        // adjust bot counts while keeping human counts from the mode def.
        let [t1Humans, t1Bots] = def.teams[0];
        let [t2Humans, t2Bots] = def.teams[1];
        if (s.teamSize != null) {
            t1Bots = Math.max(0, s.teamSize - t1Humans);
            t2Bots = Math.max(0, s.teamSize - t2Humans);
        }
        const keyMaps = [CONFIG.PLAYER1_KEYS, CONFIG.PLAYER2_KEYS];

        this._redTeam = [];
        this._blueTeam = [];
        this._humanTanks = [];
        this._humanKeys = [];
        this._cameras = [];
        this._bots = [];
        this._bases = [];
        this._allStructures = [];
        this._structureMap = new Map(); // "gx,gy" → BaseStructure
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

        // ── Base compounds (base modes only) ──
        if (def.bases) {
            const baseType = this.settings.baseType ?? "compound";
            const [layout1, layout2] = this.map.buildBaseCompounds(baseType);
            this._bases = [
                this._buildBase(layout1, 1, "#cc3333", "#882222"),
                this._buildBase(layout2, 2, "#3366dd", "#223399"),
            ];
            this._allStructures = [...this._bases[0].allStructures, ...this._bases[1].allStructures];
            // Populate tile → structure lookup
            for (const s of this._allStructures) {
                for (const pos of s.tilePositions) {
                    this._structureMap.set(`${pos.gx},${pos.gy}`, s);
                }
            }
        }

        // ── AI bots ──
        for (const t of this._redTeam) {
            if (this._humanTanks.includes(t)) continue;
            const ai = new AIController(BOT_KEYS, this.map);
            ai.role = pickRoleForVehicle(t.vehicleType);
            if (def.bases) ai.friendlyBase = this._bases[0];
            this._bots.push({
                ai,
                tank: t,
                enemies: this._blueTeam,
                enemyBase: def.bases ? this._bases[1] : null,
            });
        }
        for (const t of this._blueTeam) {
            if (this._humanTanks.includes(t)) continue;
            const ai = new AIController(BOT_KEYS, this.map);
            ai.role = pickRoleForVehicle(t.vehicleType);
            if (def.bases) ai.friendlyBase = this._bases[1];
            this._bots.push({
                ai,
                tank: t,
                enemies: this._redTeam,
                enemyBase: def.bases ? this._bases[0] : null,
            });
        }

        this._spawn();
    }

    _spawn() {
        const def = this.modeDef;

        if (def.bases) {
            // ── Base spawn: inside compound interior ──
            const b1 = this._bases[0],
                b2 = this._bases[1];
            for (const t of this._redTeam) {
                const sp = this.map.getBaseSpawnPoint(b1.center.x, b1.center.y);
                t.respawnAt(sp.x, sp.y);
                t.alive = true;
                t.angle = Math.atan2(b2.y - b1.y, b2.x - b1.x) + (Math.random() - 0.5) * 0.5;
            }
            for (const t of this._blueTeam) {
                const sp = this.map.getBaseSpawnPoint(b2.center.x, b2.center.y);
                t.respawnAt(sp.x, sp.y);
                t.alive = true;
                t.angle = Math.atan2(b1.y - b2.y, b1.x - b2.x) + (Math.random() - 0.5) * 0.5;
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
        for (const { ai, tank, enemies, enemyBase } of this._bots) {
            if (!tank.alive) continue;
            const obj = def.bases && enemyBase?.alive ? enemyBase : null;
            // For non-base modes give AI the nearest enemy as objective
            const target = obj ?? (enemies.find((e) => e.alive) || null);
            const enemyStructures = enemyBase?.allStructures ?? [];
            ai.think(dt, tank, enemies, this.map, target, enemyStructures);
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
        if (def.bases) this._pushFromStructures();

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
        if (def.bases) this._updateWatchTowers(dt);
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
                    // Spawn inside compound
                    const base = this._bases[t.team - 1];
                    const sp = base?.alive
                        ? this.map.getBaseSpawnPoint(base.center.x, base.center.y)
                        : this.map.getSpawnPoint();
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
            // HQ destruction
            for (const base of this._bases) {
                if (!base.alive) {
                    this.gameOver = true;
                    this.winner = base.team === 1 ? 2 : 1;
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

            this._applyHitToTank(b, t, dmg);
        }

        for (const s of this._allStructures) {
            if (!s.alive || b.team === s.team) continue;
            const d = distance(b.x, b.y, s.x, s.y);
            if (d >= splashR + s.size) continue;

            const edgeDist = Math.max(0, d - s.size);
            const dmg = b.damage * Math.max(0, 1 - edgeDist / splashR);
            if (dmg <= 0) continue;

            if (s.applyDamage(dmg)) {
                this._onStructureDestroyed(s);
            } else {
                this.particles.emitImpact(b.x, b.y);
                this.emit("impact", {});
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

            this._applyHitToTank(drone, t, dmg);
        }

        for (const s of this._allStructures) {
            if (!s.alive || s.team === drone.team) continue;
            const d = distance(drone.x, drone.y, s.x, s.y);
            if (d >= blastR + s.size) continue;

            const edgeDist = Math.max(0, d - s.size);
            const dmg = maxDmg * Math.max(0, 1 - edgeDist / blastR);
            if (dmg <= 0) continue;

            if (s.applyDamage(dmg)) {
                this._onStructureDestroyed(s);
            } else {
                this.particles.emitImpact(drone.x, drone.y);
                this.emit("impact", {});
            }
        }

        this.particles.emitDroneExplosion(drone.x, drone.y);
        this.emit("drone_strike", { drone });
        drone.kill();
    }

    /**
     * Apply a hit to a tank and emit the appropriate particles/events.
     * @param {{x:number, y:number, team:number}} source - bullet or explosion origin
     * @param {Tank} tank - target tank
     * @param {number} damage - damage amount
     */
    _applyHitToTank(source, tank, damage) {
        const zone = tank.getHitZone(source.x, source.y);
        const result = tank.applyHit(zone, damage);

        if (result === "destroyed") {
            this.particles.emitExplosion(tank.x, tank.y);
            this.emit("destroy", { tank });
            this._onKill(source.team, tank);
        } else if (result === "damaged") {
            this.particles.emitImpact(source.x, source.y);
            this.emit("hit", { tank, zone });
        } else {
            this.particles.emitTinyImpact(source.x, source.y);
        }
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
                    // Check for base structure at this tile
                    const structure = this._getStructureAt(gx, gy);
                    if (structure) {
                        if (b.team !== structure.team) {
                            if (structure.applyDamage(b.damage)) {
                                this._onStructureDestroyed(structure);
                            }
                        }
                    } else if (this.map.damageTile(gx, gy, b.damage)) {
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

                    this._applyHitToTank(b, t, b.damage);
                    break;
                }
            }
        }
    }

    _pushFromStructures() {
        for (const t of this._allTanks) {
            if (!t.alive || t.vehicleType === "drone") continue;
            for (const s of this._allStructures) {
                if (!s.alive) continue;
                // Push from each tile the structure occupies
                for (const pos of s.tilePositions) {
                    const sx = pos.gx + 0.5,
                        sy = pos.gy + 0.5;
                    const d = distance(t.x, t.y, sx, sy);
                    const min = VEHICLES[t.vehicleType].size + 0.5;
                    if (d < min && d > 0.001) {
                        const nx = (t.x - sx) / d;
                        const ny = (t.y - sy) / d;
                        const newX = sx + nx * min;
                        const newY = sy + ny * min;
                        if (this._canStand(newX, newY)) {
                            t.x = newX;
                            t.y = newY;
                        }
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

    /* ── Base compound helpers ─────────────────────────────── */

    /** Create a Base compound from map layout data. */
    _buildBase(layout, team, color, darkColor) {
        const base = new Base(team, color, darkColor);
        base.center = layout.center;
        base.origin = { x: layout.ox, y: layout.oy };
        base.entranceDir = layout.dir;

        // HQ
        const hq = new BaseHQ(team, color, darkColor);
        hq.x = layout.hqCenter.x;
        hq.y = layout.hqCenter.y;
        hq.tilePositions = layout.hqTiles.map((t) => ({ gx: t.gx, gy: t.gy }));
        base.hq = hq;

        // Walls
        for (const pos of layout.walls) {
            const w = new BaseWall(team, color, darkColor);
            w.x = pos.gx + 0.5;
            w.y = pos.gy + 0.5;
            w.tilePositions = [{ gx: pos.gx, gy: pos.gy }];
            base.walls.push(w);
        }

        // Watch towers
        for (const pos of layout.towers) {
            const t = new BaseWatchTower(team, color, darkColor);
            t.x = pos.gx + 0.5;
            t.y = pos.gy + 0.5;
            t.tilePositions = [{ gx: pos.gx, gy: pos.gy }];
            base.towers.push(t);
        }

        return base;
    }

    /** Look up the structure entity occupying tile (gx, gy). */
    _getStructureAt(gx, gy) {
        return this._structureMap.get(`${gx},${gy}`) ?? null;
    }

    /** Handle a structure being destroyed: clear tiles, particles, events. */
    _onStructureDestroyed(structure) {
        for (const pos of structure.tilePositions) {
            this.map.setTile(pos.gx, pos.gy, T.SAND);
            this._structureMap.delete(`${pos.gx},${pos.gy}`);
        }
        this.particles.emitExplosion(structure.x, structure.y);
        this.emit("destroy", { structure });
        this._invalidatePathfinders();
    }

    /** Update watch tower firing (auto-targeting enemies in range). */
    _updateWatchTowers(dt) {
        for (const base of this._bases) {
            const enemyTeam = base.team === 1 ? this._blueTeam : this._redTeam;
            for (const tower of base.towers) {
                if (!tower.alive) continue;
                tower.fireCooldown -= dt;
                if (tower.fireCooldown > 0) continue;

                // Find best target in range
                const cfg = BASE_STRUCTURES.baseTower;
                const priorities = cfg.targetPriority;
                let best = null,
                    bestScore = -1;
                for (const e of enemyTeam) {
                    if (!e.alive) continue;
                    const w = priorities[e.targetType] ?? 0;
                    if (w <= 0) continue;
                    const d = distance(tower.x, tower.y, e.x, e.y);
                    if (d > cfg.fireRange) continue;
                    if (!this._hasLineOfSight(tower.x, tower.y, e.x, e.y)) continue;
                    const score = w / Math.max(d, 0.5);
                    if (score > bestScore) {
                        best = e;
                        bestScore = score;
                    }
                }
                if (!best) continue;

                // Fire
                const angle = Math.atan2(best.y - tower.y, best.x - tower.x);
                tower.turretAngle = angle;
                tower.fireCooldown = cfg.bulletCooldown;
                const b = new Bullet(tower.x, tower.y, angle, 0, tower.team, cfg.bulletDamage, cfg.bulletSpeed);
                this.bullets.push(b);
                const tipX = tower.x + Math.cos(angle) * 0.3;
                const tipY = tower.y + Math.sin(angle) * 0.3;
                this.particles.emitIFVFlash(tipX, tipY, angle);
                this.emit("fire", { tower, bullet: b });
            }
        }
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

    /** Check if a straight line between two points is clear of projectile-blocking terrain.
     *  Skips the shooter's own tile so structures (e.g. watch towers) don't block themselves. */
    _hasLineOfSight(x1, y1, x2, y2) {
        const dx = x2 - x1,
            dy = y2 - y1;
        const d = Math.hypot(dx, dy);
        const n = Math.ceil(d * 3);
        const originGx = Math.floor(x1),
            originGy = Math.floor(y1);
        for (let i = 1; i < n; i++) {
            const t = i / n;
            const sx = x1 + dx * t,
                sy = y1 + dy * t;
            if (Math.floor(sx) === originGx && Math.floor(sy) === originGy) continue;
            if (this.map.blocksProjectile(sx, sy)) return false;
        }
        return true;
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
