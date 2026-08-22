import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_STRUCTURES, GAME_TYPES, SQUAD_ATTENTION_ORDER, SQUAD_MEMBERS, VEHICLES } from "../js/config.js";
import { Formation } from "../js/formation.js";
import { pickSquadTarget } from "../js/squad.js";
import { HIT_ZONE } from "../js/tank.js";
import { ACTIONS, customMap, T, Tank } from "./helpers.js";

/** Build a squad vehicle at a position with its component initialised. */
function squadTank(x, y, team = 1) {
    const t = new Tank(1, "#55aa44", "#337722");
    t.team = team;
    t.alive = true;
    t.x = x;
    t.y = y;
    t.angle = 0;
    t.vehicleType = "squad"; // the setter's init hook creates the Squad at (x, y)
    return t;
}

describe("Infantry squad – config", () => {
    it("defines the squad vehicle and member simulation tunables", () => {
        const v = VEHICLES.squad;
        assert.ok(v);
        assert.ok(v.soldierRadius > 0);
        assert.ok(v.memberSpeed >= v.speed);
        assert.ok(v.formationSpacing > 0);
        assert.ok(v.digInTime > 0);
        assert.ok(v.coverRadius > 0);
    });

    it("squads never roll the defender role", () => {
        assert.equal(VEHICLES.squad.roleWeights.defender, 0);
    });

    it("defines all four member types", () => {
        for (const key of ["rifleman", "mg", "rpg", "shotgun"]) {
            assert.ok(SQUAD_MEMBERS[key], `missing member ${key}`);
        }
    });

    it("attention order has five slots with two riflemen", () => {
        assert.equal(SQUAD_ATTENTION_ORDER.length, 5);
        assert.equal(SQUAD_ATTENTION_ORDER.filter((m) => m === "rifleman").length, 2);
    });

    it("adds squads to battle only", () => {
        assert.ok(GAME_TYPES.battle.vehicles.includes("squad"));
        assert.ok(!GAME_TYPES.skirmish.vehicles.includes("squad"));
    });

    it("enemy targeting weights cover squads", () => {
        for (const type of ["tank", "ifv", "drone", "spg"]) {
            assert.ok((VEHICLES[type].targetPriority.squad ?? 0) > 0, type);
        }
        assert.ok(BASE_STRUCTURES.baseTower.targetPriority.squad > 0);
    });
});

describe("Infantry squad – member damage", () => {
    it("kills members in canonical order, uncapped", () => {
        const s = squadTank(10, 10).squad;
        assert.equal(s.membersAlive, 5);
        // One tank shell (3.0) drops three members at once.
        assert.equal(s.applyDamage(3.0), "absorbed");
        assert.equal(s.membersAlive, 2);
        assert.deepEqual(
            s.aliveMembers.map((m) => m.type),
            ["rpg", "shotgun"],
        );

        s.applyDamage(1.0);
        assert.equal(s.membersAlive, 1);
        assert.deepEqual(
            s.aliveMembers.map((m) => m.type),
            ["shotgun"],
        );

        assert.equal(s.applyDamage(1.0), "destroyed");
        assert.equal(s.membersAlive, 0);
    });

    it("carries fractional damage between hits", () => {
        const s = squadTank(10, 10).squad;
        s.applyDamage(0.4);
        assert.equal(s.membersAlive, 5);
        s.applyDamage(0.6); // total 1.0 → one member dies
        assert.equal(s.membersAlive, 4);
    });

    it("crush kills a specific member and dug-in soldiers are protected", () => {
        const s = squadTank(10, 10).squad;
        assert.equal(s.isCrushable, true);
        assert.equal(s.crushMember(4), false); // shotgunner dies, squad survives
        assert.equal(s.membersAlive, 4);
        assert.ok(!s.aliveMembers.some((m) => m.type === "shotgun"));

        s.digIn = { state: "dugIn", timer: 0 };
        assert.equal(s.isCrushable, false);
        assert.equal(s.crushMember(0), false); // protected while dug in
        assert.equal(s.membersAlive, 4);
    });

    it("crushing the last member destroys the squad", () => {
        const s = squadTank(10, 10).squad;
        for (let i = 0; i < 4; i++) s.crushMember(i);
        assert.equal(s.membersAlive, 1);
        assert.equal(s.crushMember(4), true);
        assert.equal(s.membersAlive, 0);
    });

    it("crushedMemberBy finds the soldier under a vehicle (and respects dug-in)", () => {
        const s = squadTank(10, 10).squad;
        s.members[0].x = 10;
        s.members[0].y = 10;
        s.members[1].x = 13;
        s.members[1].y = 10;
        s.members[2].x = 10;
        s.members[2].y = 13;
        s.members[3].x = 20;
        s.members[3].y = 20;
        s.members[4].x = 20;
        s.members[4].y = 20;

        assert.equal(s.crushedMemberBy({ x: 13, y: 10, size: 0.45 }), 1);
        assert.equal(s.crushedMemberBy({ x: 30, y: 30, size: 0.45 }), -1);

        // Dug-in soldiers cannot be run over.
        s.digIn = { state: "dugIn", timer: 0 };
        assert.equal(s.crushedMemberBy({ x: 13, y: 10, size: 0.45 }), -1);
    });

    it("Tank.applyHit delegates to the member model", () => {
        const t = squadTank(10, 10);
        assert.equal(t.applyHit(HIT_ZONE.FRONT, 3.0), "absorbed");
        assert.equal(t.membersAlive, 2);
        assert.equal(t.applyHit(HIT_ZONE.FRONT, 2.0), "destroyed");
        assert.equal(t.alive, false);
    });
});

