// Vercel executes this CommonJS entrypoint after the build has produced the bundled app.
// Using the bundle avoids Node ESM resolution failures for extensionless TypeScript imports.
const app = require("./dist/vercel-app.cjs");

module.exports = app.default ?? app;
