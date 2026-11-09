import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, PAD_BUTTONS as B, CONFIG } from "../js/config.js";
import {
    anyPressed,
    firstPresser,
    GamepadDevice,
    gamepadToActions,
    InputManager,
    KeyboardDevice,
} from "../js/input.js";

/* ── Fake gamepad factory ─────────────────────────────────
 * buttons: { index: true | 0..1 }  — true = digital press,
 * number = analogue value (pressed when > 0.5, like the spec).
 */
function makePad({ index = 0, axes = [0, 0, 0, 0], buttons = {}, connected = true, controlProfile } = {}) {
    const arr = Array.from({ length: 17 }, (_, i) => {
        const b = buttons[i];
        if (typeof b === "number") return { pressed: b > 0.5, value: b };
        return { pressed: !!b, value: b ? 1 : 0 };
    });
    return { index, connected, controlProfile, mapping: "standard", axes, buttons: arr };
}

const A = ACTIONS;

describe("gamepadToActions", () => {
    it("maps face buttons to throttle", () => {
        assert.ok(gamepadToActions(makePad({ buttons: { 3: true } })).held.has(A.forward));
        assert.ok(gamepadToActions(makePad({ buttons: { 2: true } })).held.has(A.backward));
    });

    it("maps bottom face to fire + confirm", () => {
        const held = gamepadToActions(makePad({ buttons: { [B.FACE_BOTTOM]: true } })).held;
        assert.ok(held.has(A.fire));
        assert.ok(held.has(A.confirm));
    });

    it("right face backs out without firing, so firing with it can't quit the result screen", () => {
        const held = gamepadToActions(makePad({ buttons: { [B.FACE_RIGHT]: true } })).held;
        assert.ok(held.has(A.back));
        assert.ok(!held.has(A.fire));
        assert.ok(!held.has(A.confirm));
    });

    it("Start confirms and pauses without firing", () => {
        const held = gamepadToActions(makePad({ buttons: { [B.START]: true } })).held;
        assert.ok(held.has(A.confirm));
        assert.ok(held.has(A.pause));
        assert.ok(!held.has(A.fire));
    });

    it("maps d-pad left/right to steering", () => {
        assert.ok(gamepadToActions(makePad({ buttons: { 14: true } })).held.has(A.left));
        assert.ok(gamepadToActions(makePad({ buttons: { 15: true } })).held.has(A.right));
    });

    it("maps d-pad up/down to forward/up and backward/down", () => {
        const held = gamepadToActions(makePad({ buttons: { 12: true, 13: true } })).held;
        assert.ok(held.has(A.forward) && held.has(A.up));
        assert.ok(held.has(A.backward) && held.has(A.down));
    });

    it("maps the left stick to throttle and steering with analog magnitude", () => {
        const up = gamepadToActions(makePad({ axes: [0, -1] }));
        assert.ok(up.held.has(A.forward) && up.held.has(A.up));
        const left = gamepadToActions(makePad({ axes: [-1, 0] }));
        assert.ok(left.held.has(A.left));
        assert.equal(left.axes[A.left], 1);
    });

    it("maps the left face button to backward + switch-team", () => {
        const held = gamepadToActions(makePad({ buttons: { 2: true } })).held;
        assert.ok(held.has(A.backward));
        assert.ok(held.has(A.cycleTeam));
    });
});

describe("twin-stick layout (Steam Controllers, and any pad the Gamepad API reports)", () => {
    const twinStick = (pad) => gamepadToActions(makePad({ ...pad, controlProfile: "twinStick" }));

    it("is the layout of a pad that names no profile", () => {
        assert.ok(gamepadToActions(makePad({ buttons: { [B.R2]: true } })).held.has(A.fire));
    });

    it("turns the turret from the right stick, at a speed set by how far it is pushed", () => {
        const half = twinStick({ axes: [0, 0, -0.675, 0] });
        assert.ok(half.held.has(A.turretLeft));
        assert.ok(Math.abs(half.axes[A.turretLeft] - 0.5) < 0.001);
        assert.equal(twinStick({ axes: [0, 0, 1, 0] }).axes[A.turretRight], 1);
    });

    it("ignores a resting stick's noise", () => {
        const { held } = twinStick({ axes: [0.03, -0.03, 0.03, -0.03] });
        assert.equal(held.size, 0);
    });

    it("drives from the left stick without touching the turret", () => {
        const { held } = twinStick({ axes: [-1, -1, 0, 0] });
        assert.ok(held.has(A.left) && held.has(A.forward));
        assert.ok(!held.has(A.turretLeft));
    });

    it("fires from the right trigger once it passes the pull threshold", () => {
        const pull = (value) => twinStick({ buttons: { [B.R2]: value } }).held.has(A.fire);
        assert.ok(!pull(CONFIG.GAMEPAD_TRIGGER_THRESHOLD - 0.05));
        assert.ok(pull(CONFIG.GAMEPAD_TRIGGER_THRESHOLD + 0.05));
    });

    it("turns the turret from the bumpers as well, for anyone without a working right stick", () => {
        assert.ok(twinStick({ buttons: { [B.L1]: true } }).held.has(A.turretLeft));
        assert.ok(twinStick({ buttons: { [B.R1]: true } }).held.has(A.turretRight));
    });
});

