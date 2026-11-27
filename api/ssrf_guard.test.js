import test from "node:test";
import { runSsrfGuardTests } from "../testing/ssrf_guard_suite.mjs";

test("validateSafeWebhookUrl", { timeout: 30000 }, async (t) => {
  await runSsrfGuardTests(t, new URL("./ssrf_guard.js", import.meta.url).href);
});
