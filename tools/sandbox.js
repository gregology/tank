/**
 * Swarm sandbox — a tuning workbench for the pheromone AI.
 *
 * Runs an all-bot battle with a full-map view, pheromone heatmap
 * overlays, live parameter sliders (CONFIG / VEHICLES are mutated in
 * place — every signal read happens per frame, so changes apply
 * immediately), and a live metrics panel (the same metrics module the
 * headless simulator and optimizer use).
 *
 * Served as sandbox.html next to index.html — no build step.
 */

import { collectMetrics, sampleExploration, trackMatch } from "./metrics.js";
import { getParam, seededRng, setParam } from "./sim-lib.js";
import { Camera } from "../js/camera.js";
import { CONFIG } from "../js/config.js";
import { Game } from "../js/game.js";
import { renderViewport } from "../js/render/viewport.js";
import { worldToScreen } from "../js/utils.js";

/* ── tunables exposed as sliders ──────────────────────────── */

const PARAMS = [
    { path: "CONFIG.EXPLORE_VENTURE_WEIGHT", min: 0, max: 0.3, step: 0.005 },
    { path: "CONFIG.CONVOY_CROWD_LIMIT", min: 1, max: 20, step: 0.5 },
    { path: "CONFIG.CONVOY_JOIN_RANGE", min: 4, max: 20, step: 0.5 },
    { path: "CONFIG.CONVOY_SPACING", min: 0.6, max: 3, step: 0.1 },
    { path: "CONFIG.CONVOY_FLANK_OFFSET", min: 0.8, max: 4, step: 0.1 },
    { path: "CONFIG.EXPLORE_RADIUS", min: 6, max: 30, step: 1 },
    { path: "CONFIG.EXPLORE_INTERVAL", min: 0.5, max: 10, step: 0.5 },
    { path: "CONFIG.SIGNAL_HALFLIVES.recruit", min: 0.5, max: 8, step: 0.1 },
    { path: "CONFIG.SIGNAL_HALFLIVES.trail", min: 1, max: 24, step: 0.5 },
    { path: "CONFIG.SIGNAL_HALFLIVES.alarm", min: 0.5, max: 5, step: 0.1 },
    { path: "CONFIG.SIGNAL_HALFLIVES.food", min: 0.5, max: 6, step: 0.1 },
    { path: "CONFIG.SIGNAL_ALARM_STRENGTH", min: 1, max: 15, step: 0.5 },
    { path: "CONFIG.SIGNAL_ALARM_TIME", min: 1, max: 10, step: 0.5 },
    { path: "CONFIG.SIGNAL_ALARM_RESPONSE_RADIUS", min: 4, max: 24, step: 1 },
    { path: "CONFIG.SIGNAL_HUMAN_EMIT", min: 1, max: 5, step: 0.1 },
    { path: "CONFIG.SIGNAL_TRAIL_DISTANCE_FACTOR", min: 0, max: 0.2, step: 0.005 },
    { path: "VEHICLES.tank.signals.recruit", min: 0, max: 3, step: 0.05 },
    { path: "VEHICLES.ifv.signals.recruit", min: 0, max: 3, step: 0.05 },
    { path: "VEHICLES.squad.signals.recruit", min: 0, max: 2, step: 0.05 },
    { path: "VEHICLES.drone.signals.recruit", min: 0, max: 2, step: 0.05 },
    { path: "VEHICLES.drone.personalSpace", min: 0, max: 3, step: 0.1 },
    { path: "VEHICLES.squad.personalSpace", min: 0, max: 2.5, step: 0.1 },
];

const CHANNELS = {
    recruit: { color: "0,220,120", label: "recruit (convoys)" },
    trail: { color: "240,220,60", label: "trail (routes)" },
    alarm: { color: "240,60,60", label: "alarm (rally)" },
    food: { color: "180,80,240", label: "food (objectives)" },
};

/* ── state ────────────────────────────────────────────────── */

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

const state = {
    game: null,
    tracker: null,
    camera: new Camera(),
    zoom: 0.25,
    playing: true,
    speed: 1,
    seed: 1,
    mapSize: 64,
    teamSize: 4,
    channels: { recruit: true, trail: true, alarm: true, food: true },
    accumulator: 0,
    sampleTimer: 0,
};

/* ── match lifecycle ──────────────────────────────────────── */

function newMatch(seed) {
    state.seed = seed;
    const realRandom = Math.random;
    Math.random = seededRng(seed);
    try {
        state.game = new Game({
            gameType: "battle",
            humans: [],
            settings: {
                mapSize: { w: state.mapSize, h: state.mapSize },
                buildingDensity: 0,
                baseType: "compound",
                teamSize: state.teamSize,
            },
        });
    } finally {
        Math.random = realRandom;
    }
    state.tracker = trackMatch(state.game);
    state.accumulator = 0;
    state.sampleTimer = 0;

    const map = state.game.map;
    const center = worldToScreen(map.width / 2, map.height / 2);
    state.camera.setPosition(center.x, center.y);
    const spanX = (map.width + map.height) * (CONFIG.TILE_WIDTH / 2);
    const spanY = (map.width + map.height) * (CONFIG.TILE_HEIGHT / 2);
    state.zoom = Math.min(canvas.width / spanX, canvas.height / spanY) * 0.98;
}

function resize() {
    canvas.width = window.innerWidth - 320;
    canvas.height = window.innerHeight;
    if (state.game) newMatch(state.seed);
}
window.addEventListener("resize", resize);

/* ── heatmap overlay ──────────────────────────────────────── */

