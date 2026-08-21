/**
 * Per-viewport rendering: the two-pass depth-sort contract.
 *
 * Pass 1 draws all flat ground tiles (water, sand, grass, dirt, paved).
 * Pass 2 depth-sorts elevated tiles and entities together: elevated tiles
 * use depth gx+gy+1 so their side walls correctly occlude entities behind
 * them, and entities use their world position.  Flat tiles must never
 * enter the depth-sorted pass — it causes flickering when tanks cross
 * tile boundaries.
 *
 * `collectDepthItems` is exported separately so the depth contract can be
 * unit-tested without a canvas.
 */

import { VEHICLES } from "../config.js";
import { clamp, worldToScreen } from "../utils.js";
import { PALETTE, rgb } from "./canvas-utils.js";
import { drawBullet, drawParticle } from "./effects.js";
import { drawTargetIndicator } from "./overlay.js";
import { TH, TW } from "./projection.js";
import { drawBaseStructure } from "./structures.js";
import { drawTile } from "./tiles.js";
import { drawVehicle } from "./vehicles.js";

/**
 * Render one clipped viewport: terrain, depth-sorted entities, and the
 * SPG targeting indicator for the viewport's own tank.
 */
export function renderViewport(ctx, game, focusTank, camera, vx, vy, vw, vh) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx, vy, vw, vh);
    ctx.clip();

    // Fill background (deep water colour so edges look natural)
    ctx.fillStyle = rgb(PALETTE.deepWater.r - 6, PALETTE.deepWater.g - 6, PALETTE.deepWater.b - 6);
    ctx.fillRect(vx, vy, vw, vh);

    // Camera transform: centre of viewport tracks camera position
    const ox = vx + vw / 2 - camera.x;
    const oy = vy + vh / 2 - camera.y;
    ctx.translate(ox, oy);

    // Determine visible area in screen-space
    const visLeft = camera.x - vw / 2 - TW * 2;
    const visRight = camera.x + vw / 2 + TW * 2;
    const visTop = camera.y - vh / 2 - TH * 4;
    const visBottom = camera.y + vh / 2 + TH * 4;

    const map = game.map;

    // ── PASS 1: flat ground tiles ──
    // Flat tiles (water, sand, grass) can never occlude entities,
    // so we draw them all first.  Adjacent flat diamonds share
    // exact edges, so iteration order doesn't matter.
    for (let gy = 0; gy < map.height; gy++) {
        for (let gx = 0; gx < map.width; gx++) {
            const tile = map.getTile(gx, gy);
            if (map.tileHeight(tile) > 0) continue; // elevated → pass 2

            const scr = worldToScreen(gx, gy);
            if (scr.x < visLeft || scr.x > visRight || scr.y < visTop || scr.y > visBottom) continue;

            drawTile(ctx, { gx, gy, tile, sx: scr.x, sy: scr.y }, game.gameTime, map);
        }
    }

    // ── PASS 2: elevated tiles + entities, depth-sorted ──
    // Only hills/rocks can visually occlude entities, so they
    // share depth buckets with tanks, bullets, and particles.
    drawDepthBuckets(ctx, collectDepthItems(game, visLeft, visRight, visTop, visBottom), game);

    // ── SPG targeting indicator (drawn in camera space) ──
    if (focusTank.alive && focusTank.vehicleType === "spg" && focusTank.isCharging) {
        const vStats = VEHICLES.spg;
        const range = Math.min(vStats.minRange + focusTank.chargeTime * vStats.chargeRate, vStats.maxRange);
        const tAngle = focusTank.turretWorld;
        const targetWX = focusTank.x + Math.cos(tAngle) * range;
        const targetWY = focusTank.y + Math.sin(tAngle) * range;
        const tScr = worldToScreen(targetWX, targetWY);
        drawTargetIndicator(ctx, tScr.x, tScr.y, range, vStats.maxRange, game.gameTime);
    }

    ctx.restore();
}