describe("paddle layout (small pads with no sticks)", () => {
    const paddles = (pad) => gamepadToActions(makePad({ ...pad, controlProfile: "paddles" }));

    it("turns the turret left from L and L2, and right from R and R2", () => {
        for (const button of [B.L1, B.L2]) {
            assert.ok(paddles({ buttons: { [button]: true } }).held.has(A.turretLeft));
        }
        for (const button of [B.R1, B.R2]) {
            assert.ok(paddles({ buttons: { [button]: true } }).held.has(A.turretRight));
        }
    });

    it("never fires from a paddle: R2 is for the turret here", () => {
        assert.ok(!paddles({ buttons: { [B.R2]: true } }).held.has(A.fire));
    });

    it("drives from a D-pad the kernel reports as a left stick", () => {
        const { held, axes } = paddles({ axes: [-1, -1, 0, 0] });
        assert.ok(held.has(A.left) && held.has(A.forward));
        assert.equal(axes[A.left], 1);
    });

    it("fires from the bottom button", () => {
        assert.ok(paddles({ buttons: { [B.FACE_BOTTOM]: true } }).held.has(A.fire));
    });
});

describe("pause chord (holding L + R on a small pad)", () => {
    const LEFT_AND_RIGHT = { [B.L1]: true, [B.R1]: true };
    const frame = (device, buttons) => {
        device.endFrame();
        device.update(makePad({ controlProfile: "paddles", buttons }));
    };

    it("pauses once, after the hold time, and only once per hold", () => {
        const device = new GamepadDevice(0);
        let presses = 0;
        for (let i = 0; i < CONFIG.PAUSE_CHORD_HOLD_FRAMES * 3; i++) {
            frame(device, LEFT_AND_RIGHT);
            if (device.wasPressed(A.pause)) presses++;
            if (i === CONFIG.PAUSE_CHORD_HOLD_FRAMES - 2) assert.equal(presses, 0, "pressed before the hold time");
        }
        assert.equal(presses, 1);
    });

    it("doesn't pause when rolling from one paddle to the other", () => {
        const device = new GamepadDevice(0);
        for (let i = 0; i < CONFIG.PAUSE_CHORD_HOLD_FRAMES * 3; i++) {
            const overlap = i % 20 < 5;
            frame(device, overlap ? LEFT_AND_RIGHT : { [B.L1]: true });
            assert.ok(!device.wasPressed(A.pause));
        }
    });

    it("isn't a chord on a twin-stick pad, whose bumpers can be held together while aiming", () => {
        const device = new GamepadDevice(0);
        for (let i = 0; i < CONFIG.PAUSE_CHORD_HOLD_FRAMES * 2; i++) {
            device.update(makePad({ controlProfile: "twinStick", buttons: LEFT_AND_RIGHT }));
            assert.ok(!device.isDown(A.pause));
        }
    });
});

describe("KeyboardDevice", () => {
    it("maps WASD/arrows to forward/backward/left/right", () => {
        const k = new KeyboardDevice();
        k._onKeyDown("KeyW");
        k.refresh();
        assert.ok(k.isDown(A.forward));
        assert.ok(k.isDown(A.up));
        k._onKeyUp("KeyW");
        k._onKeyDown("ArrowRight");
        k.refresh();
        assert.ok(!k.isDown(A.forward));
        assert.ok(k.isDown(A.right));
    });

    it("produces one-frame press edges", () => {
        const k = new KeyboardDevice();
        k._onKeyDown("Space");
        k.refresh();
        assert.ok(k.wasPressed(A.fire));
        assert.ok(k.wasPressed(A.confirm));
        k.endFrame();
        k.refresh();
        assert.ok(!k.wasPressed(A.fire));
        assert.ok(k.isDown(A.fire));
    });

    it("maps Tab to switch-team", () => {
        const k = new KeyboardDevice();
        k._onKeyDown("Tab");
        k.refresh();
        assert.ok(k.isDown(A.cycleTeam));
    });
});

