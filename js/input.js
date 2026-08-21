/**
 * Keyboard + gamepad input, abstracted behind a per-device interface.
 *
 * Each human player (and the AI) is driven by an InputDevice that exposes
 * the game's ACTION vocabulary directly — no key-code indirection:
 *
 *     device.isDown(action)     — action currently held
 *     device.wasPressed(action) — action newly pressed this frame
 *     device.analog(action)     — 0..1 magnitude (steering/triggers),
 *                                 else 0/1 (binary)
 *
 * Devices:
 *   KeyboardDevice — one fixed key map (WASD/QE/Space; arrows/Enter/Esc).
 *   GamepadDevice  — standard-mapping buttons/axes → actions.  Every pad
 *                    maps identically, so any pad can drive any player;
 *                    join order (not pad index) determines P1…P4.
 *
 * InputManager is a device registry: it owns the keyboard, creates and
 * refreshes GamepadDevices from navigator.getGamepads(), and drives
 * per-frame edge detection via poll() / endFrame().
 */

import { ACTIONS, CONFIG } from "./config.js";

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

/**
 * Base InputDevice: tracks held actions and one-frame pressed edges.
 * Subclasses populate `_held` / `_pressed` / `_axes` each frame.
 */
export class InputDevice {
    constructor() {
        this._held = new Set();
        this._pressed = new Set();
        this._axes = {};
    }

    isDown(action) {
        return this._held.has(action);
    }

    wasPressed(action) {
        return this._pressed.has(action);
    }

    analog(action) {
        return this._axes[action] ?? (this._held.has(action) ? 1 : 0);
    }

    /** Clear one-frame press edges (call once at the end of each frame). */
    endFrame() {
        this._pressed = new Set();
    }
}

/* ── Keyboard ─────────────────────────────────────────────── */

/**
 * Keyboard key code → actions.  One keyboard = one device, so a single
 * map covers both gameplay (WASD) and menu (arrows/Enter/Esc) inputs.
 * Arrows double as a fallback for WASD so either hand works.
 */
const KEYBOARD_MAP = {
    KeyW: [ACTIONS.forward, ACTIONS.up],
    ArrowUp: [ACTIONS.forward, ACTIONS.up],
    KeyS: [ACTIONS.backward, ACTIONS.down],
    ArrowDown: [ACTIONS.backward, ACTIONS.down],
    KeyA: [ACTIONS.left],
    ArrowLeft: [ACTIONS.left],
    KeyD: [ACTIONS.right],
    ArrowRight: [ACTIONS.right],
    KeyQ: [ACTIONS.turretLeft],
    KeyE: [ACTIONS.turretRight],
    Space: [ACTIONS.fire, ACTIONS.confirm],
    Enter: [ACTIONS.confirm],
    Escape: [ACTIONS.back],
    Backspace: [ACTIONS.back],
    KeyR: [ACTIONS.back],
    Tab: [ACTIONS.cycleTeam],
};

export class KeyboardDevice extends InputDevice {
    constructor() {
        super();
        this.index = -1; // device id: -1 = keyboard
        this._heldCodes = new Set();
        this._pressedCodes = new Set();
    }

    /** The keyboard is always "connected". */
    get connected() {
        return true;
    }

    _onKeyDown(code) {
        if (!this._heldCodes.has(code)) this._pressedCodes.add(code);
        this._heldCodes.add(code);
    }

    _onKeyUp(code) {
        this._heldCodes.delete(code);
    }

    _reset() {
        this._heldCodes.clear();
        this._pressedCodes.clear();
        this._held = new Set();
        this._pressed = new Set();
    }

    /** Recompute action sets from raw key state (called each poll). */
    refresh() {
        this._held = this._codesToActions(this._heldCodes);
        this._pressed = this._codesToActions(this._pressedCodes);
    }

    endFrame() {
        this._pressedCodes.clear();
        this._pressed = new Set();
    }

    _codesToActions(codes) {
        const out = new Set();
        for (const code of codes) {
            for (const action of KEYBOARD_MAP[code] ?? []) out.add(action);
        }
        return out;
    }
}

/* ── Gamepad ──────────────────────────────────────────────── */

/**
 * Translate one standard-mapping gamepad snapshot into held actions and
 * analog magnitudes.  Pure — exported for tests.
 *
 * @param {Gamepad} gp  standard-mapping gamepad snapshot
 * @returns {{ held: Set<string>, axes: Record<string, number> }}
 */
