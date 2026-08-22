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
import { Camera } from "./camera.js";
import { CONFIG, GAME_TYPES, TILES as T } from "./config.js";
import { planFactions } from "./factions.js";
import { GameMap } from "./map.js";
import { getMode } from "./modes.js";
import { ParticleSystem } from "./particles.js";
import { updateCamera } from "./systems/camera.js";
import { pushFromStructures as pushFromStructuresSystem, resolveCrushes, separatePairs } from "./systems/collision.js";
import { emitDamageSmoke } from "./systems/effects.js";
import { checkBulletHits, tickBullets } from "./systems/projectiles.js";
import { handleRespawns } from "./systems/respawn.js";
import { updateWatchTowers as updateWatchTowersSystem } from "./systems/towers.js";
import { checkWin } from "./systems/win.js";
import { Tank } from "./tank.js";
import { worldToScreen } from "./utils.js";
import { getVehicleBehaviour, pickVehicleType } from "./vehicles/index.js";

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
        /** Particle system (world-space effects) — part of the world-model surface. */
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
    /** All AI-controlled bots as `{ tank, role }` pairs (for the HUD/minimap). */
    get bots() {
        return this._bots.map(({ tank, ai }) => ({ tank, role: ai.role }));
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
        handleRespawns(this, dt);
    }

    /* ── win condition ────────────────────────────────────── */

    _checkWin() {
        checkWin(this);
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
        tickBullets(this, dt);
    }

    _checkBulletHits() {
        checkBulletHits(this);
    }

    /**
     * Ground vehicles run over exposed (non-dug-in) infantry.  See
     * `js/systems/collision.js#resolveCrushes`.
     */
    _resolveCrushes() {
        resolveCrushes(this);
    }

    pushFromStructures() {
        pushFromStructuresSystem(this);
    }

    _emitDamageSmoke(dt) {
        emitDamageSmoke(this, dt);
    }

    _separatePairs(tanks) {
        separatePairs(this, tanks);
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
        updateWatchTowersSystem(this, dt);
    }

    _updateCamera(cam, tank, dt) {
        updateCamera(cam, tank, dt);
    }
}
