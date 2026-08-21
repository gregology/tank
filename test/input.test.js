import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS } from "../js/config.js";
import { GamepadDevice, gamepadToActions, InputManager, KeyboardDevice } from "../js/input.js";

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

const A = ACTIONS;

describe("gamepadToActions", () => {
    it("maps face buttons to throttle", () => {
        assert.ok(gamepadToActions(makePad({ buttons: { 3: true } })).held.has(A.forward));
        assert.ok(gamepadToActions(makePad({ buttons: { 2: true } })).held.has(A.backward));
    });

    it("maps bottom face to fire + confirm, right face to fire + back", () => {
        const bottom = gamepadToActions(makePad({ buttons: { 0: true } })).held;
        assert.ok(bottom.has(A.fire));
        assert.ok(bottom.has(A.confirm));
        const right = gamepadToActions(makePad({ buttons: { 1: true } })).held;
        assert.ok(right.has(A.fire));
        assert.ok(right.has(A.back));
        assert.ok(!right.has(A.confirm));
    });

    it("maps Start to fire + confirm", () => {
        const held = gamepadToActions(makePad({ buttons: { 9: true } })).held;
        assert.ok(held.has(A.fire));
        assert.ok(held.has(A.confirm));
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

    it("maps triggers to turret rotation (digital + analog)", () => {
        const lt = gamepadToActions(makePad({ buttons: { 6: true } }));
        assert.ok(lt.held.has(A.turretLeft));
        assert.equal(lt.axes[A.turretLeft], 1);
        assert.ok(gamepadToActions(makePad({ buttons: { 7: true } })).held.has(A.turretRight));
    });

    it("maps the left face button to backward + switch-team", () => {
        const held = gamepadToActions(makePad({ buttons: { 2: true } })).held;
        assert.ok(held.has(A.backward));
        assert.ok(held.has(A.cycleTeam));
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

    it("handles a null getGamepads result", () => {
        const input = new InputManager(() => null);
        input.poll();
        assert.equal(input.connectedGamepads.length, 0);
    });
});
