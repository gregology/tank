/**
 * Faction intel — what a colony has *discovered*, as opposed to what
 * exists.  Objectives are not omnisciently known: knowledge enters a
 * faction's intel only when a friendly unit (bots AND humans — anyone
 * scouts for the colony) actually sees it (sight range + line of sight,
 * checked by js/systems/swarm.js).
 *
 * Two levels of knowledge:
 *   structures — every discovered enemy structure still standing: what
 *                the swarm may shoot at (fog of war for targetability)
 *   objectives — the things the swarm marches on.  Seeing ANY structure
 *                of an enemy base reveals the base as an objective (you
 *                spotted the compound, you know where their base is).
 *                Objectives carry a data-driven priority; a dead one
 *                drops out, so attraction dies with it.
 *
 * The objective seam is ready for multiple objective kinds (capture
 * points): anything with `x`, `y`, and `alive` can be one.
 */

export class FactionIntel {
    constructor() {
        /** @type {Map<object, {x:number, y:number}>} discovered enemy structures */
        this._structures = new Map();
        /** @type {Map<object, {x:number, y:number, priority:number}>} known objectives */
        this._objectives = new Map();
    }

    /** Record a structure sighting (targetable while it stands). */
    revealStructure(entity) {
        if (!this._structures.has(entity)) this._structures.set(entity, { x: entity.x, y: entity.y });
    }

    /** Record an objective (entity needs `x`, `y`, `alive`). */
    revealObjective(entity, priority = 1) {
        if (!this._objectives.has(entity)) this._objectives.set(entity, { x: entity.x, y: entity.y, priority });
    }

    hasStructure(entity) {
        return this._structures.has(entity);
    }

    /** Known structures + objectives (for test assertions). */
    get size() {
        return this._structures.size + this._objectives.size;
    }

    /** Discovered enemy structures still standing — the targetable set. */
    knownStructures() {
        const out = [];
        for (const [entity] of this._structures) {
            if (entity.alive) out.push(entity);
        }
        return out;
    }

    /**
     * Known, alive objectives sorted by descending priority — the food
     * sources.  `objectives()[0]` is the swarm's current march target.
     */
    objectives() {
        const out = [];
        for (const [entity, rec] of this._objectives) {
            if (entity.alive) out.push({ entity, x: rec.x, y: rec.y, priority: rec.priority });
        }
        out.sort((a, b) => b.priority - a.priority);
        return out;
    }

    /** Drop destroyed entries; returns the dead objectives (so the caller
     *  can erase their food signal on the spot). */
    pruneDead() {
        const deadObjectives = [];
        for (const [entity, rec] of this._objectives) {
            if (!entity.alive) {
                deadObjectives.push(rec);
                this._objectives.delete(entity);
            }
        }
        for (const [entity] of this._structures) {
            if (!entity.alive) this._structures.delete(entity);
        }
        return deadObjectives;
    }
}
