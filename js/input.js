/**
 * Keyboard + gamepad input manager.
 *
 * Keyboard events are tracked directly.  Gamepads are polled once per
 * frame (pollGamepads) and translated into the SAME key codes the
 * keyboard uses (CONFIG.PLAYER1_KEYS / PLAYER2_KEYS), so the rest of
 * the game can't tell the difference.
 *
 * The pad mapping is context-sensitive (menuMode flag):
 *
 *   MENUS (menuMode = true)
 *     d-pad / left stick      → Arrow keys (navigate)
 *     bottom face button      → Enter (confirm)  — A on Xbox, ✕ on PS,
 *     Start                   → Enter (confirm)    B on Nintendo
 *     right face button       → KeyR (back)      — B on Xbox, ○ on PS
 *
 *   GAME (menuMode = false)
 *     top face button (Y/△)   → forward     (d-pad ↑, stick ↑ work too)
 *     left face button (X/□)  → reverse     (d-pad ↓, stick ↓ work too)
 *     d-pad ←→ / stick ←→     → steer left / right (stick is analog)
 *     LT / RT                 → turret left / right (analog)
 *     bottom face button      → fire — the primary action button on
 *     (A/✕) + right btn/Start   every layout (labelled ✕ on PlayStation)
 *
 * Analog channels (stick X, triggers) additionally report a 0–1
 * magnitude via analog(), enabling non-binary steering/turret speed.
 * Digital sources (keyboard, d-pad, AI) report 1 when held.
 *
 * The first connected pad drives player 1, the second drives player 2.
 * A pad and the keyboard can be used simultaneously — states merge.
 *
 * Tracks which keys are currently held and which were just pressed
 * this frame.  Call `pollGamepads()` at the START of each frame and
 * `endFrame()` at the END (clears the "just-pressed" set).
 */

import { CONFIG } from "./config.js";

/* ── Standard-mapping gamepad button indices ─────────────── */
const BTN = {
    FACE_BOTTOM: 0, // Xbox A / PlayStation ✕ / Nintendo B
    FACE_RIGHT: 1, //  Xbox B / PlayStation ○ / Nintendo A
    FACE_LEFT: 2, //   Xbox X / PlayStation □ / Nintendo Y
    FACE_TOP: 3, //    Xbox Y / PlayStation △ / Nintendo X
    LT: 6,
    RT: 7,
    START: 9,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
};

/** UI "back" code injected for the gamepad back button. */
const BACK_CODE = "KeyR";

/**
 * Translate one gamepad's state into virtual key presses for the
 * given player key map (GAME mapping — see gamepadToMenuKeys for menus).
 * Pure — exported for tests.
 *
 * @param {Gamepad} gp          standard-mapping gamepad snapshot
 * @param {object}  playerKeys  CONFIG.PLAYER1_KEYS or PLAYER2_KEYS
 * @returns {Record<string,boolean>} map of key code → true
 */
export function gamepadToKeys(gp, playerKeys) {
    const keys = {};
    const pressed = (i) => gp.buttons?.[i]?.pressed ?? false;
    const trigger = (i) => {
        const b = gp.buttons?.[i];
        return !!b && (b.pressed || b.value > CONFIG.GAMEPAD_TRIGGER_THRESHOLD);
    };
    const axis = (i) => gp.axes?.[i] ?? 0;
    const dz = CONFIG.GAMEPAD_STICK_DEADZONE;

    // Throttle — top face button forward / left face button reverse.
    // D-pad up/down and the stick's Y axis work too.
    if (pressed(BTN.FACE_TOP) || pressed(BTN.DPAD_UP) || axis(1) < -dz) keys[playerKeys.forward] = true;
    if (pressed(BTN.FACE_LEFT) || pressed(BTN.DPAD_DOWN) || axis(1) > dz) keys[playerKeys.backward] = true;

    // Steering — d-pad left/right (digital) or the stick's X axis
    // (analog magnitude reported separately via gamepadToAxes).
    if (pressed(BTN.DPAD_LEFT) || axis(0) < -dz) keys[playerKeys.left] = true;
    if (pressed(BTN.DPAD_RIGHT) || axis(0) > dz) keys[playerKeys.right] = true;

    // Turret — LT / RT (analogue triggers with a threshold)
    if (trigger(BTN.LT)) keys[playerKeys.turretLeft] = true;
    if (trigger(BTN.RT)) keys[playerKeys.turretRight] = true;

    // Fire — bottom face button (the primary action button on every
    // layout; labelled ✕ on PlayStation).  Right face button and Start
    // are aliases so confirm/rematch habits just work.
    if (pressed(BTN.FACE_BOTTOM) || pressed(BTN.FACE_RIGHT) || pressed(BTN.START)) {
        keys[playerKeys.fire] = true;
    }

    return keys;
}

