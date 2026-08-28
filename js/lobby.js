/**
 * Lobby — the pure match-setup state machine.
 *
 * Holds who has joined, which team each player is on, the selected game
 * type, and the pre-game option values.  It resolves all of that into a
 * MatchConfig for Game.  No rendering and no input here — the Menu drives
 * it from device events and draws it.
 */

import {
    GAME_OPTIONS,
    GAME_TYPE_ORDER,
    GAME_TYPES,
    getDefaultOptionValues,
    MAX_PLAYERS,
    opinionatedSettings,
    PLAYER_COLORS,
    resolveSettings,
} from "./config.js";

export class Lobby {
    constructor() {
        /** @type {'skirmish' | 'battle'} */
        this.gameType = "battle";
        /** @type {{device: object, team: number}[]} */
        this.players = [];
        /** Settings-row cursor index (host). */
        this.cursor = 0;
        /** Map<string, number> of current option indices/values. */
        this.optionValues = getDefaultOptionValues(this.gameType);
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

    /* ── game type & options ──────────────────────────────── */

    setGameType(type) {
        if (type === this.gameType) return;
        this.gameType = type;
        this.optionValues = getDefaultOptionValues(type);
        this.cursor = 0;
        // Re-default teams for the new team set (Skirmish = per-colour,
        // Battle = RED/BLUE).
        this.players.forEach((p, i) => {
            p.team = this.defaultTeam(i);
        });
    }

    /** Settings rows: game type, per-type options, then START. */
    rows() {
        const rows = [{ type: "gameType" }];
        for (const key of GAME_TYPES[this.gameType].options) rows.push({ type: "option", key });
        rows.push({ type: "start" });
        return rows;
    }

    changeRow(row, right) {
        if (row.type === "gameType") {
            const idx = GAME_TYPE_ORDER.indexOf(this.gameType);
            this.setGameType(GAME_TYPE_ORDER[(idx + 1) % GAME_TYPE_ORDER.length]);
            return;
        }
        if (row.type !== "option") return;
        const opt = GAME_OPTIONS.find((o) => o.key === row.key);
        if (!opt) return;
        const cur = this.optionValues.get(row.key);
        const n = opt.choices.length;
        const next = right ? (cur + 1) % n : (cur - 1 + n) % n;
        this.optionValues.set(row.key, next);
    }

    /* ── resolution ───────────────────────────────────────── */

    /** Resolve the lobby into a MatchConfig for Game. */
    buildMatch() {
        const mapSizeIndex = this.optionValues.get("mapSize") ?? 0;
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
                ...resolveSettings(this.optionValues),
                ...opinionatedSettings(this.gameType, mapSizeIndex),
            },
        };
    }
}
