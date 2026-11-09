/**
 * Reads controllers straight from the kernel's event nodes.
 *
 * Chromium's Gamepad API can't do split screen under Steam: it treats all of
 * Steam's virtual pads as one device and keeps only the last.  Calling it also
 * opens the controllers' raw HID nodes, which fights Steam for them, so nothing
 * in this shell may ever call navigator.getGamepads().
 */

import fs from "node:fs";
import path from "node:path";
import { identifyController } from "./identify.js";
import {
    EV_SYN,
    INPUT_EVENT_BYTES,
    INPUT_EVENT_CODE_OFFSET,
    INPUT_EVENT_TYPE_OFFSET,
    INPUT_EVENT_VALUE_OFFSET,
    SYN_DROPPED,
} from "./kernel-codes.js";
import { PadState } from "./pad-state.js";

const EVENT_NODE = /^event\d+$/;
const JOYSTICK_CHILD = /^js\d+$/;
const READ_BUFFER_EVENTS = 512;

function readSysText(file) {
    try {
        return fs.readFileSync(file, "utf8").trim();
    } catch {
        return "";
    }
}

export class PadReader {
    /**
     * @param {object} options
     * @param {string} [options.sysClassInput]  injectable for tests
     * @param {string} [options.devInput]       injectable for tests
     * @param {() => Map} options.readSteamSlots  see parseSteamSlots
     * @param {(pad: object, type: number, code: number, value: number) => void} [options.onEvent]
     * @param {(pads: object[]) => void} [options.onDevicesChanged]
     */
    constructor({
        sysClassInput = "/sys/class/input",
        devInput = "/dev/input",
        readSteamSlots,
        onEvent = () => {},
        onDevicesChanged = () => {},
    }) {
        this._sysClassInput = sysClassInput;
        this._devInput = devInput;
        this._readSteamSlots = readSteamSlots;
        this._onEvent = onEvent;
        this._onDevicesChanged = onDevicesChanged;
        /** @type {Map<string, object>} open pads by node name */
        this._pads = new Map();
        /** A controller keeps its index for the whole run, so a returning pad rebinds to its player. */
        this._indexOfIdentity = new Map();
        this._buffer = Buffer.alloc(INPUT_EVENT_BYTES * READ_BUFFER_EVENTS);
        this._changed = true;
    }

    /** Find added, removed and reclassified controllers.  Call about once a second. */
    scan() {
        const steamSlots = this._readSteamSlots();
        const wanted = new Map();
        for (const device of this._listJoystickNodes()) {
            const controller = identifyController(device, steamSlots);
            if (controller) wanted.set(device.node, { ...device, ...controller });
        }
        let devicesChanged = false;
        for (const node of [...this._pads.keys()]) {
            if (!wanted.has(node)) {
                this._close(node);
                devicesChanged = true;
            }
        }
        for (const [node, device] of wanted) {
            const pad = this._pads.get(node);
            if (pad) {
                pad.controlProfile = device.controlProfile;
            } else if (this._open(device)) {
                devicesChanged = true;
            }
        }
        if (devicesChanged) {
            this._changed = true;
            this._onDevicesChanged(this.pads);
        }
    }

    /** Apply everything the kernel has queued.  Call as often as input should be fresh. */
    drain() {
        for (const pad of [...this._pads.values()]) this._drainPad(pad);
    }

    /** @returns {object[]} a description of each open controller */
    get pads() {
        return [...this._pads.values()].map(({ node, name, deviceId, index, controlProfile }) => ({
            node,
            name,
            deviceId,
            index,
            controlProfile,
        }));
    }

    /** The current Gamepad snapshots, regardless of whether anything changed. */
    snapshot() {
        this._changed = false;
        return [...this._pads.values()].map((pad) => pad.state.toGamepad({ ...pad, id: pad.name }));
    }

    /** Snapshots if anything changed since the last call, otherwise null. */
    takeChangedSnapshot() {
        return this._changed ? this.snapshot() : null;
    }

    close() {
        for (const node of [...this._pads.keys()]) this._close(node);
    }

    _listJoystickNodes() {
        const devices = [];
        for (const node of fs.readdirSync(this._sysClassInput)) {
            if (!EVENT_NODE.test(node)) continue;
            const deviceDir = path.join(this._sysClassInput, node, "device");
            let children;
            try {
                children = fs.readdirSync(deviceDir);
            } catch {
                continue; // The device vanished while we listed it.
            }
            if (!children.some((child) => JOYSTICK_CHILD.test(child))) continue;
            devices.push({
                node,
                name: readSysText(path.join(deviceDir, "name")),
                deviceId: `${readSysText(path.join(deviceDir, "id/vendor"))}:${readSysText(path.join(deviceDir, "id/product"))}`,
                uniq: readSysText(path.join(deviceDir, "uniq")),
            });
        }
        return devices;
    }

    _open(device) {
        let fd;
        try {
            fd = fs.openSync(path.join(this._devInput, device.node), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        } catch {
            return false; // Rescanned shortly; the node may not have its permissions yet.
        }
        this._pads.set(device.node, { ...device, fd, index: this._indexOf(device.identity), state: new PadState() });
        return true;
    }

    _indexOf(identity) {
        if (!this._indexOfIdentity.has(identity)) this._indexOfIdentity.set(identity, this._indexOfIdentity.size);
        return this._indexOfIdentity.get(identity);
    }

    _close(node) {
        const pad = this._pads.get(node);
        this._pads.delete(node);
        try {
            fs.closeSync(pad.fd);
        } catch {
            // The device has already gone.
        }
    }

    _drainPad(pad) {
        for (;;) {
            let bytes;
            try {
                bytes = fs.readSync(pad.fd, this._buffer, 0, this._buffer.length, null);
            } catch (error) {
                if (error.code !== "EAGAIN") this._drop(pad);
                return;
            }
            this._applyEvents(pad, bytes);
            if (bytes < this._buffer.length) return;
        }
    }

    /** A pad that fails a read has been turned off; its node stays until the next scan. */
    _drop(pad) {
        this._close(pad.node);
        this._changed = true;
        this._onDevicesChanged(this.pads);
    }

    _applyEvents(pad, bytes) {
        for (let start = 0; start + INPUT_EVENT_BYTES <= bytes; start += INPUT_EVENT_BYTES) {
            const type = this._buffer.readUInt16LE(start + INPUT_EVENT_TYPE_OFFSET);
            const code = this._buffer.readUInt16LE(start + INPUT_EVENT_CODE_OFFSET);
            const value = this._buffer.readInt32LE(start + INPUT_EVENT_VALUE_OFFSET);
            if (type === EV_SYN) {
                // Events were lost, so any "held" state may be stale.  Releases may be
                // among them, and a stuck button is worse than one pressed again.
                if (code === SYN_DROPPED) {
                    pad.state.clear();
                    this._changed = true;
                }
                continue;
            }
            if (pad.state.apply(type, code, value)) this._changed = true;
            this._onEvent(pad, type, code, value);
        }
    }
}
