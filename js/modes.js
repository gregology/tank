/**
 * Game-mode strategies — the Skirmish vs Battle branching in Game.
 *
 * A mode is a plain strategy object with hooks for everything the two
 * modes do differently; the shared simulation loop (movement, firing,
 * bullets, separation) stays in Game.  GAME_TYPES declares *what* each
 * mode is (win, teamSet, bases, vehicles, options); these objects
 * implement *how* it behaves at runtime.
 *
 * Hooks (all take the Game as the first argument):
 *   hasBases         whether compounds/towers/HQ exist
 *   init(game)       mode-specific construction (battle: compounds)
 *   spawn(game)      where tanks start
 *   setupBot(game, bot, faction)   bot initialisation (battle: friendly base)
 *   aiObjective(game, bot)         what a bot navigates toward
 *   enemyStructures(game, tank)    enemy structures a bot may target
 *   afterSeparation(game)          per-frame step after separation
 *   afterBullets(game, dt)         per-frame step after bullet hits
 *   respawn(game, tank)            spawn point for a respawning tank
 *                                  (null = keep the current position)
 *   onKill(game, killerTeam, deadTank)   kill credit / scoring
 *   checkWin(game)                 winning faction id, or null
 *   factionLabel(game, faction) / winnerLabel(game, faction)
 *                                  HUD labels
 *
 * Adding a third mode: a GAME_TYPES entry + one strategy object here,
 * no new `if (gameType)` sprinkles in Game.
 */

import { CONFIG, PLAYER_COLORS } from "./config.js";
import { Base, BaseHQ, BaseWall, BaseWatchTower } from "./entity.js";

/* ── entity construction (battle only) ───────────────────── */

/** Build a Base compound entity tree from map layout data. */
function buildBase(layout, team, color, darkColor) {
    const base = new Base(team, color, darkColor);
    base.center = layout.center;
    base.origin = { x: layout.ox, y: layout.oy };
    base.entranceDir = layout.dir;
    base.compoundSize = layout.size;

    const hq = new BaseHQ(team, color, darkColor);
    hq.x = layout.hqCenter.x;
    hq.y = layout.hqCenter.y;
    hq.tilePositions = layout.hqTiles.map((t) => ({ gx: t.gx, gy: t.gy }));
    base.hq = hq;

    for (const pos of layout.walls) {
        const w = new BaseWall(team, color, darkColor);
        w.x = pos.gx + 0.5;
        w.y = pos.gy + 0.5;
        w.tilePositions = [{ gx: pos.gx, gy: pos.gy }];
        base.walls.push(w);
    }

    for (const pos of layout.towers) {
        const t = new BaseWatchTower(team, color, darkColor);
        t.x = pos.gx + 0.5;
        t.y = pos.gy + 0.5;
        t.tilePositions = [{ gx: pos.gx, gy: pos.gy }];
        base.towers.push(t);
    }

    return base;
}

/* ── shared Skirmish label logic ─────────────────────────── */

/** P1/P2 label, or BOT for a bot faction, or the colour label for a team. */
function playerLabelFor(game, faction, winner) {
    const humans = game.humanTanks.filter((t) => t.team === faction.id);
    if (humans.length === 1) {
        const n = game.humanTanks.indexOf(humans[0]) + 1;
        return winner ? `PLAYER ${n}` : `P${n}`;
    }
    if (humans.length === 0) return "BOT";
    const col = PLAYER_COLORS.find((c) => c.color === faction.color);
    const label = col?.label ?? "TEAM";
    return winner ? `${label} TEAM` : label;
}

/* ═══════════════════════════════════════════════════════════ *
 *  Skirmish — score race, no bases                            *
 * ═══════════════════════════════════════════════════════════ */

