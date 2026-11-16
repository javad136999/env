import express from "express";
import fs from "node:fs";
import path from "node:path";
import indexHtml from "./public/index.html";
import { assets } from "./server/generatedAssets";
import { configureExpressApp } from "./server/_core/app";

const app = configureExpressApp(express());
const publicDir = [path.resolve(process.cwd(), "public"), path.resolve(process.cwd(), "dist/public")].find(fs.existsSync);

if (publicDir) {
  app.use(express.static(publicDir, { index: false }));
}

app.get("/assets/*", (req, res, next) => {
  const content = assets[req.path as keyof typeof assets];
  if (content === undefined) return next();
  res.type(req.path.endsWith(".css") ? "css" : "js").send(content);
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || path.extname(req.path)) return next();
  if (publicDir) return res.sendFile(path.join(publicDir, "index.html"));
  res.type("html").send(indexHtml);
});

export default app;
