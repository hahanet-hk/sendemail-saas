# SendEmail.ai 系統架構與安全基線規範

- **版本：** v1.0.0
- **適用範圍：** `/home/docker-apps/sendemail-saas`（API、Worker、Web Console）

## 1. 服務拓撲與基礎設施

| 容器 / 服務 | 端口 / 佇列 | 職責說明 |
| :--- | :--- | :--- |
| **`sendemail-web`** | `127.0.0.1:8095` | Next.js 15 管理控制台（概況儀表板、API 金鑰、批量驗證、範本編輯器、網域、沙盒、Webhook、API Playground）。 |
| **`sendemail-api`** | `127.0.0.1:8096` | Express REST API 閘道，負責認證授權、速率限制、範本渲染、原子計費校驗、抑制名單過濾與任務排程。 |
| **`sendemail-worker`** | BullMQ Workers | 消費 `email-dispatch`（SMTP / 上游 MTA 派發）與 `email-verify`（語法、MX、拋棄式網域、SMTP 探測），並執行背景 Webhook 推播與每月配額重置。 |
| **`global-mariadb`** | `3306` (`sendemail_saas`) | 核心業務資料庫，並透過跨庫查詢共享 `global_auth` 統一帳號與工作階段。 |
| **`global-redis`** | `6379` (`DB 14`) | 承載 BullMQ 任務佇列與分散式滑動窗口速率限制器。 |

## 2. 核心資料庫結構規範

- **`tenants`：** 租戶主檔，包含 `credit_balance`（驗證點數）、`monthly_quota`（月度發信上限）、`used_quota`（本月已用額度）、`status`（`active` / `suspended`）。
- **`api_keys`：** 儲存 `SHA-256` 雜湊金鑰（`se_live_...` 與 `se_test_...`），支援撤銷（`revoked_at`）與最近使用 IP／時間審計。
- **`email_templates`：** 交易型郵件範本（`template_uid` 格式 `tpl_<16hex>`），支援 `{{variable_name}}` 佔位符與 `sample_variables` JSON。
- **`suppressions`：** 租戶全域抑制名單（唯一鍵 `tenant_id + email`），來源包含 `hard_bounce`、`complained`、`unsubscribed`、`verify_blocked` 與手動新增。
- **`verification_batches` / `verification_results`：** 批量信箱驗證任務與逐筆判定結果（`allow` / `review` / `block` / `error` / `pending`）。
- **`webhook_endpoints` / `webhook_deliveries`：** 租戶註冊的 Webhook 訂閱端點、簽章密鑰（`whsec_...`）與每次派發的 HTTP 狀態審計紀錄。
- **`quota_reset_logs`：** 月度計費週期重置審計紀錄（`cycle_key` 格式 `YYYY-MM` 設為 `UNIQUE KEY` 作為分散式冪等鎖）。

## 3. 強制安全紅線（Security Guardrails）

任何後續開發或重構不得破壞以下四項安全基線：

1. **雙端 SSRF 縱深防禦（`api/ssrf_guard.js` & `worker/webhook_emitter.js`）：**
   - 註冊端點與發起外網 POST 前均必須執行即時雙棧（IPv4 / IPv6）`dns.lookup`。
   - 嚴格阻斷環回（`127.0.0.0/8`、`::1`）、私有內網（`10/8`、`172.16/12`、`192.168/16`、`fc00::/7`）、鏈路本地與雲端中繼資料（`169.254.169.254`）以及非 `80`/`443` 通訊埠。
   - 所有 `fetch` 請求必須明確設定 `redirect: "error"`，禁止跟隨 HTTP 30x 重導向。
2. **分層速率限制（`api/rate_limiter.js`）：**
   - 登入與註冊（`/api/v1/auth/login`、`/register`）：`15 req / min`
   - 發信與批量驗證（`/api/v1/send`、`/api/v1/verify`）：`120 req / min`
   - 全域 API（`/api/v1/*`）：`600 req / min`（超限回傳 `HTTP 429`）。
3. **Webhook HMAC-SHA256 防重放簽章：**
   - 請求標頭固定帶入 `X-SendEmail-Signature: t=<unix_sec>,v1=<hmac_sha256>`，簽章原文為 `${t}.${rawBody}`，接收端應驗證時間戳誤差在 300 秒內。
4. **防退信護欄閉環：**
   - `POST /api/v1/send` 在扣減配額與入隊前，必須先比對 `suppressions` 表剔除所有受抑制收件人；若全部命中則直接回傳 `200 {"status":"suppressed_all"}`，零額度消耗。

## 4. 計費配額原子扣減與週期重置規則

- **月度發信配額（`api/billing_guard.js`）：**
  - 以單一原子 SQL `UPDATE tenants SET used_quota = used_quota + ? WHERE id=? AND status='active' AND (used_quota + ?) <= monthly_quota` 預留額度（Sandbox 模式與全數命中抑制名單不扣額度；佇列異常自動退還）。
  - 超額回傳 **`HTTP 402 Payment Required`**（`error: "QUOTA_EXCEEDED"`）。
  - 使用率首次跨越 **80%** 派發 `quota.warning` Webhook；達到 **100%** 或超限派發 `quota.exceeded` Webhook（內建 5 分鐘同級別冷卻防轟炸）。
- **信箱驗證點數（`api/billing_guard.js`）：**
  - 以單一原子 SQL `UPDATE tenants SET credit_balance = credit_balance - ? WHERE id=? AND status='active' AND credit_balance >= ?` 預留點數（批次建立失敗自動退還）；不足回傳 **`HTTP 402 Payment Required`**（`error: "INSUFFICIENT_CREDITS"`）。
  - 餘額首次跌破 **100 點** 派發 `credits.low` Webhook；歸零或不足派發 `credits.exhausted` Webhook。
- **每月配額自動歸零排程（`worker/quota_scheduler.js`）：**
  - Worker 啟動時及每 10 分鐘檢查當月 `YYYY-MM`，透過 `INSERT IGNORE INTO quota_reset_logs` 取得唯一鎖後將所有租戶 `used_quota` 歸零並寫入審計快照。
