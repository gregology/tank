/**
 * Core game state — faction-based match system.
 *
 * A match is described by a MatchConfig built by the lobby (menu.js) and
 * passed to the constructor:
 *
 *   {
 *     gameType: "skirmish" | "battle",   // rules from GAME_TYPES
 *     humans: [ { device, color, darkColor, label, team } ],
 *     settings: { mapSize, buildingDensity, teamSize? },
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

import { Swarm } from "./ai/swarm/index.js";
import { AIController } from "./ai.js";
import { Camera } from "./camera.js";
import { CONFIG, GAME_TYPES, SWARM, TILES as T } from "./config.js";
import { resolveDamage } from "./damage.js";
import { GAME_EVENTS } from "./events.js";
import { planFactions } from "./factions.js";
import { GameMap } from "./map.js";
import { getMode } from "./modes.js";
import { ParticleSystem } from "./particles.js";
import { deriveSeed, mulberry32 } from "./rng.js";
import { updateCamera } from "./systems/camera.js";
import { pushFromStructures as pushFromStructuresSystem, resolveCrushes, separatePairs } from "./systems/collision.js";
import { emitDamageSmoke } from "./systems/effects.js";
import { runFiring } from "./systems/firing.js";
import { runMovement } from "./systems/movement.js";
import { checkBulletHits, tickBullets } from "./systems/projectiles.js";
import { handleRespawns } from "./systems/respawn.js";
import { updateSwarms } from "./systems/swarm.js";
import { runThink } from "./systems/think.js";
import { updateWatchTowers as updateWatchTowersSystem } from "./systems/towers.js";
import { updateVehicles } from "./systems/update.js";
import { checkWin } from "./systems/win.js";
import { Tank } from "./tank.js";
import { worldToScreen } from "./utils.js";
import { pickVehicleType } from "./vehicles/index.js";

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

        /**
         * One match = one seed.  `this.rng` is the master stream for shared
         * rolls (spawns, vehicle picks, cosmetic timers); each bot's
         * AIController gets an independent derived stream.  Same seed +
         * same settings = bit-for-bit reproducible match.
         */
        this.seed = this.settings.seed ?? Math.floor(Math.random() * 2147483647);
        this.rng = mulberry32(this.seed);

        /**
         * Live swarm tuning for this match: the SWARM defaults with any
         * per-match overrides.  Shared by reference with every faction's
         * Swarm, so the sandbox's sliders apply immediately.
         */
        this.tuning = { ...SWARM, ...(this.settings.tuning ?? {}) };

        // Build map with settings-driven dimensions and density
        const mapW = this.settings.mapSize?.w;
        const mapH = this.settings.mapSize?.h;
        const density = this.settings.buildingDensity;
        this.map = new GameMap(mapW, mapH, density, undefined, this.seed);
        /** Particle system (world-space effects) — part of the world-model surface. */
        this.particles = new ParticleSystem();
        /** @type {Bullet[]} */
        this.bullets = [];
        this.gameTime = 0;
        this.gameOver = false;
        this.winner = null; // winning faction id
        /** @type {Record<string,Function[]>} */
        this._listeners = {};

        // Cross-cutting pathfinder invalidation: any terrain change invalidates
        // every bot's cached A* route (was a direct `ai._pf` reach before).
        this.on(GAME_EVENTS.TERRAIN_CHANGED, () => {
            for (const { ai } of this._bots) ai.invalidatePath();
        });

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
    /** Every damageable entity (tanks + base structures) in one flat list. */
    get damageables() {
        return this._allTanks.concat(this._allStructures);
    }
    /** Alive enemy entities (tanks + structures) a team may shoot at. */
    enemiesOf(team) {
        return this.damageables.filter((e) => e.alive && e.team !== team);
    }
    /** The first human tank (for single-viewport matches / HUD). */
    get humanTank() {
        return this._humanTanks[0];
    }
    /** All human-controlled tanks (viewport order = join order). */
    get humanTanks() {
        return this._humanTanks;
    }
    /** All AI-controlled bots as `{ ai, tank, enemies, allies, swarm }` records. */
    get bots() {
        return this._bots;
    }
    /** Per-faction colony state (pheromone fields + intel). */
    get swarms() {
        return this._swarms;
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
    off(event, fn) {
        const list = this._listeners[event];
        if (!list) return;
        this._listeners[event] = list.filter((f) => f !== fn);
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
        // A restart sequence is reproducible too: the next map's seed is
        // drawn from the current match's stream.
        this.seed = Math.floor(this.rng() * 2147483647);
        this.rng = mulberry32(this.seed);
        const s = this.settings;
        this.map = new GameMap(s.mapSize?.w, s.mapSize?.h, s.buildingDensity, undefined, this.seed);
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

        const factions = planFactions(this.gameType, this._humanPlan, this.settings.teamSize).map((f) => ({
            ...f,
            entities: [],
        }));
        const factionById = new Map(factions.map((f) => [f.id, f]));
        this._factions = factions;

        // ── One colony per faction: shared pheromone fields + intel ──
        this._swarms = new Map(factions.map((f) => [f.id, new Swarm(this.map.width, this.map.height, this.tuning)]));

        // ── Mode-specific construction (battle: base compounds) ──
        this.mode.init(this);

        // ── Create tanks: humans (join order) then bots ──
        let nextId = 1;
        for (const h of this._humanPlan) {
            const f = factionById.get(h.team);
            if (!f) continue;
            const t = new Tank(nextId++, h.color, h.darkColor);
            t.team = h.team;
            t.vehicleType = pickVehicleType(def.vehicles, this.rng);
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
                t.vehicleType = pickVehicleType(def.vehicles, this.rng);
                f.entities.push(t);
            }
        }

        this._allTanks = factions.flatMap((f) => f.entities);
        for (const f of factions) this._scores.set(f.id, 0);

        // Humans are their colony's natural convoy leaders (the swarm
        // reads them as attractors; it never steers them).
        for (const t of this._humanTanks) this._swarms.get(t.team)?.humans.add(t);

        // ── AI bots (every non-human tank) ──
        for (const f of factions) {
            for (const t of f.entities) {
                if (this._humanTanks.includes(t)) continue;
                const swarm = this._swarms.get(f.id);
                const ai = new AIController(this.map, mulberry32(deriveSeed(this.seed, t.playerNumber)), swarm);
                ai.allies = f.entities;
                this._bots.push({
                    ai,
                    tank: t,
                    swarm,
                    enemies: this._allTanks.filter((e) => e.team !== t.team),
                    allies: f.entities,
                });
            }
        }

        this._spawn();

        // The colony's home reference (spawn centroid) — exploration
        // expands away from it (see the swarm's explore behaviour).
        for (const f of factions) {
            const swarm = this._swarms.get(f.id);
            if (!swarm || f.entities.length === 0) continue;
            swarm.home = {
                x: f.entities.reduce((s, t) => s + t.x, 0) / f.entities.length,
                y: f.entities.reduce((s, t) => s + t.y, 0) / f.entities.length,
            };
        }
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
        const bots = this._bots;
        const humanDevices = this._humanDevices;

        // A thin, ordered list of per-frame system calls.
        updateSwarms(this, dt);
        runThink(this, bots, dt);
        runMovement(this, bots, humanDevices, dt);
        updateVehicles(this, dt);

        this._separatePairs(this._allTanks);
        this.mode.afterSeparation(this);

        // ── Run-over: enemy ground vehicles crush exposed soldiers ──
        this._resolveCrushes();

        runFiring(this, bots, humanDevices, dt);

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

    /**
     * The one damage-application seam: resolve a hit through the entity's own
     * damage model, then apply the shared post-hit side-effects (particles,
     * events, kill credit / structure clearing).  Tanks and structures go
     * through the same path — the differences live in the entity's damage
     * model and its `onDestroyed` hook, not in callers.
     *
     * @param {object} entity  the target (Tank or BaseStructure)
     * @param {{x:number, y:number, team:number}} source  bullet/blast/crush origin
     * @param {number} amount  raw incoming damage
     * @returns {"destroyed"|"damaged"|"absorbed"}
     */
    applyDamage(entity, source, amount) {
        // Zone is armour-model-specific (computed only where it exists); cover
        // / dig-in reduction is a per-entity capability (1 for most entities).
        const zone = entity.getHitZone ? entity.getHitZone(source.x, source.y) : null;
        const dmg = amount * entity.incomingDamageMultiplier(this.map);
        const result = resolveDamage(entity, zone, dmg);

        // A living victim keeps emitting the alarm pheromone (see the
        // swarm system); the signal dies with it — no rallying to a corpse.
        if (entity.isVehicle) entity.lastHitAt = this.gameTime;

        if (result === "destroyed") {
            this.destroyEntity(entity, source);
        } else if (result === "damaged") {
            this.particles.emit("impact", source.x, source.y);
            this.emit(GAME_EVENTS.HIT, { tank: entity, zone });
        } else {
            this.particles.emit("tinyImpact", source.x, source.y);
        }
        return result;
    }

    /** Emit the standard destruction side-effects for a killed entity. */
    destroyEntity(entity, source) {
        this.particles.emit("explosion", entity.x, entity.y);
        this.emit(GAME_EVENTS.DESTROY, { entity });
        entity.onDestroyed(this, source);
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
    structureAt(gx, gy) {
        return this._structureMap.get(`${gx},${gy}`) ?? null;
    }

    /** The full bot handle (`{ ai, tank, enemies }`) for a tank, or null. */
    getBot(tank) {
        return this._bots.find((b) => b.tank === tank) ?? null;
    }

    /** Handle a structure being destroyed: clear tiles, particles, events. */
    onStructureDestroyed(structure) {
        for (const pos of structure.tilePositions) {
            this.map.setTile(pos.gx, pos.gy, T.SAND);
            this._structureMap.delete(`${pos.gx},${pos.gy}`);
        }
        this.particles.emit("explosion", structure.x, structure.y);
        this.emit(GAME_EVENTS.DESTROY, { entity: structure });
        this.emit(GAME_EVENTS.TERRAIN_CHANGED, { structure });
    }

    /** Apply damage to a destructible tile; emits the destroy_tile event on break. */
    damageTileAt(gx, gy, damage) {
        if (!this.map.damageTile(gx, gy, damage)) return;
        this.particles.emit("explosion", gx + 0.5, gy + 0.5);
        this.emit(GAME_EVENTS.DESTROY_TILE, { gx, gy });
        this.emit(GAME_EVENTS.TERRAIN_CHANGED, { gx, gy });
    }

    /** Update watch tower firing (auto-targeting enemies in range). */
    updateWatchTowers(dt) {
        updateWatchTowersSystem(this, dt);
    }

    _updateCamera(cam, tank, dt) {
        updateCamera(cam, tank, dt);
    }
}
