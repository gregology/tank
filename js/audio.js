/**
 * Procedural sound effects via the Web Audio API.
 *
 * All sounds are synthesised at runtime — no audio files needed.
 * Sounds are data-driven: a `SOUNDS` table of synth "voices" (an oscillator
 * or a filtered noise burst, each with an envelope) played through one
 * `play(soundKey)` engine.  Adding a sound is a table row, not a new method.
 *
 * Call `init()` on a user gesture (click / keypress) to unlock the
 * AudioContext, then hook into the Game event bus with `hookIntoGame()`.
 * Menu screens call `play("select")` / `play("confirm")` directly.
 */

import { GAME_EVENTS } from "./events.js";

/**
 * Synth voices, keyed by sound name.
 *
 * Each voice is one of:
 *   { kind: "osc",  wave, freq, to?, sweep?, delay?, peak, decay, dur }
 *   { kind: "noise", filter, q?, freq, to?, sweep?, delay?, peak, decay, dur }
 *
 * `freq` is the start frequency (or the fixed frequency when `to` is
 * omitted); `to` + `sweep` describe an exponential ramp.  `peak`/`decay`
 * describe the gain envelope, and `dur` is the stop time from the voice's
 * own start (after `delay`).
 */
export const SOUNDS = {
    tank: {
        voices: [
            {
                kind: "noise",
                filter: "bandpass",
                q: 2,
                freq: 2500,
                to: 400,
                sweep: 0.1,
                peak: 0.3,
                decay: 0.12,
                dur: 0.15,
            },
            { kind: "osc", wave: "sine", freq: 160, to: 40, sweep: 0.1, peak: 0.35, decay: 0.1, dur: 0.15 },
        ],
    },
    ifv: {
        voices: [
            {
                kind: "noise",
                filter: "bandpass",
                q: 3,
                freq: 3500,
                to: 800,
                sweep: 0.05,
                peak: 0.15,
                decay: 0.06,
                dur: 0.08,
            },
            { kind: "osc", wave: "sine", freq: 220, to: 80, sweep: 0.04, peak: 0.12, decay: 0.05, dur: 0.06 },
        ],
    },
    rifle: {
        voices: [
            {
                kind: "noise",
                filter: "bandpass",
                q: 4,
                freq: 4200,
                to: 1200,
                sweep: 0.04,
                peak: 0.14,
                decay: 0.05,
                dur: 0.07,
            },
        ],
    },
    rpg: {
        voices: [
            {
                kind: "noise",
                filter: "bandpass",
                q: 1.5,
                freq: 900,
                to: 3000,
                sweep: 0.18,
                peak: 0.25,
                decay: 0.22,
                dur: 0.25,
            },
            { kind: "osc", wave: "sine", freq: 140, to: 50, sweep: 0.15, peak: 0.3, decay: 0.18, dur: 0.2 },
        ],
    },
    shotgun: {
        voices: [
            { kind: "noise", filter: "lowpass", freq: 2600, to: 120, sweep: 0.12, peak: 0.4, decay: 0.16, dur: 0.2 },
            { kind: "osc", wave: "sine", freq: 120, to: 30, sweep: 0.12, peak: 0.35, decay: 0.16, dur: 0.18 },
        ],
    },
    droneStrike: {
        voices: [
            { kind: "osc", wave: "sawtooth", freq: 2000, to: 200, sweep: 0.15, peak: 0.2, decay: 0.18, dur: 0.2 },
            {
                kind: "noise",
                filter: "bandpass",
                q: 2,
                freq: 3000,
                to: 200,
                sweep: 0.2,
                delay: 0.05,
                peak: 0.4,
                decay: 0.25,
                dur: 0.3,
            },
        ],
    },
    spg: {
        voices: [
            {
                kind: "noise",
                filter: "bandpass",
                q: 1.5,
                freq: 1800,
                to: 200,
                sweep: 0.25,
                peak: 0.45,
                decay: 0.3,
                dur: 0.35,
            },
            { kind: "osc", wave: "sine", freq: 100, to: 25, sweep: 0.3, peak: 0.5, decay: 0.35, dur: 0.4 },
        ],
    },
    spgLand: {
        voices: [
            { kind: "noise", filter: "lowpass", freq: 3000, to: 60, sweep: 0.5, peak: 0.45, decay: 0.6, dur: 0.7 },
            { kind: "osc", wave: "sine", freq: 70, to: 15, sweep: 0.5, peak: 0.5, decay: 0.55, dur: 0.7 },
        ],
    },
    explosion: {
        voices: [
            { kind: "noise", filter: "lowpass", freq: 4000, to: 80, sweep: 0.6, peak: 0.5, decay: 0.7, dur: 0.8 },
            { kind: "osc", wave: "sine", freq: 90, to: 18, sweep: 0.6, peak: 0.55, decay: 0.6, dur: 0.8 },
        ],
    },
    impact: {
        voices: [{ kind: "noise", filter: "bandpass", q: 3, freq: 3500, peak: 0.12, decay: 0.07, dur: 0.1 }],
    },
    hit: {
        voices: [
            { kind: "osc", wave: "square", freq: 800, to: 200, sweep: 0.15, peak: 0.3, decay: 0.2, dur: 0.25 },
            { kind: "noise", filter: "bandpass", q: 4, freq: 2000, peak: 0.2, decay: 0.1, dur: 0.12 },
        ],
    },
    select: {
        voices: [{ kind: "osc", wave: "sine", freq: 660, peak: 0.15, decay: 0.1, dur: 0.12 }],
    },
    confirm: {
        voices: [
            { kind: "osc", wave: "sine", freq: 520, peak: 0.18, decay: 0.12, dur: 0.15 },
            { kind: "osc", wave: "sine", freq: 780, delay: 0.08, peak: 0.18, decay: 0.12, dur: 0.15 },
        ],
    },
    win: {
        voices: [
            { kind: "osc", wave: "square", freq: 523, peak: 0.12, decay: 0.2, dur: 0.25 },
            { kind: "osc", wave: "square", freq: 659, delay: 0.13, peak: 0.12, decay: 0.2, dur: 0.25 },
            { kind: "osc", wave: "square", freq: 784, delay: 0.26, peak: 0.12, decay: 0.2, dur: 0.25 },
            { kind: "osc", wave: "square", freq: 1047, delay: 0.39, peak: 0.12, decay: 0.2, dur: 0.25 },
        ],
    },
};

