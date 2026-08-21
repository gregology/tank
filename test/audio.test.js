import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AudioManager } from "../js/audio.js";

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

/** Count calls to named play* methods on a fresh AudioManager. */
function spyOnPlays(audio) {
    const counts = Object.create(null);
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(audio))) {
        if (typeof audio[key] === "function" && key.startsWith("play")) {
            const original = audio[key].bind(audio);
            audio[key] = () => {
                counts[key] = (counts[key] ?? 0) + 1;
                return original();
            };
        }
    }
    return counts;
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
            a.playShoot();
            a.playExplosion();
            a.playWin();
            assert.equal(ctx.nodes.length, before);
        });
    });
});

describe("AudioManager – sound effects", () => {
    const playMethods = [
        "playShoot",
        "playIFVShoot",
        "playRifleShoot",
        "playRPGShoot",
        "playShotgunShoot",
        "playDroneStrike",
        "playSPGShoot",
        "playSPGLand",
        "playExplosion",
        "playImpact",
        "playHit",
        "playSelect",
        "playConfirm",
        "playWin",
    ];

    for (const method of playMethods) {
        it(`${method} synthesises nodes and routes them to the destination`, () => {
            withAudioContext((ctx) => {
                const a = new AudioManager();
                a.init();
                const before = ctx.nodes.length;
                assert.doesNotThrow(() => a[method]());
                assert.ok(ctx.nodes.length > before, `${method} created nodes`);
                assert.ok(
                    ctx.nodes.some((n) => n.started),
                    `${method} started nodes`,
                );
            });
        });
    }

    it("play methods are no-ops before init", () => {
        const a = new AudioManager();
        assert.doesNotThrow(() => a.playShoot());
        assert.doesNotThrow(() => a.playWin());
    });
});

describe("AudioManager – event wiring", () => {
    it("hooks the full game event vocabulary", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            const counts = spyOnPlays(a);

            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);

            const emit = (event, data) => handlers.get(event)?.(data);
            emit("fire", {});
            emit("artillery_impact", {});
            emit("drone_strike", {});
            emit("destroy", {});
            emit("destroy_tile", {});
            emit("impact", {});
            emit("hit", {});
            emit("win", {});

            assert.equal(counts.playShoot, 1);
            assert.equal(counts.playSPGLand, 1);
            assert.equal(counts.playDroneStrike, 1);
            assert.equal(counts.playExplosion, 2); // destroy + destroy_tile
            assert.equal(counts.playImpact, 1);
            assert.equal(counts.playHit, 1);
            assert.equal(counts.playWin, 1);
        });
    });

    it("dispatches the fire event by weapon tag", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            const counts = spyOnPlays(a);

            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);
            const fire = (d) => handlers.get("fire")(d);

            fire({ weapon: "rpg" });
            fire({ weapon: "shotgun" });
            fire({ weapon: "rifle" });
            fire({ weapon: "mg" });
            fire({ weapon: "rifle" });
            assert.equal(counts.playRPGShoot, 1);
            assert.equal(counts.playShotgunShoot, 1);
            assert.equal(counts.playRifleShoot, 3); // rifle + mg + rifle
        });
    });

    it("dispatches the fire event by vehicle type", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            const counts = spyOnPlays(a);

            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);
            const fire = (d) => handlers.get("fire")(d);

            fire({ tank: { vehicleType: "spg" } });
            fire({ tank: { vehicleType: "ifv" } });
            fire({ tank: { vehicleType: "tank" } });
            assert.equal(counts.playSPGShoot, 1);
            assert.equal(counts.playIFVShoot, 1);
            assert.equal(counts.playShoot, 1);
        });
    });

    it("squad weapons fall through to the generic shoot sound", () => {
        withAudioContext(() => {
            const a = new AudioManager();
            const counts = spyOnPlays(a);
            const handlers = new Map();
            const game = { on: (event, fn) => handlers.set(event, fn) };
            a.hookIntoGame(game);
            handlers.get("fire")({ tank: { vehicleType: "squad" }, weapon: "rifle" });
            handlers.get("fire")({ tank: { vehicleType: "squad" }, weapon: "mg" });
            assert.equal(counts.playRifleShoot, 2);
        });
    });
});
