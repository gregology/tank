/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: "no-circular",
            severity: "error",
            comment: "No circular dependencies allowed",
            from: {},
            to: { circular: true },
        },
        {
            name: "config-is-leaf",
            severity: "error",
            comment: "config.js must not import any other project module",
            from: { path: "^js/config\\.js$" },
            to: { path: "^js/" },
        },
        {
            name: "utils-only-imports-config",
            severity: "error",
            comment: "utils.js may only import config.js",
            from: { path: "^js/utils\\.js$" },
            to: { path: "^js/(?!config\\.js$)" },
        },
        {
            name: "no-renderer-from-logic",
            severity: "warn",
            comment: "Game logic modules should not import the renderer",
            from: { path: "^js/(ai|tank|bullet|map|pathfinder|config|utils)\\.js$" },
            to: { path: "^js/renderer\\.js$" },
        },
        {
            name: "no-input-from-logic",
            severity: "warn",
            comment: "Pure logic modules should not import the input manager",
            from: { path: "^js/(ai|tank|bullet|map|pathfinder|config|utils)\\.js$" },
            to: { path: "^js/input\\.js$" },
        },
        {
            name: "no-audio-from-logic",
            severity: "warn",
            comment: "Pure logic modules should not import audio",
            from: { path: "^js/(ai|tank|bullet|map|pathfinder|config|utils)\\.js$" },
            to: { path: "^js/audio\\.js$" },
        },
    ],
    options: {
        doNotFollow: { path: "node_modules" },
        tsPreCompilationDeps: false,
        enhancedResolveOptions: {
            exportsFields: ["exports"],
            conditionNames: ["import", "require", "node", "default"],
        },
    },
};
