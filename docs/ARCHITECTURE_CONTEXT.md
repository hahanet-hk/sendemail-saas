# SendEmail.ai SaaS — 系統架構基準與 AI / 工程師開發規範 (v4.1.1 -> v4.2.0)

> **強制規則：** 任何 AI 代理或開發人員在修改程式碼、執行資料庫遷移或新增微服務前，**必須先閱讀本文件與 `docs/ROADMAP_V4_2_PRODUCTION.md`**，嚴格遵守既有技術棧與資料表約定，禁止擅自變更模組規範或重寫核心架構。

---

## 1. 伺服器與容器拓撲（Docker Compose）
專案根目錄：`/home/docker-apps/sendemail-saas`

| 容器名稱 | 內部 / 綁定埠號 | 職責說明 |
| :--- | :--- | :--- |
| `sendemail-web` | `127.0.0.1:8095 -> 8095` | Next.js 前端應用（`web/`，容器內監聽 **8095** 非 3000） |
| `sendemail-api` | `127.0.0.1:8096 -> 8096` | Express REST API 服務（`api/`） |
| `sendemail-worker` | 無對外埠號 | BullMQ 背景佇列與排程處理器（`worker/`） |
| `sendemail-rspamd` | `11332-11334/tcp` | 郵件垃圾評分與 DKIM/ARC 檢測引擎（`rspamd/`） |
| `global-mariadb` | `127.0.0.1:3307 -> 3306` | 共用外部 MariaDB（內網直連 `global-mariadb:3306`） |
| `global-redis` | `127.0.0.1:6380 -> 6379` | 共用外部 Redis（內網直連 `global-redis:6379`，**隔離 DB 14**，`noeviction`） |

### 維運與資料庫標準指令
- **重建單一服務：** `cd /home/docker-apps/sendemail-saas && docker compose up -d --build sendemail-api`（嚴禁執行 `down -v`）。
- **執行 MariaDB SQL：**
  `ROOT_PW=$(docker exec global-mariadb printenv MYSQL_ROOT_PASSWORD) && docker exec -i global-mariadb mysql -u root -p"$ROOT_PW" sendemail_saas`
- **Port 25 避讓原則：** 宿主機 Port 25 可能已有 Postfix 服務；部署 `smtp-bounce-receiver`（Batch 4）時優先監聽容器內網 Port `2525` 並透過 Postfix transport 轉發，避免埠號衝突。

---

## 2. 資料庫與認證架構約定
1. **核心資料庫分離：**
   - `sendemail_saas`：業務主庫（現有 23 張表 + v4.2 新增 `system_settings` / `cms_locales` / `cms_pages_i18n` / `supported_currencies`）。
   - `global_auth`：跨站統一帳號與 Session 庫（`global_auth.users`、`global_auth.sessions`、`global_auth.oauth_accounts`）。
2. **`global_auth` 硬性欄位約束（防踩坑）：**
   - `global_auth.users` 寫入時**必須包含 `uuid`（`crypto.randomUUID()`）**與 `full_name`（無 `display_name` 欄位）。
   - `global_auth.sessions` 欄位為 `(user_id, token_hash, expires_at)`。
3. **認證機制（`api/server.js` -> `authenticateTenant`）：**
   - API Key 模式：`Authorization: Bearer <key>`，比對 `sendemail_saas.api_keys.key_hash`（SHA-256）。
   - 控制台 Session 模式：Cookie `se_session`，比對 `global_auth.sessions.token_hash`，並自動綁定 `tenants` 紀錄。
4. **SuperAdmin 權限判定（`api/routes_billing_sso.js` -> `isSuperAdmin`）：**
   - 符合環境變數 `SUPERADMIN_EMAILS` **或** `global_auth.users` 中 `id` 最小的首位創始用戶。
5. **SuperAdmin 稽核日誌表（`superadmin_audit_logs`）：**
   - 嚴格使用既有欄位：`(actor_email, target_tenant_id, action, details, created_at)`。

---

## 3. 後端程式規範與既有核心路由（`api/`）
- **模組系統：** **純 ES Modules（`"type": "module"`）**，所有檔案必須使用 `import ... from './xxx.js'`（副檔名 `.js` 不可省略），**嚴禁使用 CommonJS `require()`**。
- **已安裝依賴：** `express`、`mysql2`（`mysql2/promise`）、`bullmq`、`ioredis`（優先使用 Node.js 內建 `node:crypto`、`node:fs` 與原生 `fetch`）。
- **路由註冊模式：** 統一於 `api/server.js` 匯入 `registerXxxRoutes(app, pool, authenticateTenant, ...)` 並掛載。
- **既有核心驗證路由：** `GET /api/health`、`GET /api/v1/domains`、`GET /api/v1/bounces`、`GET /api/v1/automations`、`GET /api/v1/billing/plans`、`GET /api/v1/superadmin/overview`。

---

## 4. 前端程式規範（`web/src/app/`）
- **目錄結構：** 採用 App Router 扁平化分頁元件架構，所有功能分頁直接置於 `web/src/app/`（如 `page.js`、`authView.js`、`billingTab.js`、`domainsTab.js`、`automationsTab.js`、`opsRiskTab.js`），由主工作台 `web/src/app/page.js` 統一引入切換。
- **程式碼拆分原則：** 新增大型管理介面（如 CMS / 金鑰設定）時建立獨立元件檔（如 `cmsAdminTab.js`），避免單次 Shell Heredoc 過長。

---

## 5. 環境變數清單（`.env` 鍵名，嚴禁寫入明文密碼）
- 基礎：`NODE_ENV`、`API_PORT`、`WEB_PORT`
- 資料庫：`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`
- 快取：`REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_DB`（固定 `14`）
- 內網服務：`CHECKEMAIL_INTERNAL_URL`、`MAILWIZZ_INTERNAL_URL`、`MAILWIZZ_PUBLIC_URL`
- 安全密鑰：`SAAS_ADMIN_SECRET`、`WEBHOOK_SIGNING_SECRET`（v4.2 支援選填 `SETTINGS_MASTER_KEY`，未設則自動由 `DB_PASSWORD` 派生 SHA-256 金鑰）

---

## 6. 宿主機執行環境限制
- **宿主機未安裝 `node` / `npm`**：Node.js 環境僅存在於 Docker 容器（`sendemail-api`、`sendemail-web`、`sendemail-worker`）內部。
- **文本/程式碼修改規範**：在宿主機批次修改程式碼或 JSON 處理時，統一使用系統內建 `python3`（禁止在宿主機直接呼叫 `node`）。
