/**
 * Vehicle-info screen: cycling through the vehicle pages and the
 * stat-bar comparison at the bottom.
 */

import { ACTIONS } from "../config.js";
import { roundedRect } from "../render/canvas-utils.js";
import { drawGrid, drawMenuVehicle } from "./background.js";
import { anyPressed } from "./input.js";
import { getStatValue, STAT_METRICS, VEHICLE_INFO, vehicleStats } from "./vehicle-info.js";

export const aboutScreen = {
    update(menu, input, audio) {
        const left = anyPressed(input, ACTIONS.left);
        const right = anyPressed(input, ACTIONS.right);
        const back = anyPressed(input, ACTIONS.back);
        const go = anyPressed(input, ACTIONS.confirm);

        if (left) {
            menu._aboutIndex = (menu._aboutIndex - 1 + VEHICLE_INFO.length) % VEHICLE_INFO.length;
            if (audio) {
                audio.init();
                audio.play("select");
            }
        }
        if (right) {
            menu._aboutIndex = (menu._aboutIndex + 1) % VEHICLE_INFO.length;
            if (audio) {
                audio.init();
                audio.play("select");
            }
        }
        if (back || go) {
            menu.show("main");
            if (audio) {
                audio.init();
                audio.play("confirm");
            }
        }
    },

    render(menu, ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = menu._time;
        const vi = VEHICLE_INFO[menu._aboutIndex];

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        drawGrid(ctx, W, H, t);

        ctx.textAlign = "center";

        ctx.font = 'bold 36px "Courier New", monospace';
        ctx.fillStyle = "#777";
        ctx.fillText("VEHICLE  INFO", cx, 50);

        // Tab bar
        const tabY = 80;
        const tabSpacing = Math.min(180, (W - 40) / VEHICLE_INFO.length);
        const tabStart = cx - (tabSpacing * (VEHICLE_INFO.length - 1)) / 2;

        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const tx = tabStart + i * tabSpacing;
            const sel = i === menu._aboutIndex;
            if (sel) {
                ctx.fillStyle = "rgba(255,255,255,0.06)";
                roundedRect(ctx, tx - tabSpacing / 2 + 5, tabY - 14, tabSpacing - 10, 24, 4);
                ctx.fill();
                ctx.fillStyle = VEHICLE_INFO[i].color;
            } else {
                ctx.fillStyle = "#444";
            }
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.fillText(VEHICLE_INFO[i].name, tx, tabY);
        }

        // Vehicle preview (larger)
        const previewY = 165;
        const glow = 0.06 + Math.sin(t * 2) * 0.02;
        ctx.fillStyle = `rgba(255,255,255,${glow})`;
        ctx.beginPath();
        ctx.arc(cx, previewY, 55, 0, Math.PI * 2);
        ctx.fill();

        drawMenuVehicle(ctx, cx, previewY, t * 0.9, vi.type, vi.color, vi.dark, 2.0, t);

        ctx.font = 'bold 28px "Courier New", monospace';
        ctx.fillStyle = vi.color;
        ctx.fillText(vi.name, cx, previewY + 65);

        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#666";
        ctx.fillText(vi.tagline, cx, previewY + 82);

        // Stats row
        const statsY = previewY + 106;
        const stats = vehicleStats(vi.type);
        const statKeys = Object.keys(stats);
        const statSpacing = Math.min(110, (W - 60) / statKeys.length);
        const statStart = cx - (statSpacing * (statKeys.length - 1)) / 2;

        ctx.fillStyle = "rgba(255,255,255,0.03)";
        roundedRect(ctx, statStart - statSpacing / 2, statsY - 16, statSpacing * statKeys.length, 32, 6);
        ctx.fill();

        ctx.font = 'bold 11px "Courier New", monospace';
        for (let i = 0; i < statKeys.length; i++) {
            const sx = statStart + i * statSpacing;
            const key = statKeys[i];
            ctx.fillStyle = "#555";
            ctx.fillText(key, sx, statsY - 2);
            ctx.fillStyle = vi.color;
            ctx.fillText(`${stats[key]}`, sx, statsY + 12);
        }

        // Description
        const descStartY = statsY + 44;
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#999";
        for (let i = 0; i < vi.desc.length; i++) {
            if (vi.desc[i] !== "") ctx.fillText(vi.desc[i], cx, descStartY + i * 20);
        }

        // Stat bars
        const barY = descStartY + vi.desc.length * 20 + 16;
        drawStatCompare(ctx, cx, barY, vi.type, vi.color, W);

        // Nav hints
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("\u25C4  A/D  \u25BA   Switch Vehicle          Enter / Esc   Back", cx, H - 38);

        const arrowPulse = Math.sin(t * 3) * 3;
        ctx.font = "bold 28px sans-serif";
        ctx.fillStyle = "#333";
        ctx.textAlign = "left";
        ctx.fillText("\u25C4", 15 + arrowPulse, H / 2);
        ctx.textAlign = "right";
        ctx.fillText("\u25BA", W - 15 - arrowPulse, H / 2);
        ctx.textAlign = "center";

        // Page dots
        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const dx = cx + (i - (VEHICLE_INFO.length - 1) / 2) * 18;
            ctx.fillStyle = i === menu._aboutIndex ? vi.color : "#333";
            ctx.beginPath();
            ctx.arc(dx, H - 60, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    },
};

/* ── stat comparison bars ─────────────────────────────────── */

function drawStatCompare(ctx, cx, y, activeType, activeColor, canvasW) {
    const barW = Math.min(260, canvasW * 0.35);
    const barH = 8;
    const rowH = 28;
    const startX = cx - barW / 2;
    const labelW = 80;

    ctx.textAlign = "right";
    for (let i = 0; i < STAT_METRICS.length; i++) {
        const m = STAT_METRICS[i];
        const my = y + i * rowH;
        const val = getStatValue(activeType, m.key);
        const frac = Math.min(1, val / m.max);

        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText(m.label, startX + labelW - 8, my + barH / 2 + 3);

        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(startX + labelW, my, barW - labelW, barH);
        ctx.fillStyle = activeColor;
        ctx.fillRect(startX + labelW, my, (barW - labelW) * frac, barH);

        ctx.textAlign = "left";
        ctx.font = '9px "Courier New", monospace';
        ctx.fillStyle = "#666";
        ctx.fillText(val == null ? "N/A" : val.toFixed(1), startX + barW + 6, my + barH / 2 + 3);
        ctx.textAlign = "right";
    }
    ctx.textAlign = "center";
}
