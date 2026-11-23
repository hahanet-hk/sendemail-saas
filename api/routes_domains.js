import crypto from "node:crypto";
import dns from "node:dns/promises";

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

function splitDomainParts(domain) {
  const parts = domain.split(".");
  if (parts.length <= 2) return { isSubdomain: false, subPrefix: "", rootDomain: domain };
  return { isSubdomain: true, subPrefix: parts.slice(0, -2).join("."), rootDomain: parts.slice(-2).join(".") };
}

function buildProviderHints(domain, selector) {
  const { isSubdomain, subPrefix, rootDomain } = splitDomainParts(domain);
  const suf = isSubdomain ? `.${subPrefix}` : "";
  return {
    is_subdomain: isSubdomain,
    root_domain: rootDomain,
    isolation_advice: isSubdomain
      ? `已採用子網域隔離（${domain}），可有效保護主網域 @${rootDomain} 商務信箱信譽。`
      : `建議改用子網域隔離：交易信使用 tx.${domain}，行銷信使用 mail.${domain}，避免影響日常商務信箱。`,
    providers: {
      cloudflare: {
        name: "Cloudflare",
        tip: "所有 CNAME 與 TXT 紀錄必須關閉橘雲代理（設為 DNS Only 灰雲模式），否則無法解析驗證。",
        spf_host: isSubdomain ? subPrefix : "@",
        dkim_host: `${selector}._domainkey${suf}`,
        dmarc_host: `_dmarc${suf}`,
        verp_host: `b${suf}`
      },
      godaddy: {
        name: "GoDaddy / Namecheap",
        tip: `託管商後台會自動補上主網域（${rootDomain}），主機名稱（Host）請勿重複填寫 .${rootDomain}。`,
        spf_host: isSubdomain ? subPrefix : "@",
        dkim_host: `${selector}._domainkey${suf}`,
        dmarc_host: `_dmarc${suf}`,
        verp_host: `b${suf}`
      }
    }
  };
}

function formatDnsRecords(r) {
  const pub = (r.dkim_public_key || "").replace(/-----(BEGIN|END) PUBLIC KEY-----|\s+/g, "");
  const { isSubdomain, subPrefix } = splitDomainParts(r.domain);
  const suf = isSubdomain ? `.${subPrefix}` : "";
  return {
    spf: { type: "TXT", host: isSubdomain ? subPrefix : "@", fqdn: r.domain, value: "v=spf1 include:_spf.sendemail.ai ~all", verified: !!r.spf_verified, required: true },
    dkim: { type: "TXT", host: `${r.dkim_selector}._domainkey${suf}`, fqdn: `${r.dkim_selector}._domainkey.${r.domain}`, value: `v=DKIM1; k=rsa; p=${pub}`, verified: !!r.dkim_verified, required: true },
    dmarc: { type: "TXT", host: `_dmarc${suf}`, fqdn: `_dmarc.${r.domain}`, value: "v=DMARC1; p=none; rua=mailto:dmarc@sendemail.ai", verified: !!r.dmarc_verified, required: false },
    verp: { type: "CNAME", host: `b${suf}`, fqdn: `b.${r.domain}`, value: "b.sendemail.ai", verified: !!r.verp_verified, required: false },
    hints: buildProviderHints(r.domain, r.dkim_selector)
  };
}

async function lookupTxt(fqdn) {
  try {
    const records = await resolver.resolveTxt(fqdn);
    return { ok: true, values: records.map((c) => c.join("")) };
  } catch (e) {
    return { ok: false, values: [], error: e.code || e.message };
  }
}

async function lookupCname(fqdn) {
  try {
    const records = await resolver.resolveCname(fqdn);
    return { ok: true, values: records.map((v) => v.toLowerCase().replace(/\.$/, "")) };
  } catch (e) {
    return { ok: false, values: [], error: e.code || e.message };
  }
}

async function verifyDomainRow(pool, row) {
  const exp = formatDnsRecords(row);
  const [spfRes, dkimRes, dmarcRes, verpRes] = await Promise.all([
    lookupTxt(exp.spf.fqdn),
    lookupTxt(exp.dkim.fqdn),
    lookupTxt(exp.dmarc.fqdn),
    lookupCname(exp.verp.fqdn)
  ]);
  const spf = spfRes.values.join(" ").includes("_spf.sendemail.ai") ? 1 : 0;
  const dkimPre = exp.dkim.value.split("p=")[1]?.slice(0, 64) || "";
  const dkim = dkimPre && dkimRes.values.join("").replace(/\s+/g, "").includes(dkimPre) ? 1 : 0;
  const dmarc = dmarcRes.values.join(" ").toUpperCase().includes("V=DMARC1") ? 1 : 0;
  const verp = verpRes.values.includes("b.sendemail.ai") ? 1 : 0;
  let status = "pending";
  if (spf && dkim) status = "verified";
  else if (row.verified_at || spf || dkim || dmarc || verp) status = "degraded";

  await pool.query(
    "UPDATE sending_domains SET spf_verified=?,dkim_verified=?,dmarc_verified=?,verp_verified=?,status=?,last_checked_at=NOW(),verified_at=IF(?='verified' AND verified_at IS NULL,NOW(),verified_at) WHERE id=?",
    [spf, dkim, dmarc, verp, status, status, row.id]
  );
  const checkedAt = new Date().toISOString();
  const upd = { ...row, spf_verified: spf, dkim_verified: dkim, dmarc_verified: dmarc, verp_verified: verp, status, last_checked_at: checkedAt };
  return {
    id: row.id, domain: row.domain, purpose: row.purpose || "general", status, last_checked_at: checkedAt,
    records: formatDnsRecords(upd),
    diagnostics: {
      checked_at: checkedAt,
      spf: { found: spfRes.values, error: spfRes.error || null },
      dkim: { found: dkimRes.values, error: dkimRes.error || null },
      dmarc: { found: dmarcRes.values, error: dmarcRes.error || null },
      verp: { found: verpRes.values, error: verpRes.error || null }
    }
  };
}

