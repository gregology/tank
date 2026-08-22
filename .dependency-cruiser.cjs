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
            comment: "config.js and the config/ package must stay data-only: they import nothing outside the package",
            from: { path: "^js/config(\\.js|/)" },
            to: { path: "^js/(?!config/)" },
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
            comment: "Game logic modules should not import the renderer or render package",
            from: { path: "^js/((ai|config)(\\.js|/.*\\.js)|tank\\.js|bullet\\.js|map\\.js|pathfinder\\.js|utils\\.js)$" },
            to: { path: "^js/render(er\\.js|/)" },
        },
        {
            name: "render-only-imports-data",
            severity: "warn",
            comment: "The render package must stay leaf-ish: data, utils, and drawing helpers only",
            from: { path: "^js/render/" },
            to: { path: "^js/(?!config\\.js$|utils\\.js$|draw-helpers\\.js$|formation\\.js$|render/)" },
        },
        {
            name: "no-input-from-logic",
            severity: "warn",
            comment: "Pure logic modules should not import the input manager",
            from: { path: "^js/((ai|config)(\\.js|/.*\\.js)|tank\\.js|bullet\\.js|map\\.js|pathfinder\\.js|utils\\.js)$" },
            to: { path: "^js/input\\.js$" },
        },
        {
            name: "no-audio-from-logic",
            severity: "warn",
            comment: "Pure logic modules should not import audio",
            from: { path: "^js/((ai|config)(\\.js|/.*\\.js)|tank\\.js|bullet\\.js|map\\.js|pathfinder\\.js|utils\\.js)$" },
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
