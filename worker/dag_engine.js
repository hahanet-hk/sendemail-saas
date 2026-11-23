import crypto from 'node:crypto';
import { Worker, Queue } from 'bullmq';

export function startDagWorker(pool, redisConnection) {
  const dagQueue = new Queue('automation-dag', { connection: redisConnection });
  const dispatchQueue = new Queue('email-dispatch', { connection: redisConnection });

  const dagWorker = new Worker('automation-dag', async (job) => {
    const { flowRunId, stepUid } = job.data || {};
    if (!flowRunId || !stepUid) return;

    const [[run]] = await pool.query(
      'SELECT id, flow_run_id, tenant_id, flow_id, contact_email, status, is_time_travel, context_data FROM flow_runs WHERE flow_run_id=? LIMIT 1',
      [flowRunId]
    );
    if (!run || run.status === 'cancelled_by_goal' || run.status === 'completed') return;

    const [[step]] = await pool.query(
      'SELECT step_uid, node_type, node_config, next_step_uid, branch_false_step_uid FROM flow_steps WHERE step_uid=? AND flow_id=? LIMIT 1',
      [stepUid, run.flow_id]
    );
    if (!step) {
      await pool.query('UPDATE flow_runs SET status="completed", finished_at=NOW() WHERE id=?', [run.id]);
      return;
    }

    const cfg = typeof step.node_config === 'string' ? JSON.parse(step.node_config) : (step.node_config || {});
    let nextUid = step.next_step_uid;
    let delayMs = 0;

    if (step.node_type === 'delay') {
      const realMs = Math.max(1000, Number(cfg.delay_minutes || 60) * 60 * 1000);
      delayMs = run.is_time_travel ? 800 : realMs;
    } else if (step.node_type === 'condition') {
      const ctx = typeof run.context_data === 'string' ? JSON.parse(run.context_data) : (run.context_data || {});
      const field = cfg.field || 'opened';
      const passed = Boolean(ctx[field]);
      nextUid = passed ? step.next_step_uid : (step.branch_false_step_uid || step.next_step_uid);
    } else if (step.node_type === 'send_email') {
      const [[t]] = await pool.query('SELECT id, monthly_quota, used_quota, sending_frozen_at FROM tenants WHERE id=? LIMIT 1', [run.tenant_id]);
      if (t && !t.sending_frozen_at && t.used_quota < t.monthly_quota) {
        const dispatchUid = crypto.randomUUID();
        const subj = String(cfg.subject || 'Automated Message').replace(/\{\{email\}\}/g, run.contact_email);
        const html = String(cfg.html || '<p>Hello!</p>').replace(/\{\{email\}\}/g, run.contact_email);
        await pool.query('UPDATE tenants SET used_quota = used_quota + 1 WHERE id=?', [t.id]);
        await pool.query(
          'INSERT INTO email_dispatches (dispatch_uid, tenant_id, mode, from_email, subject, recipient_count, status) VALUES (?,?,?,?,?,?,?)',
          [dispatchUid, t.id, 'campaign', cfg.from_email || 'noreply@sendemail.ai', subj, 1, 'queued']
        );
        await dispatchQueue.add('send', {
          dispatchUid, tenantId: t.id, mode: 'campaign',
          fromEmail: cfg.from_email || 'noreply@sendemail.ai',
          to: [run.contact_email], subject: subj, html,
          verifyBeforeSend: Boolean(cfg.verify_before_send)
        });
      }
    }

    if (!nextUid) {
      await pool.query('UPDATE flow_runs SET current_node_id=?, status="completed", finished_at=NOW() WHERE id=?', [step.step_uid, run.id]);
      return;
    }

    const nextStatus = delayMs > 0 ? 'waiting' : 'running';
    const nextJob = await dagQueue.add('step', { flowRunId, stepUid: nextUid }, { delay: delayMs, removeOnComplete: 100 });
    await pool.query(
      'UPDATE flow_runs SET current_node_id=?, bull_job_id=?, status=? WHERE id=?',
      [nextUid, String(nextJob.id), nextStatus, run.id]
    );
  }, { connection: redisConnection, concurrency: 4 });

  return { dagWorker, dagQueue };
}