export function registerDomainRoutes(app, pool, auth) {
  app.get("/api/v1/domains", auth, async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM sending_domains WHERE tenant_id=? ORDER BY id DESC", [req.tenant.id]);
    res.json({
      domains: rows.map((r) => ({
        id: r.id, domain: r.domain, purpose: r.purpose || "general", channel_type: r.channel_type,
        status: r.status, share_token: r.share_token, last_checked_at: r.last_checked_at,
        verified_at: r.verified_at, created_at: r.created_at, records: formatDnsRecords(r)
      }))
    });
  });

  app.post("/api/v1/domains", auth, async (req, res) => {
    const domain = String(req.body?.domain || "").trim().toLowerCase().replace(/^https?:\/\/|\/.*$/g, "");
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: "INVALID_DOMAIN" });
    const allowed = new Set(["transactional", "campaign", "general"]);
    const inferred = domain.startsWith("tx.") ? "transactional" : domain.startsWith("mail.") ? "campaign" : "general";
    const purpose = allowed.has(req.body?.purpose) ? req.body.purpose : inferred;
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const sel = "se" + crypto.randomBytes(3).toString("hex");
    const tok = crypto.randomBytes(24).toString("hex");
    try {
      const [ins] = await pool.query(
        "INSERT INTO sending_domains (tenant_id,domain,purpose,dkim_selector,dkim_public_key,dkim_private_key,share_token) VALUES (?,?,?,?,?,?,?)",
        [req.tenant.id, domain, purpose, sel, publicKey, privateKey, tok]
      );
      const [[row]] = await pool.query("SELECT * FROM sending_domains WHERE id=?", [ins.insertId]);
      res.status(201).json({
        domain: { id: row.id, domain: row.domain, purpose: row.purpose, status: row.status, share_token: row.share_token, records: formatDnsRecords(row) }
      });
    } catch (e) {
      res.status(e.code === "ER_DUP_ENTRY" ? 409 : 500).json({ error: e.code === "ER_DUP_ENTRY" ? "DOMAIN_ALREADY_EXISTS" : e.message });
    }
  });

  app.post("/api/v1/domains/:id/verify", auth, async (req, res) => {
    const [[row]] = await pool.query("SELECT * FROM sending_domains WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(await verifyDomainRow(pool, row));
  });

  app.post("/api/v1/domains/:id/rotate-share-token", auth, async (req, res) => {
    const tok = crypto.randomBytes(24).toString("hex");
    const [r] = await pool.query("UPDATE sending_domains SET share_token=? WHERE id=? AND tenant_id=?", [tok, req.params.id, req.tenant.id]);
    if (!r.affectedRows) return res.status(404).json({ error: "NOT_FOUND" });
    res.json({ share_token: tok });
  });

  app.delete("/api/v1/domains/:id", auth, async (req, res) => {
    const [r] = await pool.query("DELETE FROM sending_domains WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    res.status(r.affectedRows ? 200 : 404).json({ deleted: !!r.affectedRows });
  });

  app.get("/api/v1/public/dns-share/:token", async (req, res) => {
    const tok = String(req.params.token || "").trim();
    if (!/^[a-f0-9]{32,64}$/.test(tok)) return res.status(400).json({ error: "INVALID_SHARE_TOKEN" });
    const [[row]] = await pool.query("SELECT * FROM sending_domains WHERE share_token=? LIMIT 1", [tok]);
    if (!row) return res.status(404).json({ error: "SHARE_LINK_NOT_FOUND" });
    res.json({ domain: row.domain, purpose: row.purpose || "general", status: row.status, last_checked_at: row.last_checked_at, records: formatDnsRecords(row) });
  });

  app.post("/api/v1/public/dns-share/:token/verify", async (req, res) => {
    const tok = String(req.params.token || "").trim();
    if (!/^[a-f0-9]{32,64}$/.test(tok)) return res.status(400).json({ error: "INVALID_SHARE_TOKEN" });
    const [[row]] = await pool.query("SELECT * FROM sending_domains WHERE share_token=? LIMIT 1", [tok]);
    if (!row) return res.status(404).json({ error: "SHARE_LINK_NOT_FOUND" });
    const out = await verifyDomainRow(pool, row);
    delete out.id;
    res.json(out);
  });
}
