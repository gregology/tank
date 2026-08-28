/**
 * Sandbox bootstrap — DOM wiring for sandbox.html.
 *
 * The sandbox runs ordinary headless matches (Game is DOM-free) at a
 * chosen speed, draws them with js/sandbox/view.js, and exposes the
 * swarm tunables as live sliders (js/sandbox/panel.js).  A seed box
 * makes any scenario replayable.
 *
 * All DOM access lives here; view/panel stay testable without a browser.
 */

import { DENSITY_KEYS, opinionatedSettings, tunableBounds } from "../config.js";
import { Game } from "../game.js";
import { applyTuning, resetTuning, sliderSpecs, teamSizeRange } from "./panel.js";
import { drawSandbox } from "./view.js";

const TICK_DT = 1 / 60;

export function start(doc) {
    const canvas = doc.getElementById("view");
    const ctx = canvas.getContext("2d");
    const els = {
        seed: doc.getElementById("seed"),
        mapSize: doc.getElementById("mapSize"),
        teamSize: doc.getElementById("teamSize"),
        gameType: doc.getElementById("gameType"),
        density: doc.getElementById("density"),
        field: doc.getElementById("field"),
        faction: doc.getElementById("faction"),
        speed: doc.getElementById("speed"),
        newMatch: doc.getElementById("newMatch"),
        pause: doc.getElementById("pause"),
        sliders: doc.getElementById("sliders"),
        status: doc.getElementById("status"),
    };

    let game = null;
    let paused = false;
    let lastTime = 0;
    let carry = 0;

    function newMatch() {
        const size = Number(els.mapSize.value);
        game = new Game({
            gameType: els.gameType.value,
            humans: [],
            settings: {
                mapSize: { w: size, h: size },
                buildingDensity: Number(els.density.value),
                baseType: "compound",
                teamSize: Number(els.teamSize.value),
                seed: Number(els.seed.value) || 1,
            },
        });
    }

    /** Repopulate team-size options from the selected map size's cap. */
    function rebuildTeamSizes() {
        const { min, max, defaultValue } = teamSizeRange(els.mapSize.selectedIndex);
        const current = Number(els.teamSize.value) || defaultValue;
        els.teamSize.innerHTML = "";
        for (let n = min; n <= max; n++) {
            const option = doc.createElement("option");
            option.value = String(n);
            option.textContent = String(n);
            els.teamSize.append(option);
        }
        els.teamSize.value = String(Math.min(Math.max(current, min), max));
    }

    /** Clamp the density input to the tunables and default it per mode. */
    function syncDensity() {
        const { min, max } = tunableBounds(DENSITY_KEYS);
        els.density.min = min;
        els.density.max = max;
        els.density.step = 0.1;
        els.density.value = String(opinionatedSettings(els.gameType.value, els.mapSize.selectedIndex).buildingDensity);
    }

    function buildSliders() {
        for (const spec of sliderSpecs()) {
            const row = doc.createElement("label");
            row.title = spec.doc;
            row.textContent = spec.key;
            const input = doc.createElement("input");
            input.type = "range";
            input.min = spec.min;
            input.max = spec.max;
            input.step = spec.step;
            input.value = spec.value;
            const value = doc.createElement("span");
            value.textContent = Number(spec.value).toFixed(2);
            input.addEventListener("input", () => {
                value.textContent = Number(input.value).toFixed(2);
                if (game) applyTuning(game, spec.key, Number(input.value));
            });
            row.append(input, value);
            els.sliders.append(row);
        }
        const reset = doc.createElement("button");
        reset.textContent = "Reset defaults";
        reset.addEventListener("click", () => {
            if (!game) return;
            resetTuning(game);
            for (const [i, spec] of sliderSpecs().entries()) {
                const input = els.sliders.querySelectorAll("input")[i];
                if (input) input.value = spec.value;
                const span = els.sliders.querySelectorAll("span")[i];
                if (span) span.textContent = Number(spec.value).toFixed(2);
            }
        });
        els.sliders.append(reset);
    }

    function frame(now) {
        if (game && !paused) {
            const speed = Number(els.speed.value);
            carry += Math.min(0.1, (now - lastTime) / 1000) * speed;
            while (carry >= TICK_DT) {
                game.update(TICK_DT);
                carry -= TICK_DT;
            }
        }
        lastTime = now;
        if (game) {
            drawSandbox(ctx, game, {
                field: els.field.value || null,
                factionId: Number(els.faction.value),
                width: canvas.width,
                height: canvas.height,
            });
            els.status.textContent = game.gameOver
                ? `GAME OVER — winner: faction ${game.winner} @ ${game.gameTime.toFixed(0)}s`
                : `t=${game.gameTime.toFixed(1)}s`;
        }
        requestAnimationFrame(frame);
    }

    els.newMatch.addEventListener("click", newMatch);
    els.mapSize.addEventListener("change", rebuildTeamSizes);
    els.gameType.addEventListener("change", syncDensity);
    els.pause.addEventListener("click", () => {
        paused = !paused;
        els.pause.textContent = paused ? "Resume" : "Pause";
    });

    rebuildTeamSizes();
    syncDensity();
    buildSliders();
    newMatch();
    requestAnimationFrame(frame);
}

// Browser entry: auto-start when loaded by sandbox.html.
if (typeof document !== "undefined") {
    start(document);
}
