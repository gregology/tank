/**
 * Procedural sound effects via the Web Audio API.
 *
 * All sounds are synthesised at runtime — no audio files needed.
 * Call `init()` on a user gesture (click / keypress) to unlock the
 * AudioContext, then hook into the Game event bus with `hookIntoGame()`.
 */

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
        } catch (_) { /* Web Audio not available – silent mode */ }
    }

    /** Subscribe to a Game's event bus. */
    hookIntoGame(game) {
        game.on('fire', (d) => {
            if (d.tank?.vehicleType === 'ifv') this.playIFVShoot();
            else this.playShoot();
        });
        game.on('destroy',      () => this.playExplosion());
        game.on('destroy_tile', () => this.playExplosion());
        game.on('impact',       () => this.playImpact());
        game.on('hit',          () => this.playHit());
        game.on('win',          () => this.playWin());
    }

    /* ── sound effects ─────────────────────────────────────── */

    playShoot() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;

        // Noise burst through bandpass sweep
        const n = this._noiseSrc();
        const nf = ctx.createBiquadFilter();
        nf.type = 'bandpass'; nf.Q.value = 2;
        nf.frequency.setValueAtTime(2500, t);
        nf.frequency.exponentialRampToValueAtTime(400, t + 0.1);
        const ng = this._env(t, 0.3, 0.12);
        n.connect(nf).connect(ng).connect(ctx.destination);
        n.start(t); n.stop(t + 0.15);

        // Low thud
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(160, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        const og = this._env(t, 0.35, 0.1);
        o.connect(og).connect(ctx.destination);
        o.start(t); o.stop(t + 0.15);
    }

    /** Lighter, snappier autocannon sound for IFV rapid fire. */
    playIFVShoot() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;

        // Quick high-frequency crack
        const n = this._noiseSrc();
        const nf = ctx.createBiquadFilter();
        nf.type = 'bandpass'; nf.Q.value = 3;
        nf.frequency.setValueAtTime(3500, t);
        nf.frequency.exponentialRampToValueAtTime(800, t + 0.05);
        const ng = this._env(t, 0.15, 0.06);
        n.connect(nf).connect(ng).connect(ctx.destination);
        n.start(t); n.stop(t + 0.08);

        // Tiny thud (much lighter than tank)
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.04);
        const og = this._env(t, 0.12, 0.05);
        o.connect(og).connect(ctx.destination);
        o.start(t); o.stop(t + 0.06);
    }

    playExplosion() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;

        // Long noise burst
        const n = this._noiseSrc();
        const nf = ctx.createBiquadFilter();
        nf.type = 'lowpass';
        nf.frequency.setValueAtTime(4000, t);
        nf.frequency.exponentialRampToValueAtTime(80, t + 0.6);
        const ng = this._env(t, 0.5, 0.7);
        n.connect(nf).connect(ng).connect(ctx.destination);
        n.start(t); n.stop(t + 0.8);

        // Low rumble
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(90, t);
        o.frequency.exponentialRampToValueAtTime(18, t + 0.6);
        const og = this._env(t, 0.55, 0.6);
        o.connect(og).connect(ctx.destination);
        o.start(t); o.stop(t + 0.8);
    }

    playImpact() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;
        const n = this._noiseSrc();
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 3500; f.Q.value = 3;
        const g = this._env(t, 0.12, 0.07);
        n.connect(f).connect(g).connect(ctx.destination);
        n.start(t); n.stop(t + 0.1);
    }

    /** Metallic clang for subsystem damage (hit but not destroyed). */
    playHit() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;

        // Metallic ping
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(800, t);
        o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
        const og = this._env(t, 0.3, 0.2);
        o.connect(og).connect(ctx.destination);
        o.start(t); o.stop(t + 0.25);

        // Short noise for impact texture
        const n = this._noiseSrc();
        const nf = ctx.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = 2000; nf.Q.value = 4;
        const ng = this._env(t, 0.2, 0.1);
        n.connect(nf).connect(ng).connect(ctx.destination);
        n.start(t); n.stop(t + 0.12);
    }

    playSelect() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 660;
        const g = this._env(t, 0.15, 0.1);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t + 0.12);
    }

    playConfirm() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;
        [520, 780].forEach((freq, i) => {
            const o = ctx.createOscillator();
            o.type = 'sine'; o.frequency.value = freq;
            const g = this._env(t + i * 0.08, 0.18, 0.12);
            o.connect(g).connect(ctx.destination);
            o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.15);
        });
    }

    playWin() {
        if (!this._ok()) return;
        const { ctx } = this, t = ctx.currentTime;
        [523, 659, 784, 1047].forEach((freq, i) => {
            const o = ctx.createOscillator();
            o.type = 'square'; o.frequency.value = freq;
            const g = this._env(t + i * 0.13, 0.12, 0.2);
            o.connect(g).connect(ctx.destination);
            o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.25);
        });
    }

    /* ── internal helpers ──────────────────────────────────── */

    _ok() { return this.initialized && !this.muted; }

    /** Create a gain node with an exponential attack→decay envelope. */
    _env(t, peak, dur) {
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(peak, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        return g;
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
