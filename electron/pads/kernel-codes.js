/**
 * The Linux input-event format and the codes game controllers report, from
 * linux/input.h and linux/input-event-codes.h, mapped onto the game's
 * standard button layout.
 */

import { PAD_BUTTONS as B } from "../../js/config/controls.js";

/** struct input_event on x86-64: i64 seconds, i64 microseconds, u16 type, u16 code, i32 value. */
export const INPUT_EVENT_BYTES = 24;
export const INPUT_EVENT_TYPE_OFFSET = 16;
export const INPUT_EVENT_CODE_OFFSET = 18;
export const INPUT_EVENT_VALUE_OFFSET = 20;

export const EV_SYN = 0;
export const EV_KEY = 1;
export const EV_ABS = 3;
export const SYN_DROPPED = 3;

export const ABS_X = 0x00;
export const ABS_Y = 0x01;
export const ABS_Z = 0x02;
export const ABS_RX = 0x03;
export const ABS_RY = 0x04;
export const ABS_RZ = 0x05;
export const ABS_HAT0X = 0x10;
export const ABS_HAT0Y = 0x11;

export const BUTTON_OF_KEY = new Map([
    [0x130, B.FACE_BOTTOM], // BTN_SOUTH
    [0x131, B.FACE_RIGHT], // BTN_EAST
    [0x133, B.FACE_TOP], // BTN_NORTH
    [0x134, B.FACE_LEFT], // BTN_WEST
    [0x136, B.L1], // BTN_TL
    [0x137, B.R1], // BTN_TR
    [0x138, B.L2], // BTN_TL2
    [0x139, B.R2], // BTN_TR2
    [0x13a, B.SELECT], // BTN_SELECT
    [0x13b, B.START], // BTN_START
    [0x13d, B.STICK_LEFT], // BTN_THUMBL
    [0x13e, B.STICK_RIGHT], // BTN_THUMBR
    [0x220, B.DPAD_UP], // BTN_DPAD_UP
    [0x221, B.DPAD_DOWN], // BTN_DPAD_DOWN
    [0x222, B.DPAD_LEFT], // BTN_DPAD_LEFT
    [0x223, B.DPAD_RIGHT], // BTN_DPAD_RIGHT
]);

/** Stick axes in the order of a standard gamepad's `axes` array. */
export const STICK_AXIS_OF_ABS = new Map([
    [ABS_X, 0],
    [ABS_Y, 1],
    [ABS_RX, 2],
    [ABS_RY, 3],
]);

export const TRIGGER_BUTTON_OF_ABS = new Map([
    [ABS_Z, B.L2],
    [ABS_RZ, B.R2],
]);

/** Each hat axis is two D-pad buttons: [button at -1, button at +1]. */
export const DPAD_BUTTONS_OF_ABS = new Map([
    [ABS_HAT0X, [B.DPAD_LEFT, B.DPAD_RIGHT]],
    [ABS_HAT0Y, [B.DPAD_UP, B.DPAD_DOWN]],
]);
