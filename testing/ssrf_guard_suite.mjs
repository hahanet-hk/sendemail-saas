import assert from "node:assert/strict";

const TIMEOUT = 5000;

function resetDns(dnsState) {
  dnsState.calls.length = 0;
  dnsState.lookup = async () => {
    throw new Error("unexpected dns.lookup");
  };
}

async function expectBlocked(validateSafeWebhookUrl, dnsState, rawUrl, error) {
  resetDns(dnsState);
  assert.deepEqual(await validateSafeWebhookUrl(rawUrl), { ok: false, error });
  assert.deepEqual(dnsState.calls, []);
}

async function expectAllowed(validateSafeWebhookUrl, dnsState, rawUrl) {
  resetDns(dnsState);
  assert.deepEqual(await validateSafeWebhookUrl(rawUrl), {
    ok: true,
    url: new URL(rawUrl).toString()
  });
  assert.deepEqual(dnsState.calls, []);
}

export async function runSsrfGuardTests(t, guardHref) {
  const dnsState = {
    calls: [],
    lookup: async () => {
      throw new Error("unexpected dns.lookup");
    }
  };
  const lookup = (host, options) => {
    dnsState.calls.push({ host, options });
    return dnsState.lookup(host, options);
  };

  // Must be installed before the guard module is imported, so hostname checks never call the real resolver.
  // Node 22 applies defaultExport and namedExports. The exports option is ignored on this line.
  t.mock.module("node:dns/promises", {
    cache: true,
    defaultExport: { lookup },
    namedExports: { lookup }
  });

  const { validateSafeWebhookUrl } = await import(guardHref);

  await t.test("allows public literal IPs over http and https", { timeout: TIMEOUT }, async () => {
    await expectAllowed(validateSafeWebhookUrl, dnsState, "https://1.1.1.1/hook");
    await expectAllowed(validateSafeWebhookUrl, dnsState, "http://8.8.8.8/hook");
  });

  await t.test("blocks literal private and loopback IPs", { timeout: TIMEOUT }, async () => {
    const urls = [
      "http://127.0.0.1/hook",
      "http://10.1.2.3/hook",
      "http://172.16.5.5/hook",
      "http://192.168.1.20/hook",
      "http://169.254.169.254/latest",
      "http://0.0.0.0/hook"
    ];
    for (const rawUrl of urls) {
      await expectBlocked(validateSafeWebhookUrl, dnsState, rawUrl, "SSRF_BLOCKED_PRIVATE_IP");
    }
  });

  await t.test("rejects unsupported schemes and invalid URLs", { timeout: TIMEOUT }, async () => {
    await expectBlocked(validateSafeWebhookUrl, dnsState, "ftp://1.1.1.1/hook", "UNSUPPORTED_URL_SCHEME");
    await expectBlocked(validateSafeWebhookUrl, dnsState, "not a url", "INVALID_WEBHOOK_URL");
  });

  await t.test("rejects credentials without resolving the host", { timeout: TIMEOUT }, async () => {
    await expectBlocked(
      validateSafeWebhookUrl,
      dnsState,
      "https://user:pass@1.1.1.1/hook",
      "CREDENTIALS_IN_URL_FORBIDDEN"
    );
    await expectBlocked(
      validateSafeWebhookUrl,
      dnsState,
      "https://user:pass@hooks.example/hook",
      "CREDENTIALS_IN_URL_FORBIDDEN"
    );
  });

  await t.test("rejects localhost and internal hostnames without DNS", { timeout: TIMEOUT }, async () => {
    const urls = [
      "http://localhost/hook",
      "http://foo.localhost/hook",
      "http://printer.local/hook",
      "http://db.internal/hook"
    ];
    for (const rawUrl of urls) {
      await expectBlocked(validateSafeWebhookUrl, dnsState, rawUrl, "SSRF_BLOCKED_INTERNAL_HOST");
    }
  });

  await t.test("allows a hostname that resolves only to public addresses", { timeout: TIMEOUT }, async () => {
    resetDns(dnsState);
    dnsState.lookup = async () => [{ address: "1.1.1.1", family: 4 }];
    const rawUrl = "https://hooks.example/callback";
    assert.deepEqual(await validateSafeWebhookUrl(rawUrl), {
      ok: true,
      url: new URL(rawUrl).toString()
    });
    assert.deepEqual(dnsState.calls, [
      { host: "hooks.example", options: { all: true, verbatim: true } }
    ]);
  });

  await t.test("blocks a hostname when any resolved address is private", { timeout: TIMEOUT }, async () => {
    resetDns(dnsState);
    dnsState.lookup = async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.5", family: 4 }
    ];
    assert.deepEqual(await validateSafeWebhookUrl("https://hooks.example/callback"), {
      ok: false,
      error: "SSRF_BLOCKED_PRIVATE_NETWORK"
    });
    assert.equal(dnsState.calls.length, 1);
  });

  await t.test("rejects a hostname with no DNS records", { timeout: TIMEOUT }, async () => {
    resetDns(dnsState);
    dnsState.lookup = async () => [];
    assert.deepEqual(await validateSafeWebhookUrl("https://hooks.example/callback"), {
      ok: false,
      error: "WEBHOOK_HOST_UNRESOLVABLE"
    });
    assert.equal(dnsState.calls.length, 1);
  });

  await t.test("rejects a hostname when DNS lookup fails", { timeout: TIMEOUT }, async () => {
    resetDns(dnsState);
    dnsState.lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    assert.deepEqual(await validateSafeWebhookUrl("https://hooks.example/callback"), {
      ok: false,
      error: "WEBHOOK_HOST_DNS_FAILED"
    });
    assert.equal(dnsState.calls.length, 1);
  });
}
