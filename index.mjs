import express from "express";
import app from "./dist/vercel-app.mjs";

if (typeof express !== "function") throw new Error("Express failed to load");
export default app;
