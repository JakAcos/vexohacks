import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export type AccessConfig = { publicOrigin?: string; accessToken?: string };

export function validateAccess(config: AccessConfig): AccessConfig {
  if (!config.publicOrigin && !config.accessToken) return {};
  if (!config.publicOrigin || !config.accessToken || config.accessToken.length < 32)
    throw new Error("Remote mode requires PUBLIC_ORIGIN and a RELAY_ACCESS_TOKEN of at least 32 characters.");
  const url = new URL(config.publicOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.");
  return { publicOrigin: url.origin, accessToken: config.accessToken };
}

export function accessBoundary(input: AccessConfig): RequestHandler {
  const config = validateAccess(input);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return (req, res, next) => {
    if (config.accessToken) {
      const auth = req.get("authorization") ?? "";
      let supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (auth.startsWith("Basic ")) {
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
        if (decoded.startsWith("relay:")) supplied = decoded.slice(6);
      }
      if (!timingSafeEqual(digest(supplied), digest(config.accessToken))) {
        res.set({ "WWW-Authenticate": 'Basic realm="Relay private demo", charset="UTF-8"', "Cache-Control": "no-store" });
        res.status(401).json({ error: "Sign in to the private Relay demo." });
        return;
      }
      res.set("Cache-Control", "no-store");
    }
    // Local HTTP is unauthenticated: reject DNS-rebound and unexpected hosts.
    // Do not derive trust from a Host header merely repeated in Origin.
    const host = req.get("host") ?? "";
    if (!config.publicOrigin) {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host);
      if (!local || (local[2] !== undefined && (Number(local[2]) < 1 || Number(local[2]) > 65535))) {
        res.status(403).json({ error: "Local Relay requires a loopback host." });
        return;
      }
    }
    // Compare with a configured origin, never an untrusted forwarded-host header.
    const origin = req.get("origin");
    const allowed = config.publicOrigin ? [config.publicOrigin] : [
      `http://${host}`, "http://127.0.0.1:5173", "http://localhost:5173",
    ];
    if (origin && !allowed.includes(origin)) {
      res.status(403).json({ error: "Cross-origin requests are disabled." });
      return;
    }
    next();
  };
}
