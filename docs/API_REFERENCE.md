# SendEmail.ai REST API 開發者規格書

- **Base URL:** `https://www.sendemail.ai/api/v1`（本機內部：`http://127.0.0.1:8096/api/v1`）
- **資料格式：** `Content-Type: application/json`

## 1. 認證方式

* **伺服器端 API 金鑰：** `Authorization: Bearer se_live_...`
  * 若使用測試前綴金鑰 `se_test_...`，`POST /api/v1/send` 會自動進入 Sandbox 捕獲模式，不寄出真實郵件也不消耗月度配額。
* **控制台工作階段：** HttpOnly Cookie `se_session`。
* **公開無需認證端點：** `GET /api/health`、`GET /api/v1/openapi.yaml`。

## 2. 標準 HTTP 狀態碼與錯誤規範

| HTTP 狀態碼 | 錯誤代碼 (`error`) | 說明與處理建議 |
| :--- | :--- | :--- |
| `200 OK` | — | 查詢成功、更新成功，或發信收件人全數命中抑制名單（`status: "suppressed_all"`）。 |
| `201 Created` | — | 資源建立成功（如範本、網域、Webhook 端點）。 |
| `202 Accepted` | — | 非同步任務已進入佇列（`dispatch_uid` 或 `batch_uid`）或已寫入 Sandbox。 |
| `400 Bad Request` | `MISSING_FIELDS` / `NO_VALID_EMAILS` / `SSRF_BLOCKED` | 請求缺少必要欄位、格式無效或目標 URL 違反安全策略。 |
| `401 Unauthorized` | `UNAUTHENTICATED` / `INVALID_OR_REVOKED_API_KEY` | 缺少憑證、工作階段過期或 API 金鑰已撤銷。 |
| `402 Payment Required` | `QUOTA_EXCEEDED` / `INSUFFICIENT_CREDITS` | 月度發信配額已滿或驗證點數不足，需升級或儲值後再重試。 |
| `404 Not Found` | `NOT_FOUND` / `TEMPLATE_NOT_FOUND` / `BATCH_NOT_FOUND` | 指定的資源不存在或不屬於當前租戶。 |
| `429 Too Many Requests` | `RATE_LIMIT_EXCEEDED` | 觸發速率限制，請依 `Retry-After` 標頭退避重試。 |

## 3. 核心端點明細

### 3.1 發送郵件 `POST /api/v1/send`
支援直接傳入 `subject` + `html`/`text`，或指定 `template_id` 搭配 `variables` 動態渲染。系統自動過濾 `suppressions` 抑制名單並原子扣減月度配額，成功後回傳 `202 Accepted`（含 `dispatch_uid`、`quota_remaining`）。

* **`GET /api/v1/dispatches/:dispatchUid`**：查詢單筆發信任務排程與投遞狀態。

### 3.2 交易型郵件範本
* **`GET / POST / PUT / DELETE /api/v1/templates`**：交易型郵件範本 CRUD 與自動解析 `{{variable}}` 佔位符。

### 3.3 批量信箱驗證與抑制名單同步
* **`POST /api/v1/verify/batch`**：提交最多 5,000 筆信箱進行非同步平行驗證（原子扣除 `credit_balance`，回傳 `batch_uid`）。
* **`GET /api/v1/verify/batches`** & **`GET /api/v1/verify/batches/:batchUid`**：查詢批量驗證進度與逐筆風險評分。
* **`POST /api/v1/verify/batches/:batchUid/sync-suppressions`**：一鍵將批次內 `block`（可選 `{"include_review": true}`）信箱冪等寫入全域 `suppressions`。
* **`GET /api/v1/verify/batches/:batchUid/export.csv`**：下載帶 UTF-8 BOM 的 CSV 報告，支援 `?verdict=allow|review|block|error` 篩選。

### 3.4 帳戶、計費審計與管理端點
* **`GET /api/v1/me`**：查詢租戶配額與點數餘額。
* **`GET /api/v1/billing/reset-logs`**：查詢最近 24 個計費週期的月度發信配額自動重置審計紀錄（`cycle_key`、`tenants_reset_count`、`total_quota_cleared`、`executed_at`）。
* **`GET /api/v1/openapi.yaml`**：公開唯讀端點（無需認證），直接回傳最新 OpenAPI 3.0.3 YAML 規格檔（`Content-Type: application/yaml`）。
* **`GET / POST / DELETE /api/v1/domains` / `channels` / `suppressions` / `webhooks`**：寄件網域（含 SPF/DKIM/DMARC 診斷）、發信通道、抑制名單與 Webhook 訂閱管理。
* **`GET /api/v1/webhooks/deliveries`** & **`GET /api/v1/analytics/overview`**：Webhook 投遞紀錄與時間序列數據分析。

### 3.5 發信品質護欄、Rspamd 引擎與沙盒重掃
- **`POST /api/v1/tools/preflight`**：發信前全自動綜合預檢，一次驗證發信網域 SPF/DKIM/DMARC 狀態、Rspamd 垃圾信評分與退訂連結合規性，回傳 `readiness_score`（0–100）與具體修正建議。
- **`POST /api/v1/tools/spam-check`**：單一信件 Rspamd 垃圾信評分與命中規則（Symbols）即時體檢。
- **`POST /api/v1/tools/spam-learn`**：雙向貝氏學習（`type: "spam" | "ham"`），即時訓練專屬 Redis 貝氏模型。
- **`POST /api/v1/sandbox/:uid/rescan`**：使用最新 Rspamd 規則與貝氏模型重掃已攔截的沙盒信件。
- **`POST /api/v1/domains/:id/share-token`** & **`GET /api/v1/public/dns-share/:token`**：產生 7 天有效的免登入 IT DNS 設定分享連結，並支援免登入公開查詢與一鍵複檢。
