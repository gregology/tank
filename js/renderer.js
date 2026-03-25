/**
 * Isometric pixel-art renderer.
 *
 * Draws two side-by-side viewports (split-screen), each following one
 * player's tank.  Rendering is depth-sorted so elevated terrain
 * correctly occludes entities behind it.
 */

import { CONFIG, TILES as T } from './config.js';
import { worldToScreen, clamp } from './utils.js';

const TW = CONFIG.TILE_WIDTH;
const TH = CONFIG.TILE_HEIGHT;

/* ── Colour palette ───────────────────────────────────────── */

const PALETTE = {
    deepWater:    { r: 22,  g: 50,  b: 82  },
    shallowWater: { r: 38,  g: 82,  b: 128 },
    sand:         { r: 210, g: 185, b: 150 },
    grass:        { r: 72,  g: 124, b: 60  },
    darkGrass:    { r: 55,  g: 100, b: 42  },
    dirt:         { r: 155, g: 130, b: 95  },
    paved:        { r: 140, g: 138, b: 130 },
    hillTop:      { r: 140, g: 115, b: 80  },
    hillLeft:     { r: 105, g: 82,  b: 55  },
    hillRight:    { r: 125, g: 100, b: 68  },
    rockTop:      { r: 130, g: 130, b: 130 },
    rockLeft:     { r: 90,  g: 90,  b: 90  },
    rockRight:    { r: 110, g: 110, b: 110 },
    // Buildings — each has wall, roof, and trim colours
    bldgSmall:  { wall: {r:180,g:165,b:140}, roof: {r:160,g:75,b:55},  trim: {r:120,g:110,b:95} },
    bldgMedium: { wall: {r:195,g:185,b:170}, roof: {r:80,g:110,b:150}, trim: {r:140,g:130,b:115} },
    bldgLarge:  { wall: {r:170,g:165,b:160}, roof: {r:55,g:65,b:80},   trim: {r:110,g:105,b:100} },
};

function rgb(r, g, b) { return `rgb(${r|0},${g|0},${b|0})`; }

