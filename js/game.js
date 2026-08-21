/**
 * Core game state — faction-based match system.
 *
 * A match is described by a MatchConfig built by the lobby (menu.js) and
 * passed to the constructor:
 *
 *   {
 *     gameType: "skirmish" | "battle",   // rules from GAME_TYPES
 *     humans: [ { device, color, darkColor, label, team } ],
 *     settings: { mapSize, buildingDensity, baseType?, teamSize? },
 *   }
 *
 * `team` is a faction id (1..MAX_PLAYERS).  Game resolves factions from
 * the humans + game type, then fills bots:
 *   - Battle:   2 factions (RED/BLUE), bots fill each to `teamSize`.
 *   - Skirmish: one faction per distinct human team; if every human is on
 *               one team, a single bot faction is added as the opposition.
 *
 * Events: fire, hit, destroy, impact, destroy_tile, win,
 *         artillery_impact, drone_strike
 */

import { AIController, pickRoleForVehicle } from "./ai.js";
import { Bullet } from "./bullet.js";
import { Camera } from "./camera.js";
import { vehiclesSeparate } from "./collision.js";
import {
    ACTIONS,
    BASE_STRUCTURES,
    CONFIG,
    GAME_TYPES,
    PLAYER_COLORS,
    SQUAD_MEMBERS,
    TILES as T,
    VEHICLES,
} from "./config.js";
import { Base, BaseHQ, BaseWall, BaseWatchTower } from "./entity.js";
import { planFactions } from "./factions.js";
import { GameMap } from "./map.js";
import { ParticleSystem } from "./particles.js";
import { pickSquadTarget } from "./squad.js";
import { Tank } from "./tank.js";
import { distance, worldToScreen } from "./utils.js";

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
    /**
     * @param {object} matchConfig  lobby-built match plan (see header)
     */
    constructor(matchConfig = {}) {
        this.gameType = matchConfig.gameType ?? "skirmish";
        this.typeDef = GAME_TYPES[this.gameType] ?? GAME_TYPES.skirmish;
        this.settings = matchConfig.settings ?? {};
        this._humanPlan = matchConfig.humans ?? [];

        // Build map with settings-driven dimensions and density
        const mapW = this.settings.mapSize?.w;
        const mapH = this.settings.mapSize?.h;
        const density = this.settings.buildingDensity;
        this.map = new GameMap(mapW, mapH, density);
        this.particles = new ParticleSystem();
        /** @type {Bullet[]} */
        this.bullets = [];
        this.gameTime = 0;
        this.gameOver = false;
        this.winner = null; // winning faction id
        /** @type {Record<string,Function[]>} */
        this._listeners = {};

        this._init();
    }

    /* ── accessors ────────────────────────────────────────── */

    /** Every tank in the game. */
    get allTanks() {
        return this._allTanks;
    }
    /** Base compounds (empty in non-base game types). */
    get bases() {
        return this._bases;
    }
    /** All base structures from both factions (flat list). */
    get baseStructures() {
        return this._allStructures;
    }
    /** The first human tank (for single-viewport matches / HUD). */
    get humanTank() {
        return this._humanTanks[0];
    }
    /** All human-controlled tanks (viewport order = join order). */
    get humanTanks() {
        return this._humanTanks;
    }
    /** All cameras (one per human player). */
    get cameras() {
        return this._cameras;
    }
    /** Whether this game type builds towers/bases. */
    get hasBases() {
        return this.typeDef.bases;
    }
    /** Factions: [{ id, color, darkColor, entities }]. */
    get factions() {
        return this._factions;
    }
    /** Per-faction kill scores (Map<factionId, number>). */
    get scores() {
        return this._scores;
    }
    /** Winning faction's colour (for the game-over screen). */
    get winnerColor() {
        return this._factions.find((f) => f.id === this.winner)?.color ?? "#888";
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
        const def = this.typeDef;

        this._factions = [];
        this._humanTanks = [];
        this._humanDevices = [];
        this._cameras = [];
        this._bots = [];
        this._bases = [];
        this._allStructures = [];
        this._structureMap = new Map(); // "gx,gy" → BaseStructure
        this._scores = new Map();

        const factions = planFactions(this.gameType, this._humanPlan, this.settings).map((f) => ({
            ...f,
            entities: [],
        }));
        const factionById = new Map(factions.map((f) => [f.id, f]));

        // ── Base compounds (base game types only) ──
        if (def.bases) {
            const baseType = this.settings.baseType ?? "compound";
            const [layout1, layout2] = this.map.buildBaseCompounds(baseType);
            this._bases = [
                this._buildBase(layout1, 1, factions[0].color, factions[0].darkColor),
                this._buildBase(layout2, 2, factions[1].color, factions[1].darkColor),
            ];
            this._allStructures = [...this._bases[0].allStructures, ...this._bases[1].allStructures];
            for (const s of this._allStructures) {
                for (const pos of s.tilePositions) {
                    this._structureMap.set(`${pos.gx},${pos.gy}`, s);
                }
            }
        }

        // ── Create tanks: humans (join order) then bots ──
        let nextId = 1;
        for (const h of this._humanPlan) {
            const f = factionById.get(h.team);
            if (!f) continue;
            const t = new Tank(nextId++, h.color, h.darkColor);
            t.team = h.team;
            t.vehicleType = pickVehicleType(def.vehicles);
            f.entities.push(t);
            this._humanTanks.push(t);
            this._humanDevices.push(h.device);
            const cam = new Camera();
            cam.smoothing = CONFIG.CAMERA_SMOOTHING;
            this._cameras.push(cam);
        }
        for (const f of factions) {
            for (let i = 0; i < f.botCount; i++) {
                const t = new Tank(nextId++, f.color, f.darkColor);
                t.team = f.id;
                t.vehicleType = pickVehicleType(def.vehicles);
                f.entities.push(t);
            }
        }

        this._factions = factions;
        this._allTanks = factions.flatMap((f) => f.entities);
        for (const f of factions) this._scores.set(f.id, 0);

        // ── AI bots (every non-human tank) ──
        for (const f of factions) {
            for (const t of f.entities) {
                if (this._humanTanks.includes(t)) continue;
                const ai = new AIController(this.map);
                ai.role = pickRoleForVehicle(t.vehicleType);
                if (def.bases) ai.friendlyBase = this._bases.find((b) => b.team === f.id) ?? null;
                this._bots.push({
                    ai,
                    tank: t,
                    enemies: this._allTanks.filter((e) => e.team !== t.team),
                    enemyBase: def.bases ? (this._bases.find((b) => b.team !== f.id) ?? null) : null,
                });
            }
        }

        this._spawn();
    }

    _spawn() {
        const def = this.typeDef;

        if (def.bases) {
            // ── Base spawn: inside each faction's compound ──
            for (const f of this._factions) {
                const base = this._bases.find((b) => b.team === f.id);
                const enemyBase = this._bases.find((b) => b.team !== f.id);
                if (!base) continue;
                for (const t of f.entities) {
                    const sp = this.map.getBaseSpawnPoint(base.center.x, base.center.y);
                    t.respawnAt(sp.x, sp.y);
                    t.alive = true;
                    t.angle = enemyBase
                        ? Math.atan2(enemyBase.y - base.y, enemyBase.x - base.x) + (Math.random() - 0.5) * 0.5
                        : Math.random() * Math.PI * 2;
                }
            }
        } else {
            // ── Random spawn: spread everyone out, then face nearest enemy ──
            let lastX = -1,
                lastY = -1;
            for (const t of this._allTanks) {
                const sp = this.map.getSpawnPoint(lastX, lastY);
                t.respawnAt(sp.x, sp.y);
                t.alive = true;
                lastX = sp.x;
                lastY = sp.y;
            }
            for (const t of this._allTanks) {
                const enemy = this._nearestEnemy(t);
                if (enemy) t.angle = Math.atan2(enemy.y - t.y, enemy.x - t.x) + (Math.random() - 0.5) * 0.3;
            }
        }

        // Init cameras
        for (let i = 0; i < this._humanTanks.length; i++) {
            const sc = worldToScreen(this._humanTanks[i].x, this._humanTanks[i].y);
            this._cameras[i].setPosition(sc.x, sc.y);
        }
    }

    /** Nearest alive tank in a different faction. */
    _nearestEnemy(tank) {
        let best = null;
        let bestD = Infinity;
        for (const e of this._allTanks) {
            if (e === tank || e.team === tank.team || !e.alive) continue;
            const d = (e.x - tank.x) ** 2 + (e.y - tank.y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /* ═══════════════════════════════════════════════════════ *
     *  UNIFIED UPDATE                                         *
     * ═══════════════════════════════════════════════════════ */

    _update(dt) {
        const def = this.typeDef;

        // ── AI think ──
        for (const { ai, tank, enemies, enemyBase } of this._bots) {
            if (!tank.alive) continue;
            const obj = def.bases && enemyBase?.alive ? enemyBase : null;
            // For non-base game types give AI the nearest enemy as objective
            const target = obj ?? (enemies.find((e) => e.alive) || null);
            const enemyStructures = enemyBase?.allStructures ?? [];
            ai.think(dt, tank, enemies, this.map, target, enemyStructures);
        }

        // ── Movement — humans (only when alive) ──
        for (let i = 0; i < this._humanTanks.length; i++) {
            if (this._humanTanks[i].alive) {
                this._humanTanks[i].update(dt, this._humanDevices[i], this.map);
            }
        }
        // ── Movement — bots ──
        for (const { ai, tank } of this._bots) {
            if (tank.alive) tank.update(dt, ai, this.map);
        }

        // ── Squad member steering + dig-in timers ──
        for (const t of this._allTanks) {
            if (t.alive && t.vehicleType === "squad" && t.squad) t.squad.update(dt, this.map);
        }

        this._separatePairs(this._allTanks);
        if (def.bases) this._pushFromStructures();

        // ── Run-over: enemy ground vehicles crush exposed soldiers ──
        this._resolveCrushes();

        // ── Firing — humans ──
        for (let i = 0; i < this._humanTanks.length; i++) {
            if (this._humanTanks[i].alive) {
                this._handleFiring(this._humanTanks[i], this._humanDevices[i], dt);
            }
        }
        // ── Firing — bots ──
        for (const { ai, tank } of this._bots) {
            if (tank.alive) this._handleFiring(tank, ai, dt);
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
        const def = this.typeDef;
        for (const t of this._allTanks) {
            if (t.alive) continue;
            t.respawnTimer -= dt;
            if (t.respawnTimer <= 0) {
                if (def.bases) {
                    // Spawn inside compound
                    const base = this._bases.find((b) => b.team === t.team);
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
        if (this.typeDef.bases) {
            // HQ destruction — the other faction wins.
            for (const base of this._bases) {
                if (!base.alive) {
                    const winner = this._bases.find((b) => b !== base)?.team ?? (base.team === 1 ? 2 : 1);
                    this.gameOver = true;
                    this.winner = winner;
                    this.emit("win", { winner });
                    return;
                }
            }
        } else {
            // Score-based — first faction to WIN_SCORE.
            for (const [factionId, score] of this._scores) {
                if (score >= CONFIG.WIN_SCORE) {
                    this.gameOver = true;
                    this.winner = factionId;
                    this.emit("win", { winner: factionId });
                    return;
                }
            }
        }
    }

    /** Short label for a faction (HUD scoreboard). */
    factionLabel(factionId) {
        const faction = this._factions.find((f) => f.id === factionId);
        if (!faction) return "";
        if (this.typeDef.bases) {
            return faction.id === 1 ? "RED" : "BLUE";
        }
        const humans = this._humanTanks.filter((t) => t.team === faction.id);
        if (humans.length === 1) return `P${this._humanTanks.indexOf(humans[0]) + 1}`;
        if (humans.length === 0) return "BOT";
        const col = PLAYER_COLORS.find((c) => c.color === faction.color);
        return col?.label ?? "TEAM";
    }

    /** Label for the winner on the game-over screen. */
    get winnerLabel() {
        if (!this.winner) return "";
        const faction = this._factions.find((f) => f.id === this.winner);
        if (!faction) return "";
        if (this.typeDef.bases) {
            return faction.id === 1 ? "RED TEAM" : "BLUE TEAM";
        }
        // Skirmish: single-human team → player label; bot → "BOT"; a
        // multi-human team → its colour label.
        const humans = this._humanTanks.filter((t) => t.team === faction.id);
        if (humans.length === 1) {
            return `PLAYER ${this._humanTanks.indexOf(humans[0]) + 1}`;
        }
        if (humans.length === 0) return "BOT";
        const col = PLAYER_COLORS.find((c) => c.color === faction.color);
        return `${col?.label ?? "TEAM"} TEAM`;
    }

    /* ═══════════════════════════════════════════════════════ *
     *  SHARED helpers                                         *
     * ═══════════════════════════════════════════════════════ */

    _handleFiring(tank, device, dt = 0.016) {
        // Drones don't fire bullets — they detonate on contact
        if (tank.vehicleType === "drone") {
            this._handleDroneAttack(tank, device);
            return;
        }
        // SPGs use hold-to-charge mechanic
        if (tank.vehicleType === "spg") {
            this._handleSPGFiring(tank, device, dt);
            return;
        }
        // Squads auto-fire per member; FIRE toggles dig-in
        if (tank.vehicleType === "squad") {
            this._handleSquadFiring(tank, device, dt);
            return;
        }
        if (device.isDown(ACTIONS.fire) && tank.canFire()) {
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

    _handleSPGFiring(tank, device, dt) {
        if (!tank.alive) return;

        const fireHeld = device.isDown(ACTIONS.fire);
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

    /**
     * Infantry squad firing: each alive member auto-targets and auto-fires
     * from its own position.  FIRE drives the dig-in state machine
     * (roaming → diggingIn → dugIn → roaming).
     */
    _handleSquadFiring(squad, device, dt) {
        if (!squad.alive || !squad.squad) return;
        const component = squad.squad;

        // Dig-in toggle — humans have edge detection; bots manage dig-in in AI.
        if (typeof device.wasPressed === "function" && device.wasPressed(ACTIONS.fire)) {
            if (component.digIn.state === "roaming") component.startDigIn();
            else if (component.digIn.state === "diggingIn") component.cancelDigIn();
            else component.standUp();
        }

        // No firing while performing the dig-in transition.
        if (!component.canFire) return;

        // Pre-filtered candidates: alive, enemy-team tanks + structures.
        const candidates = [
            ...this._allTanks.filter((t) => t.alive && t.team !== squad.team),
            ...this._allStructures.filter((s) => s.alive && s.team !== squad.team),
        ];
        const hasLOS = (x1, y1, x2, y2) => this._hasLineOfSight(x1, y1, x2, y2);

        for (const m of component.aliveMembers) {
            const weapon = SQUAD_MEMBERS[m.type];
            if (!weapon) continue;

            m.cooldown -= dt;
            if (m.cooldown > 0) continue;

            const target = pickSquadTarget(m, weapon, candidates, hasLOS);
            if (!target) continue;

            // Set the cooldown (dug-in squads fire 25% faster)
            let cooldown = weapon.cooldown;
            if (component.dugIn) cooldown *= 0.8;
            m.cooldown = cooldown;

            this._squadFireAt(squad, m, weapon, target);
        }
    }

    /**
     * Fire one member's weapon at a target.  Shotguns fire a pellet spread;
     * everything else fires a single bullet.  The bullet originates from
     * the member's position, not the squad centre.
     */
    _squadFireAt(squad, memberPos, weapon, target) {
        const e = target.entity;
        const angle = Math.atan2(e.y - memberPos.y, e.x - memberPos.x);
        const dmg = target.isFallback ? (weapon.fallbackDamage ?? weapon.damage) : weapon.damage;
        // Bullet lifetime = time to fly the member's range (+ margin),
        // giving squad weapons a hard range limit.
        const lifetime = weapon.bulletSpeed > 0 ? weapon.range / weapon.bulletSpeed + 0.15 : null;

        const pellets = weapon.pellets ?? 1;
        const spread = weapon.spread ?? 0;
        for (let p = 0; p < pellets; p++) {
            const a = pellets > 1 ? angle - spread / 2 + (spread * p) / (pellets - 1) : angle;
            const b = new Bullet(
                memberPos.x,
                memberPos.y,
                a,
                squad.playerNumber,
                squad.team,
                dmg,
                weapon.bulletSpeed,
                false,
                0,
                lifetime,
            );
            this.bullets.push(b);
        }

        // Muzzle flash + event (the weapon tag drives the sound)
        const tipX = memberPos.x + Math.cos(angle) * 0.3;
        const tipY = memberPos.y + Math.sin(angle) * 0.3;
        this.particles.emitIFVFlash(tipX, tipY, angle);
        this.emit("fire", { tank: squad, bullet: this.bullets[this.bullets.length - 1], weapon: weapon.weapon });
    }

    /**
     * Distance from an AoE source to a tank.  Squads use their nearest
     * alive member; everything else uses the centre.
     */
    _entityDistance(source, tank) {
        if (tank.vehicleType === "squad" && tank.squad) {
            const d = tank.squad.nearestMemberDistance(source.x, source.y);
            if (Number.isFinite(d)) return d;
        }
        return distance(source.x, source.y, tank.x, tank.y);
    }

    /** Radius used for AoE falloff: squads use their soldier radius. */
    _entityRadius(tank) {
        return tank.vehicleType === "squad" ? VEHICLES.squad.soldierRadius : tank.size;
    }

    _handleArtilleryImpact(b) {
        const splashR = VEHICLES.spg.splashRadius;

        for (const t of this.allTanks) {
            if (!t.alive || b.team === t.team) continue;
            const r = this._entityRadius(t);
            const d = this._entityDistance(b, t);
            if (d >= splashR + r) continue;

            const effectiveDist = Math.max(0, d - r);
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

    _handleDroneAttack(drone, device) {
        if (!device.isDown(ACTIONS.fire) || !drone.alive) return;

        const vStats = VEHICLES.drone;
        const blastR = vStats.blastRadius;
        const maxDmg = vStats.blastDamage;

        for (const t of this.allTanks) {
            if (!t.alive || t.team === drone.team) continue;
            const d = this._entityDistance(drone, t);
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
        let dmg = damage;

        // Infantry squad mechanical cover / dig-in damage reduction.
        if (tank.vehicleType === "squad" && tank.alive) {
            const v = VEHICLES.squad;
            let reduction = tank.dugIn ? v.digInReduction : 0;
            if (this.map.hasIntactBuildingNear(tank.x, tank.y, v.coverRadius)) {
                reduction = Math.max(reduction, v.coverReduction);
            }
            reduction = Math.min(reduction, v.maxDamageReduction);
            if (reduction > 0) dmg = damage * (1 - reduction);
        }

        const zone = tank.getHitZone(source.x, source.y);
        const result = tank.applyHit(zone, dmg);

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
        if (!this.typeDef.bases) {
            this._scores.set(killerTeam, (this._scores.get(killerTeam) ?? 0) + 1);
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
                // Squads use a distributed hitbox — the bullet must strike
                // an individual soldier, not the squad centre.
                const hit =
                    t.vehicleType === "squad" && t.squad
                        ? t.squad.bulletHit(b.x, b.y)
                        : distance(b.x, b.y, t.x, t.y) < t.size;
                if (hit) {
                    b.alive = false;

                    this._applyHitToTank(b, t, b.damage);
                    break;
                }
            }
        }
    }

    /**
     * Enemy ground vehicles run over exposed (non-dug-in) soldiers.
     * Overlapping a soldier kills that specific member; killing the last
     * member destroys the squad with kill credit to the vehicle.
     */
    _resolveCrushes() {
        const ground = new Set(["tank", "ifv", "spg"]);
        for (const squad of this._allTanks) {
            if (!squad.alive || squad.vehicleType !== "squad" || !squad.squad) continue;
            const component = squad.squad;

            for (const v of this._allTanks) {
                if (!v.alive || v.team === squad.team || !ground.has(v.vehicleType)) continue;

                const idx = component.crushedMemberBy(v);
                if (idx < 0) continue;

                if (component.crushMember(idx)) {
                    squad.kill();
                    this.particles.emitExplosion(squad.x, squad.y);
                    this.emit("destroy", { tank: squad });
                    this._onKill(v.team, squad);
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
                if (!vehiclesSeparate(a, b)) continue;
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
        base.compoundSize = layout.size;

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
            const enemyTeam = this._allTanks.filter((t) => t.team !== base.team);
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