describe("Infantry squad – dig-in state machine", () => {
    it("digs in over one second, then fires again", () => {
        const map = customMap([]);
        const s = squadTank(10, 10).squad;
        assert.equal(s.digIn.state, "roaming");
        assert.equal(s.canFire, true);

        s.startDigIn();
        assert.equal(s.digIn.state, "diggingIn");
        assert.equal(s.canFire, false); // no fire during transition
        assert.equal(s.canMove, false);

        s.update(0.5, map);
        assert.equal(s.digIn.state, "diggingIn");
        s.update(0.6, map); // 1.1s total → complete
        assert.equal(s.digIn.state, "dugIn");
        assert.equal(s.dugIn, true);
        assert.equal(s.canFire, true); // fires again once dug in

        s.standUp();
        assert.equal(s.digIn.state, "roaming");
        assert.equal(s.canMove, true);
    });

    it("moving during the transition cancels it", () => {
        const map = customMap([]);
        const t = squadTank(10.5, 10.5);
        t.squad.startDigIn();

        const x0 = t.x;
        t.update(0.016, { isDown: (a) => a === ACTIONS.forward }, map);
        assert.equal(t.squad.digIn.state, "roaming"); // cancelled
        assert.ok(t.x > x0); // and it moves
    });

    it("dug-in squads cannot move but still rotate", () => {
        const map = customMap([]);
        const t = squadTank(10.5, 10.5);
        t.squad.digIn = { state: "dugIn", timer: 0 };

        const x0 = t.x;
        t.update(0.016, { isDown: (a) => a === ACTIONS.forward }, map);
        assert.equal(t.x, x0); // movement blocked
        assert.equal(t.squad.digIn.state, "dugIn"); // moving does NOT dig out

        t.update(0.016, { isDown: (a) => a === ACTIONS.right }, map);
        assert.ok(t.angle > 0); // rotation still allowed
    });

    it("squads have no turret (turretAngle stays 0)", () => {
        const map = customMap([]);
        const t = squadTank(10.5, 10.5);
        t.update(0.016, { isDown: (a) => a === ACTIONS.turretRight }, map);
        assert.equal(t.turretAngle, 0);
    });

    it("respawn discards the squad component", () => {
        const t = squadTank(10, 10);
        t.squad.digIn = { state: "dugIn", timer: 0 };
        t.squad.applyDamage(4.0);
        t.respawnAt(20, 20);
        assert.equal(t.membersAlive, 5); // fresh component
        assert.equal(t.squad.dugIn, false);
    });
});

describe("Infantry squad – formation steering", () => {
    it("converges members on their slots near the leader", () => {
        const leader = { x: 10, y: 10, angle: 0 };
        const members = [
            { x: 13, y: 10, alive: true },
            { x: 10, y: 13, alive: true },
        ];
        const f = new Formation({
            slots: [
                [0.2, 0],
                [0, 0.2],
            ],
            maxSpeed: 3,
            spacing: 0.3,
            wallAffinity: 0,
        });
        const map = { isPassable: () => true };
        for (let i = 0; i < 200; i++) f.update(0.05, leader, map, members);
        for (const m of members) {
            assert.ok(Math.hypot(m.x - 10, m.y - 10) < 1.0, `member drifted to ${m.x},${m.y}`);
        }
    });

    it("never moves a member into a blocked tile", () => {
        const map = customMap([
            { x: 5, y: 0, tile: T.HILL },
            { x: 5, y: 1, tile: T.HILL },
            { x: 5, y: 2, tile: T.HILL },
        ]);
        const leader = { x: 0.5, y: 0.5, angle: 0 };
        const f = new Formation({ slots: [[10, 0]], maxSpeed: 3, spacing: 0.3, wallAffinity: 0 });
        const members = [{ x: 0.5, y: 0.5, alive: true }];
        for (let i = 0; i < 400; i++) f.update(0.05, leader, map, members);
        assert.ok(
            map.isPassable(members[0].x, members[0].y),
            `member inside obstacle at ${members[0].x},${members[0].y}`,
        );
    });

    it("tightens the formation as members die", () => {
        const f = new Formation({
            slots: [
                [1, 0],
                [0, 1],
                [-1, 0],
                [0, -1],
                [2, 2],
            ],
            maxSpeed: 3,
            spacing: 0.3,
            wallAffinity: 0,
        });
        assert.deepEqual(f._slotFor(0, 5), [1, 0]);
        assert.deepEqual(f._slotFor(0, 1), [0, 0]); // collapses to the leader
    });
});

