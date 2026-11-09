import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { identifyController, parseSteamSlots } from "../electron/pads/identify.js";
import {
    ABS_HAT0X,
    ABS_HAT0Y,
    ABS_RX,
    ABS_RZ,
    ABS_X,
    EV_ABS,
    EV_KEY,
    EV_SYN,
    SYN_DROPPED,
} from "../electron/pads/kernel-codes.js";
import { PadReader } from "../electron/pads/pad-reader.js";
import { PadState } from "../electron/pads/pad-state.js";
import { ACTIONS as A, PAD_BUTTONS as B } from "../js/config.js";
import { gamepadToActions } from "../js/input.js";

const BTN_SOUTH = 0x130;
const BTN_EAST = 0x131;
const BTN_NORTH = 0x133;
const BTN_WEST = 0x134;
const BTN_TL = 0x136;
const BTN_TL2 = 0x138;
const BTN_START = 0x13b;
const BTN_MODE = 0x13c;

const SMALL_PAD = "057e:2009";
const STEAM_VIRTUAL = "28de:11ff";

const SLOT_FILE = `[slot 0]
name=Steam Controller
VID=0x28de
PID=0x1302
handle=0x0000aaaa
type=steam
[slot 1]
name=Nintendo Switch Pro Controller
VID=0x057e
PID=0x2009
handle=0x0000bbbb
type=switchpro
`;

describe("parseSteamSlots", () => {
    it("reads each slot's type and handle", () => {
        const slots = parseSteamSlots(SLOT_FILE);
        assert.deepEqual(slots.get("0"), { type: "steam", handle: "0x0000aaaa" });
        assert.deepEqual(slots.get("1"), { type: "switchpro", handle: "0x0000bbbb" });
    });

    it("has no slots for an empty file", () => {
        assert.equal(parseSteamSlots("").size, 0);
    });
});

describe("identifyController", () => {
    const slots = parseSteamSlots(SLOT_FILE);
    const virtualPad = (n) => ({
        node: "event9",
        name: `Microsoft X-Box 360 pad ${n}`,
        deviceId: STEAM_VIRTUAL,
        uniq: "",
    });

    it("counts a Steam Controller's virtual pad, because it has no node of its own", () => {
        const controller = identifyController(virtualPad(0), slots);
        assert.equal(controller.controlProfile, "twinStick");
        assert.equal(controller.identity, "steam:0x0000aaaa");
    });

    it("skips the virtual twin of a controller that has its own node, or it would join twice", () => {
        assert.equal(identifyController(virtualPad(1), slots), null);
    });

    it("skips a virtual pad Steam hasn't described yet, or any other Valve device", () => {
        assert.equal(identifyController(virtualPad(7), slots), null);
        assert.equal(
            identifyController({ node: "event4", name: "Steam Controller", deviceId: "28de:1302", uniq: "" }, slots),
            null,
        );
    });

    it("gives small pads the paddle layout, and other controllers the default", () => {
        const small = identifyController(
            { node: "event5", name: "Pro Controller", deviceId: SMALL_PAD, uniq: "x" },
            slots,
        );
        assert.equal(small.controlProfile, "paddles");
        const other = identifyController({ node: "event6", name: "Other", deviceId: "1209:5ee9", uniq: "" }, slots);
        assert.equal(other.controlProfile, "twinStick");
    });

    it("identifies an own-node pad by its serial, so a new node number is still the same pad", () => {
        const before = identifyController({ node: "event5", name: "P", deviceId: SMALL_PAD, uniq: "serial" }, slots);
        const after = identifyController({ node: "event99", name: "P", deviceId: SMALL_PAD, uniq: "serial" }, slots);
        assert.equal(before.identity, after.identity);
    });
});