const skirmish = {
    hasBases: false,

    init(_game) {},

    /** Spread everyone out, then face the nearest enemy. */
    spawn(game) {
        let lastX = -1,
            lastY = -1;
        for (const t of game.allTanks) {
            const sp = game.map.getSpawnPoint(lastX, lastY);
            t.respawnAt(sp.x, sp.y);
            t.alive = true;
            lastX = sp.x;
            lastY = sp.y;
        }
        for (const t of game.allTanks) {
            const enemy = game.nearestEnemy(t);
            if (enemy) t.angle = Math.atan2(enemy.y - t.y, enemy.x - t.x) + (Math.random() - 0.5) * 0.3;
        }
    },

    setupBot(_game, _bot, _faction) {},

    aiObjective(_game, _bot) {
        return null;
    },

    enemyStructures(_game, _tank) {
        return [];
    },

    afterSeparation(_game) {},

    afterBullets(_game, _dt) {},

    /** Skirmish positions the respawn when the tank is killed (see onKill). */
    respawn(_game, _tank) {
        return null;
    },

    /** Kill credit → score; the dead tank's respawn spot is reserved now. */
    onKill(game, killerTeam, deadTank) {
        game.creditKill(killerTeam);
        const sp = game.map.getSpawnPoint();
        deadTank.respawnAt(sp.x, sp.y);
    },

    /** First faction to WIN_SCORE kills. */
    checkWin(game) {
        for (const [factionId, score] of game.scores) {
            if (score >= CONFIG.WIN_SCORE) return factionId;
        }
        return null;
    },

    factionLabel(game, faction) {
        return playerLabelFor(game, faction, false);
    },

    winnerLabel(game, faction) {
        return playerLabelFor(game, faction, true);
    },
};

/* ═══════════════════════════════════════════════════════════ *
 *  Battle — base objective: destroy the enemy HQ              *
 * ═══════════════════════════════════════════════════════════ */

const battle = {
    hasBases: true,

    /** Build both factions' compounds and register their structures. */
    init(game) {
        const baseType = game.settings.baseType ?? "compound";
        const [layout1, layout2] = game.map.buildBaseCompounds(baseType);
        game.setBases([
            buildBase(layout1, 1, game.factions[0].color, game.factions[0].darkColor),
            buildBase(layout2, 2, game.factions[1].color, game.factions[1].darkColor),
        ]);
    },

    /** Spawn inside each faction's compound, facing the enemy base. */
    spawn(game) {
        for (const f of game.factions) {
            const base = game.bases.find((b) => b.team === f.id);
            const enemyBase = game.bases.find((b) => b.team !== f.id);
            if (!base) continue;
            for (const t of f.entities) {
                const sp = game.map.getBaseSpawnPoint(base.center.x, base.center.y);
                t.respawnAt(sp.x, sp.y);
                t.alive = true;
                t.angle = enemyBase
                    ? Math.atan2(enemyBase.y - base.y, enemyBase.x - base.x) + (Math.random() - 0.5) * 0.5
                    : Math.random() * Math.PI * 2;
            }
        }
    },

    setupBot(game, bot, faction) {
        bot.ai.friendlyBase = game.bases.find((b) => b.team === faction.id) ?? null;
    },

    /** Bots navigate toward the enemy base while it is alive. */
    aiObjective(game, bot) {
        const enemyBase = game.bases.find((b) => b.team !== bot.tank.team);
        return enemyBase?.alive ? enemyBase : null;
    },

    enemyStructures(game, tank) {
        return game.bases.find((b) => b.team !== tank.team)?.allStructures ?? [];
    },

    /** Tanks must not end up inside the compound walls. */
    afterSeparation(game) {
        game.pushFromStructures();
    },

    afterBullets(game, dt) {
        game.updateWatchTowers(dt);
    },

    /** Respawn inside the compound, or anywhere if the base is gone. */
    respawn(game, tank) {
        const base = game.bases.find((b) => b.team === tank.team);
        return base?.alive ? game.map.getBaseSpawnPoint(base.center.x, base.center.y) : game.map.getSpawnPoint();
    },

    /** No scoring — timed respawns are handled by Game._handleRespawns. */
    onKill(_game, _killerTeam, _deadTank) {},

    /** Destroying the enemy HQ wins — the surviving faction takes it. */
    checkWin(game) {
        const dead = game.bases.find((b) => !b.alive);
        if (!dead) return null;
        return game.bases.find((b) => b !== dead)?.team ?? (dead.team === 1 ? 2 : 1);
    },

    factionLabel(_game, faction) {
        return faction.id === 1 ? "RED" : "BLUE";
    },

    winnerLabel(_game, faction) {
        return faction.id === 1 ? "RED TEAM" : "BLUE TEAM";
    },
};

export const MODES = { skirmish, battle };

/** Look up the mode strategy for a game type (defaults to skirmish). */
export function getMode(gameType) {
    return MODES[gameType] ?? skirmish;
}
