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
 *   GamepadDevice  — standard-mapping buttons/axes → actions through a
 *                    control profile (CONTROL_PROFILES); any pad can drive
 *                    any player, and join order determines P1…P4.
 *
 * InputManager is a device registry: it owns the keyboard, creates and
 * refreshes GamepadDevices from a snapshot source (navigator.getGamepads()
 * unless one is injected), and drives per-frame edge detection via
 * poll() / endFrame().
 */

import { ACTIONS, CONFIG, CONTROL_PROFILES, DEFAULT_CONTROL_PROFILE } from "./config.js";

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
    Escape: [ACTIONS.back, ACTIONS.pause],
    KeyP: [ACTIONS.pause],
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

function controlProfileOf(gp) {
    return CONTROL_PROFILES[gp.controlProfile] ?? CONTROL_PROFILES[DEFAULT_CONTROL_PROFILE];
}

function isButtonHeld(gp, index) {
    const button = gp.buttons?.[index];
    return !!button && (button.pressed || button.value > CONFIG.GAMEPAD_TRIGGER_THRESHOLD);
}

/**
 * Translate one standard-mapping gamepad snapshot into held actions and
 * analog magnitudes.  Pure — exported for tests.
 *
 * @param {Gamepad} gp  standard-mapping gamepad snapshot; a `controlProfile`
 *                      field picks its layout from CONTROL_PROFILES
 * @returns {{ held: Set<string>, axes: Record<string, number> }}
 */
export function gamepadToActions(gp) {
    const profile = controlProfileOf(gp);
    const held = new Set();
    const axes = {};

    for (const { button, actions } of profile.buttons) {
        if (!isButtonHeld(gp, button)) continue;
        for (const action of actions) held.add(action);
    }

    const deadzone = CONFIG.GAMEPAD_STICK_DEADZONE;
    for (const { axis, direction, actions, analog } of profile.sticks) {
        const deflection = (gp.axes?.[axis] ?? 0) * direction;
        if (deflection <= deadzone) continue;
        for (const action of actions) {
            held.add(action);
            if (analog) axes[action] = Math.min(1, (deflection - deadzone) / (1 - deadzone));
        }
    }

    return { held, axes };
}

export class GamepadDevice extends InputDevice {
    constructor(index) {
        super();
        this.index = index; // device id: gamepad index
        this.connected = false;
        this._pauseChordFrames = 0;
    }

    /** Update from a gamepad snapshot (null/absent = disconnected). */
    update(gp) {
        if (!gp?.connected) {
            this.connected = false;
            this._held = new Set();
            this._pressed = new Set();
            this._axes = {};
            this._pauseChordFrames = 0;
            return;
        }
        this.connected = true;
        const { held, axes } = gamepadToActions(gp);
        if (this._pauseChordComplete(gp)) held.add(ACTIONS.pause);
        const pressed = new Set();
        for (const action of held) {
            if (!this._held.has(action)) pressed.add(action);
        }
        this._held = held;
        this._axes = axes;
        this._pressed = pressed;
    }

    _pauseChordComplete(gp) {
        const chord = controlProfileOf(gp).pauseChord;
        const held = chord?.every((button) => isButtonHeld(gp, button)) ?? false;
        this._pauseChordFrames = held ? this._pauseChordFrames + 1 : 0;
        return this._pauseChordFrames >= CONFIG.PAUSE_CHORD_HOLD_FRAMES;
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

/** The first device that pressed `action` this frame (keyboard, then pads), or null. */
export function firstPresser(input, action) {
    if (input.keyboard?.wasPressed(action)) return input.keyboard;
    return input.connectedGamepads.find((pad) => pad.wasPressed(action)) ?? null;
}

/** True when any device pressed `action` this frame. */
export function anyPressed(input, action) {
    return firstPresser(input, action) !== null;
}
