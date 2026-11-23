'use client';
import { useState } from 'react';

export default function SdkExamples({ apiKey = '', defaultScenario = 'send' }) {
  const [scenario, setScenario] = useState(defaultScenario);
  const [lang, setLang] = useState('node');
  const [copied, setCopied] = useState(false);

  const keyVal = apiKey || 'se_live_your_api_key_here';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://www.sendemail.ai';

  const snippets = {
    preflight: {
      curl: `curl -s -X POST "${baseUrl}/api/v1/tools/preflight" \\
  -H "Authorization: Bearer ${keyVal}" \\
  -H "Content-Type: application/json" \\
  -d '{"mode":"campaign","from_email":"news@mail.yourdomain.com","subject":"Spring Release","html":"<p>Updates! <a href=\"[UNSUBSCRIBE_URL]\">Unsubscribe</a></p>"}'`,
      node: `const res = await fetch("${baseUrl}/api/v1/tools/preflight", {
  method: "POST",
  headers: { "Authorization": "Bearer ${keyVal}", "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "campaign",
    from_email: "news@mail.yourdomain.com",
    subject: "Spring Release",
    html: "<p>Updates! <a href=\"[UNSUBSCRIBE_URL]\">Unsubscribe</a></p>"
  })
});
const report = await res.json();
if (report.readiness === "blocked") throw new Error("Preflight blocked: " + JSON.stringify(report.issues));`,
      python: `import requests
r = requests.post(
    "${baseUrl}/api/v1/tools/preflight",
    headers={"Authorization": "Bearer ${keyVal}"},
    json={"mode": "campaign", "from_email": "news@mail.yourdomain.com", "subject": "Spring Release", "html": "<p>Updates! <a href=\"[UNSUBSCRIBE_URL]\">Unsubscribe</a></p>"}
)
print(r.json())`,
      php: `$ch = curl_init("${baseUrl}/api/v1/tools/preflight");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${keyVal}", "Content-Type: application/json"],
    CURLOPT_POSTFIELDS => json_encode(["mode" => "campaign", "from_email" => "news@mail.yourdomain.com", "subject" => "Spring Release", "html" => "<p>Updates! <a href=\"[UNSUBSCRIBE_URL]\">Unsubscribe</a></p>"])
]);
echo curl_exec($ch);`
    },
    send: {
      curl: `curl -i -X POST "${baseUrl}/api/v1/send" \\
  -H "Authorization: Bearer ${keyVal}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": ["recipient@example.com"],
    "from_name": "Acme App",
    "from_email": "noreply@yourdomain.com",
    "subject": "Welcome to Acme",
    "html": "<h1>Hello!</h1><p>Your account is ready.</p>"
  }'`,
      node: `const res = await fetch("${baseUrl}/api/v1/send", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${keyVal}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    to: ["recipient@example.com"],
    from_name: "Acme App",
    from_email: "noreply@yourdomain.com",
    subject: "Welcome to Acme",
    html: "<h1>Hello!</h1><p>Your account is ready.</p>"
  })
});

const data = await res.json();
if (res.status === 402) {
  // QUOTA_EXCEEDED: monthly sending limit reached (triggers quota.exceeded webhook)
  throw new Error(\`Quota exceeded (\${data.used_quota}/\${data.monthly_quota})\`);
}
if (!res.ok) throw new Error(data.error || "Send failed");
console.log("Queued dispatch:", data.dispatch_uid, "Remaining:", data.quota_remaining);`,
      python: `import requests

res = requests.post(
    "${baseUrl}/api/v1/send",
    headers={
        "Authorization": "Bearer ${keyVal}",
        "Content-Type": "application/json",
    },
    json={
        "to": ["recipient@example.com"],
        "from_name": "Acme App",
        "from_email": "noreply@yourdomain.com",
        "subject": "Welcome to Acme",
        "html": "<h1>Hello!</h1><p>Your account is ready.</p>",
    },
    timeout=10,
)
data = res.json()
if res.status_code == 402:
    raise RuntimeError(f"Quota exceeded: {data.get('error')} ({data.get('used_quota')}/{data.get('monthly_quota')})")
res.raise_for_status()
print("Queued dispatch:", data.get("dispatch_uid"))`,
      php: `<?php
$ch = curl_init("${baseUrl}/api/v1/send");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${keyVal}",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "to" => ["recipient@example.com"],
        "from_name" => "Acme App",
        "from_email" => "noreply@yourdomain.com",
        "subject" => "Welcome to Acme",
        "html" => "<h1>Hello!</h1><p>Your account is ready.</p>"
    ])
]);
$body = json_decode(curl_exec($ch), true);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($code === 402) {
    throw new RuntimeException("Quota exceeded: " . ($body["error"] ?? "QUOTA_EXCEEDED"));
}
echo "Dispatch UID: " . $body["dispatch_uid"] . PHP_EOL;`
    },
    template: {
      curl: `curl -i -X POST "${baseUrl}/api/v1/send" \\
  -H "Authorization: Bearer ${keyVal}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": ["alice@example.com"],
    "template_id": "tpl_your_template_uid",
    "variables": {
      "first_name": "Alice",
      "company_name": "Acme Corp",
      "otp_code": "492810"
    }
  }'`,
      node: `const res = await fetch("${baseUrl}/api/v1/send", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${keyVal}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    to: ["alice@example.com"],
    template_id: "tpl_your_template_uid",
    variables: {
      first_name: "Alice",
      company_name: "Acme Corp",
      otp_code: "492810"
    }
  })
});

const data = await res.json();
if (res.status === 402) {
  // Handle QUOTA_EXCEEDED before retrying or alerting billing admin
  console.error("Billing limit hit:", data.error, data.remaining);
} else if (!res.ok) {
  console.error("API error:", res.status, data.error);
} else {
  console.log("Template dispatch queued:", data.dispatch_uid);
}`,
      python: `import requests

res = requests.post(
    "${baseUrl}/api/v1/send",
    headers={
        "Authorization": "Bearer ${keyVal}",
        "Content-Type": "application/json",
    },
    json={
        "to": ["alice@example.com"],
        "template_id": "tpl_your_template_uid",
        "variables": {
            "first_name": "Alice",
            "company_name": "Acme Corp",
            "otp_code": "492810",
        },
    },
    timeout=10,
)
data = res.json()
if res.status_code == 402:
    raise RuntimeError(f"Billing limit hit: {data.get('error')}")
res.raise_for_status()
print("Template dispatch queued:", data.get("dispatch_uid"))`,
      php: `<?php
$ch = curl_init("${baseUrl}/api/v1/send");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${keyVal}",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "to" => ["alice@example.com"],
        "template_id" => "tpl_your_template_uid",
        "variables" => [
            "first_name" => "Alice",
            "company_name" => "Acme Corp",
            "otp_code" => "492810"
        ]
    ])
]);
$body = json_decode(curl_exec($ch), true);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($code === 402) {
    throw new RuntimeException("Billing limit hit: " . ($body["error"] ?? "QUOTA_EXCEEDED"));
}
echo "Template Dispatch UID: " . $body["dispatch_uid"] . PHP_EOL;`
    },
    webhook: {
      node: `import crypto from "node:crypto";
import express from "express";

const app = express();
const WEBHOOK_SECRET = process.env.SENDEMAIL_WEBHOOK_SECRET; // whsec_...

app.post("/webhooks/sendemail", express.raw({ type: "application/json" }), (req, res) => {
  const sigHeader = req.header("X-SendEmail-Signature") || "";
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) return res.status(401).send("Missing signature");
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.status(401).send("Expired timestamp");

  const rawBody = req.body.toString("utf8");
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(\`\${timestamp}.\${rawBody}\`).digest("hex");

  const valid = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(401).send("Invalid signature");

  const event = JSON.parse(rawBody);
  // Handles delivery events (delivered, hard_bounce) & billing alerts (quota.warning, quota.exceeded, credits.low)
  console.log("Verified event:", event.type, event.data);
  res.sendStatus(200);
});`,
      python: `import os, time, hmac, hashlib
from flask import Flask, request, abort

app = Flask(__name__)
WEBHOOK_SECRET = os.environ["SENDEMAIL_WEBHOOK_SECRET"]  # whsec_...

@app.post("/webhooks/sendemail")
def handle_webhook():
    sig_header = request.headers.get("X-SendEmail-Signature", "")
    parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
    ts, sig = parts.get("t", ""), parts.get("v1", "")

    if not ts or not sig or abs(time.time() - int(ts)) > 300:
        abort(401, "Invalid or expired timestamp")

    raw_body = request.get_data(as_text=True)
    expected = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        f"{ts}.{raw_body}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(sig, expected):
        abort(401, "Invalid HMAC signature")

    event = request.get_json()
    print("Verified event:", event["type"], event["data"])
    return ("", 200)`,
      php: `<?php
$secret = getenv("SENDEMAIL_WEBHOOK_SECRET"); // whsec_...
$sigHeader = $_SERVER["HTTP_X_SENDEMAIL_SIGNATURE"] ?? "";
parse_str(str_replace(",", "&", $sigHeader), $parts);
$ts = $parts["t"] ?? "";
$sig = $parts["v1"] ?? "";

if (!$ts || !$sig || abs(time() - (int)$ts) > 300) {
    http_response_code(401);
    exit("Invalid or expired timestamp");
}

$rawBody = file_get_contents("php://input");
$expected = hash_hmac("sha256", $ts . "." . $rawBody, $secret);
if (!hash_equals($expected, $sig)) {
    http_response_code(401);
    exit("Invalid signature");
}

$event = json_decode($rawBody, true);
error_log("Verified event: " . ($event["type"] ?? "unknown"));
http_response_code(200);`,
      curl: `# Verify X-SendEmail-Signature (t=<unix_ts>,v1=<hex>) locally with OpenSSL:
TS="1795195954"
SECRET="whsec_your_signing_secret"
BODY='{"id":"evt_123","type":"quota.warning","data":{"usage_percent":80,"remaining":200}}'

printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET"`
    }
  };

  const code = snippets[scenario][lang];

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const pill = (active) => ({
    padding: '6px 12px',
    borderRadius: 6,
    border: 0,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    background: active ? '#2563eb' : '#f1f5f9',
    color: active ? '#fff' : '#475569'
  });

  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Quickstart SDK & Signature Verification</h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {apiKey ? 'Auto-filled with your newly created API key' : 'Copy-paste ready snippets for raw HTML, templates, HTTP 402 handling & webhook verification'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={pill(scenario === 'send')} onClick={() => setScenario('send')}>Send Email API</button>
          <button type="button" style={pill(scenario === 'template')} onClick={() => setScenario('template')}>Send with Template</button>
          <button type="button" style={pill(scenario === 'preflight')} onClick={() => setScenario('preflight')}>Campaign Preflight</button>
          <button type="button" style={pill(scenario === 'webhook')} onClick={() => setScenario('webhook')}>Verify Webhook HMAC</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '8px 14px', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['node', 'Node.js'], ['python', 'Python'], ['php', 'PHP'], ['curl', 'cURL / CLI']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setLang(k)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 0,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                background: lang === k ? '#334155' : 'transparent',
                color: lang === k ? '#38bdf8' : '#94a3b8'
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyCode}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: copied ? '#16a34a' : '#0f172a',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {copied ? 'Copied!' : 'Copy Code'}
        </button>
      </div>

      <pre style={{ margin: 0, padding: 16, background: '#0f172a', color: '#e2e8f0', borderRadius: '0 0 10px 10px', overflowX: 'auto', fontSize: 12.5, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        <code>{code}</code>
      </pre>

      <div style={{ marginTop: 14, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#475569', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div>
          <strong style={{ color: '#0f172a' }}>HTTP 202 Accepted</strong>
          <div>Queued for delivery (`dispatch_uid`). Returns `quota_remaining` or `credit_balance`.</div>
        </div>
        <div>
          <strong style={{ color: '#b91c1c' }}>HTTP 402 Payment Required</strong>
          <div>`QUOTA_EXCEEDED` (monthly send limit) or `INSUFFICIENT_CREDITS` (verify credits).</div>
        </div>
        <div>
          <strong style={{ color: '#0369a1' }}>Usage Alert Webhooks</strong>
          <div>Subscribe to `quota.warning` (80%), `quota.exceeded` (100%), and `credits.low`.</div>
        </div>
      </div>
    </div>
  );
}
