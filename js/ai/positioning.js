/**
 * Position scoring — candidate-position search shared by the sniper and
 * scout roles (weighted cover / flank / range / line-of-sight criteria).
 *
 * These used to live in `roles.js`; they were extracted so role strategies
 * stay about *what* a role wants, while *where* to stand is one reusable
 * primitive (mirroring the vehicles/ one-module-per-concern split).
 */

import { CONFIG } from "../config.js";

/**
 * Evaluate candidate positions around the objective and return
 * the best one according to weighted scoring criteria.
 *
 * Criteria (all normalised to 0–1 before weighting):
 *   cover — projectile-blocking tiles within POSITION_COVER_RADIUS
 *   flank — perpendicular offset from the direct me→objective line
 *   range — closeness to idealRange from the objective
 *   los   — clear line-of-sight to the objective
 *
 * @param {object}  me         bot's current position
 * @param {object}  objective  target position
 * @param {object}  map        GameMap
 * @param {object}  weights    { cover, flank, range, los }
 * @param {number}  idealRange distance from objective to sample candidates
 * @returns {{ x: number, y: number }}
 */
export function findBestPosition(me, objective, map, weights, idealRange) {
    const samples = CONFIG.POSITION_SAMPLES;
    const coverR = CONFIG.POSITION_COVER_RADIUS;

    // Direct line from me to objective (for flank scoring)
    const dirX = objective.x - me.x;
    const dirY = objective.y - me.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    // Unit perpendicular vector
    const perpX = -dirY / dirLen;
    const perpY = dirX / dirLen;

    let bestPos = null;
    let bestScore = -Infinity;

    // Find the max possible cover in the area for normalisation
    let maxCover = 1;
    const candidateList = [];

    for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        // Try multiple radii: ideal range, and slightly closer/farther
        for (const rFactor of [1.0, 0.85, 1.15]) {
            const r = idealRange * rFactor;
            const cx = objective.x + Math.cos(angle) * r;
            const cy = objective.y + Math.sin(angle) * r;

            // Clamp to map bounds
            const px = Math.max(3, Math.min(map.width - 4, cx));
            const py = Math.max(3, Math.min(map.height - 4, cy));
            if (!map.isPassable(px, py)) continue;

            const cover = weights.cover > 0 ? map.countCoverTiles(px, py, coverR) : 0;
            if (cover > maxCover) maxCover = cover;
            candidateList.push({ x: px, y: py, cover, rFactor });
        }
    }

    if (candidateList.length === 0) {
        // Fallback: angle from objective toward us
        const a = Math.atan2(me.y - objective.y, me.x - objective.x);
        return {
            x: objective.x + Math.cos(a) * idealRange,
            y: objective.y + Math.sin(a) * idealRange,
        };
    }

    for (const c of candidateList) {
        // ── Cover score (0–1): nearby blocking tiles
        const coverScore = maxCover > 0 ? c.cover / maxCover : 0;

        // ── Flank score (0–1): perpendicular distance from the
        //    direct me→objective line, normalised by idealRange
        const relX = c.x - me.x;
        const relY = c.y - me.y;
        const perpDist = Math.abs(relX * perpX + relY * perpY);
        const flankScore = Math.min(1, perpDist / (idealRange * 0.8));

        // ── Range score (0–1): 1.0 at ideal range, falls off
        const distToObj = Math.hypot(c.x - objective.x, c.y - objective.y);
        const rangeError = Math.abs(distToObj - idealRange) / idealRange;
        const rangeScore = Math.max(0, 1 - rangeError);

        // ── LOS score (0 or 1): can we see the objective?
        const losScore = weights.los > 0 ? (map.hasLineOfSight(c.x, c.y, objective.x, objective.y) ? 1 : 0) : 0;

        const score =
            coverScore * (weights.cover || 0) +
            flankScore * (weights.flank || 0) +
            rangeScore * (weights.range || 0) +
            losScore * (weights.los || 0);

        if (score > bestScore) {
            bestScore = score;
            bestPos = { x: c.x, y: c.y };
        }
    }

    return bestPos;
}

/**
 * Compute a flank waypoint using the position scoring system.
 * The midpoint distance is used as the ideal range so candidates
 * form a ring around the midpoint between bot and objective.
 */
export function computeFlankPoint(me, objective, map, weights = null) {
    const dist = Math.hypot(objective.x - me.x, objective.y - me.y);
    if (dist < 1) return { x: objective.x, y: objective.y };

    // Use midpoint as the "objective" for the candidate ring, with half
    // the distance as the ideal range — candidates land in a ring
    // perpendicular to the approach line.
    const mid = {
        x: (me.x + objective.x) / 2,
        y: (me.y + objective.y) / 2,
    };
    const w = weights || CONFIG.SCOUT_POSITION_WEIGHTS;
    const idealRange = dist * 0.4;

    return findBestPosition(me, mid, map, w, idealRange);
}
