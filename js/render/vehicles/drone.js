/**
 * Drone sprite — an FPV kamikaze quadcopter drawn hovering above ground.
 */
import { createDrawHelpers } from "../../draw-helpers.js";
import { makeProjection, spriteVisible, TH } from "../projection.js";

/**
 * Draw an FPV kamikaze quadcopter drone from isometric perspective.
 *
 * Drones hover above the ground, so the entire sprite is drawn with a
 * vertical offset and a shadow ellipse sits at ground level.
 */
export function drawDrone(ctx, tank, sx, sy) {
    const { drop, fill, lift } = createDrawHelpers(ctx);
    if (!spriteVisible(tank)) return;

    const { P } = makeProjection(sx, sy, tank.angle);

    // Hover height (bobbing)
    const hoverH = 20 + Math.sin(performance.now() / 300) * 2;

    // ── 1. Shadow on ground ──
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + TH / 4, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── 2. Arms ──
    const armLen = 0.2;
    const arms = [
        { lx: armLen, ly: armLen },
        { lx: armLen, ly: -armLen },
        { lx: -armLen, ly: armLen },
        { lx: -armLen, ly: -armLen },
    ];

    const centre = lift([P(0, 0)], -hoverH)[0];

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    for (const arm of arms) {
        const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];
        ctx.beginPath();
        ctx.moveTo(centre[0], centre[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
    }

    // ── 3. Rotor discs (fast-spinning blur) ──
    const rotorPhase = performance.now() / 40;
    for (let ai = 0; ai < arms.length; ai++) {
        const arm = arms[ai];
        const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];

        // Motion-blur disc
        ctx.fillStyle = "rgba(180,180,180,0.2)";
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 6, 0, Math.PI * 2);
        ctx.fill();

        // Blade lines (2 per rotor, rotating)
        const bladeAngle = rotorPhase + ai * 0.7;
        ctx.strokeStyle = "rgba(80,80,80,0.5)";
        ctx.lineWidth = 1.5;
        const r = 5;
        ctx.beginPath();
        for (let b = 0; b < 2; b++) {
            const a = bladeAngle + (b * Math.PI) / 2;
            const dx = Math.cos(a) * r;
            const dy = Math.sin(a) * r * 0.5; // isometric squish
            ctx.moveTo(tip[0] - dx, tip[1] - dy);
            ctx.lineTo(tip[0] + dx, tip[1] + dy);
        }
        ctx.stroke();
    }

    // ── 4. Central body ──
    const bw = 0.09,
        bh = 0.06;
    const body = lift([P(-bw, -bh), P(bw, -bh), P(bw, bh), P(-bw, bh)], -hoverH);
    fill(drop(body, 2), tank.darkColor); // body thickness
    fill(body, tank.color);
    ctx.strokeStyle = tank.darkColor;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(body[0][0], body[0][1]);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
    ctx.closePath();
    ctx.stroke();

    // Warhead band (dark stripe around the payload)
    const band = lift([P(-0.015, -bh), P(0.015, -bh), P(0.015, bh), P(-0.015, bh)], -hoverH + 0.5);
    fill(band, "#26221e");

    // Dark underside indicator (payload)
    const payload = lift([P(-0.04, -0.03), P(0.04, -0.03), P(0.04, 0.03), P(-0.04, 0.03)], -hoverH + 2);
    fill(payload, tank.darkColor);

    // Camera gimbal (small ball under the nose)
    const gim = lift([P(bw + 0.02, 0)], -hoverH + 2.5)[0];
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(gim[0], gim[1], 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a5a78";
    ctx.beginPath();
    ctx.arc(gim[0] + 0.5, gim[1] + 0.3, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // ── 5. Front LED (white dot, blinks) ──
    const ledOn = Math.sin(performance.now() / 200) > 0;
    if (ledOn) {
        const nose = lift([P(bw + 0.03, 0)], -hoverH)[0];
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(nose[0], nose[1], 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
}