/* ================================================================== */

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.vpW = Math.floor(this.canvas.width / 2);
        this.vpH = this.canvas.height;
    }

    /* ── public entry point ───────────────────────────────── */

    render(game) {
        const ctx = this.ctx;
        const cw = this.canvas.width, ch = this.canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        if (game.mode === 'pvp') {
            // ── Split screen ──
            this._renderViewport(ctx, game, game.tank1, game.camera1,
                                 0, 0, this.vpW, this.vpH);
            this._renderViewport(ctx, game, game.tank2, game.camera2,
                                 this.vpW, 0, this.vpW, this.vpH);
            ctx.save();
            ctx.strokeStyle = '#556'; ctx.lineWidth = 3;
            ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.moveTo(this.vpW, 0);
            ctx.lineTo(this.vpW, ch); ctx.stroke(); ctx.restore();
            this._drawHUD(ctx, game, 1, 0,       0, this.vpW, this.vpH);
            this._drawHUD(ctx, game, 2, this.vpW, 0, this.vpW, this.vpH);
        } else {
            // ── Full screen (pvb or team) ──
            this._renderViewport(ctx, game, game.humanTank, game.camera1,
                                 0, 0, cw, ch);
            if (game.mode === 'team') this._drawTeamHUD(ctx, game, cw, ch);
            else                      this._drawHUD(ctx, game, 1, 0, 0, cw, ch);
        }

        if (game.gameOver) this._drawGameOver(ctx, game);
    }

    /* ── viewport rendering ───────────────────────────────── */

    _renderViewport(ctx, game, tank, camera, vx, vy, vw, vh) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vw, vh);
        ctx.clip();

        // Fill background (deep water colour so edges look natural)
        ctx.fillStyle = rgb(PALETTE.deepWater.r - 6,
                            PALETTE.deepWater.g - 6,
                            PALETTE.deepWater.b - 6);
        ctx.fillRect(vx, vy, vw, vh);

        // Camera transform: centre of viewport tracks camera position
        const ox = vx + vw / 2 - camera.x;
        const oy = vy + vh / 2 - camera.y;
        ctx.translate(ox, oy);

        // Determine visible area in screen-space
        const visLeft   = camera.x - vw / 2 - TW * 2;
        const visRight  = camera.x + vw / 2 + TW * 2;
        const visTop    = camera.y - vh / 2 - TH * 4;
        const visBottom = camera.y + vh / 2 + TH * 4;

        // ── PASS 1: flat ground tiles ──
        // Flat tiles (water, sand, grass) can never occlude entities,
        // so we draw them all first.  Adjacent flat diamonds share
        // exact edges, so iteration order doesn't matter.
        const map = game.map;

        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const tile = map.getTile(gx, gy);
                if (map.tileHeight(tile) > 0) continue;   // elevated → pass 2

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight ||
                    scr.y < visTop  || scr.y > visBottom) continue;

                this._drawTile(ctx, { gx, gy, tile, sx: scr.x, sy: scr.y },
                               game.gameTime, map);
            }
        }

        // ── PASS 2: elevated tiles + entities, depth-sorted ──
        // Only hills/rocks can visually occlude entities, so they
        // share depth buckets with tanks, bullets, and particles.
        const maxSum = map.width + map.height;
        const buckets = new Array(maxSum + 2);
        for (let i = 0; i < buckets.length; i++) buckets[i] = null;

        const addToBucket = (depth, item) => {
            const d = clamp(Math.floor(depth), 0, maxSum);
            if (!buckets[d]) buckets[d] = [];
            buckets[d].push(item);
        };

        // Elevated tiles – use depth gx+gy+1 (tile centre) so
        // their side faces correctly occlude entities behind them.
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const tile = map.getTile(gx, gy);
                if (map.tileHeight(tile) === 0) continue;  // already drawn

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight ||
                    scr.y < visTop  || scr.y > visBottom) continue;

                addToBucket(gx + gy + 1, {
                    kind: 0, gx, gy, tile,
                    sx: scr.x, sy: scr.y,
                });
            }
        }

        // Entities (tanks, bullets, particles)
        const addEntity = (kind, entity, wx, wy) => {
            const scr = worldToScreen(wx, wy);
            if (scr.x < visLeft - 40 || scr.x > visRight + 40 ||
                scr.y < visTop - 40  || scr.y > visBottom + 40) return;
            addToBucket(wx + wy, { kind, entity, sx: scr.x, sy: scr.y });
        };

        for (const t of game.allTanks) {
            if (t.alive || t.respawnTimer > 0) addEntity(1, t, t.x, t.y);
        }
        for (const tw of game.towers) {
            if (tw.alive) addEntity(4, tw, tw.x, tw.y);
        }
        for (const b of game.bullets) {
            if (b.alive) addEntity(2, b, b.x, b.y);
        }
        for (const p of game.particles.particles) {
            addEntity(3, p, p.x, p.y);
        }

        // Render back-to-front (save/restore prevents canvas state leaks
        // between entity draws — a stale globalAlpha could hide everything)
        for (let d = 0; d < buckets.length; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (const item of bucket) {
                ctx.save();
                switch (item.kind) {
                    case 0: this._drawTile(ctx, item, game.gameTime, map); break;
                    case 1: this._drawVehicle(ctx, item.entity, item.sx, item.sy); break;
                    case 2: this._drawBullet(ctx, item.entity, item.sx, item.sy, game.gameTime); break;
                    case 3: this._drawParticle(ctx, item.entity, item.sx, item.sy); break;
                    case 4: this._drawTower(ctx, item.entity, item.sx, item.sy); break;
                }
                ctx.restore();
            }
        }

        ctx.restore();
    }

    /* ── tile drawing ─────────────────────────────────────── */

    _drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
        // Colour variation per tile based on position
        const v = ((gx * 7 + gy * 13) % 5) - 2;   // −2 … +2

        switch (tile) {
            case T.DEEP_WATER:
            case T.SHALLOW_WATER: {
                const base = tile === T.DEEP_WATER ? PALETTE.deepWater : PALETTE.shallowWater;
                const wave = Math.sin(time * 1.8 + gx * 1.3 + gy * 0.9) * 0.5 + 0.5;
                const r = base.r + v * 2 + wave * 12;
                const g = base.g + v * 2 + wave * 16;
                const b = base.b + v * 2 + wave * 22;
                this._diamond(ctx, sx, sy, rgb(r, g, b));
                // subtle wave highlight
                if (wave > 0.7) {
                    ctx.globalAlpha = (wave - 0.7) * 1.5;
                    this._diamond(ctx, sx, sy, 'rgba(180,210,240,0.15)');
                    ctx.globalAlpha = 1;
                }
                break;
            }

            case T.SAND: {
                const c = PALETTE.sand;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.DIRT: {
                const c = PALETTE.dirt;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.PAVED: {
                const c = PALETTE.paved;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 2, c.g + v * 2, c.b + v * 2));
                break;
            }

            case T.GRASS: {
                const c = PALETTE.grass;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 4, c.g + v * 4, c.b + v * 3));
                break;
            }

            case T.DARK_GRASS: {
                const c = PALETTE.darkGrass;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.HILL: {
                const frac = map.getDamageFraction(gx, gy);
                const h = Math.round(map.tileHeight(T.HILL) * frac);
                this._elevatedTile(ctx, sx, sy, h,
                    PALETTE.hillTop, PALETTE.hillLeft, PALETTE.hillRight, v);
                if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
                break;
            }

            case T.ROCK: {
                const frac = map.getDamageFraction(gx, gy);
                const h = Math.round(map.tileHeight(T.ROCK) * frac);
                this._elevatedTile(ctx, sx, sy, h,
                    PALETTE.rockTop, PALETTE.rockLeft, PALETTE.rockRight, v);
                if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
                break;
            }

            case T.BLDG_SMALL:
            case T.BLDG_MEDIUM:
            case T.BLDG_LARGE: {
                const frac = map.getDamageFraction(gx, gy);
                this._drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time);
                break;
            }
        }
    }

    /** Draw a flat isometric diamond (top face of a ground-level tile). */
    _diamond(ctx, sx, sy, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx,          sy);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();
    }

    /** Draw an elevated tile (top face + two visible side faces). */
    _elevatedTile(ctx, sx, sy, h, topC, leftC, rightC, v) {
        // Left (SW) side
        ctx.fillStyle = rgb(leftC.r + v * 2, leftC.g + v * 2, leftC.b + v * 2);
        ctx.beginPath();
        ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Right (SE) side
        ctx.fillStyle = rgb(rightC.r + v * 2, rightC.g + v * 2, rightC.b + v * 2);
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Top face
        ctx.fillStyle = rgb(topC.r + v * 3, topC.g + v * 3, topC.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx,          sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Overlay cracks and darkening on a damaged elevated tile.
     * `frac` = 1 (undamaged) → 0 (about to break).
     */
    _drawDamageOverlay(ctx, sx, sy, h, frac, time) {
        const dmg = 1 - frac;   // 0 = no damage, 1 = nearly dead

        // Darken the top face proportionally to damage
        ctx.globalAlpha = dmg * 0.45;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(sx,          sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Crack lines – more cracks at higher damage
        const crackCount = Math.ceil(dmg * 5);
        ctx.strokeStyle = `rgba(0,0,0,${0.3 + dmg * 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Seed cracks deterministically from tile position
        const seedX = sx * 7 + sy * 13;
        for (let i = 0; i < crackCount; i++) {
            // Pseudo-random offsets within the top diamond
            const a = Math.sin(seedX + i * 37.7) * 0.35;
            const b = Math.cos(seedX + i * 53.3) * 0.35;
            const cx1 = sx + a * TW * 0.4;
            const cy1 = sy - h + TH / 2 + b * TH * 0.4;
            const a2 = Math.sin(seedX + i * 71.1) * 0.35;
            const b2 = Math.cos(seedX + i * 91.9) * 0.35;
            const cx2 = sx + a2 * TW * 0.4;
            const cy2 = sy - h + TH / 2 + b2 * TH * 0.4;
            ctx.moveTo(cx1, cy1);
            ctx.lineTo(cx2, cy2);
        }
        ctx.stroke();

        // Flash white briefly when at critical damage
        if (frac <= 0.34 && Math.sin(time * 10) > 0.5) {
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = '#ff4400';
            ctx.beginPath();
            ctx.moveTo(sx,          sy - h);
            ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
            ctx.lineTo(sx,          sy + TH - h);
            ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    /* ── building drawing ─────────────────────────────────── */

    /**
     * Draw an isometric building with walls, roof, and details.
     * Height shrinks with damage just like terrain.
     */
    _drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time) {
        const pal = tile === T.BLDG_SMALL  ? PALETTE.bldgSmall
                  : tile === T.BLDG_MEDIUM ? PALETTE.bldgMedium
                  :                          PALETTE.bldgLarge;

        const fullH = tile === T.BLDG_SMALL ? 14
                    : tile === T.BLDG_MEDIUM ? 22 : 32;
        const h = Math.max(2, Math.round(fullH * frac));
        const v = ((gx * 7 + gy * 13) % 3) - 1;

        const w = pal.wall, rf = pal.roof, tr = pal.trim;

        // ── Left (SW) wall ──
        ctx.fillStyle = rgb(tr.r + v * 3, tr.g + v * 3, tr.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // ── Right (SE) wall ──
        ctx.fillStyle = rgb(w.r + v * 3, w.g + v * 3, w.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // ── Roof (top face) ──
        ctx.fillStyle = rgb(rf.r + v * 4, rf.g + v * 4, rf.b + v * 4);
        ctx.beginPath();
        ctx.moveTo(sx,          sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();

        // ── Roof ridge line (gives depth) ──
        ctx.strokeStyle = rgb(rf.r - 20, rf.g - 20, rf.b - 20);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - TW * 0.2, sy + TH / 2 - h);
        ctx.lineTo(sx + TW * 0.2, sy + TH / 2 - h);
        ctx.stroke();

        // ── Window on right wall (if tall enough) ──
        if (h >= 14) {
            const winW = TW * 0.12, winH = h * 0.25;
            const winX = sx + TW * 0.15;
            const winY = sy + TH * 0.25 - h * 0.2;
            ctx.fillStyle = '#3a4a5a';
            ctx.fillRect(winX, winY, winW, winH);
            // Window frame
            ctx.strokeStyle = rgb(tr.r, tr.g, tr.b);
            ctx.lineWidth = 0.5;
            ctx.strokeRect(winX, winY, winW, winH);
        }

        // ── Second window (medium + large) ──
        if (h >= 20) {
            const winW = TW * 0.10, winH = h * 0.2;
            const winX = sx + TW * 0.02;
            const winY = sy + TH * 0.40 - h * 0.15;
            ctx.fillStyle = '#3a4a5a';
            ctx.fillRect(winX, winY, winW, winH);
            ctx.strokeStyle = rgb(tr.r, tr.g, tr.b);
            ctx.lineWidth = 0.5;
            ctx.strokeRect(winX, winY, winW, winH);
        }

        // ── Door on left wall ──
        if (h >= 10) {
            const doorW = TW * 0.08, doorH = Math.min(h * 0.45, 10);
            const doorX = sx - TW * 0.22;
            const doorY = sy + TH / 2 - doorH;
            ctx.fillStyle = '#5a3a22';
            ctx.fillRect(doorX, doorY, doorW, doorH);
        }

        // ── Chimney (large buildings only) ──
        if (tile === T.BLDG_LARGE && frac > 0.5) {
            const chX = sx + TW * 0.12;
            const chY = sy - h - 6;
            ctx.fillStyle = rgb(tr.r - 10, tr.g - 10, tr.b - 10);
            ctx.fillRect(chX, chY, 4, 8);
            // Chimney top
            ctx.fillStyle = rgb(tr.r + 5, tr.g + 5, tr.b + 5);
            ctx.fillRect(chX - 1, chY, 6, 2);
        }

        // ── Damage overlay ──
        if (frac < 1) {
            this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
        }
    }

    /* ── vehicle drawing (dispatch) ───────────────────────── */

    _drawVehicle(ctx, tank, sx, sy) {
        if (tank.vehicleType === 'ifv') {
            this._drawIFV(ctx, tank, sx, sy);
        } else {
            this._drawTank(ctx, tank, sx, sy);
        }
    }

    /* ── tank drawing ─────────────────────────────────────── */

    /**
     * Draw a fully-rotated isometric tank with visible 3-D depth.
     *
     * Every shape is defined in **local space** (+x = forward, +y = right)
     * then rotated by the tank's angle and projected through the
     * isometric transform.  Vertical height is faked by drawing each
     * layer at a screen-Y offset so the tank looks stacked:
     *
     *   ground → tracks → hull → turret → barrel
     *
     * Each layer has a dark "side wall" drawn below its top face.
     *
     * The hull and tracks use the tank's hull angle, while the turret
     * and barrel use the world-space turretWorld (hull angle + turret offset).
     */
    _drawTank(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle), sa = Math.sin(tank.angle);
        const tWorld = tank.turretWorld;
        const ta = Math.cos(tWorld), tb = Math.sin(tWorld);
        const HTW = TW / 2, HTH = TH / 2;

        // Project local point → screen using hull angle.  lx = forward, ly = right.
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW,
                    sy + (wx + wy) * HTH];
        };

        // Project local point → screen using turret angle.
        const PT = (lx, ly) => {
            const wx = lx * ta - ly * tb;
            const wy = lx * tb + ly * ta;
            return [sx + (wx - wy) * HTW,
                    sy + (wx + wy) * HTH];
        };

        // Fill polygon helper
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };

        // Stroke polygon outline
        const outline = (pts, color, width) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };

        // Shift every point down by d pixels
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);

        // Draw a 3-D extruded slab: side wall of height h, then top face.
        // `wallColor` is for the visible side wall, `topColor` for the top.
        const slab = (topPts, h, topColor, wallColor) => {
            const bot = drop(topPts, h);
            // Draw side wall: connect each top edge to its corresponding
            // bottom edge, but only the segments whose normals face "down"
            // on screen (i.e. the viewer-facing sides).
            // Simplified: draw bottom then top is sufficient for convex shapes.
            fill(bot, wallColor);
            fill(topPts, topColor);
        };

        /* ── local-space dimensions (world units) ─────────
         *  Scaled up ~60 % from the previous version so the
         *  tank is clearly visible and has room for detail.  */
        const THL  = 0.38;   // track half-length
        const TYO  = 0.30;   // track outer Y
        const TYI  = 0.21;   // track inner Y
        const HR   = -0.28;  // hull rear X
        const HF   = 0.24;   // hull front X
        const HT   = 0.34;   // hull pointed tip X
        const HW   = 0.20;   // hull half-width Y
        const TR   = 0.13;   // turret radius
        const BHW  = 0.03;   // barrel half-width
        const BX0  = 0.10;   // barrel start X
        let   BX1  = 0.52;   // barrel end X
        const TRACK_H = 4;   // track extrusion height (px)
        const HULL_H  = 7;   // hull extrusion height (px)
        const TURR_H  = 5;   // turret extrusion height (px)
        const BARR_H  = 3;   // barrel extrusion height (px)

        if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.10;

        // ── Vertical offsets (cumulative, lower = further down screen) ──
        // We draw from ground up.  Each layer's "top" is shifted up by
        // the sum of all layers below it.
        const trackTop = -(TRACK_H);                         // tracks sit on ground
        const hullTop  = -(TRACK_H + HULL_H);               // hull sits on tracks
        const turrTop  = -(TRACK_H + HULL_H + TURR_H);      // turret on hull
        const barrTop  = -(TRACK_H + HULL_H + BARR_H);      // barrel on hull

        // Apply a vertical offset to projected points
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

        /* ── 1. Shadow ──────────────────────────────────── */
        fill(drop([
            P(-THL - 0.04, -TYO - 0.02), P( THL + 0.04, -TYO - 0.02),
            P( THL + 0.04,  TYO + 0.02), P(-THL - 0.04,  TYO + 0.02),
        ], 6), 'rgba(0,0,0,0.18)');

        /* ── 2. Tracks (hull angle) ─────────────────────── */
        // Left track: red-brown if disabled, normal dark grey otherwise
        const lTrackColor = tank.leftTrackDisabled ? '#5a2a1a' : '#2a2a2a';
        const lTrackWall  = tank.leftTrackDisabled ? '#3a1a0a' : '#111';
        const lTrackTop = lift(
            [P(-THL,-TYO), P(THL,-TYO), P(THL,-TYI), P(-THL,-TYI)],
            trackTop);
        slab(lTrackTop, TRACK_H, lTrackColor, lTrackWall);

        // Right track
        const rTrackColor = tank.rightTrackDisabled ? '#5a2a1a' : '#2a2a2a';
        const rTrackWall  = tank.rightTrackDisabled ? '#3a1a0a' : '#111';
        const rTrackTop = lift(
            [P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)],
            trackTop);
        slab(rTrackTop, TRACK_H, rTrackColor, rTrackWall);

        // Tread marks (on the track top faces, scrolling)
        // Skip tread marks on disabled tracks (visually broken)
        const TREAD_N = 8;
        ctx.strokeStyle = '#444';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        for (let i = 0; i < TREAD_N; i++) {
            const t  = ((i / TREAD_N + tank.treadPhase) % 1);
            const lx = -THL + t * THL * 2;
            if (!tank.leftTrackDisabled) {
                const a1 = lift([P(lx, -TYO)], trackTop)[0];
                const a2 = lift([P(lx, -TYI)], trackTop)[0];
                ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]);
            }
            if (!tank.rightTrackDisabled) {
                const b1 = lift([P(lx,  TYI)], trackTop)[0];
                const b2 = lift([P(lx,  TYO)], trackTop)[0];
                ctx.moveTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]);
            }
        }
        ctx.stroke();

        // Damage cracks on disabled tracks
        if (tank.leftTrackDisabled) {
            ctx.strokeStyle = '#2a0a00';
            ctx.lineWidth = 1;
            const c1 = lift([P(-THL * 0.3, -(TYO + TYI) / 2)], trackTop)[0];
            const c2 = lift([P( THL * 0.3, -(TYO * 0.7 + TYI * 0.3))], trackTop)[0];
            ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
        }
        if (tank.rightTrackDisabled) {
            ctx.strokeStyle = '#2a0a00';
            ctx.lineWidth = 1;
            const c1 = lift([P(-THL * 0.2, (TYO + TYI) / 2)], trackTop)[0];
            const c2 = lift([P( THL * 0.2, (TYO * 0.7 + TYI * 0.3))], trackTop)[0];
            ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
        }

        // Track wheel detail (small circles inside tracks)
        ctx.fillStyle = '#1a1a1a';
        for (let i = 0; i < 3; i++) {
            const lx = -THL * 0.6 + i * THL * 0.6;
            if (!tank.leftTrackDisabled) {
                const cL = lift([P(lx, -(TYO + TYI) / 2)], trackTop)[0];
                ctx.beginPath(); ctx.arc(cL[0], cL[1], 2, 0, Math.PI * 2); ctx.fill();
            }
            if (!tank.rightTrackDisabled) {
                const cR = lift([P(lx,  (TYO + TYI) / 2)], trackTop)[0];
                ctx.beginPath(); ctx.arc(cR[0], cR[1], 2, 0, Math.PI * 2); ctx.fill();
            }
        }

        /* ── 3. Hull (hull angle) ───────────────────────── */
        // Darken hull colour when damaged
        const hullColor = tank.damaged ? tank.darkColor : tank.color;
        const hullDark  = tank.damaged ? '#1a1a1a' : tank.darkColor;
        const hullPts = lift([
            P(HR, -HW), P(HF, -HW),
            P(HT, 0),
            P(HF,  HW), P(HR,  HW),
        ], hullTop);
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.5);

        // Rear panel (darker accent)
        const rearW = HW - 0.03;
        fill(lift([P(HR, -rearW), P(HR + 0.05, -rearW),
                   P(HR + 0.05, rearW), P(HR, rearW)], hullTop), hullDark);

        // Hull centre ridge
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 1;
        const rg1 = lift([P(HR + 0.08, 0)], hullTop)[0];
        const rg2 = lift([P(HF - 0.04, 0)], hullTop)[0];
        ctx.beginPath(); ctx.moveTo(rg1[0], rg1[1]); ctx.lineTo(rg2[0], rg2[1]); ctx.stroke();

        // Side panel lines (give hull more shape)
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 0.5;
        const sp1a = lift([P(HR + 0.04, -HW)], hullTop)[0];
        const sp1b = lift([P(HR + 0.04,  HW)], hullTop)[0];
        ctx.beginPath(); ctx.moveTo(sp1a[0], sp1a[1]); ctx.lineTo(sp1b[0], sp1b[1]); ctx.stroke();

        /* ── 4. Barrel (turret angle) ───────────────────── */
        const barrColor = tank.turretDisabled ? '#444' : '#666';
        const barrDark  = tank.turretDisabled ? '#222' : '#333';
        const barrPts = lift([
            PT(BX0, -BHW), PT(BX1, -BHW),
            PT(BX1,  BHW), PT(BX0,  BHW),
        ], barrTop);
        slab(barrPts, BARR_H, barrColor, barrDark);

        // Muzzle brake (wider tip)
        const MZ = 0.04;
        const muzzle = lift([
            PT(BX1 - MZ, -BHW - 0.015), PT(BX1 + 0.01, -BHW - 0.015),
            PT(BX1 + 0.01,  BHW + 0.015), PT(BX1 - MZ,  BHW + 0.015),
        ], barrTop);
        slab(muzzle, BARR_H,
            tank.turretDisabled ? '#555' : '#777',
            tank.turretDisabled ? '#333' : '#444');

        /* ── 5. Turret (turret angle) ───────────────────── */
        const turretColor = tank.turretDisabled ? '#555' : tank.color;
        const turretDark  = tank.turretDisabled ? '#333' : tank.darkColor;
        const tPts = [], tHatch = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            const a = i / N * Math.PI * 2;
            tPts.push(  lift([PT(Math.cos(a) * TR,       Math.sin(a) * TR)],       turrTop)[0]);
            tHatch.push(lift([PT(Math.cos(a) * TR * 0.35, Math.sin(a) * TR * 0.35)], turrTop)[0]);
        }
        slab(tPts, TURR_H, turretColor, turretDark);
        outline(tPts, turretDark, 0.5);

        // Commander hatch
        fill(tHatch, turretDark);

        // Hatch cross-hair (or X for disabled turret)
        if (tank.turretDisabled) {
            // Red X indicating locked turret
            ctx.strokeStyle = '#cc2222';
            ctx.lineWidth = 1.5;
            const x1 = lift([PT(-TR * 0.25, -TR * 0.25)], turrTop)[0];
            const x2 = lift([PT( TR * 0.25,  TR * 0.25)], turrTop)[0];
            const x3 = lift([PT(-TR * 0.25,  TR * 0.25)], turrTop)[0];
            const x4 = lift([PT( TR * 0.25, -TR * 0.25)], turrTop)[0];
            ctx.beginPath();
            ctx.moveTo(x1[0], x1[1]); ctx.lineTo(x2[0], x2[1]);
            ctx.moveTo(x3[0], x3[1]); ctx.lineTo(x4[0], x4[1]);
            ctx.stroke();
        } else {
            ctx.strokeStyle = tank.color;
            ctx.lineWidth = 0.5;
            const hc = lift([PT(0, 0)], turrTop)[0];
            const ht = lift([PT(0, -TR * 0.3)], turrTop)[0];
            const hb = lift([PT(0,  TR * 0.3)], turrTop)[0];
            const hl = lift([PT(-TR * 0.3, 0)], turrTop)[0];
            const hr = lift([PT( TR * 0.3, 0)], turrTop)[0];
            ctx.beginPath();
            ctx.moveTo(ht[0], ht[1]); ctx.lineTo(hb[0], hb[1]);
            ctx.moveTo(hl[0], hl[1]); ctx.lineTo(hr[0], hr[1]);
            ctx.stroke();
        }
    }

    /* ── IFV drawing ──────────────────────────────────── */

    /**
     * Draw a wheeled IFV (IFV).  Visually very different from tank:
     *   - Wide, flat-bodied APC shape (vs narrow pointed tank)
     *   - 4 large visible wheels per side (vs continuous tracks)
     *   - Olive/khaki hull tint overlaid on team colour
     *   - Small boxy fixed turret (vs circular rotating turret)
     *   - White chevron marking on hull top
     */
    _drawIFV(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle), sa = Math.sin(tank.angle);
        const HTW = TW / 2, HTH = TH / 2;

        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath(); ctx.fill();
        };
        const outline = (pts, color, width) => {
            ctx.strokeStyle = color; ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath(); ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topColor, wallColor) => {
            fill(drop(topPts, h), wallColor);
            fill(topPts, topColor);
        };

        /* ── IFV is WIDER and FLATTER than a tank ───── */
        const SHL  = 0.36;   // hull half-length
        const SHW  = 0.26;   // hull half-width (MUCH wider than tank's 0.20)
        const SWO  = 0.30;   // wheel outer Y (beyond hull)
        const BHW  = 0.02;   // barrel half-width (thin autocannon)
        const BX0  = 0.05;   // barrel start X
        let   BX1  = 0.48;   // barrel end X
        const MHW  = 0.07;   // turret mount half-width
        const MHL  = 0.10;   // turret mount half-length

        const WHEEL_H = 4;
        const HULL_H  = 4;   // flat (vs tank 7)
        const MOUNT_H = 3;
        const BARR_H  = 2;

        if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.06;

        const wheelTop = -(WHEEL_H);
        const hullTop  = -(WHEEL_H + HULL_H);
        const mountTop = -(WHEEL_H + HULL_H + MOUNT_H);
        const barrTop  = -(WHEEL_H + HULL_H + BARR_H);

        // Olive-tinted hull: mix team colour with khaki
        const hullColor = tank.color;
        const hullDark  = tank.darkColor;

        /* ── 1. Shadow ──────────────────────────────────── */
        fill(drop([
            P(-SHL - 0.04, -SWO - 0.03), P(SHL + 0.04, -SWO - 0.03),
            P(SHL + 0.04, SWO + 0.03), P(-SHL - 0.04, SWO + 0.03),
        ], 5), 'rgba(0,0,0,0.2)');

        /* ── 2. Wheels — 4 per side, large and visible ──── */
        const wheelXs = [-0.24, -0.08, 0.08, 0.24];
        const wheelR = 4.5;    // much larger than before (was 3.2)
        for (const wx of wheelXs) {
            for (const side of [-1, 1]) {
                const wc = lift([P(wx, SWO * side)], wheelTop)[0];
                // Tyre (dark)
                ctx.fillStyle = '#1a1a1a';
                ctx.beginPath(); ctx.arc(wc[0], wc[1], wheelR, 0, Math.PI * 2); ctx.fill();
                // Rim (lighter)
                ctx.fillStyle = '#555';
                ctx.beginPath(); ctx.arc(wc[0], wc[1], wheelR * 0.5, 0, Math.PI * 2); ctx.fill();
                // Spinning hub cross
                const spA = tank.treadPhase * Math.PI * 2;
                ctx.strokeStyle = '#777'; ctx.lineWidth = 1;
                ctx.beginPath();
                const dx1 = Math.cos(spA) * wheelR * 0.35;
                const dy1 = Math.sin(spA) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx1, wc[1] - dy1 * 0.5);
                ctx.lineTo(wc[0] + dx1, wc[1] + dy1 * 0.5);
                const dx2 = Math.cos(spA + Math.PI/2) * wheelR * 0.35;
                const dy2 = Math.sin(spA + Math.PI/2) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx2, wc[1] - dy2 * 0.5);
                ctx.lineTo(wc[0] + dx2, wc[1] + dy2 * 0.5);
                ctx.stroke();
            }
        }

        /* ── 3. Hull — wide flat box (NOT pointed like tank) ── */
        // Flat front instead of tank's pointed nose
        const hullPts = lift([
            P(-SHL, -SHW),
            P( SHL, -SHW),   // flat front edge (key visual difference)
            P( SHL,  SHW),
            P(-SHL,  SHW),
        ], hullTop);
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.7);

        // Rear panel
        fill(lift([P(-SHL, -SHW + 0.03), P(-SHL + 0.04, -SHW + 0.03),
                   P(-SHL + 0.04, SHW - 0.03), P(-SHL, SHW - 0.03)], hullTop), hullDark);

        // ── White chevron on hull top (iconic IFV marking) ──
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        const chev1 = lift([P(0.12, -SHW * 0.6)], hullTop)[0];
        const chev2 = lift([P(0.22, 0)], hullTop)[0];
        const chev3 = lift([P(0.12, SHW * 0.6)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(chev1[0], chev1[1]);
        ctx.lineTo(chev2[0], chev2[1]);
        ctx.lineTo(chev3[0], chev3[1]);
        ctx.stroke();

        // ── Side armour panels (thick white stripe) ──
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2.5;
        const s1 = lift([P(-SHL + 0.05, -SHW)], hullTop)[0];
        const s2 = lift([P(SHL - 0.05, -SHW)], hullTop)[0];
        ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
        const s3 = lift([P(-SHL + 0.05, SHW)], hullTop)[0];
        const s4 = lift([P(SHL - 0.05, SHW)], hullTop)[0];
        ctx.beginPath(); ctx.moveTo(s3[0], s3[1]); ctx.lineTo(s4[0], s4[1]); ctx.stroke();

        // Hull cross-bar detail
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 0.6;
        const cb1 = lift([P(-0.10, -SHW)], hullTop)[0];
        const cb2 = lift([P(-0.10,  SHW)], hullTop)[0];
        ctx.beginPath(); ctx.moveTo(cb1[0], cb1[1]); ctx.lineTo(cb2[0], cb2[1]); ctx.stroke();

        /* ── 4. Barrel (thin autocannon, hull angle) ────── */
        const barrPts = lift([
            P(BX0, -BHW), P(BX1, -BHW),
            P(BX1, BHW), P(BX0, BHW),
        ], barrTop);
        slab(barrPts, BARR_H, '#777', '#444');

        // Muzzle brake
        const muzzle = lift([
            P(BX1 - 0.02, -BHW - 0.008), P(BX1 + 0.005, -BHW - 0.008),
            P(BX1 + 0.005, BHW + 0.008), P(BX1 - 0.02, BHW + 0.008),
        ], barrTop);
        slab(muzzle, BARR_H, '#888', '#555');

        /* ── 5. Gun mount — small angular box (NOT circular) ── */
        const mountPts = lift([
            P(-MHL, -MHW), P(MHL, -MHW),
            P(MHL, MHW), P(-MHL, MHW),
        ], mountTop);
        slab(mountPts, MOUNT_H, hullColor, hullDark);
        outline(mountPts, hullDark, 0.5);

        // Vision slit on front of mount
        ctx.fillStyle = '#222';
        const vs1 = lift([P(MHL - 0.01, -MHW * 0.5)], mountTop)[0];
        const vs2 = lift([P(MHL - 0.01,  MHW * 0.5)], mountTop)[0];
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(vs1[0], vs1[1]); ctx.lineTo(vs2[0], vs2[1]); ctx.stroke();
    }

    /* ── tower drawing ────────────────────────────────────── */

    _drawTower(ctx, tower, sx, sy) {
        const frac = tower.hp / tower.maxHp;
        const fullH = CONFIG.TOWER_VIS_HEIGHT;
        const h = Math.round(fullH * frac);        // shrinks with damage
        if (h <= 0) return;

        const S  = 0.45;   // half-size in world units (isometric block)
        const bw = S * TW;
        const bd = S * TH;

        // Darken colours based on damage
        const dmg = 1 - frac;
        const darken = (hex, amt) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const f = 1 - amt * 0.5;
            return rgb(r * f, g * f, b * f);
        };
        const topCol   = darken(tower.color, dmg);
        const leftCol  = darken(tower.darkColor, dmg);
        const rightCol = darken(tower.darkColor, dmg * 0.7);

        // ── Left (SW) side wall ──
        ctx.fillStyle = leftCol;
        ctx.beginPath();
        ctx.moveTo(sx - bw, sy - h);
        ctx.lineTo(sx,      sy + bd - h);
        ctx.lineTo(sx,      sy + bd);
        ctx.lineTo(sx - bw, sy);
        ctx.closePath();
        ctx.fill();

        // ── Right (SE) side wall ──
        ctx.fillStyle = rightCol;
        ctx.beginPath();
        ctx.moveTo(sx + bw, sy - h);
        ctx.lineTo(sx,      sy + bd - h);
        ctx.lineTo(sx,      sy + bd);
        ctx.lineTo(sx + bw, sy);
        ctx.closePath();
        ctx.fill();

        // ── Top face ──
        ctx.fillStyle = topCol;
        ctx.beginPath();
        ctx.moveTo(sx,      sy - bd - h);
        ctx.lineTo(sx + bw, sy - h);
        ctx.lineTo(sx,      sy + bd - h);
        ctx.lineTo(sx - bw, sy - h);
        ctx.closePath();
        ctx.fill();

        // ── Damage cracks on top face ──
        if (dmg > 0) {
            this._drawDamageOverlay(ctx, sx, sy, h, frac, 0);
        }

        // ── Battlements (only at high HP) ──
        if (frac > 0.4) {
            const mH = 5;
            const mw = bw * 0.3;
            ctx.fillStyle = leftCol;
            // Four small merlon blocks at diamond corners
            const merlons = [
                [sx,      sy - bd - h - mH],
                [sx + bw, sy - h - mH],
                [sx,      sy + bd - h - mH],
                [sx - bw, sy - h - mH],
            ];
            for (const [mx, my] of merlons) {
                ctx.fillRect(mx - mw / 2, my, mw, mH);
            }
        }

        // ── Flag pole + flag ──
        const flagX = sx, flagY = sy - bd - h - 18;
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - bd - h);
        ctx.lineTo(flagX, flagY);
        ctx.stroke();

        ctx.fillStyle = tower.color;
        ctx.beginPath();
        ctx.moveTo(flagX, flagY);
        ctx.lineTo(flagX + 10, flagY + 4);
        ctx.lineTo(flagX, flagY + 8);
        ctx.closePath();
        ctx.fill();

        // ── HP bar ──
        const barW = 34, barH = 5;
        const barX = sx - barW / 2, barY = flagY - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
        ctx.fillStyle = frac > 0.5 ? '#4a4' : frac > 0.25 ? '#da4' : '#d44';
        ctx.fillRect(barX, barY, barW * frac, barH);
    }

    /* ── bullet drawing ───────────────────────────────────── */

    _drawBullet(ctx, bullet, sx, sy, time) {
        const pulse = Math.sin(time * 30) * 0.3 + 0.7;
        const isIFV = bullet.damage < 1.0;

        if (isIFV) {
            // ── IFV tracer: small bright green dot with trail ──
            const r = 1.8;

            // Trail (3 fading dots behind)
            const trailDx = -Math.cos(bullet.angle) * 3;
            const trailDy = -Math.sin(bullet.angle) * 1.5;  // iso squish
            for (let i = 1; i <= 3; i++) {
                ctx.globalAlpha = 0.3 - i * 0.08;
                ctx.fillStyle = '#88ff44';
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
            ctx.fillStyle = `rgb(${140 + pulse * 40|0},255,${80 + pulse * 40|0})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();

            // White hot centre
            ctx.fillStyle = '#eeffcc';
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
            ctx.fillStyle = `rgb(255,${200 + pulse * 55|0},${50 + pulse * 80|0})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();

            // Bright centre
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── particle drawing ─────────────────────────────────── */

    _drawParticle(ctx, p, sx, sy) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        const half = p.size / 2;
        ctx.fillRect(sx - half, sy - half, p.size, p.size);
        ctx.globalAlpha = 1;
    }

    /* ── HUD (per-viewport overlay) ───────────────────────── */

    _drawHUD(ctx, game, playerNum, vx, vy, vw, vh) {
        const tank  = playerNum === 1 ? game.tank1 : game.tank2;
        const label = (playerNum === 2 && game.mode === 'pvb') ? 'BOT' : `P${playerNum}`;
        const score = tank.score;

        ctx.save();

        // Player label + score
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.textAlign = 'center';
        const cx = vx + vw / 2;

        // Background pill
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const pillW = 140, pillH = 36;
        this._roundedRect(ctx, cx - pillW / 2, vy + 10, pillW, pillH, 8);
        ctx.fill();

        // Text
        ctx.fillStyle = tank.color;
        ctx.fillText(`${label}: ${score} / ${CONFIG.WIN_SCORE}`, cx, vy + 35);

        // Respawn message
        if (!tank.alive) {
            ctx.font = 'bold 18px "Courier New", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('RESPAWNING...', cx, vy + vh / 2);
        }

        // Controls hint (first few seconds)
        if (game.gameTime < 6) {
            const alpha = game.gameTime < 4 ? 0.7 : 0.7 * (1 - (game.gameTime - 4) / 2);
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.font = '14px "Courier New", monospace';
            ctx.fillStyle = '#ccc';
            if (playerNum === 1) {
                ctx.fillText('WASD move · QE turret · SPACE fire', cx, vy + vh - 30);
            } else {
                ctx.fillText('Arrows move · ,. turret · ENTER fire', cx, vy + vh - 30);
            }
            ctx.globalAlpha = 1;
        }

        // Minimap
        this._drawMinimap(ctx, game, playerNum, vx, vy, vw, vh);

        ctx.restore();
    }

    /* ── minimap ──────────────────────────────────────────── */

    _drawMinimap(ctx, game, playerNum, vx, vy, vw, vh) {
        const map  = game.map;
        const px   = 2;                        // pixels per tile
        const mmW  = map.width  * px;
        const mmH  = map.height * px;
        const pad  = 10;
        const mmX  = vx + vw - mmW - pad;
        const mmY  = vy + vh - mmH - pad;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

        // Tiles (simple top-down coloured squares)
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const t = map.getTile(gx, gy);
                let c;
                switch (t) {
                    case T.DEEP_WATER:    c = '#1a3252'; break;
                    case T.SHALLOW_WATER: c = '#265a80'; break;
                    case T.SAND:          c = '#c8b490'; break;
                    case T.DIRT:          c = '#9b8260'; break;
                    case T.PAVED:         c = '#8c8a82'; break;
                    case T.GRASS:         c = '#487c3c'; break;
                    case T.DARK_GRASS:    c = '#3a6c2a'; break;
                    case T.HILL:          c = '#8c7350'; break;
                    case T.ROCK:          c = '#808080'; break;
                    case T.BLDG_SMALL:    c = '#b4a08c'; break;
                    case T.BLDG_MEDIUM:   c = '#a0a0b0'; break;
                    case T.BLDG_LARGE:    c = '#707080'; break;
                    default:              c = '#000';
                }
                ctx.fillStyle = c;
                ctx.fillRect(mmX + gx * px, mmY + gy * px, px, px);
            }
        }

        // Tank dots (IFVs slightly smaller)
        for (const t of game.allTanks) {
            if (!t.alive) continue;
            ctx.fillStyle = t.team === 1 ? '#ff4444' : '#4488ff';
            const dx = mmX + t.x * px;
            const dy = mmY + t.y * px;
            if (t.vehicleType === 'ifv') {
                // Diamond shape for IFVs
                ctx.beginPath();
                ctx.moveTo(dx, dy - 1.5);
                ctx.lineTo(dx + 1.5, dy);
                ctx.lineTo(dx, dy + 1.5);
                ctx.lineTo(dx - 1.5, dy);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.fillRect(dx - 1, dy - 1, 3, 3);
            }
        }

        // Tower markers (larger)
        for (const tw of game.towers) {
            if (!tw.alive) continue;
            ctx.fillStyle = tw.team === 1 ? '#ff6666' : '#6688ff';
            const dx = mmX + tw.x * px;
            const dy = mmY + tw.y * px;
            ctx.fillRect(dx - 3, dy - 3, 7, 7);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(dx - 3, dy - 3, 7, 7);
        }

        // Border highlight for this player
        const borderTank = game.allTanks.find(t => t.team === playerNum) ?? game.allTanks[0];
        ctx.strokeStyle = borderTank ? borderTank.color : '#888';
        ctx.lineWidth = 1;
        ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
    }

    /* ── team HUD ─────────────────────────────────────────── */

    _drawTeamHUD(ctx, game, cw, ch) {
        ctx.save();
        ctx.textAlign = 'center';
        const cx = cw / 2;

        // Tower HP for both teams
        const barW = 150, barH = 14, gap = 20;
        for (let i = 0; i < game.towers.length; i++) {
            const tw = game.towers[i];
            const x = i === 0 ? cx - barW - gap : cx + gap;
            const y = 14;
            const frac = tw.alive ? tw.hp / tw.maxHp : 0;
            const label = tw.team === 1 ? 'RED TOWER' : 'BLUE TOWER';

            // Background
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x - 2, y - 2, barW + 4, barH + 18);

            // Label
            ctx.font = 'bold 11px "Courier New", monospace';
            ctx.fillStyle = tw.color;
            ctx.textAlign = i === 0 ? 'right' : 'left';
            ctx.fillText(label, i === 0 ? x + barW : x, y + 10);

            // Bar
            const barY = y + 14;
            ctx.fillStyle = '#222';
            ctx.fillRect(x, barY, barW, barH);
            ctx.fillStyle = frac > 0.5 ? tw.color : frac > 0.25 ? '#da4' : '#d44';
            ctx.fillRect(x, barY, barW * frac, barH);
            ctx.strokeStyle = '#666';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, barY, barW, barH);

            // HP text (ceil for display when fractional from IFV bullets)
            ctx.font = 'bold 10px "Courier New", monospace';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.ceil(tw.hp)}/${tw.maxHp}`, x + barW / 2, barY + 11);
        }

        // "VS" divider
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.fillStyle = '#555';
        ctx.textAlign = 'center';
        ctx.fillText('VS', cx, 36);

        // Vehicle type indicator
        if (game.humanTank.alive) {
            const vType = game.humanTank.vehicleType === 'ifv' ? '\u25C7 IFV' : '\u25C6 TANK';
            ctx.font = 'bold 13px "Courier New", monospace';
            ctx.fillStyle = game.humanTank.color;
            ctx.textAlign = 'center';
            ctx.fillText(vType, cx, ch - 20);
        }

        // Respawn message
        if (!game.humanTank.alive) {
            ctx.font = 'bold 20px "Courier New", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('RESPAWNING...', cx, ch / 2);
        }

        // Minimap
        this._drawMinimap(ctx, game, 1, 0, 0, cw, ch);

        ctx.restore();
    }

    /* ── game over overlay ────────────────────────────────── */

    _drawGameOver(ctx, game) {
        const cw = this.canvas.width, ch = this.canvas.height;

        // Dim
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.textAlign = 'center';

        // Winner label
        let winner, label;
        if (game.mode === 'team') {
            winner = { color: game.winner === 1 ? '#cc3333' : '#3366dd' };
            label  = game.winner === 1 ? 'RED TEAM' : 'BLUE TEAM';
        } else {
            winner = game.winner === 1 ? game.tank1 : game.tank2;
            label  = game.winner === 1 ? 'PLAYER 1'
                   : game.mode === 'pvb' ? 'BOT' : 'PLAYER 2';
        }

        ctx.font = 'bold 48px "Courier New", monospace';
        ctx.fillStyle = winner.color;
        ctx.fillText(`${label} WINS!`, cw / 2, ch / 2 - 30);

        // Prompts
        ctx.font = '20px "Courier New", monospace';
        ctx.fillStyle = '#aaa';
        ctx.fillText('Space / Enter   Rematch', cw / 2, ch / 2 + 20);
        ctx.fillStyle = '#666';
        ctx.fillText('R   Menu', cw / 2, ch / 2 + 50);

        ctx.restore();
    }

    /* ── utility ──────────────────────────────────────────── */

    _roundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}
