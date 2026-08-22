import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, MAX_PLAYERS } from "../js/config.js";
import { Menu } from "../js/menu.js";
import { fakeCtx } from "./helpers.js";

/* ── Fake devices / input ─────────────────────────────────── */

/**
 * A one-shot fake device: `press(action)` arms a pending edge that is
 * consumed (returns true once) by the next `wasPressed` call — matching
 * real input semantics across frames.
 */
function makeDevice() {
    const pending = new Set();
    return {
        pending,
        isDown: () => false,
        analog: () => 0,
        wasPressed: (a) => {
            if (!pending.has(a)) return false;
            pending.delete(a);
            return true;
        },
        press: (a) => pending.add(a),
    };
}

/** Standard input bundle: a keyboard + gamepads. */
function input(keyboard, ...gamepads) {
    return { keyboard, connectedGamepads: gamepads };
}

function spyAudio() {
    const calls = [];
    return {
        calls,
        init: () => calls.push("init"),
        playConfirm: () => calls.push("playConfirm"),
        playSelect: () => calls.push("playSelect"),
    };
}

const canvas = { width: 800, height: 600 };

describe("Menu – main screen", () => {
    it("starts on the main screen with a fresh lobby", () => {
        const menu = new Menu();
        assert.equal(menu._screen, "main");
        assert.equal(menu.confirmed, false);
        assert.equal(menu.match, null);
        assert.equal(menu.lobby.players.length, 0);
    });

    it("stays on main with no input", () => {
        const menu = new Menu();
        const kb = makeDevice();
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._screen, "main");
    });

    it("confirm joins P1 and enters the lobby", () => {
        const menu = new Menu();
        const audio = spyAudio();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), audio);
        assert.equal(menu._screen, "lobby");
        assert.equal(menu.lobby.players.length, 1);
        assert.equal(menu.lobby.host.device, menu.lobby.players[0].device);
        assert.ok(audio.calls.includes("init"));
        assert.ok(audio.calls.includes("playConfirm"));
    });

    it("back opens the vehicle info screen", () => {
        const menu = new Menu();
        const audio = spyAudio();
        const kb = makeDevice();
        kb.press(ACTIONS.back);
        menu.update(0.016, input(kb), audio);
        assert.equal(menu._screen, "about");
        assert.equal(menu._aboutIndex, 0);
        assert.ok(audio.calls.includes("playConfirm"));
    });
});

describe("Menu – about screen", () => {
    it("left/right cycle vehicles and wrap", () => {
        const menu = new Menu();
        menu._screen = "about";
        const kb = makeDevice();
        kb.press(ACTIONS.right);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._aboutIndex, 1);
        kb.press(ACTIONS.left);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._aboutIndex, 0);
    });

    it("confirm or back returns to main", () => {
        const menu = new Menu();
        menu._screen = "about";
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._screen, "main");
    });
});

