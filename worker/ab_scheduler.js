export function startAbScheduler(pool) {
  const run = async () => {
    const [exps] = await pool.query('SELECT * FROM ab_experiments WHERE status="running" AND evaluate_at <= NOW() LIMIT 20').catch(() => [[]]);
    for (const exp of exps) {
      const variants = typeof exp.variants === 'string' ? JSON.parse(exp.variants) : (exp.variants || []);
      let winner = variants[0]?.id || 'A', bestRate = -1;
      for (const v of variants) {
        const [[ev]] = await pool.query('SELECT COUNT(*) cnt FROM email_events WHERE tenant_id=? AND event_type=?', [exp.tenant_id, exp.win_metric === 'click_rate' ? 'click' : 'open']).catch(() => [[{ cnt: 0 }]]);
        const rate = Number(v.sent || 1) > 0 ? Number(ev.cnt || 0) / Number(v.sent || 1) : 0;
        if (rate > bestRate) { bestRate = rate; winner = v.id || winner; }
      }
      await pool.query('UPDATE ab_experiments SET status="completed", winner_variant=? WHERE id=?', [winner, exp.id]).catch(() => {});
    }
  };
  run();
  return setInterval(run, 5 * 60 * 1000);
}
