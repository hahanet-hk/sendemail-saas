import crypto from "node:crypto";

const ENC_KEY = crypto.createHash("sha256").update(process.env.DB_PASSWORD || "sendemail-secret").digest();
const ALLOWED = new Set(["platform_transactional", "platform_marketing", "byo_google_oauth", "byo_smtp"]);

function encryptCreds(obj) {
  if (!obj) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function registerChannelRoutes(app, pool, auth) {
  app.get("/api/v1/channels", auth, async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id,c.domain_id,d.domain AS domain_name,d.status AS domain_status,c.channel_name,c.provider_type,
              c.from_email,c.from_name,c.is_default,c.weight,c.status,c.consecutive_failures,c.daily_limit,c.daily_sent,c.last_error,c.created_at
       FROM sending_channels c LEFT JOIN sending_domains d ON d.id=c.domain_id
       WHERE c.tenant_id=? ORDER BY c.is_default DESC,c.weight DESC,c.id DESC`,
      [req.tenant.id]
    );
    res.json({ channels: rows });
  });

  app.post("/api/v1/channels", auth, async (req, res) => {
    const { channel_name, provider_type, from_email, from_name, domain_id, credentials, is_default, weight } = req.body || {};
    if (!channel_name || !provider_type || !from_email) return res.status(400).json({ error: "MISSING_FIELDS" });
    if (!ALLOWED.has(provider_type)) return res.status(400).json({ error: "INVALID_PROVIDER_TYPE" });
    const email = String(from_email).trim().toLowerCase(), domPart = email.split("@")[1] || "";
    if (!domPart) return res.status(400).json({ error: "INVALID_FROM_EMAIL" });

    let domId = domain_id ? Number(domain_id) : null, verified = false;
    const [[dom]] = domId
      ? await pool.query("SELECT id,status FROM sending_domains WHERE id=? AND tenant_id=? LIMIT 1", [domId, req.tenant.id])
      : await pool.query("SELECT id,status FROM sending_domains WHERE domain=? AND tenant_id=? LIMIT 1", [domPart, req.tenant.id]);
    if (domId && !dom) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
    if (dom) { domId = dom.id; verified = dom.status === "verified"; }

    const isPlat = provider_type === "platform_transactional" || provider_type === "platform_marketing";
    const dailyLimit = isPlat && !verified ? 50 : null;
    const w = Math.min(1000, Math.max(1, Number(weight) || 100));
    if (is_default) await pool.query("UPDATE sending_channels SET is_default=0 WHERE tenant_id=?", [req.tenant.id]);
    const [ins] = await pool.query(
      "INSERT INTO sending_channels (tenant_id,domain_id,channel_name,provider_type,from_email,from_name,encrypted_credentials,is_default,weight,daily_limit) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [req.tenant.id, domId, String(channel_name).trim(), provider_type, email, String(from_name || "").trim(), encryptCreds(credentials), is_default ? 1 : 0, w, dailyLimit]
    );
    res.status(201).json({ id: ins.insertId, domain_id: domId, channel_name: String(channel_name).trim(), provider_type, from_email: email, weight: w, daily_limit: dailyLimit, transitional_mode: dailyLimit !== null, status: "active" });
  });

  app.patch("/api/v1/channels/:id", auth, async (req, res) => {
    const [[cur]] = await pool.query("SELECT * FROM sending_channels WHERE id=? AND tenant_id=? LIMIT 1", [req.params.id, req.tenant.id]);
    if (!cur) return res.status(404).json({ error: "NOT_FOUND" });
    const { channel_name, from_name, is_default, weight, status, credentials } = req.body || {};
    if (is_default) await pool.query("UPDATE sending_channels SET is_default=0 WHERE tenant_id=?", [req.tenant.id]);
    const name = channel_name !== undefined ? String(channel_name).trim() : cur.channel_name;
    const fName = from_name !== undefined ? String(from_name).trim() : cur.from_name;
    const def = is_default !== undefined ? (is_default ? 1 : 0) : cur.is_default;
    const w = weight !== undefined ? Math.min(1000, Math.max(1, Number(weight) || 100)) : cur.weight;
    const st = ["active", "paused"].includes(status) ? status : cur.status;
    const creds = credentials ? encryptCreds(credentials) : cur.encrypted_credentials;
    await pool.query("UPDATE sending_channels SET channel_name=?,from_name=?,is_default=?,weight=?,status=?,encrypted_credentials=? WHERE id=? AND tenant_id=?", [name, fName, def, w, st, creds, cur.id, req.tenant.id]);
    res.json({ id: cur.id, channel_name: name, from_name: fName, is_default: def, weight: w, status: st });
  });

  app.post("/api/v1/channels/:id/reset-circuit", auth, async (req, res) => {
    const [r] = await pool.query("UPDATE sending_channels SET status='active',consecutive_failures=0,last_error=NULL WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    if (!r.affectedRows) return res.status(404).json({ error: "NOT_FOUND" });
    res.json({ id: Number(req.params.id), status: "active", consecutive_failures: 0 });
  });

  app.delete("/api/v1/channels/:id", auth, async (req, res) => {
    const [r] = await pool.query("DELETE FROM sending_channels WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    res.status(r.affectedRows ? 200 : 404).json({ deleted: !!r.affectedRows });
  });

  app.get("/api/v1/sandbox", auth, async (req, res) => {
    const [rows] = await pool.query("SELECT id,message_uid,from_email,to_email,subject,spam_score,spam_report,created_at FROM sandbox_messages WHERE tenant_id=? ORDER BY id DESC LIMIT 50", [req.tenant.id]);
    res.json({ messages: rows });
  });
}
