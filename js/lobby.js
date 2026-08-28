/**
 * Lobby — the pure match-setup state machine.
 *
 * Holds who has joined, which team each player is on, the selected game
 * type, and the chosen map size.  It resolves all of that into a
 * MatchConfig for Game.  No rendering and no input here — the Menu drives
 * it from device events and draws it.
 */

import { GAME_TYPE_ORDER, GAME_TYPES, MAP_SIZES, MAX_PLAYERS, opinionatedSettings, PLAYER_COLORS } from "./config.js";

export class Lobby {
    constructor() {
        /** @type {'skirmish' | 'battle'} */
        this.gameType = "battle";
        /** @type {{device: object, team: number}[]} */
        this.players = [];
        /** Settings-row cursor index (host): 0 = game type, 1 = map size, 2 = start. */
        this.cursor = 0;
        /** Index into MAP_SIZES (0 = small, 1 = medium, 2 = large). */
        this.mapSizeIndex = 1;
    }

    /* ── players & teams ──────────────────────────────────── */

    /** The lowest-numbered joined player (the host). */
    get host() {
        return this.players[0] ?? null;
    }

    isJoined(device) {
        return this.players.some((p) => p.device === device);
    }

    join(device) {
        const i = this.players.length;
        this.players.push({ device, team: this.defaultTeam(i) });
    }

    leave(player) {
        const i = this.players.indexOf(player);
        if (i >= 0) this.players.splice(i, 1);
    }

    /** The team-assignment rule for the current game type (see GAME_TYPES). */
    get teamSet() {
        return GAME_TYPES[this.gameType].teamSet;
    }

    cycleTeam(player) {
        if (this.teamSet === "two") {
            player.team = player.team === 1 ? 2 : 1;
        } else {
            player.team = (player.team % MAX_PLAYERS) + 1;
        }
    }

    defaultTeam(joinIndex) {
        return this.teamSet === "two" ? (joinIndex % 2) + 1 : joinIndex + 1;
    }

    /* ── game type & map size ─────────────────────────────── */

    setGameType(type) {
        if (type === this.gameType) return;
        this.gameType = type;
        this.cursor = 0;
        // Re-default teams for the new team set (Skirmish = per-colour,
        // Battle = RED/BLUE).
        this.players.forEach((p, i) => {
            p.team = this.defaultTeam(i);
        });
    }

    /** Settings rows: game type, map size, then START. */
    rows() {
        return [{ type: "gameType" }, { type: "mapSize" }, { type: "start" }];
    }

    changeRow(row, right) {
        if (row.type === "gameType") {
            const idx = GAME_TYPE_ORDER.indexOf(this.gameType);
            this.setGameType(GAME_TYPE_ORDER[(idx + 1) % GAME_TYPE_ORDER.length]);
            return;
        }
        if (row.type === "mapSize") {
            const n = MAP_SIZES.length;
            this.mapSizeIndex = right ? (this.mapSizeIndex + 1) % n : (this.mapSizeIndex - 1 + n) % n;
        }
    }

    /* ── resolution ───────────────────────────────────────── */

    /** Resolve the lobby into a MatchConfig for Game. */
    buildMatch() {
        const { w, h } = MAP_SIZES[this.mapSizeIndex];
        return {
            gameType: this.gameType,
            humans: this.players.map((p, i) => {
                const col = PLAYER_COLORS[p.team - 1];
                return {
                    device: p.device,
                    color: col.color,
                    darkColor: col.darkColor,
                    label: `P${i + 1}`,
                    team: p.team,
                };
            }),
            settings: {
                mapSize: { w, h },
                ...opinionatedSettings(this.gameType, this.mapSizeIndex),
            },
        };
    }
}
