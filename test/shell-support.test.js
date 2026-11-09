import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DiagnosticReport, summarizeFrames } from "../electron/diagnostics.js";
import { readLaunchOptions } from "../electron/launch-options.js";
import { ABS_HAT0X, ABS_X, EV_ABS, EV_KEY } from "../electron/pads/kernel-codes.js";

let dir;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tanked-shell-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true });
});

describe("readLaunchOptions", () => {
    const missing = () => path.join(dir, "next_launch_args.txt");

    it("has nothing set by default", () => {
        assert.deepEqual(readLaunchOptions([], missing()), {
            diagnose: false,
            demo: null,
            quitAtSeconds: null,
            shotSeconds: [],
        });
    });

    it("reads the command line", () => {
        const options = readLaunchOptions(
            ["--diagnose", "--demo=battle-4p", "--quit-at=40", "--shots=5,20"],
            missing(),
        );
        assert.deepEqual(options, { diagnose: true, demo: "battle-4p", quitAtSeconds: 40, shotSeconds: [5, 20] });
    });

    it("uses the one-shot file for exactly one launch, because it is deleted", () => {
        const file = missing();
        fs.writeFileSync(file, "--diagnose\n--quit-at=9\n");
        const first = readLaunchOptions([], file);
        assert.equal(first.diagnose, true);
        assert.equal(first.quitAtSeconds, 9);
        assert.ok(!fs.existsSync(file));
        assert.equal(readLaunchOptions([], file).diagnose, false);
    });
});

describe("summarizeFrames", () => {
    it("reports average, 1% low and worst", () => {
        const frames = new Array(99).fill(10).concat([110]);
        const summary = summarizeFrames(frames);
        assert.equal(summary.frames, 100);
        assert.ok(Math.abs(summary.averageFps - 1000 / 11) < 0.01);
        assert.ok(Math.abs(summary.onePercentLowFps - 1000 / 110) < 0.01);
        assert.equal(summary.worstFrameMs, 110);
    });

    it("still has a 1% low with under a hundred frames", () => {
        assert.equal(summarizeFrames([10, 20]).worstFrameMs, 20);
        assert.equal(summarizeFrames([10, 20]).onePercentLowFps, 50);
    });

    it("has no summary without frames", () => {
        assert.equal(summarizeFrames([]), null);
    });
});

describe("DiagnosticReport", () => {
    const pad = { index: 2, node: "event30", controlProfile: "paddles" };
    const read = (file) => fs.readFileSync(file, "utf8");

    it("records every button with its raw code, because that's how a new pad gets worked out", () => {
        const file = path.join(dir, "r.txt");
        const report = new DiagnosticReport(file, () => 0);
        report.logPadEvent(pad, EV_KEY, 0x138, 1);
        report.logPadEvent(pad, EV_KEY, 0x2c0, 1);
        report.logPadEvent(pad, EV_ABS, ABS_HAT0X, -1);
        report.finish();
        const text = read(file);
        assert.match(text, /pad 2 \(event30, paddles\) key 0x138 = 1/);
        assert.match(text, /key 0x2c0 = 1/);
        assert.match(text, /abs 0x10 = -1/);
    });

    it("leaves out sticks, which report hundreds of times a second", () => {
        const file = path.join(dir, "r.txt");
        const report = new DiagnosticReport(file, () => 0);
        report.logPadEvent(pad, EV_ABS, ABS_X, 20000);
        report.finish();
        assert.equal(read(file), "");
    });

    it("lists controllers", () => {
        const file = path.join(dir, "r.txt");
        const report = new DiagnosticReport(file, () => 0);
        report.logPads([{ ...pad, name: "Pro Controller", deviceId: "057e:2009" }]);
        report.finish();
        assert.match(read(file), /controllers: 1/);
        assert.match(read(file), /pad 2: Pro Controller \[057e:2009\] on event30, paddles layout/);
    });

    it("ignores controller events that arrive after it has finished, while the app is quitting", () => {
        const file = path.join(dir, "r.txt");
        const report = new DiagnosticReport(file, () => 0);
        report.finish();
        assert.doesNotThrow(() => report.logPadEvent(pad, EV_KEY, 0x130, 1));
        assert.equal(read(file), "");
    });

    it("writes the frame rate in windows and over the whole run", () => {
        const file = path.join(dir, "r.txt");
        const report = new DiagnosticReport(file, () => 0);
        report.addFrames(new Array(600).fill(10));
        report.addFrames(new Array(10).fill(20));
        report.finish();
        const lines = read(file).trim().split("\n");
        assert.equal(lines.length, 2);
        assert.match(lines[0], /600 frames: average 100\.0 fps/);
        assert.match(lines[1], /whole run, 610 frames/);
    });
});
