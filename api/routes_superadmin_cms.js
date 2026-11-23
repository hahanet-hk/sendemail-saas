import { SettingsVault } from './lib/settings_vault.js';

async function checkSuperAdmin(pool, req) {
  const secret = req.headers['x-admin-secret'];
  if (secret && process.env.SAAS_ADMIN_SECRET && secret === process.env.SAAS_ADMIN_SECRET) {
    return { ok: true, email: 'system-secret@sendemail.ai' };
  }
  if (!req.user?.email) return { ok: false };
  const allowList = String(process.env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.includes(req.user.email.toLowerCase())) {
    return { ok: true, email: req.user.email };
  }
  const [[firstUser]] = await pool.query('SELECT id FROM global_auth.users ORDER BY id ASC LIMIT 1');
  if (Number(firstUser?.id) === Number(req.user.id)) {
    return { ok: true, email: req.user.email };
  }
  return { ok: false };
}

export function registerSuperAdminCmsRoutes(app, pool, auth, redisConnection) {
  const vault = new SettingsVault(pool, redisConnection);

  // 允許 session auth 或 x-admin-secret 通過驗證
  const requireSuperAdmin = async (req, res, next) => {
    const secret = req.headers['x-admin-secret'];
    if (secret && process.env.SAAS_ADMIN_SECRET && secret === process.env.SAAS_ADMIN_SECRET) {
      req.saActor = 'system-secret@sendemail.ai';
      return next();
    }
    return auth(req, res, async () => {
      const check = await checkSuperAdmin(pool, req);
      if (!check.ok) {
        return res.status(403).json({ error: 'SUPERADMIN_REQUIRED' });
      }
      req.saActor = check.email;
      next();
    });
  };

  async function writeAudit(actorEmail, action, details) {
    try {
      await pool.query(
        'INSERT INTO superadmin_audit_logs (actor_email, target_tenant_id, action, details, created_at) VALUES (?, NULL, ?, ?, NOW())',
        [actorEmail, action, JSON.stringify(details || {})]
      );
    } catch (e) {
      console.error('[AuditLog] error:', e.message);
    }
  }

  // 1. 公開端點：官網讀取多語系文案、啟用幣別、SEO 與 Schema JSON-LD
  app.get('/api/v1/public/cms', async (req, res) => {
    try {
      const requestedLocale = String(req.query.locale || 'en').trim();
      const pageSlug = String(req.query.slug || 'home').trim();

      const [locales] = await pool.query(
        'SELECT locale_code, label, default_currency, sort_order FROM cms_locales WHERE is_active = 1 ORDER BY sort_order ASC'
      );
      const activeLocale = locales.find((l) => l.locale_code === requestedLocale) || locales[0] || {
        locale_code: 'en',
        label: 'English',
        default_currency: 'USD',
      };

      let [pages] = await pool.query(
        'SELECT page_slug, locale_code, seo_title, seo_description, og_image_url, schema_jsonld, content_blocks, updated_at FROM cms_pages_i18n WHERE page_slug = ? AND locale_code = ? LIMIT 1',
        [pageSlug, activeLocale.locale_code]
      );
      if (!pages.length && activeLocale.locale_code !== 'en') {
        [pages] = await pool.query(
          'SELECT page_slug, locale_code, seo_title, seo_description, og_image_url, schema_jsonld, content_blocks, updated_at FROM cms_pages_i18n WHERE page_slug = ? AND locale_code = "en" LIMIT 1',
          [pageSlug]
        );
      }

      const [currencies] = await pool.query(
        'SELECT currency_code, symbol, exchange_rate_to_usd, plan_prices, topup_prices FROM supported_currencies WHERE is_active = 1'
      );
      const turnstileSiteKey = await vault.get('turnstile_site_key');

      const pageData = pages[0] || null;
      if (pageData) {
        if (typeof pageData.schema_jsonld === 'string') pageData.schema_jsonld = JSON.parse(pageData.schema_jsonld);
        if (typeof pageData.content_blocks === 'string') pageData.content_blocks = JSON.parse(pageData.content_blocks);
      }

      return res.json({
        ok: true,
        locale: activeLocale.locale_code,
        default_currency: activeLocale.default_currency,
        locales,
        currencies: currencies.map((c) => ({
          ...c,
          plan_prices: typeof c.plan_prices === 'string' ? JSON.parse(c.plan_prices) : c.plan_prices,
          topup_prices: typeof c.topup_prices === 'string' ? JSON.parse(c.topup_prices) : c.topup_prices,
        })),
        page: pageData,
        public_config: { turnstile_site_key: turnstileSiteKey || null },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 2. SuperAdmin 加密設定庫
  app.get('/api/v1/superadmin/settings', requireSuperAdmin, async (_req, res) => {
    try {
      const settings = await vault.listForAdmin();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/v1/superadmin/settings', requireSuperAdmin, async (req, res) => {
    try {
      const { settings } = req.body || {};
      if (!Array.isArray(settings)) return res.status(400).json({ ok: false, error: 'settings must be an array' });
      await vault.upsertMany(settings, req.saActor);
      await writeAudit(req.saActor, 'UPDATE_SYSTEM_SETTINGS', { keys: settings.map((s) => s.setting_key) });
      res.json({ ok: true, settings: await vault.listForAdmin() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/v1/superadmin/settings/test-cloudflare', requireSuperAdmin, async (req, res) => {
    try {
      const rawToken = req.body?.cloudflare_api_token;
      const token = rawToken && !rawToken.includes('****')
        ? rawToken
        : await vault.get('cloudflare_api_token', 'CLOUDFLARE_API_TOKEN');
      const zoneId = req.body?.cloudflare_zone_id || (await vault.get('cloudflare_zone_id', 'CLOUDFLARE_ZONE_ID'));

      if (!token || !zoneId) {
        return res.status(400).json({ ok: false, error: 'Missing cloudflare_api_token or cloudflare_zone_id' });
      }

      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const [verifyResp, dnsResp, routingResp] = await Promise.all([
        fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers }),
        fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=50`, { headers }),
        fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing`, { headers }),
      ]);
      const [verifyData, dnsData, routingData] = await Promise.all([
        verifyResp.json(),
        dnsResp.json(),
        routingResp.json(),
      ]);

      const tokenValid = Boolean(verifyData?.success && verifyData?.result?.status === 'active');
      const dnsRecords = Array.isArray(dnsData?.result) ? dnsData.result : [];
      const diagnostics = {
        token_status: verifyData?.result?.status || 'invalid',
        zone_dns_accessible: Boolean(dnsData?.success),
        dns_records_count: dnsRecords.length,
        has_verp_bounce_mx: dnsRecords.some((r) => r.type === 'MX' && String(r.name).includes('b.sendemail.ai')),
        has_spf_record: dnsRecords.some((r) => r.type === 'TXT' && String(r.content).includes('v=spf1')),
        email_routing_enabled: Boolean(routingData?.success && routingData?.result?.enabled),
      };

      await writeAudit(req.saActor, 'TEST_CLOUDFLARE_CONNECTION', { zoneId, ...diagnostics });
      res.json({ ok: tokenValid, diagnostics });
    } catch (err) {
      res.status(502).json({ ok: false, error: `Cloudflare probe failed: ${err.message}` });
    }
  });

  // 3. SuperAdmin 動態多語系管理
  app.get('/api/v1/superadmin/cms/locales', requireSuperAdmin, async (_req, res) => {
    const [rows] = await pool.query('SELECT * FROM cms_locales ORDER BY sort_order ASC');
    res.json({ ok: true, locales: rows });
  });

  app.post('/api/v1/superadmin/cms/locales', requireSuperAdmin, async (req, res) => {
    try {
      const { locale_code, label, default_currency = 'USD', is_active = 1, sort_order = 100 } = req.body || {};
      if (!locale_code || !label) return res.status(400).json({ ok: false, error: 'locale_code and label required' });
      await pool.query(
        'INSERT INTO cms_locales (locale_code, label, default_currency, is_active, sort_order) VALUES (?, ?, ?, ?, ?)',
        [locale_code.trim(), label.trim(), default_currency.trim(), is_active ? 1 : 0, Number(sort_order)]
      );
      await writeAudit(req.saActor, 'CREATE_CMS_LOCALE', { locale_code, label, default_currency });
      res.status(201).json({ ok: true, locale_code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/v1/superadmin/cms/locales/:code', requireSuperAdmin, async (req, res) => {
    try {
      const code = req.params.code;
      const { label, default_currency, is_active, sort_order } = req.body || {};
      await pool.query(
        `UPDATE cms_locales SET
          label = COALESCE(?, label),
          default_currency = COALESCE(?, default_currency),
          is_active = COALESCE(?, is_active),
          sort_order = COALESCE(?, sort_order)
         WHERE locale_code = ?`,
        [label ?? null, default_currency ?? null, is_active !== undefined ? (is_active ? 1 : 0) : null, sort_order ?? null, code]
      );
      await writeAudit(req.saActor, 'UPDATE_CMS_LOCALE', { code, ...req.body });
      res.json({ ok: true, locale_code: code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/v1/superadmin/cms/locales/:code', requireSuperAdmin, async (req, res) => {
    try {
      const code = req.params.code;
      if (code === 'en') return res.status(400).json({ ok: false, error: 'Cannot delete primary locale en' });
      await pool.query('DELETE FROM cms_locales WHERE locale_code = ?', [code]);
      await writeAudit(req.saActor, 'DELETE_CMS_LOCALE', { code });
      res.json({ ok: true, deleted: code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 4. SuperAdmin 網頁內容、SEO Meta 與 Schema JSON-LD 管理
  app.get('/api/v1/superadmin/cms/pages', requireSuperAdmin, async (_req, res) => {
    const [rows] = await pool.query('SELECT * FROM cms_pages_i18n ORDER BY page_slug ASC, locale_code ASC');
    res.json({
      ok: true,
      pages: rows.map((r) => ({
        ...r,
        schema_jsonld: typeof r.schema_jsonld === 'string' ? JSON.parse(r.schema_jsonld) : r.schema_jsonld,
        content_blocks: typeof r.content_blocks === 'string' ? JSON.parse(r.content_blocks) : r.content_blocks,
      })),
    });
  });

  app.put('/api/v1/superadmin/cms/pages', requireSuperAdmin, async (req, res) => {
    try {
      const { page_slug, locale_code, seo_title, seo_description, og_image_url = null, schema_jsonld = {}, content_blocks = {} } = req.body || {};
      if (!page_slug || !locale_code || !seo_title || !seo_description) {
        return res.status(400).json({ ok: false, error: 'Missing required page SEO fields' });
      }
      const schemaObj = typeof schema_jsonld === 'string' ? JSON.parse(schema_jsonld) : schema_jsonld;
      const blocksObj = typeof content_blocks === 'string' ? JSON.parse(content_blocks) : content_blocks;

      await pool.query(
        `INSERT INTO cms_pages_i18n (page_slug, locale_code, seo_title, seo_description, og_image_url, schema_jsonld, content_blocks)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           seo_title = VALUES(seo_title),
           seo_description = VALUES(seo_description),
           og_image_url = VALUES(og_image_url),
           schema_jsonld = VALUES(schema_jsonld),
           content_blocks = VALUES(content_blocks)`,
        [page_slug.trim(), locale_code.trim(), seo_title.trim(), seo_description.trim(), og_image_url, JSON.stringify(schemaObj), JSON.stringify(blocksObj)]
      );
      await writeAudit(req.saActor, 'UPSERT_CMS_PAGE', { page_slug, locale_code, seo_title });
      res.json({ ok: true, page_slug, locale_code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. SuperAdmin 多幣別與定價矩陣管理
  app.get('/api/v1/superadmin/currencies', requireSuperAdmin, async (_req, res) => {
    const [rows] = await pool.query('SELECT * FROM supported_currencies ORDER BY currency_code ASC');
    res.json({
      ok: true,
      currencies: rows.map((r) => ({
        ...r,
        plan_prices: typeof r.plan_prices === 'string' ? JSON.parse(r.plan_prices) : r.plan_prices,
        topup_prices: typeof r.topup_prices === 'string' ? JSON.parse(r.topup_prices) : r.topup_prices,
      })),
    });
  });

  app.post('/api/v1/superadmin/currencies', requireSuperAdmin, async (req, res) => {
    try {
      const { currency_code, symbol, exchange_rate_to_usd = 1, plan_prices, topup_prices, is_active = 1 } = req.body || {};
      if (!currency_code || !symbol || !plan_prices || !topup_prices) {
        return res.status(400).json({ ok: false, error: 'Missing required currency fields' });
      }
      const code = currency_code.trim().toUpperCase();
      await pool.query(
        'INSERT INTO supported_currencies (currency_code, symbol, exchange_rate_to_usd, plan_prices, topup_prices, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [code, symbol.trim(), Number(exchange_rate_to_usd), JSON.stringify(plan_prices), JSON.stringify(topup_prices), is_active ? 1 : 0]
      );
      await writeAudit(req.saActor, 'CREATE_CURRENCY', { currency_code: code, symbol, exchange_rate_to_usd });
      res.status(201).json({ ok: true, currency_code: code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/v1/superadmin/currencies/:code', requireSuperAdmin, async (req, res) => {
    try {
      const code = req.params.code.trim().toUpperCase();
      const { symbol, exchange_rate_to_usd, plan_prices, topup_prices, is_active } = req.body || {};
      await pool.query(
        `UPDATE supported_currencies SET
          symbol = COALESCE(?, symbol),
          exchange_rate_to_usd = COALESCE(?, exchange_rate_to_usd),
          plan_prices = COALESCE(?, plan_prices),
          topup_prices = COALESCE(?, topup_prices),
          is_active = COALESCE(?, is_active)
         WHERE currency_code = ?`,
        [
          symbol ?? null,
          exchange_rate_to_usd !== undefined ? Number(exchange_rate_to_usd) : null,
          plan_prices ? JSON.stringify(plan_prices) : null,
          topup_prices ? JSON.stringify(topup_prices) : null,
          is_active !== undefined ? (is_active ? 1 : 0) : null,
          code,
        ]
      );
      await writeAudit(req.saActor, 'UPDATE_CURRENCY', { code, ...req.body });
      res.json({ ok: true, currency_code: code });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
