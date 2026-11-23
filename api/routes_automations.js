import crypto from "node:crypto";
import { Queue } from "bullmq";

const FLOW_TEMPLATES = {
  abandoned_checkout: {
    name: "棄單挽回序列 (Abandoned Checkout Recovery)",
    stage: "Stage 1",
    trigger_event: "checkouts/create",
    goal_event: "orders/paid",
    description: "結帳放棄後自動寄送提醒與專屬折扣，一旦收到 orders/paid 立即 Goal Cancellation 取消後續催單。",
    buildSteps: (cfg) => {
      const delayMins = Number(cfg?.delay_minutes ?? 60);
      const s1 = "stp_" + crypto.randomBytes(6).toString("hex");
      const s2 = "stp_" + crypto.randomBytes(6).toString("hex");
      const s3 = "stp_" + crypto.randomBytes(6).toString("hex");
      return [
        { step_uid: s1, step_order: 1, node_type: "delay", node_config: { delay_minutes: delayMins }, next_step_uid: s2 },
        { step_uid: s2, step_order: 2, node_type: "send_email", node_config: { subject: cfg?.subject_1 || "您的購物車商品已為您保留", html: cfg?.html_1 || "<p>您好 {{email}}，您尚有未完成結帳的商品，點擊即可一鍵完成訂單。</p>" }, next_step_uid: s3 },
        { step_uid: s3, step_order: 3, node_type: "delay", node_config: { delay_minutes: 1440 }, next_step_uid: null }
      ];
    }
  },
  welcome_series: {
    name: "新客歡迎與開信分流序列 (Welcome Series)",
    stage: "Stage 1",
    trigger_event: "customers/create",
    goal_event: "orders/paid",
    description: "新戶註冊立即發送歡迎信，24 小時後依是否開信自動分流跟進。",
    buildSteps: (cfg) => {
      const s1 = "stp_" + crypto.randomBytes(6).toString("hex");
      const s2 = "stp_" + crypto.randomBytes(6).toString("hex");
      const s3 = "stp_" + crypto.randomBytes(6).toString("hex");
      const s4 = "stp_" + crypto.randomBytes(6).toString("hex");
      return [
        { step_uid: s1, step_order: 1, node_type: "send_email", node_config: { subject: cfg?.subject_1 || "歡迎加入！這是您的專屬首購禮遇", html: "<p>歡迎 {{email}} 加入我們！</p>" }, next_step_uid: s2 },
        { step_uid: s2, step_order: 2, node_type: "delay", node_config: { delay_minutes: Number(cfg?.delay_minutes ?? 1440) }, next_step_uid: s3 },
        { step_uid: s3, step_order: 3, node_type: "condition", node_config: { field: "opened" }, next_step_uid: null, branch_false_step_uid: s4 },
        { step_uid: s4, step_order: 4, node_type: "send_email", node_config: { subject: "別錯過您的新人專屬優惠", html: "<p>嗨 {{email}}，再次提醒您的新人優惠即將到期。</p>" }, next_step_uid: null }
      ];
    }
  },
  winback_verify: {
    name: "沉睡客戶喚醒與前置清洗流 (Win-Back + Verify)",
    stage: "Stage 2",
    trigger_event: "customer/dormant",
    goal_event: "orders/paid",
    description: "超過 60 天未互動沉睡名單，發信前自動送入 CheckEmail 清洗確認信箱有效再投遞。",
    buildSteps: (cfg) => {
      const s1 = "stp_" + crypto.randomBytes(6).toString("hex");
      return [
        { step_uid: s1, step_order: 1, node_type: "send_email", node_config: { verify_before_send: true, subject: cfg?.subject_1 || "好久不見！為您準備了專屬回流禮券", html: "<p>您好 {{email}}，我們非常想念您！</p>" }, next_step_uid: null }
      ];
    }
  }
};

