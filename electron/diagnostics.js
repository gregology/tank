/**
 * The plain-text report `--diagnose` writes: GPU, screen, frame rate, and the
 * controllers the game sees with every button press.  Raw kernel codes go in
 * as well, because they are how a new controller's layout gets worked out.
 */

import fs from "node:fs";
import { EV_ABS, EV_KEY, STICK_AXIS_OF_ABS } from "./pads/kernel-codes.js";

const WINDOW_FRAMES = 600;

/**
 * @param {number[]} frameMs  time between frames, in milliseconds
 * @returns {{frames: number, averageFps: number, onePercentLowFps: number, worstFrameMs: number}|null}
 */
export function summarizeFrames(frameMs) {
    if (frameMs.length === 0) return null;
    const slowestFirst = [...frameMs].sort((a, b) => b - a);
    const slowest = slowestFirst.slice(0, Math.max(1, Math.floor(frameMs.length / 100)));
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        frames: frameMs.length,
        averageFps: 1000 / mean(frameMs),
        onePercentLowFps: 1000 / mean(slowest),
        worstFrameMs: slowestFirst[0],
    };
}

function describeFrames({ frames, averageFps, onePercentLowFps, worstFrameMs }) {
    return `${frames} frames: average ${averageFps.toFixed(1)} fps, 1% low ${onePercentLowFps.toFixed(1)} fps, worst frame ${worstFrameMs.toFixed(1)} ms`;
}

export class DiagnosticReport {
    constructor(file, now = Date.now) {
        this._fd = fs.openSync(file, "a");
        this._now = now;
        this._startedAt = now();
        this._allFrames = [];
        this._window = [];
    }

    line(text) {
        // Controllers keep reporting between the app starting to quit and it exiting.
        if (this._fd === null) return;
        const seconds = ((this._now() - this._startedAt) / 1000).toFixed(2).padStart(8);
        fs.writeSync(this._fd, `${seconds}s  ${text}\n`);
    }

    /** One line for every button and non-stick axis: sticks report hundreds of times a second. */
    logPadEvent(pad, type, code, value) {
        if (type !== EV_KEY && (type !== EV_ABS || STICK_AXIS_OF_ABS.has(code))) return;
        const kind = type === EV_KEY ? "key" : "abs";
        this.line(`pad ${pad.index} (${pad.node}, ${pad.controlProfile}) ${kind} 0x${code.toString(16)} = ${value}`);
    }

    logPads(pads) {
        this.line(`controllers: ${pads.length}`);
        for (const { index, node, name, deviceId, controlProfile } of pads) {
            this.line(`  pad ${index}: ${name} [${deviceId}] on ${node}, ${controlProfile} layout`);
        }
    }

    addFrames(frameMs) {
        this._allFrames.push(...frameMs);
        this._window.push(...frameMs);
        if (this._window.length < WINDOW_FRAMES) return;
        this.line(`frame rate, ${describeFrames(summarizeFrames(this._window))}`);
        this._window = [];
    }

    finish() {
        const overall = summarizeFrames(this._allFrames);
        if (overall) this.line(`frame rate over the whole run, ${describeFrames(overall)}`);
        fs.closeSync(this._fd);
        this._fd = null;
    }
}