export class AudioManager {
    constructor() {
        /** @type {AudioContext|null} */
        this.ctx = null;
        this.initialized = false;
        this.muted = false;
        this._noiseCache = null;
    }

    /* ── lifecycle ─────────────────────────────────────────── */

    /** Must be called from a user-gesture handler (key / click). */
    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this._noiseCache = this._makeNoise(1);
            this.initialized = true;
        } catch (_) {
            /* Web Audio not available – silent mode */
        }
    }

    /** Subscribe to a Game's event bus. */
    hookIntoGame(game) {
        game.on(GAME_EVENTS.FIRE, (d) => this.play(d.sound ?? "tank"));
        game.on(GAME_EVENTS.ARTILLERY_IMPACT, () => this.play("spgLand"));
        game.on(GAME_EVENTS.DRONE_STRIKE, () => this.play("droneStrike"));
        game.on(GAME_EVENTS.DESTROY, () => this.play("explosion"));
        game.on(GAME_EVENTS.DESTROY_TILE, () => this.play("explosion"));
        game.on(GAME_EVENTS.IMPACT, () => this.play("impact"));
        game.on(GAME_EVENTS.HIT, () => this.play("hit"));
        game.on(GAME_EVENTS.WIN, () => this.play("win"));
    }

    /* ── sound engine ──────────────────────────────────────── */

    /** Play a sound by key (a `SOUNDS` entry); unknown keys are a no-op. */
    play(soundKey) {
        if (!this._ok()) return;
        const sound = SOUNDS[soundKey];
        if (!sound) return;
        for (const voice of sound.voices) this._playVoice(voice);
    }

    /** Build one synth voice (oscillator or filtered noise) + its envelope. */
    _playVoice(v) {
        const { ctx } = this;
        const t = ctx.currentTime + (v.delay ?? 0);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(v.peak, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + v.decay);
        gain.connect(ctx.destination);

        let node;
        if (v.kind === "noise") {
            node = this._noiseSrc();
            const filter = ctx.createBiquadFilter();
            filter.type = v.filter;
            if (v.q != null) filter.Q.value = v.q;
            filter.frequency.setValueAtTime(v.freq, t);
            if (v.to != null) filter.frequency.exponentialRampToValueAtTime(v.to, t + v.sweep);
            node.connect(filter);
            filter.connect(gain);
        } else {
            node = ctx.createOscillator();
            node.type = v.wave;
            node.frequency.setValueAtTime(v.freq, t);
            if (v.to != null) node.frequency.exponentialRampToValueAtTime(v.to, t + v.sweep);
            node.connect(gain);
        }

        node.start(t);
        node.stop(t + v.dur);
    }

    /* ── internal helpers ──────────────────────────────────── */

    _ok() {
        return this.initialized && !this.muted;
    }

    /** 1-second white-noise AudioBuffer (cached). */
    _makeNoise(dur) {
        const sr = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, sr * dur, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    /** Reusable noise source node. */
    _noiseSrc() {
        const s = this.ctx.createBufferSource();
        s.buffer = this._noiseCache;
        return s;
    }
}