describe("Menu – lobby", () => {
    it("second player joins via gamepad confirm", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const gp = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        assert.equal(menu.lobby.players.length, 1);
        gp.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        assert.equal(menu.lobby.players.length, 2);
    });

    it("caps joins at MAX_PLAYERS", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const pads = [makeDevice(), makeDevice(), makeDevice(), makeDevice(), makeDevice()];
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, ...pads), spyAudio());
        // All five pads press confirm in the same frame; only MAX_PLAYERS-1 join.
        for (const pad of pads) pad.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, ...pads), spyAudio());
        assert.equal(menu.lobby.players.length, MAX_PLAYERS);
    });

    it("non-host cycles team with cycleTeam", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const gp = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        gp.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        const [p1, p2] = menu.lobby.players;
        const teamBefore = p2.team;
        gp.press(ACTIONS.cycleTeam);
        menu.update(0.016, input(kb, gp), spyAudio());
        assert.notEqual(p2.team, teamBefore);
        assert.equal(p1.team, 1); // host untouched
    });

    it("non-host can leave with back", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const gp = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        gp.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        assert.equal(menu.lobby.players.length, 2);
        gp.press(ACTIONS.back);
        menu.update(0.016, input(kb, gp), spyAudio());
        assert.equal(menu.lobby.players.length, 1);
    });

    it("host navigates settings rows with up/down", () => {
        const menu = new Menu();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        const rows = menu.lobby.rows();
        kb.press(ACTIONS.down);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu.lobby.cursor, 1);
        kb.press(ACTIONS.up);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu.lobby.cursor, 0);
        assert.equal(rows[0].type, "gameType");
    });

    it("host toggles the game type with left/right on the gameType row", () => {
        const menu = new Menu();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu.lobby.gameType, "skirmish");
        kb.press(ACTIONS.right);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu.lobby.gameType, "battle");
        kb.press(ACTIONS.left);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu.lobby.gameType, "skirmish");
    });

    it("host changing an option row updates optionValues", () => {
        const menu = new Menu();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        kb.press(ACTIONS.down); // cursor → mapSize
        menu.update(0.016, input(kb), spyAudio());
        const rows = menu.lobby.rows();
        const before = menu.lobby.optionValues.get("mapSize");
        kb.press(ACTIONS.right);
        menu.update(0.016, input(kb), spyAudio());
        assert.notEqual(menu.lobby.optionValues.get("mapSize"), before);
        assert.equal(rows[menu.lobby.cursor].key, "mapSize");
    });

    it("host confirming the start row builds a match", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const gp = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        gp.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());

        // Move cursor to the START row (last row), then confirm.
        const startIndex = menu.lobby.rows().findIndex((r) => r.type === "start");
        for (let i = 0; i < startIndex; i++) {
            kb.press(ACTIONS.down);
            menu.update(0.016, input(kb, gp), spyAudio());
        }
        assert.equal(menu.lobby.cursor, startIndex);
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());

        assert.equal(menu.confirmed, true);
        assert.ok(menu.match, "match built");
        assert.equal(menu.match.gameType, "skirmish");
        assert.equal(menu.match.humans.length, 2);
        assert.ok(menu.match.settings, "settings resolved");
    });

    it("host leaving with no players returns to main", () => {
        const menu = new Menu();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._screen, "lobby");
        kb.press(ACTIONS.back);
        menu.update(0.016, input(kb), spyAudio());
        assert.equal(menu._screen, "main");
        assert.equal(menu.lobby.players.length, 0);
    });
});

describe("Menu – reset", () => {
    it("reset clears confirmation and lobby", () => {
        const menu = new Menu();
        const kb = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb), spyAudio());
        menu.startMatch();
        assert.equal(menu.confirmed, true);
        menu.reset();
        assert.equal(menu.confirmed, false);
        assert.equal(menu.match, null);
        assert.equal(menu._screen, "main");
        assert.equal(menu.lobby.players.length, 0);
    });
});

describe("Menu – rendering", () => {
    it("renders the main screen without throwing", () => {
        const menu = new Menu();
        const { ctx } = fakeCtx();
        assert.doesNotThrow(() => menu.render(ctx, canvas));
    });

    it("renders the lobby with joined players", () => {
        const menu = new Menu();
        const kb = makeDevice();
        const gp = makeDevice();
        kb.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        gp.press(ACTIONS.confirm);
        menu.update(0.016, input(kb, gp), spyAudio());
        const { ctx, calls } = fakeCtx();
        assert.doesNotThrow(() => menu.render(ctx, canvas));
        assert.ok(calls.length > 0, "draw calls happened");
    });

    it("renders the about screen for every vehicle (stat compare)", () => {
        const menu = new Menu();
        menu._screen = "about";
        const { ctx } = fakeCtx();
        for (let i = 0; i < 5; i++) {
            menu._aboutIndex = i;
            assert.doesNotThrow(() => menu.render(ctx, canvas), `about vehicle ${i}`);
        }
    });
});
