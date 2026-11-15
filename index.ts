import "dotenv/config";
import express from "express";
import { configureExpressApp } from "./server/_core/app";

// Vercel detects this root Express entry and exposes it as a Function.
// Static frontend files are served from the root public/ directory by Vercel's CDN.
const app = configureExpressApp(express());
export default app;