describe("PadState", () => {
    const gamepad = (state) => state.toGamepad({ index: 0, id: "pad", controlProfile: "twinStick" });

    it("reports a press and a release as changes, and repeats as none", () => {
        const state = new PadState();
        assert.equal(state.apply(EV_KEY, BTN_SOUTH, 1), true);
        assert.equal(gamepad(state).buttons[B.FACE_BOTTOM].pressed, true);
        assert.equal(state.apply(EV_KEY, BTN_SOUTH, 2), false, "auto-repeat is still held");
        assert.equal(state.apply(EV_KEY, BTN_SOUTH, 0), true);
        assert.equal(gamepad(state).buttons[B.FACE_BOTTOM].pressed, false);
    });

    it("maps face buttons by true position", () => {
        const state = new PadState();
        for (const code of [BTN_SOUTH, BTN_EAST, BTN_WEST, BTN_NORTH]) state.apply(EV_KEY, code, 1);
        const { buttons } = gamepad(state);
        for (const button of [B.FACE_BOTTOM, B.FACE_RIGHT, B.FACE_LEFT, B.FACE_TOP]) {
            assert.equal(buttons[button].pressed, true);
        }
    });

    it("maps both paddles on each side", () => {
        const state = new PadState();
        state.apply(EV_KEY, BTN_TL, 1);
        state.apply(EV_KEY, BTN_TL2, 1);
        const { buttons } = gamepad(state);
        assert.equal(buttons[B.L1].pressed, true);
        assert.equal(buttons[B.L2].pressed, true);
    });

    it("ignores buttons the game has no use for: the Home button opens Steam", () => {
        const state = new PadState();
        assert.equal(state.apply(EV_KEY, BTN_MODE, 1), false);
    });

    it("turns hats into D-pad buttons and releases the opposite side", () => {
        const state = new PadState();
        state.apply(EV_ABS, ABS_HAT0X, -1);
        assert.equal(gamepad(state).buttons[B.DPAD_LEFT].pressed, true);
        state.apply(EV_ABS, ABS_HAT0X, 1);
        assert.equal(gamepad(state).buttons[B.DPAD_LEFT].pressed, false);
        assert.equal(gamepad(state).buttons[B.DPAD_RIGHT].pressed, true);
        state.apply(EV_ABS, ABS_HAT0X, 0);
        assert.equal(gamepad(state).buttons[B.DPAD_RIGHT].pressed, false);
        state.apply(EV_ABS, ABS_HAT0Y, -1);
        assert.equal(gamepad(state).buttons[B.DPAD_UP].pressed, true);
    });

    it("scales sticks and triggers to the Gamepad API's ranges", () => {
        const state = new PadState();
        state.apply(EV_ABS, ABS_X, -32768);
        state.apply(EV_ABS, ABS_RX, 16384);
        state.apply(EV_ABS, ABS_RZ, 255);
        const { axes, buttons } = gamepad(state);
        assert.equal(axes[0], -1);
        assert.equal(axes[2], 0.5);
        assert.equal(buttons[B.R2].value, 1);
        assert.equal(buttons[B.R2].pressed, true);
    });

    it("treats a part-pulled trigger as an analogue value that isn't yet pressed", () => {
        const state = new PadState();
        state.apply(EV_ABS, ABS_RZ, 100);
        assert.equal(gamepad(state).buttons[B.R2].pressed, false);
        assert.ok(gamepad(state).buttons[B.R2].value > 0.3);
    });

    it("reports no change for an idle stick's noise, so an idle pad sends nothing", () => {
        const state = new PadState();
        for (const noise of [1040, -1040, 2600, -2600, 300]) {
            assert.equal(state.apply(EV_ABS, ABS_X, noise), false, String(noise));
        }
    });

    it("clear() releases held buttons", () => {
        const state = new PadState();
        state.apply(EV_KEY, BTN_START, 1);
        state.clear();
        assert.equal(gamepad(state).buttons[B.START].pressed, false);
    });
});

