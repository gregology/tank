/**
 * One controller's current state, built from kernel input events and read as
 * a standard-mapping Gamepad snapshot.  Pure: no devices, no IPC.
 */

import {
    BUTTON_OF_KEY,
    DPAD_BUTTONS_OF_ABS,
    EV_ABS,
    EV_KEY,
    STICK_AXIS_OF_ABS,
    TRIGGER_BUTTON_OF_ABS,
} from "./kernel-codes.js";

const BUTTON_COUNT = 16;
const STICK_AXIS_COUNT = 4;
const STICK_RANGE = 32767;
const TRIGGER_RANGE = 255;
const PRESSED_ABOVE = 0.5;

/**
 * Idle controllers report constant small changes (measured up to 2600 of
 * 32767).  Zeroing them means an idle pad changes nothing, so it sends the
 * page nothing.  The game's own deadzone is far larger.
 */
const STICK_NOISE_FLOOR = 3300;

function roundToHundredths(value) {
    return Math.round(value * 100) / 100;
}

function normalizeStick(raw) {
    if (Math.abs(raw) < STICK_NOISE_FLOOR) return 0;
    return roundToHundredths(Math.max(-1, Math.min(1, raw / STICK_RANGE)));
}

export class PadState {
    constructor() {
        this.clear();
    }

    /** Forget everything, for when the kernel reports it dropped events. */
    clear() {
        this._buttons = new Array(BUTTON_COUNT).fill(0);
        this._axes = new Array(STICK_AXIS_COUNT).fill(0);
    }

    /** @returns {boolean} true if the event changed what the game can see */
    apply(type, code, value) {
        if (type === EV_KEY) return this._applyKey(code, value);
        if (type === EV_ABS) return this._applyAxis(code, value);
        return false;
    }

    _applyKey(code, value) {
        const button = BUTTON_OF_KEY.get(code);
        if (button === undefined) return false;
        // A key event's value is 2 while the key auto-repeats, which is still held.
        return this._setButton(button, value === 0 ? 0 : 1);
    }

    _applyAxis(code, value) {
        const axis = STICK_AXIS_OF_ABS.get(code);
        if (axis !== undefined) return this._setAxis(axis, normalizeStick(value));

        const trigger = TRIGGER_BUTTON_OF_ABS.get(code);
        if (trigger !== undefined) return this._setButton(trigger, roundToHundredths(value / TRIGGER_RANGE));

        const dpad = DPAD_BUTTONS_OF_ABS.get(code);
        if (dpad === undefined) return false;
        const negativeChanged = this._setButton(dpad[0], value < 0 ? 1 : 0);
        const positiveChanged = this._setButton(dpad[1], value > 0 ? 1 : 0);
        return negativeChanged || positiveChanged;
    }

    _setButton(button, value) {
        if (this._buttons[button] === value) return false;
        this._buttons[button] = value;
        return true;
    }

    _setAxis(axis, value) {
        if (this._axes[axis] === value) return false;
        this._axes[axis] = value;
        return true;
    }

    /** A standard-mapping Gamepad snapshot, with the fields `InputManager` reads. */
    toGamepad({ index, id, controlProfile }) {
        return {
            index,
            id,
            controlProfile,
            connected: true,
            mapping: "standard",
            axes: [...this._axes],
            buttons: this._buttons.map((value) => ({ pressed: value > PRESSED_ABOVE, value })),
        };
    }
}