describe("Infantry squad – distributed hitbox", () => {
    it("bulletHit tests individual member positions, not the centre", () => {
        const s = squadTank(10, 10).squad;
        s.members.forEach((m, i) => {
            m.x = i === 0 ? 10 : 20;
            m.y = i === 0 ? 10 : 20;
        });
        assert.equal(s.bulletHit(10.1, 10), true);
        assert.equal(s.bulletHit(20.1, 20), true);
        assert.equal(s.bulletHit(15, 15), false);
    });

    it("nearestMemberDistance reports the closest soldier", () => {
        const s = squadTank(10, 10).squad;
        s.members[0].x = 10;
        s.members[0].y = 10;
        s.members[1].x = 14;
        s.members[1].y = 10;
        for (let i = 2; i < 5; i++) s.members[i].alive = false;
        assert.equal(s.nearestMemberDistance(12, 10), 2);
    });
});

describe("Infantry squad – building cover helper", () => {
    it("detects an intact building nearby", () => {
        const map = customMap([{ x: 10, y: 10, tile: T.BLDG_SMALL }]);
        assert.equal(map.hasIntactBuildingNear(10.2, 10.2, 1.5), true);
        assert.equal(map.hasIntactBuildingNear(14, 14, 1.5), false);
    });

    it("stops granting cover once the building is destroyed", () => {
        const map = customMap([{ x: 10, y: 10, tile: T.BLDG_SMALL }]);
        assert.equal(map.hasIntactBuildingNear(10.2, 10.2, 1.5), true);
        map.damageTile(10, 10, 999);
        assert.equal(map.hasIntactBuildingNear(10.2, 10.2, 1.5), false);
    });
});

describe("Infantry squad – target selection", () => {
    const always = () => true;

    it("picks a primary target by type", () => {
        const origin = { x: 10, y: 10 };
        const enemyTank = { x: 13, y: 10, targetType: "tank", alive: true };
        const enemySquad = { x: 10, y: 13, targetType: "squad", alive: true };

        const rpg = pickSquadTarget(origin, SQUAD_MEMBERS.rpg, [enemyTank, enemySquad], always);
        assert.equal(rpg.entity, enemyTank);
        assert.equal(rpg.isFallback, false);

        const rifle = pickSquadTarget(origin, SQUAD_MEMBERS.rifleman, [enemyTank, enemySquad], always);
        assert.equal(rifle.entity, enemySquad);
        assert.equal(rifle.isFallback, false);
    });

    it("falls back to plinking when no primary target exists", () => {
        const origin = { x: 10, y: 10 };
        const enemyTank = { x: 13, y: 10, targetType: "tank", alive: true };
        const r = pickSquadTarget(origin, SQUAD_MEMBERS.rifleman, [enemyTank], always);
        assert.equal(r.entity, enemyTank);
        assert.equal(r.isFallback, true);
    });

    it("ignores targets out of range or without line-of-sight", () => {
        const origin = { x: 10, y: 10 };
        const far = { x: 30, y: 10, targetType: "tank", alive: true };
        assert.equal(pickSquadTarget(origin, SQUAD_MEMBERS.rpg, [far], always), null);

        const blocked = { x: 12, y: 10, targetType: "tank", alive: true };
        assert.equal(
            pickSquadTarget(origin, SQUAD_MEMBERS.rpg, [blocked], () => false),
            null,
        );
    });

    it("prefers any primary target over a closer fallback", () => {
        const origin = { x: 10, y: 10 };
        const closeTank = { x: 10.5, y: 10, targetType: "tank", alive: true };
        const farSquad = { x: 15, y: 10, targetType: "squad", alive: true };
        const r = pickSquadTarget(origin, SQUAD_MEMBERS.rifleman, [closeTank, farSquad], always);
        assert.equal(r.entity, farSquad);
        assert.equal(r.isFallback, false);
    });
});
