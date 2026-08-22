import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioManager, SOUNDS } from "../js/audio.js";

/**
 * A recording fake AudioContext: every node factory returns a node that
 * records its calls and its frequency/gain/Q param writes.  Enough of the
 * Web Audio surface for AudioManager's synthesised sounds to run and be
 * asserted (nodes created / started / connected to destination).
 */
function fakeAudioContext() {
    const nodes = [];
    const makeParam = () => ({
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
    });
    const makeNode = (kind) => {
        const node = {
            kind,
            connect: (target) => {
                node.connectedTo = target;
                return target ?? node;
            },
            start: () => {
                node.started = true;
            },
            stop: () => {
                node.stopped = true;
            },
            frequency: makeParam(),
            gain: makeParam(),
            Q: makeParam(),
            type: "",
            buffer: null,
        };
        nodes.push(node);
        return node;
    };
    const ctx = {
        currentTime: 1.0,
        sampleRate: 44100,
        destination: { kind: "destination" },
        nodes,
        createBiquadFilter: () => makeNode("biquad"),
        createGain: () => makeNode("gain"),
        createOscillator: () => makeNode("oscillator"),
        createBufferSource: () => makeNode("source"),
        createBuffer: (_channels, length) => ({
            getChannelData: () => new Float32Array(length),
        }),
    };
    return ctx;
}

/** Install a fake `window` with a fake AudioContext for one test. */
function withAudioContext(fn) {
    const realWindow = globalThis.window;
    const ctx = fakeAudioContext();
    globalThis.window = {
        AudioContext: function FakeAudioContext() {
            return ctx;
        },
        webkitAudioContext: undefined,
    };
    try {
        fn(ctx);
    } finally {
        if (realWindow === undefined) delete globalThis.window;
        else globalThis.window = realWindow;
    }
}

/** Spy on `play`, recording every sound key it is asked to play. */
function spyOnPlay(audio) {
    const played = [];
    const original = audio.play.bind(audio);
    audio.play = (key) => {
        played.push(key);
        return original(key);
    };
    return played;
}

describe("AudioManager – lifecycle", () => {
    it("starts uninitialised and unmuted", () => {
        const a = new AudioManager();
        assert.equal(a.initialized, false);
        assert.equal(a.muted, false);
        assert.equal(a.ctx, null);
    });

    it("init creates an AudioContext and noise cache", () => {
        withAudioContext((ctx) => {
            const a = new AudioManager();
            a.init();
            assert.ok(a.initialized);
            assert.equal(a.ctx, ctx);
            assert.ok(a._noiseCache, "noise cache built");
        });
    });

    it("init is idempotent", () => {
        withAudioContext((ctx) => {
            const a = new AudioManager();
            a.init();
            a.init();
            assert.equal(a.ctx, ctx);
        });
    });

    it("init degrades silently when Web Audio is unavailable", () => {
        const realWindow = globalThis.window;
        globalThis.window = undefined;
        try {
            const a = new AudioManager();
            assert.doesNotThrow(() => a.init());
            assert.equal(a.initialized, false);
            assert.equal(a.ctx, null);
        } finally {
            if (realWindow === undefined) delete globalThis.window;
            else globalThis.window = realWindow;
        }
    });

    it("init degrades silently when the AudioContext constructor throws", () => {
        const realWindow = globalThis.window;
        globalThis.window = {
            AudioContext: function BadContext() {
                throw new Error("no audio device");
            },
        };
        try {
            const a = new AudioManager();
            assert.doesNotThrow(() => a.init());
            assert.equal(a.initialized, false);
        } finally {
            if (realWindow === undefined) delete globalThis.window;
            else globalThis.window = realWindow;
        }
    });

    it("muted plays nothing", () => {
        withAudioContext((ctx) => {
            const a = new AudioManager();
            a.init();
            a.muted = true;
            const before = ctx.nodes.length;
            a.play("tank");
            a.play("explosion");
            a.play("win");
            assert.equal(ctx.nodes.length, before);
        });
    });
});

describe("AudioManager – sound effects", () => {
    it("every sound synthesises nodes through the play() engine", () => {
        withAudioContext((ctx) => {
            const a = new AudioManager();
            a.init();
            for (const key of Object.keys(SOUNDS)) {
                const before = ctx.nodes.length;
                assert.doesNotThrow(() => a.play(key), key);
                assert.ok(ctx.nodes.length > before, `${key} created nodes`);
                assert.ok(
                    ctx.nodes.some((n) => n.started),
                    `${key} started nodes`,
                );
            }
        });
    });

    it("unknown sound keys are a no-op", () => {
        withAudioContext((ctx) => {
            const a = new AudioManager();
            a.init();
            const before = ctx.nodes.length;
            a.play("notARealSound");
            assert.equal(ctx.nodes.length, before);
        });
    });

    it("play is a no-op before init", () => {
        const a = new AudioManager();
        assert.doesNotThrow(() => a.play("tank"));
        assert.doesNotThrow(() => a.play("win"));
    });
});

describe("AudioManager – event wiring", () => {
    it("maps the full game event vocabulary to sounds", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            a.init();
            const played = spyOnPlay(a);

            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);

            const emit = (event, data) => handlers.get(event)?.(data);
            emit("fire", { sound: "tank" });
            emit("artillery_impact", {});
            emit("drone_strike", {});
            emit("destroy", {});
            emit("destroy_tile", {});
            emit("impact", {});
            emit("hit", {});
            emit("win", {});

            assert.deepEqual(played, [
                "tank",
                "spgLand",
                "droneStrike",
                "explosion",
                "explosion",
                "impact",
                "hit",
                "win",
            ]);
        });
    });

    it("plays the fire event's sound key", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            a.init();
            const played = spyOnPlay(a);

            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);
            const fire = (d) => handlers.get("fire")(d);

            fire({ sound: "rpg" });
            fire({ sound: "shotgun" });
            fire({ sound: "rifle" });
            fire({ sound: "spg" });
            fire({ sound: "ifv" });
            assert.deepEqual(played, ["rpg", "shotgun", "rifle", "spg", "ifv"]);
        });
    });

    it("defaults the fire sound to tank when the payload carries none", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            a.init();
            const played = spyOnPlay(a);
            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);
            handlers.get("fire")({});
            assert.deepEqual(played, ["tank"]);
        });
    });
});
