/**
 * Input action vocabulary — the single source of truth shared by input
 * devices (keyboard / gamepad), the AI controller, and gameplay code.
 *
 * `left` / `right` are shared between steering and menu navigation;
 * `up` / `down` are menu-only (a gamepad's face buttons drive
 * `forward`/`backward` but never menu navigation).
 */
export const ACTIONS = Object.freeze({
    forward: "forward",
    backward: "backward",
    left: "left",
    right: "right",
    turretLeft: "turretLeft",
    turretRight: "turretRight",
    fire: "fire",
    up: "up",
    down: "down",
    confirm: "confirm",
    back: "back",
    cycleTeam: "cycleTeam",
});