export function gamepadToActions(gp) {
    const held = new Set();
    const axes = {};
    const pressed = (i) => gp.buttons?.[i]?.pressed ?? false;
    const trigger = (i) => {
        const b = gp.buttons?.[i];
        return !!b && (b.pressed || b.value > CONFIG.GAMEPAD_TRIGGER_THRESHOLD);
    };
    const axis = (i) => gp.axes?.[i] ?? 0;
    const dz = CONFIG.GAMEPAD_STICK_DEADZONE;
    const trig = CONFIG.GAMEPAD_TRIGGER_THRESHOLD;
    const scale = (v, min) => Math.min(1, (Math.abs(v) - min) / (1 - min));

    // Throttle — top face button forward / left face button reverse.
    // D-pad up/down and the stick's Y axis work too.
    if (pressed(BTN.FACE_TOP) || pressed(BTN.DPAD_UP) || axis(1) < -dz) held.add(ACTIONS.forward);
    if (pressed(BTN.FACE_LEFT) || pressed(BTN.DPAD_DOWN) || axis(1) > dz) held.add(ACTIONS.backward);

    // Steering — d-pad left/right (digital) or the left stick's X axis.
    if (pressed(BTN.DPAD_LEFT) || axis(0) < -dz) held.add(ACTIONS.left);
    if (pressed(BTN.DPAD_RIGHT) || axis(0) > dz) held.add(ACTIONS.right);

    // Turret — LT / RT (analogue triggers with a threshold).
    if (trigger(BTN.LT)) held.add(ACTIONS.turretLeft);
    if (trigger(BTN.RT)) held.add(ACTIONS.turretRight);

    // Fire — bottom face button (the primary action), with right face and
    // Start as aliases so confirm/rematch habits just work.
    if (pressed(BTN.FACE_BOTTOM) || pressed(BTN.FACE_RIGHT) || pressed(BTN.START)) held.add(ACTIONS.fire);

    // Menu navigation — d-pad / stick only (face buttons never navigate).
    if (pressed(BTN.DPAD_UP) || axis(1) < -dz) held.add(ACTIONS.up);
    if (pressed(BTN.DPAD_DOWN) || axis(1) > dz) held.add(ACTIONS.down);
    if (pressed(BTN.DPAD_LEFT) || axis(0) < -dz) held.add(ACTIONS.left);
    if (pressed(BTN.DPAD_RIGHT) || axis(0) > dz) held.add(ACTIONS.right);

    // Confirm / back / switch-team.
    if (pressed(BTN.FACE_BOTTOM) || pressed(BTN.START)) held.add(ACTIONS.confirm);
    if (pressed(BTN.FACE_RIGHT)) held.add(ACTIONS.back);
    if (pressed(BTN.FACE_LEFT)) held.add(ACTIONS.cycleTeam);

    // Analog magnitudes (0–1) for steering and turret travel.
    const x = axis(0);
    if (x < -dz) axes[ACTIONS.left] = scale(x, dz);
    else if (x > dz) axes[ACTIONS.right] = scale(x, dz);
    for (const [btn, action] of [
        [BTN.LT, ACTIONS.turretLeft],
        [BTN.RT, ACTIONS.turretRight],
    ]) {
        const b = gp.buttons?.[btn];
        const raw = b?.value || (b?.pressed ? 1 : 0);
        if (raw > trig) axes[action] = scale(raw, trig);
    }

    return { held, axes };
}

export class GamepadDevice extends InputDevice {
    constructor(index) {
        super();
        this.index = index; // device id: gamepad index
        this.connected = false;
    }

    /** Update from a gamepad snapshot (null/absent = disconnected). */
    update(gp) {
        if (!gp?.connected) {
            this.connected = false;
            this._held = new Set();
            this._pressed = new Set();
            this._axes = {};
            return;
        }
        this.connected = true;
        const { held, axes } = gamepadToActions(gp);
        const pressed = new Set();
        for (const action of held) {
            if (!this._held.has(action)) pressed.add(action);
        }
        this._held = held;
        this._axes = axes;
        this._pressed = pressed;
    }
}

/* ── Device registry ──────────────────────────────────────── */

export class InputManager {
    /**
     * @param {Function|null} getGamepads  injectable for tests;
     *        defaults to navigator.getGamepads()
     */
    constructor(getGamepads = null) {
        this.keyboard = new KeyboardDevice();
        /** @type {Map<number, GamepadDevice>} */
        this._gamepads = new Map();

        this._getGamepads =
            getGamepads ??
            (() => (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []));

        if (typeof window !== "undefined") {
            window.addEventListener("keydown", (e) => {
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"].includes(e.code)) {
                    e.preventDefault();
                }
                this.keyboard._onKeyDown(e.code);
            });
            window.addEventListener("keyup", (e) => {
                this.keyboard._onKeyUp(e.code);
            });
            // Clear state if the window loses focus.
            window.addEventListener("blur", () => {
                this.keyboard._reset();
            });
        }
    }

    /** All gamepad devices (connected and remembered-after-disconnect). */
    get gamepads() {
        return [...this._gamepads.values()];
    }

    /** Connected gamepad devices only. */
    get connectedGamepads() {
        return this.gamepads.filter((g) => g.connected);
    }

    /**
     * Poll all devices.  Call once at the START of each frame, before any
     * update() reads input.
     */
    poll() {
        this.keyboard.refresh();

        const pads = this._getGamepads() ?? [];
        const seen = new Set();
        for (const gp of pads) {
            if (!gp) continue;
            seen.add(gp.index);
            let dev = this._gamepads.get(gp.index);
            if (!dev) {
                dev = new GamepadDevice(gp.index);
                this._gamepads.set(gp.index, dev);
            }
            dev.update(gp);
        }
        // A pad that vanished from the snapshot is disconnected.
        for (const [index, dev] of this._gamepads) {
            if (!seen.has(index)) dev.update(null);
        }
    }

    /** Call once at the end of each frame. */
    endFrame() {
        this.keyboard.endFrame();
        for (const dev of this._gamepads.values()) dev.endFrame();
    }
}
