import dns from "node:dns/promises";

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function txtVals(fqdn) {
  try { return (await resolver.resolveTxt(fqdn)).map((c) => c.join("")); } catch { return []; }
}
async function cnameVals(fqdn) {
  try { return (await resolver.resolveCname(fqdn)).map((v) => v.toLowerCase().replace(/\.$/, "")); } catch { return []; }
}

export function startDnsPoller(pool) {
  const tick = async () => {
    try {
      const [rows] = await pool.query(
        "SELECT id,domain,dkim_selector,dkim_public_key,verified_at FROM sending_domains WHERE status IN ('pending','degraded') AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL 45 SECOND)) LIMIT 25"
      );
      for (const r of rows) {
        const pub = (r.dkim_public_key || "").replace(/-----(BEGIN|END) PUBLIC KEY-----|\s+/g, "").slice(0, 64);
        const [spfV, dkimV, dmarcV, verpV] = await Promise.all([
          txtVals(r.domain),
          txtVals(`${r.dkim_selector}._domainkey.${r.domain}`),
          txtVals(`_dmarc.${r.domain}`),
          cnameVals(`b.${r.domain}`)
        ]);
        const spf = spfV.join(" ").includes("_spf.sendemail.ai") ? 1 : 0;
        const dkim = pub && dkimV.join("").replace(/\s+/g, "").includes(pub) ? 1 : 0;
        const dmarc = dmarcV.join(" ").toUpperCase().includes("V=DMARC1") ? 1 : 0;
        const verp = verpV.includes("b.sendemail.ai") ? 1 : 0;
        const status = spf && dkim ? "verified" : (r.verified_at || spf || dkim || dmarc || verp) ? "degraded" : "pending";
        await pool.query(
          "UPDATE sending_domains SET spf_verified=?,dkim_verified=?,dmarc_verified=?,verp_verified=?,status=?,last_checked_at=NOW(),verified_at=IF(?='verified' AND verified_at IS NULL,NOW(),verified_at) WHERE id=?",
          [spf, dkim, dmarc, verp, status, status, r.id]
        );
        if (status === "verified") {
          await pool.query("UPDATE sending_channels SET daily_limit=NULL WHERE domain_id=? AND daily_limit=50", [r.id]);
        }
      }
    } catch (e) {
      console.error("dns_poller error:", e.message);
    }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 60000);
}
