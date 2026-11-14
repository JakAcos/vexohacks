import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { accessBoundary } from "../src/server/access.js";

function status(headers: Record<string, string>, config = {}) {
  let result = 200;
  const req = { get: (name: string) => headers[name.toLowerCase()] } as Request;
  const res = {
    status: (code: number) => { result = code; return res; },
    json: () => res,
    set: () => res,
  } as unknown as Response;
  accessBoundary(config)(req, res, () => {});
  return result;
}

test("local mode rejects arbitrary Hosts even with matching or absent Origin", () => {
  for (const host of ["untrusted.invalid", "untrusted.invalid:3001", "localhost.untrusted.invalid", "127.0.0.1.untrusted.invalid", "127.0.0.2", "localhost:0", "localhost:65536", "localhost:abc", "localhost:3001@untrusted.invalid", "localhost,untrusted.invalid", ""]) {
    assert.equal(status({ host }), 403, host || "missing host");
    assert.equal(status({ host, origin: `http://${host}` }), 403, host || "empty origin host");
  }
});

test("local loopback and Vite access remain available while foreign origins are denied", () => {
  for (const host of ["localhost", "localhost:3001", "127.0.0.1:3001", "[::1]", "[::1]:3001"]) {
    assert.equal(status({ host }), 200, host);
    assert.equal(status({ host, origin: `http://${host}` }), 200, host);
    assert.equal(status({ host, origin: "http://localhost:5173" }), 200, host);
    assert.equal(status({ host, origin: "http://127.0.0.1:5173" }), 200, host);
    assert.equal(status({ host, origin: "https://untrusted.invalid" }), 403, host);
  }
});

test("private remote mode still uses configured origin and authentication", () => {
  const token = "synthetic-local-access-test-token-32";
  const config = { publicOrigin: "https://relay.example", accessToken: token };
  const headers = { host: "relay:3001", origin: "https://relay.example", authorization: `Bearer ${token}` };
  assert.equal(status(headers, config), 200);
  assert.equal(status({ ...headers, origin: "https://untrusted.invalid" }, config), 403);
  assert.equal(status({ ...headers, authorization: "Bearer wrong" }, config), 401);
});
