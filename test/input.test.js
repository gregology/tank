import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG } from "../js/config.js";
import { gamepadToAxes, gamepadToKeys, gamepadToMenuKeys, InputManager } from "../js/input.js";
import { customMap, Tank } from "./helpers.js";

/* ── Fake gamepad factory ─────────────────────────────────
 * buttons: { index: true | 0..1 }  — true = digital press,
 * number = analogue value (pressed when > 0.5, like the spec).
 */
function makePad({ index = 0, axes = [0, 0, 0, 0], buttons = {}, connected = true } = {}) {
    const arr = Array.from({ length: 17 }, (_, i) => {
        const b = buttons[i];
        if (typeof b === "number") return { pressed: b > 0.5, value: b };
        return { pressed: !!b, value: b ? 1 : 0 };
    });
    return { index, connected, mapping: "standard", axes, buttons: arr };
}

const DZ = CONFIG.GAMEPAD_STICK_DEADZONE;
const TRIG = CONFIG.GAMEPAD_TRIGGER_THRESHOLD;

/* Standard-mapping indices: 0 bottom, 1 right, 2 left, 3 top face btn */
describe("gamepadToKeys (game mapping)", () => {
    it("maps top face button to forward, left face button to reverse", () => {
        const keys = gamepadToKeys(makePad({ buttons: { 3: true } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(keys, { KeyW: true });

        const rev = gamepadToKeys(makePad({ buttons: { 2: true } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(rev, { KeyS: true });

        const p2 = gamepadToKeys(makePad({ buttons: { 3: true, 2: true } }), CONFIG.PLAYER2_KEYS);
        assert.deepEqual(p2, { ArrowUp: true, ArrowDown: true });
    });

    it("maps the bottom face button to fire (with right button and Start as aliases)", () => {
        for (const btn of [0, 1, 9]) {
            const keys = gamepadToKeys(makePad({ buttons: { [btn]: true } }), CONFIG.PLAYER1_KEYS);
            assert.deepEqual(keys, { Space: true }, `button ${btn} should fire`);
        }
        const p2 = gamepadToKeys(makePad({ buttons: { 0: true } }), CONFIG.PLAYER2_KEYS);
        assert.deepEqual(p2, { Enter: true });
    });

    it("maps d-pad left/right to steering", () => {
        const keys = gamepadToKeys(makePad({ buttons: { 14: true } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(keys, { KeyA: true });

        const right = gamepadToKeys(makePad({ buttons: { 15: true } }), CONFIG.PLAYER2_KEYS);
        assert.deepEqual(right, { ArrowRight: true });
    });

    it("keeps d-pad up/down as throttle aliases", () => {
        const keys = gamepadToKeys(makePad({ buttons: { 12: true, 13: true } }), CONFIG.PLAYER2_KEYS);
        assert.deepEqual(keys, { ArrowUp: true, ArrowDown: true });
    });

    it("maps the left stick to throttle and steering", () => {
        const up = gamepadToKeys(makePad({ axes: [0, -1] }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(up, { KeyW: true });

        const downLeft = gamepadToKeys(makePad({ axes: [-1, 1] }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(downLeft, { KeyS: true, KeyA: true });
    });

    it("ignores stick input inside the deadzone", () => {
        const keys = gamepadToKeys(makePad({ axes: [DZ - 0.01, -(DZ - 0.01)] }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(keys, {});
    });

    it("combines face buttons, d-pad, and stick", () => {
        const keys = gamepadToKeys(makePad({ axes: [1, 0], buttons: { 3: true, 0: true } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(keys, { KeyW: true, KeyD: true, Space: true });
    });

    it("maps LT/RT to turret rotation", () => {
        const keys = gamepadToKeys(makePad({ buttons: { 6: true, 7: true } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(keys, { KeyQ: true, KeyE: true });
    });

    it("honours the analogue trigger threshold", () => {
        const below = gamepadToKeys(makePad({ buttons: { 6: TRIG - 0.01 } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(below, {});

        const above = gamepadToKeys(makePad({ buttons: { 6: TRIG + 0.01 } }), CONFIG.PLAYER1_KEYS);
        assert.deepEqual(above, { KeyQ: true });
    });

    it("tolerates pads with missing axes/buttons", () => {
        assert.deepEqual(gamepadToKeys({}, CONFIG.PLAYER1_KEYS), {});
        assert.deepEqual(gamepadToMenuKeys({}), {});
        assert.deepEqual(gamepadToAxes({}, CONFIG.PLAYER1_KEYS), {});
    });
});

describe("gamepadToMenuKeys (menu mapping)", () => {
    it("maps d-pad and stick to arrow keys", () => {
        const keys = gamepadToMenuKeys(makePad({ buttons: { 12: true, 14: true } }));
        assert.deepEqual(keys, { ArrowUp: true, ArrowLeft: true });

        const stick = gamepadToMenuKeys(makePad({ axes: [1, 1] }));
        assert.deepEqual(stick, { ArrowDown: true, ArrowRight: true });
    });

    it("maps the bottom face button and Start to confirm (Enter)", () => {
        for (const btn of [0, 9]) {
            assert.deepEqual(gamepadToMenuKeys(makePad({ buttons: { [btn]: true } })), { Enter: true });
        }
    });

    it("maps the right face button to back (KeyR)", () => {
        assert.deepEqual(gamepadToMenuKeys(makePad({ buttons: { 1: true } })), { KeyR: true });
    });

    it("does not emit gameplay codes", () => {
        const keys = gamepadToMenuKeys(makePad({ buttons: { 0: true, 2: true, 3: true }, axes: [1, -1] }));
        assert.equal(keys.KeyW, undefined);
        assert.equal(keys.Space, undefined);
        assert.equal(keys.KeyA, undefined);
    });
});

describe("gamepadToAxes", () => {
    it("reports full deflection as 1", () => {
        const axes = gamepadToAxes(makePad({ axes: [-1, 0] }), CONFIG.PLAYER1_KEYS);
        assert.equal(axes.KeyA, 1);
    });

    it("scales partial deflection between deadzone and full", () => {
        const half = DZ + (1 - DZ) / 2; // stick travel halfway past the deadzone
        const axes = gamepadToAxes(makePad({ axes: [half, 0] }), CONFIG.PLAYER1_KEYS);
        assert.ok(Math.abs(axes.KeyD - 0.5) < 1e-9, `expected ~0.5, got ${axes.KeyD}`);
    });

    it("reports nothing inside the deadzone", () => {
        assert.deepEqual(gamepadToAxes(makePad({ axes: [DZ - 0.01, 0] }), CONFIG.PLAYER1_KEYS), {});
    });

    it("ignores d-pad steering (digital, reported via gamepadToKeys)", () => {
        assert.deepEqual(gamepadToAxes(makePad({ buttons: { 14: true } }), CONFIG.PLAYER1_KEYS), {});
    });

    it("reports analogue trigger travel for the turret", () => {
        const half = TRIG + (1 - TRIG) / 2;
        const axes = gamepadToAxes(makePad({ buttons: { 7: half } }), CONFIG.PLAYER1_KEYS);
        assert.ok(Math.abs(axes.KeyE - 0.5) < 1e-9, `expected ~0.5, got ${axes.KeyE}`);

        const digital = gamepadToAxes(makePad({ buttons: { 6: true } }), CONFIG.PLAYER1_KEYS);
        assert.equal(digital.KeyQ, 1);
    });

    it("uses the given player key map", () => {
        const axes = gamepadToAxes(makePad({ axes: [1, 0] }), CONFIG.PLAYER2_KEYS);
        assert.deepEqual(axes, { ArrowRight: 1 });
    });
});

describe("InputManager gamepad polling", () => {
    it("drives isDown from the pad without any keyboard", () => {
        const input = new InputManager(() => [makePad({ buttons: { 3: true } })]);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.isDown("KeyW"), true); // top face btn → P1 forward
        assert.equal(input.isDown("ArrowUp"), false);
        assert.equal(input.gamepadCount, 1);
    });

    it("produces a one-frame wasPressed edge while held", () => {
        const input = new InputManager(() => [makePad({ buttons: { 0: true } })]);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.wasPressed("Space"), true);
        input.endFrame();
        input.pollGamepads(); // still held
        assert.equal(input.wasPressed("Space"), false);
        assert.equal(input.isDown("Space"), true);
    });

    it("registers a fresh edge on release and re-press", () => {
        let pad = makePad({ buttons: { 0: true } });
        const input = new InputManager(() => [pad]);
        input.menuMode = false;
        input.pollGamepads();
        input.endFrame();
        pad = makePad(); // released
        input.pollGamepads();
        assert.equal(input.isDown("Space"), false);
        input.endFrame();
        pad = makePad({ buttons: { 0: true } }); // pressed again
        input.pollGamepads();
        assert.equal(input.wasPressed("Space"), true);
    });

    it("uses the menu mapping in menuMode (any pad, no player codes)", () => {
        const input = new InputManager(() => [makePad({ buttons: { 0: true, 12: true } })]);
        input.menuMode = true;
        input.pollGamepads();
        assert.equal(input.wasPressed("Enter"), true); // bottom btn confirms
        assert.equal(input.isDown("ArrowUp"), true); // d-pad up navigates
        assert.equal(input.isDown("Space"), false); // no gameplay codes
        assert.equal(input.isDown("KeyW"), false);
    });

    it("switches cleanly between menuMode and game mapping", () => {
        const input = new InputManager(() => [makePad({ buttons: { 0: true } })]);
        input.menuMode = true;
        input.pollGamepads();
        assert.equal(input.isDown("Enter"), true);
        input.endFrame();
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.isDown("Enter"), false);
        assert.equal(input.isDown("Space"), true);
    });

    it("binds the first pad to P1 and the second to P2 in game mode", () => {
        const pads = [makePad({ index: 0, buttons: { 3: true } }), makePad({ index: 1, buttons: { 13: true } })];
        const input = new InputManager(() => pads);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.isDown("KeyW"), true); // pad 0 top btn → P1 forward
        assert.equal(input.isDown("ArrowDown"), true); // pad 1 d-pad down → P2 backward
        assert.equal(input.isDown("ArrowUp"), false);
        assert.equal(input.gamepadCount, 2);
    });

    it("ignores a third pad", () => {
        const pads = [makePad({ index: 0 }), makePad({ index: 1 }), makePad({ index: 2, buttons: { 3: true } })];
        const input = new InputManager(() => pads);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.gamepadCount, 2);
        assert.equal(input.isDown("KeyW"), false); // pad 2 never bound
    });

    it("frees the slot on disconnect and rebinds on reconnect", () => {
        let pads = [makePad({ index: 0, buttons: { 3: true } })];
        const input = new InputManager(() => pads);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.isDown("KeyW"), true);

        pads = [null]; // disconnected
        input.pollGamepads();
        assert.equal(input.gamepadCount, 0);
        assert.equal(input.isDown("KeyW"), false);

        pads = [makePad({ index: 0 })]; // back, nothing pressed
        input.pollGamepads();
        assert.equal(input.gamepadCount, 1);
        assert.equal(input.isDown("KeyW"), false);
    });

    it("merges keyboard and gamepad state", () => {
        const input = new InputManager(() => [makePad({ buttons: { 3: true } })]);
        input.menuMode = false;
        input._kb.Space = true; // simulate a held keyboard key
        input.pollGamepads();
        assert.equal(input.isDown("KeyW"), true); // from pad
        assert.equal(input.isDown("Space"), true); // from keyboard
    });

    it("handles a null getGamepads result", () => {
        const input = new InputManager(() => null);
        input.pollGamepads();
        assert.equal(input.gamepadCount, 0);
        assert.equal(input.isDown("KeyW"), false);
    });
});

describe("InputManager.analog", () => {
    it("reports partial stick deflection", () => {
        const half = DZ + (1 - DZ) / 2;
        const input = new InputManager(() => [makePad({ axes: [-half, 0] })]);
        input.menuMode = false;
        input.pollGamepads();
        assert.ok(Math.abs(input.analog("KeyA") - 0.5) < 1e-9);
        assert.equal(input.isDown("KeyA"), true); // binary view still works
    });

    it("reports 1 for digital sources (keyboard, d-pad)", () => {
        const input = new InputManager(() => [makePad({ buttons: { 14: true } })]);
        input.menuMode = false;
        input._kb.KeyE = true;
        input.pollGamepads();
        assert.equal(input.analog("KeyA"), 1); // d-pad
        assert.equal(input.analog("KeyE"), 1); // keyboard
    });

    it("reports partial trigger travel", () => {
        const input = new InputManager(() => [makePad({ buttons: { 7: 0.7 } })]);
        input.menuMode = false;
        input.pollGamepads();
        const expected = (0.7 - TRIG) / (1 - TRIG);
        assert.ok(Math.abs(input.analog("KeyE") - expected) < 1e-9);
    });

    it("reports 0 for unbound codes and after disconnect", () => {
        let pads = [makePad({ index: 0, axes: [-1, 0] })];
        const input = new InputManager(() => pads);
        input.menuMode = false;
        input.pollGamepads();
        assert.equal(input.analog("KeyA"), 1);
        assert.equal(input.analog("KeyD"), 0);

        pads = [null];
        input.pollGamepads();
        assert.equal(input.analog("KeyA"), 0);
    });
});

/* ── Tank integration: non-binary steering/turret ───────── */

function driveTank(input, seconds = 1) {
    const map = customMap([]);
    const t = new Tank(1, "#c33", "#822");
    t.alive = true;
    t.x = 32.5;
    t.y = 32.5;
    t.angle = 0;
    t.turretAngle = 0;
    const dt = 0.016;
    for (let i = 0; i < Math.round(seconds / dt); i++) t.update(dt, input, CONFIG.PLAYER1_KEYS, map);
    return t;
}

describe("analog steering (Tank integration)", () => {
    const analogInput = (code, amount) => ({
        isDown: () => false,
        analog: (c) => (c === CONFIG.PLAYER1_KEYS[code] ? amount : 0),
    });

    it("half stick turns the hull at half rate", () => {
        const full = driveTank(analogInput("right", 1)).angle;
        const half = driveTank(analogInput("right", 0.5)).angle;
        assert.ok(full > 0);
        assert.ok(Math.abs(half / full - 0.5) < 0.02, `expected half rate, got ratio ${half / full}`);
    });

    it("half trigger rotates the turret at half rate", () => {
        const full = driveTank(analogInput("turretRight", 1)).turretAngle;
        const half = driveTank(analogInput("turretRight", 0.5)).turretAngle;
        assert.ok(full > 0);
        assert.ok(Math.abs(half / full - 0.5) < 0.02, `expected half rate, got ratio ${half / full}`);
    });

    it("binary-only inputs (no analog method) still turn at full rate", () => {
        const analogFull = driveTank(analogInput("right", 1)).angle;
        const binaryInput = { isDown: (c) => c === CONFIG.PLAYER1_KEYS.right };
        const binary = driveTank(binaryInput).angle;
        assert.ok(Math.abs(binary - analogFull) < 1e-9);
    });
});
