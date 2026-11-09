/**
 * Pad control profiles: which standard-mapping inputs drive which actions.
 * A new pad layout is one entry in CONTROL_PROFILES.
 */

import { ACTIONS as A } from "./actions.js";

/** Button indices of the W3C standard gamepad mapping, named by position. */
export const PAD_BUTTONS = Object.freeze({
    FACE_BOTTOM: 0,
    FACE_RIGHT: 1,
    FACE_LEFT: 2,
    FACE_TOP: 3,
    L1: 4,
    R1: 5,
    L2: 6,
    R2: 7,
    SELECT: 8,
    START: 9,
    STICK_LEFT: 10,
    STICK_RIGHT: 11,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15,
});

const B = PAD_BUTTONS;

/**
 * Right face is back and nothing else: if it also fired, someone firing
 * with it at the end of a match would quit to the menu.
 */
const SHARED_BUTTONS = [
    { button: B.FACE_TOP, actions: [A.forward] },
    { button: B.FACE_LEFT, actions: [A.backward, A.cycleTeam] },
    { button: B.DPAD_UP, actions: [A.forward, A.up] },
    { button: B.DPAD_DOWN, actions: [A.backward, A.down] },
    { button: B.DPAD_LEFT, actions: [A.left] },
    { button: B.DPAD_RIGHT, actions: [A.right] },
    { button: B.FACE_BOTTOM, actions: [A.fire, A.confirm] },
    { button: B.FACE_RIGHT, actions: [A.back] },
    { button: B.START, actions: [A.confirm, A.pause] },
];

/** Small pads report their D-pad here too, so every profile keeps these. */
const LEFT_STICK = [
    { axis: 1, direction: -1, actions: [A.forward, A.up] },
    { axis: 1, direction: 1, actions: [A.backward, A.down] },
    { axis: 0, direction: -1, actions: [A.left], analog: true },
    { axis: 0, direction: 1, actions: [A.right], analog: true },
];

export const CONTROL_PROFILES = Object.freeze({
    /** Left stick drives, right stick turns the turret, right trigger fires. */
    twinStick: {
        buttons: [
            ...SHARED_BUTTONS,
            { button: B.R2, actions: [A.fire] },
            { button: B.L1, actions: [A.turretLeft] },
            { button: B.R1, actions: [A.turretRight] },
        ],
        sticks: [
            ...LEFT_STICK,
            { axis: 2, direction: -1, actions: [A.turretLeft], analog: true },
            { axis: 2, direction: 1, actions: [A.turretRight], analog: true },
        ],
    },
    /** D-pad drives and the four paddles turn the turret: for pads with no sticks. */
    paddles: {
        buttons: [
            ...SHARED_BUTTONS,
            { button: B.L1, actions: [A.turretLeft] },
            { button: B.L2, actions: [A.turretLeft] },
            { button: B.R1, actions: [A.turretRight] },
            { button: B.R2, actions: [A.turretRight] },
        ],
        sticks: LEFT_STICK,
        // These pads may have no Start button, and every player must be able to pause.
        pauseChord: [B.L1, B.R1],
    },
});

/** The Gamepad API can't name a pad's layout, so its pads use this profile. */
export const DEFAULT_CONTROL_PROFILE = "twinStick";
