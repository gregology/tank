"use strict";
// The game's only view of the desktop shell: window.tankedShell (see js/main.js).

const { contextBridge, ipcRenderer } = require("electron");

const { demoScenario, reportFrames } = ipcRenderer.sendSync("shell:options");

let pads = [];
ipcRenderer.on("shell:pads", (_event, latest) => {
    pads = latest;
});

contextBridge.exposeInMainWorld("tankedShell", {
    demoScenario,
    readPads: () => pads,
});

ipcRenderer.send("shell:ready");

if (reportFrames) {
    // The whole frame's work shares one requestAnimationFrame turn, so timing it
    // here measures the game without the game knowing about diagnostics.
    const REPORT_EVERY_FRAMES = 60;
    let batch = [];
    let last = null;
    const onFrame = (now) => {
        if (last !== null) batch.push(now - last);
        last = now;
        if (batch.length >= REPORT_EVERY_FRAMES) {
            ipcRenderer.send("shell:frames", batch);
            batch = [];
        }
        requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
}