function inputEvents(events) {
    const buffer = Buffer.alloc(events.length * 24);
    events.forEach(([type, code, value], i) => {
        buffer.writeUInt16LE(type, i * 24 + 16);
        buffer.writeUInt16LE(code, i * 24 + 18);
        buffer.writeInt32LE(value, i * 24 + 20);
    });
    return buffer;
}

/** A fake /sys/class/input and /dev/input, with event nodes as plain files. */
class FakeInputTree {
    constructor(root) {
        this.sys = path.join(root, "sys");
        this.dev = path.join(root, "dev");
        fs.mkdirSync(this.sys);
        fs.mkdirSync(this.dev);
    }

    addNode(node, { name, deviceId, uniq = "", joystick = true }) {
        const device = path.join(this.sys, node, "device");
        fs.mkdirSync(path.join(device, "id"), { recursive: true });
        const [vendor, product] = deviceId.split(":");
        fs.writeFileSync(path.join(device, "name"), `${name}\n`);
        fs.writeFileSync(path.join(device, "id/vendor"), `${vendor}\n`);
        fs.writeFileSync(path.join(device, "id/product"), `${product}\n`);
        fs.writeFileSync(path.join(device, "uniq"), `${uniq}\n`);
        if (joystick) fs.mkdirSync(path.join(device, "js0"));
        fs.writeFileSync(path.join(this.dev, node), "");
    }

    removeNode(node) {
        fs.rmSync(path.join(this.sys, node), { recursive: true });
        fs.rmSync(path.join(this.dev, node));
    }

    send(node, events) {
        fs.appendFileSync(path.join(this.dev, node), inputEvents(events));
    }
}