function drawHeatmaps(vw, vh) {
    const map = state.game.map;
    ctx.save();
    ctx.translate(vw / 2 - state.camera.x, vh / 2 - state.camera.y);
    const hw = CONFIG.TILE_WIDTH / 2,
        hh = CONFIG.TILE_HEIGHT / 2;
    for (const faction of state.game.factions) {
        for (const [channel, enabled] of Object.entries(state.channels)) {
            if (!enabled) continue;
            for (let gy = 0; gy < map.height; gy++) {
                for (let gx = 0; gx < map.width; gx++) {
                    const v = faction.signals.valueAt(channel, gx + 0.5, gy + 0.5);
                    if (v < 0.1) continue;
                    const scr = worldToScreen(gx, gy);
                    const alpha = Math.min(0.55, v / CONFIG.SIGNAL_MAX);
                    ctx.fillStyle = `rgba(${CHANNELS[channel].color},${alpha})`;
                    ctx.beginPath();
                    ctx.moveTo(scr.x, scr.y - hh);
                    ctx.lineTo(scr.x + hw, scr.y);
                    ctx.lineTo(scr.x, scr.y + hh);
                    ctx.lineTo(scr.x - hw, scr.y);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }
    }
    ctx.restore();
}

/* ── frame loop ───────────────────────────────────────────── */

let lastTime = 0;

function loop(timestamp) {
    const realDt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    if (state.playing && !state.game.gameOver) {
        state.accumulator += realDt * state.speed;
        while (state.accumulator >= 0.016) {
            state.game.update(0.016);
            state.accumulator -= 0.016;
            state.sampleTimer += 0.016;
            if (state.sampleTimer >= 0.5) {
                sampleExploration(state.game, state.tracker);
                state.sampleTimer = 0;
            }
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(state.zoom, state.zoom);
    const vw = canvas.width / state.zoom,
        vh = canvas.height / state.zoom;
    const focus = state.game.allTanks.find((t) => t.alive) ?? state.game.allTanks[0];
    renderViewport(ctx, state.game, focus, state.camera, 0, 0, vw, vh);
    drawHeatmaps(vw, vh);
    ctx.restore();

    requestAnimationFrame(loop);
}

/* ── metrics panel ────────────────────────────────────────── */

function refreshMetrics() {
    const m = collectMetrics(state.game, state.tracker);
    const fmt = (v) => (v == null ? "—" : `${v.toFixed(1)}s`);
    document.getElementById("metrics").textContent =
        `time           ${m.outcome.duration}s${m.outcome.gameOver ? `  winner: faction ${m.outcome.winner}` : ""}\n` +
        `first contact  ${fmt(m.firstContactTime)}\n` +
        `discovery      1: ${fmt(m.discoveryTimes[1])}  2: ${fmt(m.discoveryTimes[2])}\n` +
        `exploration    1: ${(m.exploration[1] * 100).toFixed(0)}%  2: ${(m.exploration[2] * 100).toFixed(0)}%\n` +
        `clustering     1: ${m.clustering[1]}  2: ${m.clustering[2]}\n` +
        `convoying      ${(m.convoyCoherence * 100).toFixed(0)}%\n` +
        `HQ damage      ${m.outcome.hqDamage.map((d) => d.toFixed(1)).join(" / ")}`;
}
setInterval(refreshMetrics, 500);

/* ── controls ─────────────────────────────────────────────── */

function buildControls() {
    const playBtn = document.getElementById("play");
    playBtn.addEventListener("click", () => {
        state.playing = !state.playing;
        playBtn.textContent = state.playing ? "⏸ pause" : "▶ play";
    });
    document.getElementById("step").addEventListener("click", () => {
        state.game.update(0.016);
        sampleExploration(state.game, state.tracker);
    });
    document.getElementById("speed").addEventListener("change", (e) => {
        state.speed = Number(e.target.value);
    });
    document.getElementById("restart").addEventListener("click", () => {
        newMatch(Number(document.getElementById("seed").value));
    });
    document.getElementById("newmap").addEventListener("click", () => {
        const seedInput = document.getElementById("seed");
        seedInput.value = Number(seedInput.value) + 1;
        newMatch(Number(seedInput.value));
    });

    const channels = document.getElementById("channels");
    for (const [channel, { label, color }] of Object.entries(CHANNELS)) {
        const span = document.createElement("label");
        span.className = "chk";
        span.innerHTML = `<input type="checkbox" checked> <span style="color:rgba(${color},1)">■</span> ${label}`;
        span.querySelector("input").addEventListener("change", (e) => {
            state.channels[channel] = e.target.checked;
        });
        channels.appendChild(span);
    }

    const params = document.getElementById("params");
    for (const p of PARAMS) {
        const row = document.createElement("div");
        row.className = "row";
        const short = p.path.replace(/^CONFIG\./, "").replace(/^VEHICLES\./, "");
        row.innerHTML = `<label title="${p.path}">${short}</label>`;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = p.min;
        slider.max = p.max;
        slider.step = p.step;
        slider.value = getParam(p.path);
        const val = document.createElement("span");
        val.className = "val";
        val.textContent = slider.value;
        slider.addEventListener("input", () => {
            setParam(p.path, Number(slider.value));
            val.textContent = slider.value;
        });
        row.appendChild(slider);
        row.appendChild(val);
        params.appendChild(row);
        p._slider = slider;
        p._val = val;
    }

    const defaults = Object.fromEntries(PARAMS.map((p) => [p.path, getParam(p.path)]));
    document.getElementById("defaults").addEventListener("click", () => {
        for (const p of PARAMS) {
            setParam(p.path, defaults[p.path]);
            p._slider.value = defaults[p.path];
            p._val.textContent = defaults[p.path];
        }
    });
}

/* ── boot ─────────────────────────────────────────────────── */

canvas.width = window.innerWidth - 320;
canvas.height = window.innerHeight;
buildControls();
newMatch(1);
requestAnimationFrame(loop);
