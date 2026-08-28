import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Lobby } from "../js/lobby.js";

describe("Lobby – players & teams", () => {
    it("assigns each player their own team in skirmish", () => {
        const lobby = new Lobby();
        lobby.setGameType("skirmish");
        lobby.join({ id: "a" });
        lobby.join({ id: "b" });
        lobby.join({ id: "c" });
        assert.deepEqual(
            lobby.players.map((p) => p.team),
            [1, 2, 3],
        );
    });

    it("assigns alternating RED/BLUE teams in battle", () => {
        const lobby = new Lobby();
        lobby.setGameType("battle");
        lobby.join({ id: "a" });
        lobby.join({ id: "b" });
        lobby.join({ id: "c" });
        assert.deepEqual(
            lobby.players.map((p) => p.team),
            [1, 2, 1],
        );
    });

    it("cycles team across four colours in skirmish", () => {
        const lobby = new Lobby();
        lobby.setGameType("skirmish");
        lobby.join({ id: "a" });
        lobby.cycleTeam(lobby.players[0]); // 1 → 2
        lobby.cycleTeam(lobby.players[0]); // 2 → 3
        lobby.cycleTeam(lobby.players[0]); // 3 → 4
        assert.equal(lobby.players[0].team, 4);
        lobby.cycleTeam(lobby.players[0]); // 4 → 1
        assert.equal(lobby.players[0].team, 1);
    });

    it("cycles team between RED and BLUE in battle", () => {
        const lobby = new Lobby();
        lobby.setGameType("battle");
        lobby.join({ id: "a" });
        assert.equal(lobby.players[0].team, 1);
        lobby.cycleTeam(lobby.players[0]);
        assert.equal(lobby.players[0].team, 2);
        lobby.cycleTeam(lobby.players[0]);
        assert.equal(lobby.players[0].team, 1);
    });

    it("re-defaults teams when the game type changes", () => {
        const lobby = new Lobby();
        lobby.setGameType("skirmish");
        lobby.join({ id: "a" });
        lobby.join({ id: "b" });
        lobby.cycleTeam(lobby.players[1]); // P2 → green in skirmish
        lobby.setGameType("battle");
        assert.deepEqual(
            lobby.players.map((p) => p.team),
            [1, 2],
        );
    });

    it("exposes the host as the first joined player and promotes on leave", () => {
        const lobby = new Lobby();
        lobby.join({ id: "a" });
        lobby.join({ id: "b" });
        assert.equal(lobby.host.device.id, "a");
        lobby.leave(lobby.host);
        assert.equal(lobby.host.device.id, "b");
    });

    it("tracks joined devices", () => {
        const lobby = new Lobby();
        const device = { id: "a" };
        assert.equal(lobby.isJoined(device), false);
        lobby.join(device);
        assert.equal(lobby.isJoined(device), true);
    });
});

describe("Lobby – game type & options", () => {
    it("defaults to battle and toggles the game type via the gameType row", () => {
        const lobby = new Lobby();
        assert.equal(lobby.gameType, "battle");
        const row = lobby.rows()[0];
        assert.equal(row.type, "gameType");
        lobby.changeRow(row, true);
        assert.equal(lobby.gameType, "skirmish");
        lobby.changeRow(lobby.rows()[0], true);
        assert.equal(lobby.gameType, "battle");
    });

    it("cycles the map-size option", () => {
        const lobby = new Lobby();
        lobby.setGameType("battle");
        const mapSize = lobby.rows().find((r) => r.key === "mapSize");
        const before = lobby.optionValues.get("mapSize");
        lobby.changeRow(mapSize, true);
        assert.equal(lobby.optionValues.get("mapSize"), (before + 1) % 3);
    });

    it("shows only map size beside the game type (no hidden unit/density/base options)", () => {
        const lobby = new Lobby();
        assert.deepEqual(
            lobby.rows().map((r) => (r.type === "option" ? r.key : r.type)),
            ["gameType", "mapSize", "start"],
        );
    });
});

describe("Lobby – match resolution", () => {
    it("builds a battle match config with opinionated team size, density, and base type", () => {
        const lobby = new Lobby();
        lobby.join({ id: "a" });
        const match = lobby.buildMatch();
        assert.equal(match.gameType, "battle");
        assert.equal(match.humans.length, 1);
        assert.equal(match.humans[0].team, 1);
        assert.equal(match.humans[0].color, "#cc3333");
        assert.ok(match.settings.mapSize);
        assert.equal(match.settings.teamSize, 24, "medium map → 24 units");
        assert.equal(match.settings.buildingDensity, 1.5, "dense");
        assert.equal(match.settings.baseType, "compound");
    });

    it("resolves a skirmish match with high density and no team size/base", () => {
        const lobby = new Lobby();
        lobby.setGameType("skirmish");
        lobby.join({ id: "a" });
        const match = lobby.buildMatch();
        assert.equal(match.gameType, "skirmish");
        assert.equal(match.settings.buildingDensity, 2, "high");
        assert.equal(match.settings.teamSize, undefined);
        assert.equal(match.settings.baseType, undefined);
    });

    it("resolves a skirmish free-for-all with distinct colours", () => {
        const lobby = new Lobby();
        lobby.setGameType("skirmish");
        lobby.join({ id: "a" });
        lobby.join({ id: "b" });
        lobby.join({ id: "c" });
        const match = lobby.buildMatch();
        assert.deepEqual(
            match.humans.map((h) => h.team),
            [1, 2, 3],
        );
        const colours = new Set(match.humans.map((h) => h.color));
        assert.equal(colours.size, 3);
    });
});