describe("PadReader", () => {
    let root;
    let tree;
    let reader;
    let slotText;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tanked-pads-"));
        tree = new FakeInputTree(root);
        slotText = SLOT_FILE;
        reader = new PadReader({
            sysClassInput: tree.sys,
            devInput: tree.dev,
            readSteamSlots: () => parseSteamSlots(slotText),
        });
    });

    afterEach(() => {
        reader.close();
        fs.rmSync(root, { recursive: true });
    });

    const addSmallPad = (node, uniq) => tree.addNode(node, { name: "Pro Controller", deviceId: SMALL_PAD, uniq });
    const addVirtualPad = (node, slot) =>
        tree.addNode(node, { name: `Microsoft X-Box 360 pad ${slot}`, deviceId: STEAM_VIRTUAL });

    it("sees five controllers as five separate players, with twins skipped", () => {
        addVirtualPad("event20", 0);
        addVirtualPad("event21", 1); // a small pad's twin
        addSmallPad("event30", "pad-a");
        addSmallPad("event31", "pad-b");
        addSmallPad("event32", "pad-c");
        tree.addNode("event33", { name: "Other Pad", deviceId: "1209:5ee9" });
        tree.addNode("event1", { name: "Keyboard", deviceId: "1234:0001", joystick: false });
        reader.scan();
        assert.equal(reader.pads.length, 5);
        assert.equal(new Set(reader.pads.map((pad) => pad.index)).size, 5);
        assert.ok(!reader.pads.some((pad) => pad.node === "event21"));
    });

    it("delivers a press end to end, through the mapping the game uses", () => {
        addSmallPad("event30", "pad-a");
        addVirtualPad("event20", 0);
        reader.scan();
        reader.takeChangedSnapshot();

        tree.send("event30", [
            [EV_KEY, BTN_TL2, 1],
            [EV_SYN, 0, 0],
        ]);
        tree.send("event20", [
            [EV_ABS, ABS_RZ, 255],
            [EV_SYN, 0, 0],
        ]);
        reader.drain();

        const pads = reader.takeChangedSnapshot();
        const small = pads.find((pad) => pad.controlProfile === "paddles");
        const steam = pads.find((pad) => pad.controlProfile === "twinStick");
        assert.ok(gamepadToActions(small).held.has(A.turretLeft));
        assert.ok(gamepadToActions(steam).held.has(A.fire));
        assert.ok(!gamepadToActions(steam).held.has(A.turretLeft));
    });

    it("has no snapshot to send when nothing changed", () => {
        addSmallPad("event30", "pad-a");
        reader.scan();
        assert.ok(reader.takeChangedSnapshot());
        assert.equal(reader.takeChangedSnapshot(), null);
        tree.send("event30", [
            [EV_ABS, ABS_X, 1040],
            [EV_SYN, 0, 0],
        ]);
        reader.drain();
        assert.equal(reader.takeChangedSnapshot(), null, "stick noise should send nothing");
    });

    it("reads events split across more than one buffer's worth", () => {
        addSmallPad("event30", "pad-a");
        reader.scan();
        const flood = [];
        for (let i = 0; i < 1500; i++) flood.push([EV_KEY, BTN_START, i % 2]);
        flood.push([EV_KEY, BTN_SOUTH, 1]);
        tree.send("event30", flood);
        reader.drain();
        assert.equal(reader.snapshot()[0].buttons[B.FACE_BOTTOM].pressed, true);
    });

    it("gives a pad that goes away and returns on a new node its old index", () => {
        addSmallPad("event30", "pad-a");
        addSmallPad("event31", "pad-b");
        reader.scan();
        const indexOfB = reader.pads.find((pad) => pad.node === "event31").index;

        tree.removeNode("event31");
        reader.scan();
        assert.equal(reader.pads.length, 1);

        addSmallPad("event44", "pad-b");
        reader.scan();
        assert.equal(reader.pads.find((pad) => pad.node === "event44").index, indexOfB);
    });

    it("gives a new pad a new index rather than reusing a pad that went away", () => {
        addSmallPad("event30", "pad-a");
        reader.scan();
        tree.removeNode("event30");
        reader.scan();
        addSmallPad("event31", "pad-b");
        reader.scan();
        assert.equal(reader.pads[0].index, 1);
    });

    it("drops a held button when events were lost, so nothing sticks on", () => {
        addSmallPad("event30", "pad-a");
        reader.scan();
        tree.send("event30", [
            [EV_KEY, BTN_SOUTH, 1],
            [EV_SYN, 0, 0],
        ]);
        reader.drain();
        assert.equal(reader.snapshot()[0].buttons[B.FACE_BOTTOM].pressed, true);

        tree.send("event30", [[EV_SYN, SYN_DROPPED, 0]]);
        reader.drain();
        assert.equal(reader.takeChangedSnapshot()[0].buttons[B.FACE_BOTTOM].pressed, false);
    });

    it("picks up a virtual pad as soon as Steam says it is a Steam Controller", () => {
        addVirtualPad("event20", 5);
        reader.scan();
        assert.equal(reader.pads.length, 0);
        slotText += "[slot 5]\nhandle=0x0000cccc\ntype=steam\n";
        reader.scan();
        assert.equal(reader.pads.length, 1);
    });

    it("stops reading a virtual pad that Steam reassigns to a small pad", () => {
        addVirtualPad("event20", 0);
        reader.scan();
        assert.equal(reader.pads.length, 1);
        slotText = "[slot 0]\nhandle=0x0000bbbb\ntype=switchpro\n";
        reader.scan();
        assert.equal(reader.pads.length, 0);
    });

    it("drops a pad whose read fails, and tells whoever is listening", () => {
        const changes = [];
        const watched = new PadReader({
            sysClassInput: tree.sys,
            devInput: tree.dev,
            readSteamSlots: () => new Map(),
            onDevicesChanged: (pads) => changes.push(pads.length),
        });
        addSmallPad("event30", "pad-a");
        watched.scan();
        fs.closeSync(watched._pads.get("event30").fd);
        watched.drain();
        assert.deepEqual(changes, [1, 0]);
        assert.equal(watched.pads.length, 0);
        watched.close();
    });
});
