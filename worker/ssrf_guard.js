import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local / Cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmark 198.18.0.0/15
  if (a >= 224) return true; // Multicast & Reserved
  return false;
}

function isPrivateIp(ip) {
  const clean = ip.replace(/^\[\vert{}\]$/g, "").toLowerCase();
  if (clean.startsWith("::ffff:")) return isPrivateIpv4(clean.slice(7));
  if (net.isIPv4(clean)) return isPrivateIpv4(clean);
  if (net.isIPv6(clean)) {
    if (clean === "::1" || clean === "::") return true;
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true; // Unique local fc00::/7
    if (clean.startsWith("fe8") || clean.startsWith("fe9") || clean.startsWith("fea") || clean.startsWith("feb")) return true; // Link-local fe80::/10
    return false;
  }
  return true;
}

export async function validateSafeWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, error: "INVALID_WEBHOOK_URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "UNSUPPORTED_URL_SCHEME" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "CREDENTIALS_IN_URL_FORBIDDEN" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, error: "SSRF_BLOCKED_INTERNAL_HOST" };
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, error: "SSRF_BLOCKED_PRIVATE_IP" };
    return { ok: true, url: parsed.toString() };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) return { ok: false, error: "WEBHOOK_HOST_UNRESOLVABLE" };
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        return { ok: false, error: "SSRF_BLOCKED_PRIVATE_NETWORK" };
      }
    }
  } catch {
    return { ok: false, error: "WEBHOOK_HOST_DNS_FAILED" };
  }

  return { ok: true, url: parsed.toString() };
}
