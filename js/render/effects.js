/**
 * Projectile and particle effects: tank shells, IFV tracers, arcing SPG
 * shells, and the particle system's squares.
 */

import { CONFIG, VEHICLES } from "../config.js";

export function drawBullet(ctx, bullet, sx, sy, time) {
    if (bullet.arcing) {
        drawArcingBullet(ctx, bullet, sx, sy, time);
        return;
    }

    const pulse = Math.sin(time * 30) * 0.3 + 0.7;
    const isIFV = bullet.damage < 1.0;

    if (isIFV) {
        // ── IFV tracer: small bright green dot with trail ──
        const r = 1.8;

        // Trail (3 fading dots behind)
        const trailDx = -Math.cos(bullet.angle) * 3;
        const trailDy = -Math.sin(bullet.angle) * 1.5; // iso squish
        for (let i = 1; i <= 3; i++) {
            ctx.globalAlpha = 0.3 - i * 0.08;
            ctx.fillStyle = "#88ff44";
            ctx.beginPath();
            ctx.arc(sx + trailDx * i, sy + trailDy * i, r * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Green glow
        ctx.fillStyle = `rgba(100,255,60,${0.3 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core — bright green
        ctx.fillStyle = `rgb(${(140 + pulse * 40) | 0},255,${(80 + pulse * 40) | 0})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // White hot centre
        ctx.fillStyle = "#eeffcc";
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // ── Tank shell: larger orange/yellow ──
        const r = CONFIG.BULLET_RADIUS;

        // Glow
        ctx.fillStyle = `rgba(255,200,0,${0.25 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgb(255,${(200 + pulse * 55) | 0},${(50 + pulse * 80) | 0})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright centre
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ── arcing bullet drawing ─────────────────────────────────── */

export function drawArcingBullet(ctx, bullet, sx, sy, time) {
    const progress = bullet.arcProgress;
    const arcH = VEHICLES.spg.arcHeight * Math.sin(progress * Math.PI);

    // Shadow on ground (grows as shell is higher)
    const shadowAlpha = 0.1 + 0.1 * Math.sin(progress * Math.PI);
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4 + arcH * 0.1, 2 + arcH * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shell at height offset
    const shellY = sy - arcH;
    const r = 3.5;
    const pulse = Math.sin(time * 20) * 0.3 + 0.7;

    // Orange glow trail
    ctx.fillStyle = `rgba(255,120,0,${0.25 * pulse})`;
    ctx.beginPath();
    ctx.arc(sx, shellY, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // Shell body (hot orange-red)
    ctx.fillStyle = `rgb(255,${(100 + pulse * 40) | 0},${(20 + pulse * 30) | 0})`;
    ctx.beginPath();
    ctx.arc(sx, shellY, r, 0, Math.PI * 2);
    ctx.fill();

    // Bright hot centre
    ctx.fillStyle = "#ffee88";
    ctx.beginPath();
    ctx.arc(sx, shellY, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Trail sparks (behind the shell)
    const trailAngle = bullet.angle;
    ctx.fillStyle = "rgba(255,180,50,0.3)";
    for (let i = 1; i <= 3; i++) {
        const tx = sx - Math.cos(trailAngle) * i * 3 * (1 - progress * 0.5);
        const ty = shellY + Math.sin(trailAngle) * i * 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ── particle drawing ──────────────────────────────────────── */

export function drawParticle(ctx, p, sx, sy) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    const half = p.size / 2;
    ctx.fillRect(sx - half, sy - half, p.size, p.size);
    ctx.globalAlpha = 1;
}