export function registerAutomationRoutes(app, pool, auth, redisConnection) {
  const dagQueue = new Queue("automation-dag", { connection: redisConnection });

  app.get("/api/v1/automations", auth, async (req, res) => {
    const tid = req.tenant.id;
    const [flows] = await pool.query(
      "SELECT flow_uid, name, template_slug, trigger_event, goal_event, status, config, created_at FROM automation_flows WHERE tenant_id=? ORDER BY id DESC",
      [tid]
    );
    const [runs] = await pool.query(
      "SELECT r.flow_run_id, f.name AS flow_name, r.contact_email, r.current_node_id, r.is_time_travel, r.status, r.started_at, r.finished_at FROM flow_runs r JOIN automation_flows f ON r.flow_id=f.id WHERE r.tenant_id=? ORDER BY r.id DESC LIMIT 30",
      [tid]
    );
    const [experiments] = await pool.query(
      "SELECT exp_uid, name, test_ratio_pct, window_hours, win_metric, variants, winner_variant, status, evaluate_at, created_at FROM ab_experiments WHERE tenant_id=? ORDER BY id DESC LIMIT 20",
      [tid]
    );
    const templates = Object.entries(FLOW_TEMPLATES).map(([slug, t]) => ({
      slug, name: t.name, stage: t.stage, trigger_event: t.trigger_event, goal_event: t.goal_event, description: t.description
    }));
    res.json({ flows, runs, experiments, templates });
  });

  app.post("/api/v1/automations/from-template", auth, async (req, res) => {
    const { template_slug, name, delay_minutes, subject_1, activate } = req.body || {};
    const tpl = FLOW_TEMPLATES[template_slug];
    if (!tpl) return res.status(400).json({ error: "UNKNOWN_TEMPLATE" });

    const flowUid = "flw_" + crypto.randomBytes(10).toString("hex");
    const status = activate === false ? "draft" : "active";
    const cfg = { delay_minutes: Number(delay_minutes ?? 60), subject_1: subject_1 || null };
    const [ins] = await pool.query(
      "INSERT INTO automation_flows (flow_uid, tenant_id, name, template_slug, trigger_event, goal_event, status, config) VALUES (?,?,?,?,?,?,?,?)",
      [flowUid, req.tenant.id, name || tpl.name, template_slug, tpl.trigger_event, tpl.goal_event, status, JSON.stringify(cfg)]
    );
    const steps = tpl.buildSteps(cfg);
    for (const st of steps) {
      await pool.query(
        "INSERT INTO flow_steps (step_uid, flow_id, step_order, node_type, node_config, next_step_uid, branch_false_step_uid) VALUES (?,?,?,?,?,?,?)",
        [st.step_uid, ins.insertId, st.step_order, st.node_type, JSON.stringify(st.node_config), st.next_step_uid || null, st.branch_false_step_uid || null]
      );
    }
    res.status(201).json({ flow_uid: flowUid, status, trigger_event: tpl.trigger_event, goal_event: tpl.goal_event, step_count: steps.length });
  });

  app.post("/api/v1/events/track", auth, async (req, res) => {
    const { event_name, contact_email, context, time_travel } = req.body || {};
    const evName = String(event_name || "").trim();
    const email = String(contact_email || "").trim().toLowerCase();
    if (!evName || !email || !email.includes("@")) {
      return res.status(400).json({ error: "INVALID_EVENT", message: "需要 event_name 與有效的 contact_email。" });
    }

    const tid = req.tenant.id;
    // 1. Goal Cancellation：若此事件符合任何執行中流程的 goal_event，立即取消後續佇列工作
    const [goalRuns] = await pool.query(
      "SELECT r.id, r.flow_run_id, r.bull_job_id FROM flow_runs r JOIN automation_flows f ON r.flow_id=f.id WHERE r.tenant_id=? AND r.contact_email=? AND r.status IN ('running','waiting') AND f.goal_event=?",
      [tid, email, evName]
    );
    let cancelledCount = 0;
    for (const gr of goalRuns) {
      await pool.query("UPDATE flow_runs SET status='cancelled_by_goal', finished_at=NOW() WHERE id=?", [gr.id]);
      if (gr.bull_job_id) {
        const job = await dagQueue.getJob(gr.bull_job_id).catch(() => null);
        if (job) await job.remove().catch(() => {});
      }
      cancelledCount++;
    }

    // 2. Trigger Evaluation：啟動符合 trigger_event 的啟用中流程
    const [matchingFlows] = await pool.query(
      "SELECT id, flow_uid, name FROM automation_flows WHERE tenant_id=? AND status='active' AND trigger_event=?",
      [tid, evName]
    );
    const startedRuns = [];
    for (const fl of matchingFlows) {
      const [[firstStep]] = await pool.query(
        "SELECT step_uid FROM flow_steps WHERE flow_id=? ORDER BY step_order ASC LIMIT 1",
        [fl.id]
      );
      if (!firstStep) continue;
      const flowRunId = "run_" + crypto.randomBytes(10).toString("hex");
      const isTt = time_travel ? 1 : 0;
      await pool.query(
        "INSERT INTO flow_runs (flow_run_id, tenant_id, flow_id, contact_email, current_node_id, is_time_travel, status, context_data) VALUES (?,?,?,?,?,?,?,?)",
        [flowRunId, tid, fl.id, email, firstStep.step_uid, isTt, "running", JSON.stringify(context || {})]
      );
      const job = await dagQueue.add("step", { flowRunId, stepUid: firstStep.step_uid }, { removeOnComplete: 100 });
      await pool.query("UPDATE flow_runs SET bull_job_id=? WHERE flow_run_id=?", [String(job.id), flowRunId]);
      startedRuns.push({ flow_run_id: flowRunId, flow_uid: fl.flow_uid, time_travel: Boolean(isTt) });
    }

    res.status(200).json({
      event_name: evName,
      contact_email: email,
      cancelled_by_goal_count: cancelledCount,
      triggered_runs: startedRuns
    });
  });

  // 原生 A/B 測試建立與自動勝出選拔
  app.post("/api/v1/experiments", auth, async (req, res) => {
    const { name, test_ratio_pct, window_hours, win_metric, variant_a, variant_b } = req.body || {};
    if (!name || !variant_a?.subject || !variant_b?.subject) {
      return res.status(400).json({ error: "INVALID_EXPERIMENT", message: "需要 name、variant_a.subject 與 variant_b.subject。" });
    }
    const expUid = "exp_" + crypto.randomBytes(10).toString("hex");
    const ratio = Math.min(50, Math.max(10, Number(test_ratio_pct || 20)));
    const winHrs = Math.min(72, Math.max(1, Number(window_hours || 4)));
    const metric = win_metric === "click_rate" ? "click_rate" : "open_rate";
    const variants = {
      A: { subject: variant_a.subject, sent: Number(variant_a.sent || 100), opens: Number(variant_a.opens || 24), clicks: Number(variant_a.clicks || 6) },
      B: { subject: variant_b.subject, sent: Number(variant_b.sent || 100), opens: Number(variant_b.opens || 34), clicks: Number(variant_b.clicks || 11) }
    };
    const evaluateAt = new Date(Date.now() + winHrs * 3600 * 1000);
    await pool.query(
      "INSERT INTO ab_experiments (exp_uid, tenant_id, name, test_ratio_pct, window_hours, win_metric, variants, evaluate_at) VALUES (?,?,?,?,?,?,?,?)",
      [expUid, req.tenant.id, name, ratio, winHrs, metric, JSON.stringify(variants), evaluateAt]
    );
    res.status(201).json({ exp_uid: expUid, test_ratio_pct: ratio, remaining_rollout_pct: 100 - ratio, win_metric: metric, evaluate_at: evaluateAt });
  });

  app.post("/api/v1/experiments/:expUid/evaluate", auth, async (req, res) => {
    const [[exp]] = await pool.query(
      "SELECT id, exp_uid, win_metric, variants, test_ratio_pct FROM ab_experiments WHERE exp_uid=? AND tenant_id=? LIMIT 1",
      [req.params.expUid, req.tenant.id]
    );
    if (!exp) return res.status(404).json({ error: "EXPERIMENT_NOT_FOUND" });
    const v = typeof exp.variants === "string" ? JSON.parse(exp.variants) : exp.variants;
    const rateA = exp.win_metric === "click_rate" ? (v.A.clicks / Math.max(1, v.A.sent)) : (v.A.opens / Math.max(1, v.A.sent));
    const rateB = exp.win_metric === "click_rate" ? (v.B.clicks / Math.max(1, v.B.sent)) : (v.B.opens / Math.max(1, v.B.sent));
    const winner = rateB > rateA ? "B" : "A";
    await pool.query("UPDATE ab_experiments SET winner_variant=?, status='completed' WHERE id=?", [winner, exp.id]);
    res.json({
      exp_uid: exp.exp_uid,
      winner_variant: winner,
      winner_subject: v[winner]?.subject,
      rollout_remaining_pct: 100 - Number(exp.test_ratio_pct || 20),
      rates: { A: Number((rateA * 100).toFixed(2)), B: Number((rateB * 100).toFixed(2)) }
    });
  });
}
