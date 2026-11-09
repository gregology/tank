/**
 * Desktop shell for the Steam Machine: Electron's main process.  Composition
 * only; the logic lives in the modules it wires together, which have tests.
 *
 * It serves the unchanged browser game over a custom scheme, because ES modules
 * refuse to load from file://, and pushes controller state to the page.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen } from "electron";
import { DiagnosticReport } from "./diagnostics.js";
import { readLaunchOptions } from "./launch-options.js";
import { parseSteamSlots } from "./pads/identify.js";
import { PadReader } from "./pads/pad-reader.js";

const SCHEME = "tanked";
const GAME_ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(app.getPath("home"), ".local/share/tanked");
const PAD_POLL_MS = 8;
const PAD_SCAN_MS = 1000;
const GPU_REPORT_DELAY_MS = 5000;

fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath("userData", path.join(DATA_DIR, "chromium"));

const options = readLaunchOptions(process.argv.slice(1), path.join(DATA_DIR, "next_launch_args.txt"));
const report = options.diagnose ? new DiagnosticReport(path.join(DATA_DIR, `diagnose-${timestamp()}.txt`)) : null;

// Controller presses arrive over IPC, so to Chromium nobody has ever touched the
// page, and the autoplay policy would keep the game silent.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function readSteamSlots() {
    const file = process.env.SteamVirtualGamepadInfo;
    if (!file) return new Map();
    try {
        return parseSteamSlots(fs.readFileSync(file, "utf8"));
    } catch {
        return new Map();
    }
}

const reader = new PadReader({
    readSteamSlots,
    onEvent: (pad, type, code, value) => report?.logPadEvent(pad, type, code, value),
    onDevicesChanged: (pads) => report?.logPads(pads),
});

function sendPads(pads) {
    if (win && !win.isDestroyed()) win.webContents.send("shell:pads", pads);
}

function pollPads() {
    reader.drain();
    const pads = reader.takeChangedSnapshot();
    if (pads) sendPads(pads);
}

function serveGameFiles() {
    protocol.handle(SCHEME, (request) => {
        const file = path.join(GAME_ROOT, decodeURIComponent(new URL(request.url).pathname));
        if (!file.startsWith(GAME_ROOT + path.sep)) return new Response(null, { status: 404 });
        return net.fetch(pathToFileURL(file).href);
    });
}

async function saveScreenshot(label) {
    if (!win || win.isDestroyed()) return;
    const image = await win.webContents.capturePage();
    const dir = path.join(DATA_DIR, "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${timestamp()}-${label}.png`), image.toPNG());
}

async function logSystem() {
    const display = screen.getPrimaryDisplay();
    report.line(`app ${app.getVersion()}, Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`);
    report.line(`launch options: ${JSON.stringify(options)}`);
    report.line(`screen ${display.size.width}x${display.size.height} at ${display.displayFrequency} Hz`);
    report.logPads(reader.pads);
    try {
        const info = await app.getGPUInfo("complete");
        report.line(`GPU ${info.auxAttributes?.glRenderer ?? "unknown"}`);
    } catch (error) {
        report.line(`GPU info unavailable: ${error.message}`);
    }
    setTimeout(() => {
        report.line(`GPU features ${JSON.stringify(app.getGPUFeatureStatus())}`);
    }, GPU_REPORT_DELAY_MS);
}

function listenToPage() {
    ipcMain.on("shell:options", (event) => {
        event.returnValue = { demoScenario: options.demo, reportFrames: options.diagnose };
    });
    ipcMain.on("shell:ready", () => sendPads(reader.snapshot()));
    ipcMain.on("shell:frames", (_event, frameMs) => report?.addFrames(frameMs));
}

function createWindow() {
    win = new BrowserWindow({
        fullscreen: true,
        frame: false,
        backgroundColor: "#000000",
        webPreferences: {
            preload: path.join(import.meta.dirname, "preload.cjs"),
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown" && input.code === "F12") saveScreenshot("f12");
    });
    win.webContents.on("render-process-gone", (_event, details) => {
        report?.line(`renderer gone: ${JSON.stringify(details)}`);
    });
    win.webContents.on("console-message", ({ level, message }) => {
        if (level === "error") report?.line(`page error: ${message}`);
    });
    win.loadURL(`${SCHEME}://game/index.html`);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => report?.finish());

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    serveGameFiles();
    listenToPage();
    reader.scan();
    setInterval(pollPads, PAD_POLL_MS);
    setInterval(() => reader.scan(), PAD_SCAN_MS);
    createWindow();
    if (report) logSystem();
    for (const seconds of options.shotSeconds) setTimeout(() => saveScreenshot(`at-${seconds}s`), seconds * 1000);
    if (options.quitAtSeconds !== null) setTimeout(() => app.quit(), options.quitAtSeconds * 1000);
});
