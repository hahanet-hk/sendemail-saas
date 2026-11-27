import test from "node:test";
import assert from "node:assert/strict";

const TIMEOUT = 5000;

test("createRateLimiter", { timeout: 15000 }, async (t) => {
  const state = {
    constructed: [],
    evals: [],
    evalImpl: async () => [1, 1000]
  };

  class FakeRedis {
    constructor(config) {
      state.constructed.push(config);
    }

    on() {}

    eval(_script, numKeys, key, windowMs) {
      state.evals.push({ numKeys, key, windowMs });
      return state.evalImpl();
    }
  }

  // Replaces ioredis before the limiter module loads, so tests never open a Redis connection.
  t.mock.module("ioredis", {
    cache: true,
    defaultExport: FakeRedis
  });

  const { createRateLimiter } = await import("./rate_limiter.js");

  function reset() {
    state.constructed.length = 0;
    state.evals.length = 0;
    state.evalImpl = async () => [1, 1000];
  }

  function createResponse() {
    const headers = {};
    const res = {
      headers,
      statusCode: null,
      body: null,
      setHeader(name, value) {
        headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    const calls = { next: 0 };
    const next = () => {
      calls.next += 1;
    };
    return { res, next, calls };
  }

  function install() {
    const limit = createRateLimiter({ host: "redis.invalid", port: 1 });
    assert.deepEqual(state.constructed.at(-1), {
      host: "redis.invalid",
      port: 1,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
    return limit({ bucket: "webhook", max: 5, windowMs: 60000 });
  }

  await t.test("calls next when the request is within the limit", { timeout: TIMEOUT }, async () => {
    reset();
    state.evalImpl = async () => [1, 1000];
    const middleware = install();
    const ctx = createResponse();
    await middleware({ ip: "203.0.113.8" }, ctx.res, ctx.next);
    assert.equal(state.evals.length, 1);
    assert.equal(ctx.calls.next, 1);
    assert.equal(ctx.res.statusCode, null);
    assert.equal(ctx.res.body, null);
    assert.equal(ctx.res.headers["X-RateLimit-Limit"], "5");
    assert.equal(ctx.res.headers["X-RateLimit-Remaining"], "4");
    assert.equal(ctx.res.headers["X-RateLimit-Reset"], "1");
  });

  await t.test("returns 429 RATE_LIMIT_EXCEEDED when the limit is exceeded", { timeout: TIMEOUT }, async () => {
    reset();
    state.evalImpl = async () => [6, 2500];
    const middleware = install();
    const ctx = createResponse();
    await middleware({ ip: "203.0.113.8" }, ctx.res, ctx.next);
    assert.equal(state.evals.length, 1);
    assert.equal(ctx.calls.next, 0);
    assert.equal(ctx.res.statusCode, 429);
    assert.deepEqual(ctx.res.body, {
      error: "RATE_LIMIT_EXCEEDED",
      bucket: "webhook",
      limit: 5,
      retry_after_seconds: 3
    });
    assert.equal(ctx.res.headers["Retry-After"], "3");
  });

  await t.test("calls next when Redis throws", { timeout: TIMEOUT }, async () => {
    reset();
    state.evalImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const middleware = install();
    const ctx = createResponse();
    await middleware({ ip: "203.0.113.8" }, ctx.res, ctx.next);
    assert.equal(state.evals.length, 1);
    assert.equal(ctx.calls.next, 1);
    assert.equal(ctx.res.statusCode, null);
    assert.equal(ctx.res.body, null);
  });
});
