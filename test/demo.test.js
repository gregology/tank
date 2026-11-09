import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS as A } from "../js/config.js";
import { DEMO_SCENARIOS, DemoDevice, demoMatch } from "../js/demo.js";
import { Game } from "../js/game.js";

describe("demo scenarios", () => {
    it("every scenario builds a match that really plays", () => {
        for (const [name, scenario] of Object.entries(DEMO_SCENARIOS)) {
            const match = demoMatch(name);
            assert.equal(match.humans.length, scenario.players, name);
            assert.equal(match.gameType, scenario.gameType, name);
            const game = new Game({ ...match, settings: { ...match.settings, seed: 1 } });
            for (let i = 0; i < 30; i++) game.update(1 / 60);
            assert.ok(game.gameTime > 0, name);
        }
    });

    it("rejects a mistyped scenario instead of quietly showing the menu", () => {
        assert.throws(() => demoMatch("battle-44p"), /battle-44p/);
    });
});

describe("DemoDevice", () => {
    it("loops a script that moves and fires, offset per player", () => {
        let now = 0;
        const device = new DemoDevice(0, () => now);
        const seen = new Set();
        for (now = 0; now < 30; now += 0.25) {
            for (const action of Object.values(A)) if (device.isDown(action)) seen.add(action);
        }
        for (const action of [A.forward, A.backward, A.left, A.right, A.fire, A.turretLeft, A.turretRight]) {
            assert.ok(seen.has(action), action);
        }
        assert.ok(!seen.has(A.pause), "a robot must not pause the match it is measuring");
    });

    it("presents the same analog interface bots do", () => {
        const device = new DemoDevice(0, () => 0);
        assert.equal(device.analog(A.forward), 1);
        assert.equal(device.analog(A.backward), 0);
        assert.equal(device.wasPressed(A.fire), false);
    });
});
