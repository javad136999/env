import "dotenv/config";
import express from "express";
import { createRequire } from "node:module";
import type { Express } from "express";

// Keep the Vercel entrypoint compatible with Node ESM resolution while loading
// the bundled application built into dist/ by the build command.
const require = createRequire(import.meta.url);
const bundledApp = require("./dist/vercel-app.cjs").default as Express;
const app = express();
app.use(bundledApp);
export default app;