/**
 * Translate one gamepad's state into MENU navigation keys.
 * Layout-independent: the bottom face button confirms and the right
 * face button goes back on Xbox, PlayStation and Nintendo pads alike.
 * Pure — exported for tests.
 *
 * @param {Gamepad} gp  standard-mapping gamepad snapshot
 * @returns {Record<string,boolean>} map of key code → true
 */
export function gamepadToMenuKeys(gp) {
    const keys = {};
    const pressed = (i) => gp.buttons?.[i]?.pressed ?? false;
    const axis = (i) => gp.axes?.[i] ?? 0;
    const dz = CONFIG.GAMEPAD_STICK_DEADZONE;

    // Navigate — d-pad or left stick
    if (pressed(BTN.DPAD_UP) || axis(1) < -dz) keys.ArrowUp = true;
    if (pressed(BTN.DPAD_DOWN) || axis(1) > dz) keys.ArrowDown = true;
    if (pressed(BTN.DPAD_LEFT) || axis(0) < -dz) keys.ArrowLeft = true;
    if (pressed(BTN.DPAD_RIGHT) || axis(0) > dz) keys.ArrowRight = true;

    // Confirm — bottom face button or Start
    if (pressed(BTN.FACE_BOTTOM) || pressed(BTN.START)) keys.Enter = true;

    // Back — right face button
    if (pressed(BTN.FACE_RIGHT)) keys[BACK_CODE] = true;

    return keys;
}

/**
 * Analog magnitudes (0–1) for one gamepad, for the channels that
 * support non-binary control: steering (left stick X) and turret
 * (LT/RT trigger travel).  Values are scaled so deflection just past
 * the deadzone/threshold starts near 0 and full deflection is 1.
 * Pure — exported for tests.
 *
 * @param {Gamepad} gp          standard-mapping gamepad snapshot
 * @param {object}  playerKeys  CONFIG.PLAYER1_KEYS or PLAYER2_KEYS
 * @returns {Record<string,number>} map of key code → 0..1
 */
export function gamepadToAxes(gp, playerKeys) {
    const axes = {};
    const dz = CONFIG.GAMEPAD_STICK_DEADZONE;
    const trig = CONFIG.GAMEPAD_TRIGGER_THRESHOLD;
    const scale = (v, min) => Math.min(1, (Math.abs(v) - min) / (1 - min));

    // Steering — left stick X
    const x = gp.axes?.[0] ?? 0;
    if (x < -dz) axes[playerKeys.left] = scale(x, dz);
    else if (x > dz) axes[playerKeys.right] = scale(x, dz);

    // Turret — LT / RT trigger travel
    for (const [btn, code] of [
        [BTN.LT, playerKeys.turretLeft],
        [BTN.RT, playerKeys.turretRight],
    ]) {
        // Prefer the analogue travel value; fall back to the pressed
        // flag for digital triggers that only report 0/1.
        const b = gp.buttons?.[btn];
        const raw = b?.value || (b?.pressed ? 1 : 0);
        if (raw > trig) axes[code] = scale(raw, trig);
    }

    return axes;
}

/* ================================================================== */