/**
 * Gather every visible elevated tile and entity into depth buckets.
 *
 * Bucket index = floor(world depth), clamped to [0, map.width + map.height].
 * Drones get a +2 depth bonus so they render above buildings.  Items are
 * pushed in a fixed order (tiles, then tanks, then structures, then
 * bullets, then particles), which defines draw order within one bucket.
 *
 * @returns {Array<Array<object> | null>} buckets indexed by depth
 */
export function collectDepthItems(game, visLeft, visRight, visTop, visBottom) {
    const map = game.map;
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
            if (map.tileHeight(tile) === 0) continue; // already drawn

            const scr = worldToScreen(gx, gy);
            if (scr.x < visLeft || scr.x > visRight || scr.y < visTop || scr.y > visBottom) continue;

            addToBucket(gx + gy + 1, {
                kind: "tile",
                gx,
                gy,
                tile,
                sx: scr.x,
                sy: scr.y,
            });
        }
    }

    // Entities (tanks, bullets, particles)
    const addEntity = (kind, entity, wx, wy, depthBonus = 0) => {
        const scr = worldToScreen(wx, wy);
        if (scr.x < visLeft - 40 || scr.x > visRight + 40 || scr.y < visTop - 40 || scr.y > visBottom + 40) return;
        addToBucket(wx + wy + depthBonus, { kind, entity, sx: scr.x, sy: scr.y });
    };

    for (const t of game.allTanks) {
        if (t.alive || t.respawnTimer > 0) {
            // Air units fly above buildings — render them later (higher depth)
            const depthBonus = VEHICLES[t.vehicleType].unitClass === "air" ? 2 : 0;
            addEntity("vehicle", t, t.x, t.y, depthBonus);
        }
    }
    for (const s of game.baseStructures) {
        if (s.alive) addEntity("structure", s, s.x, s.y);
    }
    for (const b of game.bullets) {
        if (b.alive) addEntity("bullet", b, b.x, b.y);
    }
    for (const p of game.particles.particles) {
        addEntity("particle", p, p.x, p.y);
    }

    return buckets;
}

/**
 * Draw depth buckets back-to-front.  Each item is wrapped in
 * save/restore so a stale canvas state (e.g. globalAlpha) from one
 * sprite can never leak into the next draw.
 */
export function drawDepthBuckets(ctx, buckets, game) {
    for (let d = 0; d < buckets.length; d++) {
        const bucket = buckets[d];
        if (!bucket) continue;
        for (const item of bucket) {
            ctx.save();
            switch (item.kind) {
                case "tile":
                    drawTile(ctx, item, game.gameTime, game.map);
                    break;
                case "vehicle":
                    drawVehicle(ctx, item.entity, item.sx, item.sy);
                    break;
                case "bullet":
                    drawBullet(ctx, item.entity, item.sx, item.sy, game.gameTime);
                    break;
                case "particle":
                    drawParticle(ctx, item.entity, item.sx, item.sy);
                    break;
                case "structure":
                    drawBaseStructure(ctx, item.entity, item.sx, item.sy, game.gameTime);
                    break;
            }
            ctx.restore();
        }
    }
}

/** Draw separators on the interior edges of a multi-viewport layout. */
export function drawViewportBorders(ctx, rects, cw, ch) {
    if (rects.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "#556";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const seen = new Set();
    const edge = (vertical, at, from, to) => {
        const key = `${vertical ? "v" : "h"}:${at}:${from}:${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (vertical) {
            ctx.moveTo(at, from);
            ctx.lineTo(at, to);
        } else {
            ctx.moveTo(from, at);
            ctx.lineTo(to, at);
        }
    };
    for (const r of rects) {
        if (r.x > 0) edge(true, r.x, r.y, r.y + r.h);
        if (r.x + r.w < cw) edge(true, r.x + r.w, r.y, r.y + r.h);
        if (r.y > 0) edge(false, r.y, r.x, r.x + r.w);
        if (r.y + r.h < ch) edge(false, r.y + r.h, r.x, r.x + r.w);
    }
    ctx.stroke();
    ctx.restore();
}
