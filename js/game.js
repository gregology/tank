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
 * The two modes (score race vs base objective) diverge in spawn, win
 * condition, scoring, and labels — that branching lives in the mode
 * strategy (js/modes.js), not here.  Per-vehicle firing/attack rules
 * live in the vehicle behaviours (js/vehicles/), dispatched from the
 * `vehicleType`.  This file is the shared simulation loop.
 *
 * Events: fire, hit, destroy, impact, destroy_tile, win,
 *         artillery_impact, drone_strike
 */

import { AIController, pickRoleForVehicle } from "./ai.js";
import { Bullet } from "./bullet.js";
import { Camera } from "./camera.js";
import { vehiclesSeparate } from "./collision.js";
import { BASE_STRUCTURES, CONFIG, GAME_TYPES, TILES as T, VEHICLES } from "./config.js";
import { planFactions } from "./factions.js";
import { GameMap } from "./map.js";
import { getMode } from "./modes.js";
import { ParticleSystem } from "./particles.js";
import { Tank } from "./tank.js";
import { distance, worldToScreen } from "./utils.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

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
        this.mode = getMode(this.gameType);
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
    // This is the world-model surface the mode strategies (js/modes.js)
    // and vehicle behaviours (js/vehicles/) are written against.  They
    // read these getters and call the public mutators below
    // (`setBases`, `creditKill`, `nearestEnemy`) — never the `_`-prefixed
    // fields, which are Game-internal.

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
        return this.mode.hasBases;
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
        this._factions = factions;

        // ── Mode-specific construction (battle: base compounds) ──
        this.mode.init(this);

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

        this._allTanks = factions.flatMap((f) => f.entities);
        for (const f of factions) this._scores.set(f.id, 0);

        // ── AI bots (every non-human tank) ──
        for (const f of factions) {
            for (const t of f.entities) {
                if (this._humanTanks.includes(t)) continue;
                const ai = new AIController(this.map);
                ai.role = pickRoleForVehicle(t.vehicleType);
                const bot = {
                    ai,
                    tank: t,
                    enemies: this._allTanks.filter((e) => e.team !== t.team),
                };
                this.mode.setupBot(this, bot, f);
                this._bots.push(bot);
            }
        }

        this._spawn();
    }

    _spawn() {
        this.mode.spawn(this);

        // Init cameras
        for (let i = 0; i < this._humanTanks.length; i++) {
            const sc = worldToScreen(this._humanTanks[i].x, this._humanTanks[i].y);
            this._cameras[i].setPosition(sc.x, sc.y);
        }
    }

    /** Nearest alive tank in a different faction. */
    nearestEnemy(tank) {
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

    /** Credit one kill to a faction's score (skirmish scoring). */
    creditKill(factionId) {
        this._scores.set(factionId, (this._scores.get(factionId) ?? 0) + 1);
    }

    /* ═══════════════════════════════════════════════════════ *
     *  UNIFIED UPDATE                                         *
     * ═══════════════════════════════════════════════════════ */

    _update(dt) {
        // ── AI think ──
        for (const { ai, tank, enemies } of this._bots) {
            if (!tank.alive) continue;
            // Mode decides the objective (battle: the enemy base).
            const objective =
                this.mode.aiObjective(this, { ai, tank, enemies }) ?? (enemies.find((e) => e.alive) || null);
            ai.think(dt, tank, enemies, this.map, objective, this.mode.enemyStructures(this, tank));
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

        // ── Vehicle behaviour per-frame updates (squad member steering) ──
        for (const t of this._allTanks) {
            if (t.alive) getVehicleBehaviour(t.vehicleType).update(this, t, dt);
        }

        this._separatePairs(this._allTanks);
        this.mode.afterSeparation(this);

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
        this.mode.afterBullets(this, dt);
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
        for (const t of this._allTanks) {
            if (t.alive) continue;
            t.respawnTimer -= dt;
            if (t.respawnTimer <= 0) {
                // Mode picks the spawn point (battle: inside the compound);
                // skirmish keeps the position reserved at kill time.
                const sp = this.mode.respawn(this, t);
                if (sp) t.respawnAt(sp.x, sp.y);
                t.alive = true;
                t.flashTimer = 1;
                // Re-randomise vehicle type on respawn
                t.vehicleType = pickVehicleType(this.typeDef.vehicles);
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
        const winner = this.mode.checkWin(this);
        if (winner != null) {
            this.gameOver = true;
            this.winner = winner;
            this.emit("win", { winner });
        }
    }

    /** Short label for a faction (HUD scoreboard). */
    factionLabel(factionId) {
        const faction = this._factions.find((f) => f.id === factionId);
        return faction ? this.mode.factionLabel(this, faction) : "";
    }

    /** Label for the winner on the game-over screen. */
    get winnerLabel() {
        if (!this.winner) return "";
        const faction = this._factions.find((f) => f.id === this.winner);
        return faction ? this.mode.winnerLabel(this, faction) : "";
    }

    /* ═══════════════════════════════════════════════════════ *
     *  SHARED helpers                                         *
     * ═══════════════════════════════════════════════════════ */

    /** Per-frame firing/attack — dispatched to the vehicle's behaviour. */
    _handleFiring(tank, device, dt = 0.016) {
        getVehicleBehaviour(tank.vehicleType).fire(this, tank, device, dt);
    }

    /**
     * Apply a hit to a tank and emit the appropriate particles/events.
     * @param {{x:number, y:number, team:number}} source - bullet or explosion origin
     * @param {Tank} tank - target tank
     * @param {number} damage - damage amount
     */
    applyHitToTank(source, tank, damage) {
        let dmg = damage;

        // Cover / dig-in damage reduction is a per-entity capability (1 for
        // everything except infantry squads).
        dmg *= tank.incomingDamageMultiplier(this.map);

        const zone = tank.getHitZone(source.x, source.y);
        const result = tank.applyHit(zone, dmg);

        if (result === "destroyed") {
            this.particles.emitExplosion(tank.x, tank.y);
            this.emit("destroy", { tank });
            this.mode.onKill(this, source.team, tank);
        } else if (result === "damaged") {
            this.particles.emitImpact(source.x, source.y);
            this.emit("hit", { tank, zone });
        } else {
            this.particles.emitTinyImpact(source.x, source.y);
        }
    }

    _tickBullets(dt) {
        for (const b of this.bullets) {
            const wasAlive = b.alive;
            b.update(dt, this.map);
            if (wasAlive && !b.alive) {
                if (b.arcing && b.landed) {
                    // Arcing shells apply their impact through the shooter's behaviour.
                    getVehicleBehaviour(b.sourceType).onShellImpact(this, b);
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
                                this.onStructureDestroyed(structure);
                            }
                        }
                    } else {
                        this.damageTileAt(gx, gy, b.damage);
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
                if (t.hitTest(b.x, b.y)) {
                    b.alive = false;

                    this.applyHitToTank(b, t, b.damage);
                    break;
                }
            }
        }
    }

    /**
     * Ground vehicles run over exposed (non-dug-in) infantry.  The
     * interaction is expressed through capabilities (`canCrush` vs
     * `crushable`) rather than unit-class checks, so a new soft or
     * crushing unit inherits it.
     */
    _resolveCrushes() {
        for (const target of this._allTanks) {
            if (!target.alive || !target.crushable) continue;

            for (const v of this._allTanks) {
                if (!v.alive || v.team === target.team || !v.canCrush) continue;

                const idx = target.crushedMemberBy(v);
                if (idx < 0) continue;

                if (target.crushMember(idx)) {
                    target.kill();
                    this.particles.emitExplosion(target.x, target.y);
                    this.emit("destroy", { tank: target });
                    this.mode.onKill(this, v.team, target);
                }
            }
        }
    }

    pushFromStructures() {
        for (const t of this._allTanks) {
            if (!t.alive || t.flies) continue;
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
                        if (this.map.canStand(newX, newY)) {
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
                    if (this.map.canStand(ax, ay, VEHICLES[a.vehicleType].size)) {
                        a.x = ax;
                        a.y = ay;
                    }
                    if (this.map.canStand(bx, by, VEHICLES[b.vehicleType].size)) {
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

    /** Register the mode's base compounds and their structures (battle init). */
    setBases(bases) {
        this._bases = bases;
        this._allStructures = bases.flatMap((b) => b.allStructures);
        this._structureMap = new Map();
        for (const s of this._allStructures) {
            for (const pos of s.tilePositions) {
                this._structureMap.set(`${pos.gx},${pos.gy}`, s);
            }
        }
    }

    /** Look up the structure entity occupying tile (gx, gy). */
    _getStructureAt(gx, gy) {
        return this._structureMap.get(`${gx},${gy}`) ?? null;
    }

    /** Handle a structure being destroyed: clear tiles, particles, events. */
    onStructureDestroyed(structure) {
        for (const pos of structure.tilePositions) {
            this.map.setTile(pos.gx, pos.gy, T.SAND);
            this._structureMap.delete(`${pos.gx},${pos.gy}`);
        }
        this.particles.emitExplosion(structure.x, structure.y);
        this.emit("destroy", { structure });
        this._invalidatePathfinders();
    }

    /** Apply damage to a destructible tile; emits the destroy_tile event on break. */
    damageTileAt(gx, gy, damage) {
        if (!this.map.damageTile(gx, gy, damage)) return;
        this.particles.emitExplosion(gx + 0.5, gy + 0.5);
        this.emit("destroy_tile", { gx, gy });
        this._invalidatePathfinders();
    }

    /** Update watch tower firing (auto-targeting enemies in range). */
    updateWatchTowers(dt) {
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
                    if (!this.map.hasLineOfSight(tower.x, tower.y, e.x, e.y, { skipOrigin: true })) continue;
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