export class InputManager {
    /**
     * @param {Function|null} getGamepads  injectable for tests;
     *        defaults to navigator.getGamepads()
     */
    constructor(getGamepads = null) {
        /** @type {Record<string,boolean>} keyboard keys currently held */
        this._kb = {};
        /** @type {Record<string,boolean>} gamepad-derived codes currently held */
        this._pad = {};
        /** @type {Record<string,number>} gamepad-derived analog magnitudes (0–1) */
        this._padAnalog = {};
        /** @type {Record<string,boolean>} pad state last frame (for edge detection) */
        this._padPrev = {};
        /** @type {Record<string,boolean>} pressed this frame */
        this.justPressed = {};
        /** @type {(number|null)[]} gamepad index bound to each player slot */
        this._padSlots = [null, null];

        /**
         * Context switch for the pad mapping — true while in menus
         * (navigate/confirm/back), false during gameplay.  Set by main.js.
         */
        this.menuMode = true;

        this._getGamepads =
            getGamepads ??
            (() => (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []));

        if (typeof window !== "undefined") {
            window.addEventListener("keydown", (e) => {
                if (!this._kb[e.code]) {
                    this.justPressed[e.code] = true;
                }
                this._kb[e.code] = true;

                // Prevent browser scrolling for game keys
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"].includes(e.code)) {
                    e.preventDefault();
                }
            });

            window.addEventListener("keyup", (e) => {
                this._kb[e.code] = false;
            });

            // Clear state if the window loses focus
            window.addEventListener("blur", () => {
                this._kb = {};
                this._pad = {};
                this._padAnalog = {};
                this._padPrev = {};
                this.justPressed = {};
            });
        }
    }

    /** Number of gamepads currently bound to player slots (0–2). */
    get gamepadCount() {
        return this._padSlots.filter((s) => s !== null).length;
    }

    /**
     * Poll gamepads and merge their state.  Call once at the START of
     * each frame, before any update() reads input.
     */
    pollGamepads() {
        const next = {};
        const nextAxes = {};
        const pads = this._getGamepads() ?? [];

        // Lazily bind newly seen pads to free player slots (stable
        // assignment — a pad keeps its slot until it disconnects).
        for (const gp of pads) {
            if (gp?.connected) this._bindSlot(gp.index);
        }

        for (let slot = 0; slot < this._padSlots.length; slot++) {
            const idx = this._padSlots[slot];
            if (idx === null) continue;
            const gp = pads[idx];
            if (!gp?.connected) {
                this._padSlots[slot] = null; // disconnected — free the slot
                continue;
            }
            if (this.menuMode) {
                // Menus: every pad navigates (no player assignment)
                Object.assign(next, gamepadToMenuKeys(gp));
            } else {
                const playerKeys = slot === 0 ? CONFIG.PLAYER1_KEYS : CONFIG.PLAYER2_KEYS;
                Object.assign(next, gamepadToKeys(gp, playerKeys));
                Object.assign(nextAxes, gamepadToAxes(gp, playerKeys));
            }
        }

        // Edge detection: code held now but not last frame → just pressed
        for (const code in next) {
            if (!this._padPrev[code]) this.justPressed[code] = true;
        }

        this._padPrev = next;
        this._pad = next;
        this._padAnalog = nextAxes;
    }

    _bindSlot(index) {
        if (this._padSlots.includes(index)) return;
        const free = this._padSlots.indexOf(null);
        if (free !== -1) this._padSlots[free] = index;
    }

    isDown(code) {
        return !!(this._kb[code] || this._pad[code]);
    }

    /**
     * Analog magnitude (0–1) for a key code.  Digital sources (keyboard,
     * d-pad, AI) report 1 when held; the gamepad stick and triggers
     * report a scaled value for non-binary steering / turret speed.
     */
    analog(code) {
        if (this._kb[code]) return 1;
        return this._padAnalog[code] ?? (this._pad[code] ? 1 : 0);
    }

    wasPressed(code) {
        return !!this.justPressed[code];
    }

    /** Call once at the end of each frame. */
    endFrame() {
        this.justPressed = {};
    }
}
