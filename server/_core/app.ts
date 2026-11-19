import express, { type ErrorRequestHandler, type Express } from "express";
import { registerEnvRoutes } from "../env/routes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

export function configureExpressApp(app: Express): Express {
  // Bound and sanitize JSON errors for this API without affecting starter endpoints.
  app.use("/api/env", (req, res, next) => {
    const isLogout = req.method === "POST" && req.path === "/auth/logout";
    if (req.method === "POST" && !isLogout && !req.is("application/json")) {
      res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.status(415).json({ error: { code: "CONTENT_TYPE_INVALID", message: "درخواست باید application/json باشد." } });
      return;
    }
    next();
  });
  app.use("/api/env", express.json({ limit: "128kb" }));
  const envBodyError: ErrorRequestHandler = (error, _req, res, _next) => {
    const tooLarge = error?.type === "entity.too.large";
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? "BODY_TOO_LARGE" : "BODY_INVALID", message: "بدنهٔ درخواست معتبر نیست." } });
  };
  app.use("/api/env", envBodyError);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  registerEnvRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  return app;
}
