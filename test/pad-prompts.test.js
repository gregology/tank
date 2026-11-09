import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawGameOver, drawPause } from "../js/render/overlay.js";
import { drawFaceButtons, drawPrompt, faceButton } from "../js/render/pad-prompts.js";
import { fakeCtx } from "./helpers.js";

/** A context that records where things land, and the fill they were drawn with. */
function recordingCtx() {
    const texts = [];
    const dots = [];
    const ctx = {
        fillStyle: "#abc",
        textAlign: "center",
        measureText: (text) => ({ width: text.length * 10 }),
        fillText: (text, x) => texts.push({ text, x, fill: ctx.fillStyle, align: ctx.textAlign }),
        beginPath() {},
        fill() {},
        arc: (x, y, radius) => dots.push({ x, y, radius, fill: ctx.fillStyle }),
    };
    return { ctx, texts, dots };
}

describe("drawPrompt", () => {
    it("centres the whole line, pictures included", () => {
        const { ctx, texts } = recordingCtx();
        drawPrompt(ctx, 500, 100, ["PRESS", faceButton("bottom"), "JOIN"], 20);
        // Widths 50 + 20 + 40 and two gaps of 8 total 126, so the line starts at 437.
        assert.equal(texts[0].x, 437);
        assert.equal(texts[1].x, 437 + 50 + 8 + 20 + 8);
    });

    it("leaves the caller's text state alone, and draws later text in its colour", () => {
        const { ctx, texts } = recordingCtx();
        drawPrompt(ctx, 500, 100, [faceButton("left"), "after"]);
        assert.equal(texts[0].fill, "#abc", "a picture's colour must not leak into the text after it");
        assert.equal(texts[0].align, "left");
        assert.equal(ctx.fillStyle, "#abc");
        assert.equal(ctx.textAlign, "center");
    });
});

describe("drawFaceButtons", () => {
    it("lights only the button to press, at that position", () => {
        const positions = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
        for (const [position, [dx, dy]] of Object.entries(positions)) {
            const { ctx, dots } = recordingCtx();
            drawFaceButtons(ctx, 100, 100, 20, position);
            assert.equal(dots.length, 4);
            const largest = dots.reduce((a, b) => (b.radius > a.radius ? b : a));
            assert.equal(Math.sign(largest.x - 100), dx, position);
            assert.equal(Math.sign(largest.y - 100), dy, position);
            assert.equal(dots.filter((dot) => dot.fill === largest.fill).length, 1);
        }
    });
});

describe("result and pause screens", () => {
    const game = { winnerLabel: "P1", winnerColor: "#c33" };

    it("hides the result prompts until input is accepted", () => {
        const locked = fakeCtx();
        drawGameOver(locked.ctx, game, 800, 600, false);
        assert.ok(!locked.calls.includes("arc"), "no button pictures while input is locked");

        const ready = fakeCtx();
        drawGameOver(ready.ctx, game, 800, 600, true);
        assert.ok(ready.calls.includes("arc"));
    });

    it("names who paused only when a joined player did", () => {
        const texts = (label) => {
            const { ctx, texts: drawn } = recordingCtx();
            Object.assign(ctx, { fillRect() {}, save() {}, restore() {} });
            drawPause(ctx, label, 800, 600);
            return drawn.map(({ text }) => text).join(" ");
        };
        assert.ok(texts("P2").includes("P2"));
        assert.ok(!texts(null).includes("null"));
    });
});
