const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function injectTrackingHtml(html, trackingUid, baseUrl = 'https://app.sendemail.ai') {
  if (!html || !trackingUid) return html;
  const linked = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_, u) => `href="${baseUrl}/t/c/${trackingUid}?u=${encodeURIComponent(u)}"`);
  const pixel = `<img src="${baseUrl}/t/o/${trackingUid}.gif" width="1" height="1" alt="" style="display:none" />`;
  return linked.includes('</body>') ? linked.replace('</body>', `${pixel}</body>`) : `${linked}${pixel}`;
}

export function registerTrackingRoutes(app, pool) {
  app.get('/t/o/:uid.gif', async (req, res) => {
    const uid = String(req.params.uid || '').slice(0, 64);
    const [d] = await pool.query('SELECT tenant_id, dispatch_uid FROM sendemail_saas.email_dispatches WHERE dispatch_uid=? LIMIT 1', [uid]).catch(() => [[]]);
    if (d.length) {
      await pool.query('INSERT INTO sendemail_saas.email_events (tenant_id, dispatch_uid, tracking_uid, event_type, ip_address, user_agent) VALUES (?, ?, ?, "open", ?, ?)', [d[0].tenant_id, d[0].dispatch_uid, uid, String(req.ip || '').slice(0, 45), String(req.headers['user-agent'] || '').slice(0, 250)]).catch(() => {});
    }
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(GIF_1X1);
  });

  app.get('/t/c/:uid', async (req, res) => {
    const uid = String(req.params.uid || '').slice(0, 64);
    const target = String(req.query.u || 'https://www.sendemail.ai');
    if (!/^https?:\/\//i.test(target)) return res.status(400).send('Invalid URL');
    const [d] = await pool.query('SELECT tenant_id, dispatch_uid FROM sendemail_saas.email_dispatches WHERE dispatch_uid=? LIMIT 1', [uid]).catch(() => [[]]);
    if (d.length) {
      await pool.query('INSERT INTO sendemail_saas.email_events (tenant_id, dispatch_uid, tracking_uid, event_type, target_url, ip_address, user_agent) VALUES (?, ?, ?, "click", ?, ?, ?)', [d[0].tenant_id, d[0].dispatch_uid, uid, target, String(req.ip || '').slice(0, 45), String(req.headers['user-agent'] || '').slice(0, 250)]).catch(() => {});
    }
    res.redirect(302, target);
  });
}
