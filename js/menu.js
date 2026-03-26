/**
 * Start-screen menu rendered on the game canvas.
 *
 * Modes:
 *   • pvp  — two human players, split screen
 *   • pvb  — human (P1) vs AI bot (P2)
 */

export class Menu {
    constructor() {
        this.modes = [
            { label: "1v1 SPLIT SCREEN", mode: "pvp" },
            { label: "PLAYER  vs  BOT", mode: "pvb" },
            { label: "5v5 TEAM BATTLE", mode: "team" },
        ];
        this.selectedIndex = 0;
        this.confirmed = false;
        this.selectedMode = "pvp";

        // decorative
        this._time = 0;
    }

    reset() {
        this.confirmed = false;
    }

    /**
     * @returns {'pvp'|'pvb'|null}  the chosen mode once confirmed.
     */
    update(dt, input, audio) {
        this._time += dt;

        const up = input.wasPressed("ArrowUp") || input.wasPressed("KeyW");
        const down = input.wasPressed("ArrowDown") || input.wasPressed("KeyS");
        const go = input.wasPressed("Enter") || input.wasPressed("Space");

        if (up) {
            this.selectedIndex = (this.selectedIndex - 1 + this.modes.length) % this.modes.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (down) {
            this.selectedIndex = (this.selectedIndex + 1) % this.modes.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (go) {
            this.selectedMode = this.modes[this.selectedIndex].mode;
            this.confirmed = true;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
    }

    /* ── rendering ────────────────────────────────────────── */

    render(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2,
            cy = H / 2;
        const t = this._time;

        // ── Background
        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);

        // Subtle animated iso-grid
        this._drawGrid(ctx, W, H, t);

        // ── Decorative tanks
        this._drawMenuTank(ctx, cx - 180, cy - 80, t * 1.2, "#cc3333", "#882222");
        this._drawMenuTank(ctx, cx + 180, cy - 80, -t * 1.0, "#3366dd", "#223399");

        ctx.textAlign = "center";

        // ── Title
        ctx.font = 'bold 58px "Courier New", monospace';
        ctx.fillStyle = "#cc3333";
        ctx.fillText("TANK", cx - 90, cy - 115);
        ctx.fillStyle = "#3366dd";
        ctx.fillText("BATTLE", cx + 100, cy - 115);

        // Tagline
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText("ISOMETRIC  WARFARE", cx, cy - 85);

        // ── Menu items
        ctx.font = 'bold 24px "Courier New", monospace';
        for (let i = 0; i < this.modes.length; i++) {
            const y = cy - 15 + i * 50;
            const sel = i === this.selectedIndex;

            if (sel) {
                // Pulsing highlight bar
                const pulse = 0.04 + Math.sin(t * 4) * 0.015;
                ctx.fillStyle = `rgba(255,255,255,${pulse})`;
                ctx.fillRect(cx - 210, y - 24, 420, 38);
                ctx.fillStyle = "#fff";
                ctx.fillText(`►  ${this.modes[i].label}`, cx, y);
            } else {
                ctx.fillStyle = "#555";
                ctx.fillText(`   ${this.modes[i].label}`, cx, y);
            }
        }

        // ── Controls hint
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("↑ ↓   Select          Enter   Start", cx, cy + 100);

        // ── Version / credits
        ctx.font = '11px "Courier New", monospace';
        ctx.fillStyle = "#222";
        ctx.fillText("W/S also navigate  ·  Sound auto-enabled", cx, H - 20);
    }

    /* ── private drawing helpers ───────────────────────────── */

    _drawGrid(ctx, W, H, t) {
        ctx.strokeStyle = "rgba(255,255,255,0.025)";
        ctx.lineWidth = 1;
        const off = (t * 8) % 64;
        for (let x = -off; x < W + 64; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        const offy = (t * 4) % 32;
        for (let y = -offy; y < H + 32; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
    }

    /** Tiny spinning iso-tank silhouette for the menu screen. */
    _drawMenuTank(ctx, ox, oy, angle, color, dark) {
        const ca = Math.cos(angle),
            sa = Math.sin(angle);
        const S = 18; // pixel scale

        const p = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [ox + (wx - wy) * S, oy + (wx + wy) * S * 0.5];
        };

        const fill = (pts, c) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };

        // Tracks
        fill([p(-1.1, -0.9), p(1.1, -0.9), p(1.1, -0.55), p(-1.1, -0.55)], "#1a1a1a");
        fill([p(-1.1, 0.55), p(1.1, 0.55), p(1.1, 0.9), p(-1.1, 0.9)], "#1a1a1a");
        // Hull
        fill([p(-0.8, -0.55), p(0.7, -0.55), p(1.0, 0), p(0.7, 0.55), p(-0.8, 0.55)], color);
        // Turret
        const t8 = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            t8.push(p(Math.cos(a) * 0.38, Math.sin(a) * 0.38));
        }
        fill(t8, dark);
        // Barrel
        fill([p(0.35, -0.1), p(1.5, -0.1), p(1.5, 0.1), p(0.35, 0.1)], "#555");
    }
}
