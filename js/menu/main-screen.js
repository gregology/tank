/**
 * Title screen: input (join as P1, or open vehicle info) and rendering.
 */

import { ACTIONS } from "../config.js";
import { drawGrid, drawMenuVehicle } from "./background.js";
import { anyPressed, firstJoiner } from "./input.js";
import { VEHICLE_INFO } from "./vehicle-info.js";

export const mainScreen = {
    update(menu, input, audio) {
        // Any device's confirm → join as P1 and enter the lobby.
        const joiner = firstJoiner(input, menu.lobby);
        if (joiner) {
            menu.lobby.join(joiner);
            menu.show("lobby");
            menu.lobby.cursor = 0;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
            return;
        }
        // Back → vehicle info.
        if (anyPressed(input, ACTIONS.back)) {
            menu.show("about");
            menu._aboutIndex = 0;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
    },

    render(menu, ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = menu._time;

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        drawGrid(ctx, W, H, t);
        ctx.textAlign = "center";

        // Title
        ctx.font = 'bold 58px "Courier New", monospace';
        ctx.fillStyle = "#cc3333";
        ctx.fillText("TANK", cx - 90, 130);
        ctx.fillStyle = "#3366dd";
        ctx.fillText("BATTLE", cx + 100, 130);
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText("ISOMETRIC  WARFARE", cx, 157);

        // Vehicle showcase
        const vehicleY = 230;
        const spacing = Math.min(150, (W - 80) / (VEHICLE_INFO.length - 1));
        const startX = cx - spacing * ((VEHICLE_INFO.length - 1) / 2);
        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const v = VEHICLE_INFO[i];
            const vx = startX + i * spacing;
            ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.sin(t * 2 + i * 1.5) * 0.02})`;
            ctx.beginPath();
            ctx.arc(vx, vehicleY, 36, 0, Math.PI * 2);
            ctx.fill();
            drawMenuVehicle(ctx, vx, vehicleY, t * (0.8 + i * 0.15), v.type, v.color, v.dark, 1.2, t);
            ctx.font = 'bold 12px "Courier New", monospace';
            ctx.fillStyle = v.color;
            ctx.fillText(v.name, vx, vehicleY + 40);
            ctx.font = '9px "Courier New", monospace';
            ctx.fillStyle = "#555";
            ctx.fillText(v.tagline, vx, vehicleY + 52);
        }

        // Call to action (pulsing)
        const pulse = 0.6 + Math.sin(t * 4) * 0.3;
        ctx.font = 'bold 26px "Courier New", monospace';
        ctx.fillStyle = `rgba(255,255,255,${pulse})`;
        ctx.fillText("PRESS  A / START", cx, H / 2 + 120);

        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#666";
        ctx.fillText("first to press becomes Player 1", cx, H / 2 + 152);

        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("B / Esc   Vehicle info", cx, H - 30);
    },
};