describe("GamepadDevice", () => {
    it("tracks held actions and press edges across updates", () => {
        const d = new GamepadDevice(0);
        d.update(makePad({ index: 0, buttons: { 3: true } }));
        assert.ok(d.isDown(A.forward));
        assert.ok(d.wasPressed(A.forward));
        d.endFrame();
        d.update(makePad({ index: 0, buttons: { 3: true } }));
        assert.ok(!d.wasPressed(A.forward));
        assert.ok(d.isDown(A.forward));
    });

    it("marks disconnected and clears state when given null", () => {
        const d = new GamepadDevice(0);
        d.update(makePad({ index: 0, buttons: { 3: true } }));
        assert.ok(d.connected);
        d.update(null);
        assert.ok(!d.connected);
        assert.ok(!d.isDown(A.forward));
    });
});

describe("who pressed", () => {
    it("finds the pad that pressed, not just that someone did", () => {
        const pads = [makePad({ index: 0 }), makePad({ index: 1, buttons: { [B.START]: true } })];
        const input = new InputManager(() => pads);
        input.poll();
        assert.equal(firstPresser(input, A.pause), input.connectedGamepads[1]);
        assert.ok(anyPressed(input, A.pause));
        assert.equal(firstPresser(input, A.back), null);
        assert.ok(!anyPressed(input, A.back));
    });

    it("finds the keyboard", () => {
        const input = new InputManager(() => []);
        input.keyboard._onKeyDown("KeyP");
        input.poll();
        assert.equal(firstPresser(input, A.pause), input.keyboard);
    });
});

describe("InputManager device registry", () => {
    it("polls keyboard edges", () => {
        const input = new InputManager(() => []);
        input.keyboard._onKeyDown("KeyW");
        input.poll();
        assert.ok(input.keyboard.isDown(A.forward));
        assert.ok(input.keyboard.wasPressed(A.forward));
        input.endFrame();
        input.poll();
        assert.ok(!input.keyboard.wasPressed(A.forward));
    });

    it("registers gamepads by index and exposes the connected list", () => {
        const pads = [makePad({ index: 0, buttons: { 3: true } }), makePad({ index: 1, buttons: { 13: true } })];
        const input = new InputManager(() => pads);
        input.poll();
        assert.equal(input.connectedGamepads.length, 2);
        assert.ok(input.connectedGamepads[0].isDown(A.forward));
        assert.ok(input.connectedGamepads[1].isDown(A.down));
    });

    it("marks a vanished pad as disconnected", () => {
        let pads = [makePad({ index: 0, buttons: { 3: true } })];
        const input = new InputManager(() => pads);
        input.poll();
        assert.equal(input.connectedGamepads.length, 1);
        pads = [];
        input.poll();
        assert.equal(input.connectedGamepads.length, 0);
    });

    it("reports per-device confirm presses (join events)", () => {
        const pads = [makePad({ index: 0, buttons: { 0: true } })];
        const input = new InputManager(() => pads);
        input.poll();
        assert.ok(input.connectedGamepads[0].wasPressed(A.confirm));
        assert.ok(!input.keyboard.wasPressed(A.confirm));
    });

    it("clears edges on endFrame", () => {
        const pads = [makePad({ index: 0, buttons: { 0: true } })];
        const input = new InputManager(() => pads);
        input.poll();
        assert.ok(input.connectedGamepads[0].wasPressed(A.confirm));
        input.endFrame();
        assert.ok(!input.connectedGamepads[0].wasPressed(A.confirm));
    });

    it("keeps the same device when a pad goes away and comes back, so its player gets it back", () => {
        let pads = [makePad({ index: 3 })];
        const input = new InputManager(() => pads);
        input.poll();
        const device = input.connectedGamepads[0];
        pads = [];
        input.poll();
        pads = [makePad({ index: 3, buttons: { [B.FACE_BOTTOM]: true } })];
        input.poll();
        assert.equal(input.connectedGamepads[0], device);
        assert.ok(device.isDown(A.fire));
    });

    it("handles a null getGamepads result", () => {
        const input = new InputManager(() => null);
        input.poll();
        assert.equal(input.connectedGamepads.length, 0);
    });
});
