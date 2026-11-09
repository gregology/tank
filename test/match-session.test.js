import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS as A, CONFIG } from "../js/config.js";
import { MatchSession } from "../js/match-session.js";

const DT = 1 / 60;

function makeDevice() {
    const pressed = new Set();
    return {
        press: (action) => pressed.add(action),
        endFrame: () => pressed.clear(),
        wasPressed: (action) => pressed.has(action),
        isDown: () => false,
        analog: () => 0,
    };
}

function setup() {
    const players = [makeDevice(), makeDevice()];
    const stranger = makeDevice();
    const keyboard = makeDevice();
    const input = { keyboard, connectedGamepads: [...players, stranger] };
    const audioCalls = [];
    const audio = { init: () => audioCalls.push("init"), hookIntoGame: () => audioCalls.push("hook") };
    const humans = players.map((device, i) => ({
        device,
        color: "#c33",
        darkColor: "#811",
        label: `P${i + 1}`,
        team: i + 1,
    }));
    const session = new MatchSession(
        { gameType: "skirmish", humans, settings: { mapSize: { w: 40, h: 40 }, buildingDensity: 0, seed: 1 } },
        audio,
    );
    const frame = () => {
        const stillPlaying = session.update(DT, input);
        for (const device of [...players, stranger, keyboard]) device.endFrame();
        return stillPlaying;
    };
    return { session, players, stranger, keyboard, frame, audioCalls };
}

function endMatch(session) {
    session.game.gameOver = true;
    session.game.winner = 1;
}

/** Frames until the result screen accepts input, plus a margin for float rounding. */
const LOCK_FRAMES = Math.ceil(CONFIG.GAME_OVER_INPUT_LOCK_SECONDS / DT) + 2;

describe("pausing", () => {
    it("stops the simulation and resumes it", () => {
        const { session, players, frame } = setup();
        frame();
        const before = session.game.gameTime;
        assert.ok(before > 0, "a running match should advance");

        players[1].press(A.pause);
        frame();
        for (let i = 0; i < 30; i++) frame();
        assert.ok(session.paused);
        assert.equal(session.game.gameTime, before);
        assert.equal(session.pausedByLabel, "P2");

        players[1].press(A.confirm);
        frame();
        assert.ok(!session.paused);
        frame();
        assert.ok(session.game.gameTime > before);
    });

    it("ignores another player firing, which is also confirm, while paused", () => {
        const { session, players, frame } = setup();
        players[0].press(A.pause);
        frame();
        players[1].press(A.confirm);
        frame();
        assert.ok(session.paused);
    });

    it("lets only the player who paused quit", () => {
        const { players, frame } = setup();
        players[0].press(A.pause);
        frame();
        players[1].press(A.back);
        assert.equal(frame(), true);
        players[0].press(A.back);
        assert.equal(frame(), false);
    });

    it("lets anyone end a pause, in case the pauser's controller has died", () => {
        const { session, players, frame } = setup();
        players[0].press(A.pause);
        frame();
        players[1].press(A.pause);
        frame();
        assert.ok(!session.paused);
    });

    it("has no player to name when an unjoined controller pauses", () => {
        const { session, stranger, frame } = setup();
        stranger.press(A.pause);
        frame();
        assert.ok(session.paused);
        assert.equal(session.pausedByLabel, null);
    });

    it("doesn't pause on the result screen, where Start means rematch", () => {
        const { session, players, frame } = setup();
        endMatch(session);
        players[0].press(A.pause);
        frame();
        assert.ok(!session.paused);
    });
});

describe("the result screen", () => {
    it("ignores presses at first, so someone mashing fire still sees who won", () => {
        const { session, players, frame } = setup();
        endMatch(session);
        const game = session.game;
        for (let i = 0; i < LOCK_FRAMES - 4; i++) {
            players[0].press(A.confirm);
            players[1].press(A.back);
            assert.equal(frame(), true, `left the match on frame ${i}`);
        }
        assert.equal(session.game, game);
        assert.ok(session.game.gameOver, "rematched too early");
        assert.ok(!session.resultPromptsReady);
    });

    it("rematches on confirm once input is accepted, and locks the next result too", () => {
        const { session, players, frame, audioCalls } = setup();
        endMatch(session);
        for (let i = 0; i < LOCK_FRAMES; i++) frame();
        assert.ok(session.resultPromptsReady);

        players[0].press(A.confirm);
        assert.equal(frame(), true);
        assert.ok(!session.game.gameOver);
        assert.ok(audioCalls.includes("init"));

        endMatch(session);
        assert.ok(!session.resultPromptsReady);
    });

    it("leaves on back once input is accepted", () => {
        const { session, players, frame } = setup();
        endMatch(session);
        for (let i = 0; i < LOCK_FRAMES; i++) frame();
        players[1].press(A.back);
        assert.equal(frame(), false);
    });

    it("subscribes audio to the match", () => {
        assert.ok(setup().audioCalls.includes("hook"));
    });
});
