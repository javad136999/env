// Vercel detects Express apps from the entrypoint import.
// The actual application is loaded from the bundle produced by pnpm build.
const express = require("express");
const bundledApp = require("./dist/vercel-app.cjs");

if (typeof express !== "function") throw new Error("Express failed to load");
module.exports = bundledApp.default ?? bundledApp;
