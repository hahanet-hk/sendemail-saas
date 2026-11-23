# SendEmail.ai 工程交接基準與產品發展路線圖 (v1.3 Complete Edition)

**文件版本**：v1.3（已落實 `global_auth` 跨產品統一身分庫與 `www.sendemail.ai` 原生後台 Basic Auth 隔離）  
**更新日期**：2026-11-19  
**專案路徑**：`/home/docker-apps/sendemail-saas/`  
**開發策略**：路線 A + B（第 1 週快速落地混合商業化入口，第 2 週演進為全自建 Next.js 統一工作台）  
**目標願景**：打造結合「前置零信任信箱清洗（Zero-Trust Email Verification）」與「雙模高送達率引擎（Transactional + Campaign）」的一流 Email SaaS 平台。

---

## 0. 工程交接與環境上下文基準 (AI Handover Context)
> **給接手開發的 AI 工程師**：本節定義了當前生產環境的實際拓撲與約束條件，所有新增功能與指令必須嚴格遵循以下規格，切勿重新發明架構或破壞現有隔離邊界。

### 0.1 基礎設施與容器拓撲
- **主機環境**：Ubuntu 24.04.5 LTS（IP `201.18.217.101`），外網反向代理與 SSL 由 CloudPanel Nginx 管理。
- **共享 Docker 內網**：`global-net`（所有微服務透過容器名稱在內網互通，不走公網繞行）。
- **核心服務清單**：
  1. `sendemail-web`（Port `8095`）：SaaS 前端控制台（`https://app.sendemail.ai`），技術棧為 **Next.js 15 (`output: 'standalone'`)**，源碼位於 `/home/docker-apps/sendemail-saas/web`。
  2. `sendemail-api`（Port `8096`）：SaaS 後端 REST API（`https://app.sendemail.ai/api/*`），技術棧為 Node.js Express，源碼位於 `/home/docker-apps/sendemail-saas/api`。
  3. `sendemail-worker`：背景非同步任務處理器（BullMQ Worker），源碼位於 `/home/docker-apps/sendemail-saas/worker`。
  4. `checkemail-docker-web-1`（內網 Port `3000`）：信箱風險評分微服務，內網端點 `http://checkemail-docker-web-1:3000/api/v1/verify`（內部呼叫必須攜帶 Header `X-Internal-Service: sendemail-worker` 以繞過公開 API 限流）。
  5. `php-site-03`（Port `8093`）：底層 MailWizz 2.x (v3.0.8) 無頭發信引擎，內網 API 端點 `http://php-site-03/api`（內部呼叫必須攜帶 `Host: www.sendemail.ai` 與 `X-Forwarded-Proto: https`）。
  6. `global-mariadb`（宿主機映射 Port `3307` / 內網 `3306`）：包含三個獨立隔離資料庫：
     - `global_auth`：跨產品統一身分認證庫（供 `sendemail.ai` 與 `checkemail` 共用登入憑證、各自獨立計費）。
     - `sendemail_saas`：SendEmail SaaS 專屬業務與計費資料庫。
     - `php_site_03`：MailWizz 底層引擎資料庫。
  7. `global-redis`（內網 `6379`）：SaaS 專屬佇列使用 **`DB 14`**（BullMQ 佇列名稱：`email-dispatch`、`email-verify`）。

### 0.2 現有資料庫表結構 (`global_auth` & `sendemail_saas`)
- **`global_auth`（已建置完成，專屬連線帳號 `auth_service`）**：
  - `users`：`id`、`uuid`、`email`、`password_hash`、`full_name`、`status`（`active`|`suspended`|`pending_verification`）、`email_verified_at`、`last_login_at`、`created_at`、`updated_at`。
  - `oauth_accounts`：`id`、`user_id`、`provider`（如 `google`）、`provider_user_id`、`created_at`。
  - `sessions`：`id`、`user_id`、`token_hash`、`user_agent`、`ip_address`、`expires_at`、`created_at`。
- **`sendemail_saas`（已建置完成）**：
  - `tenants`：租戶主表（儲存 `id`、`name`、`api_token`、`mw_api_key`、`status`、`created_at`；後續新增 `owner_user_id` 關聯 `global_auth.users.id`）。
  - `email_dispatches`：派發紀錄表（`dispatch_uid`、`tenant_id`、`mode` [`transactional`|`campaign`]、`subject`、`recipient_count`、`mw_reference_uid`、`status` [`queued`|`sent`|`failed`]、`error_message`、`created_at`）。
  - `verification_batches` & `verification_results`：批量與單筆信箱清洗任務與結果明細表。

### 0.3 現有 API 契約、安全隔離與開發鐵律
- **已上線端點**：`GET /api/health`、`POST /api/v1/send`、`GET /api/v1/dispatches/:uid`、`POST /api/v1/verify/batch`、`GET /api/v1/verify/batches/:id`（均需 `Authorization: Bearer <token>`）。
- **MailWizz 原生後台安全隔離（已完成）**：`www.sendemail.ai` 的 `/backend` 與 `/customer` 路徑已在 CloudPanel Nginx（`/etc/nginx/sites-enabled/www.sendemail.ai.conf`）套用 Basic Auth 密碼鎖（憑證檔 `/etc/nginx/.htpasswd_mailwizz`），未授權訪問回傳 `401`；`/api/`、開信追蹤與退訂連結維持公開放行。
- **開發鐵律 (Guardrails)**：
  1. 修改前端後必須執行 `cd /home/docker-apps/sendemail-saas && docker compose up -d --build sendemail-web`。
  2. **嚴禁**在前端程式碼中硬編碼任何 `se_live_*` 或 `se_test_*` Token。
  3. 呼叫 MailWizz `/api/lists` 時必須包含 `company[name]`、`company[country_id]`、`company[address_1]`、`company[city]`、`company[zip_code]` 與 `defaults[from_name]`；呼叫 `/api/campaigns` 時 HTML 內文必須包含 `[COMPANY_FULL_ADDRESS]` 與 `[UNSUBSCRIBE_URL]`。
  4. **不修改 MailWizz 原生前端 PHP 頁面**，完全將其作為 Headless 發信引擎。

---

## 1. 已完成架構回顧 (Milestone 1: Core Infrastructure & Security Hardening)

- **雙模智慧派信管線全鏈路驗收通過**：單收件人自動走 `transactional` 直發通道；多收件人自動經 `checkemail` 過濾黑名單 → 建立 MailWizz 名單 → 匯入合法收件人 → 注入合規退訂頁尾 → 排程活動並回寫 `campaign_uid`。
- **統一身分認證庫建置完成**：在 `global-mariadb` 建立獨立 `global_auth` 資料庫與最小權限帳號 `auth_service`，實現 `sendemail.ai` 與 `checkemail` 憑證共用、業務與計費完全隔離。
- **原生引擎入口隔離完成**：封鎖 `www.sendemail.ai/backend` 與 `/customer` 未授權存取，前端清除所有預設測試憑證。

---

## 2. 客戶專用平台入口 (`https://app.sendemail.ai/`) 4 大核心門戶模組 (Milestone 2
cat << 'EOF' > /home/docker-apps/sendemail-saas/server-migration.md
# SendEmail.ai 伺服器無痛遷移標準作業程序 (Server Migration SOP)

**文件版本**：v1.1（已同步纳入 `global_auth` 統一身分庫與 MailWizz 原生後台密碼鎖檔案）  
**更新日期**：2026-11-19  
**適用架構**：Hostinger VPS (Ubuntu 24.04.5 LTS / CloudPanel + Docker Compose 共享內網架構)  
**目標**：將 `www.sendemail.ai`（MailWizz 2.x）、`app.sendemail.ai`（Next.js + Express + BullMQ）、`checkemail` 微服務、共享資料庫（`global_auth`、`sendemail_saas`、`php_site_03`）、Redis 與 Nginx 隔離設定完整遷移至新伺服器，並實現零遺失切換。

---

## 1. 遷移資產盤點清單 (Migration Inventory)

在舊伺服器（來源 IP：`201.18.217.101`）執行遷移前，必須完整打包以下 **6 大核心資產**：

| 資產類別 | 舊伺服器路徑 / 容器名稱 | 備份方式與關鍵注意事項 |
| :--- | :--- | :--- |
| **1. 應用程式源碼與 `.env`** | `/home/docker-apps/sendemail-saas/`<br>`/home/docker-apps/checkemail-docker/`（依實際路徑） | 打包完整目錄（務必包含隱藏檔 `.env` 與 `docker-compose.yml`）。 |
| **2. MailWizz 網站檔案與上傳附件** | `php-site-03` 掛載目錄（含 `apps/common/config/main-custom.php` 與 `frontend/assets/files`） | 必須保留原本的檔案權限與 `main-custom.php` 加密金鑰（Salt/Key），否則既有密碼與 API Key 會失效。 |
| **3. 關聯式資料庫 (MariaDB)** | `global-mariadb` (Port `3307`)<br>• `global_auth`（跨產品統一身分庫與 `auth_service` 帳號）<br>• `sendemail_saas`（SaaS 租戶與派發紀錄）<br>• `php_site_03`（MailWizz 引擎資料） | 使用 `mysqldump --single-transaction --routines --triggers` 分別匯出三個資料庫，並在新主機補建 `auth_service` 資料庫權限。 |
| **4. 記憶體佇列與快取 (Redis)** | `global-redis`（`DB 14` 為 SaaS BullMQ 佇列） | 切換前先暫停新任務寫入，待 `DB 14` 佇列消化完畢後觸發 `BGSAVE` 備份 `dump.rdb`。 |
| **5. 網關、SSL 與後台隔離密碼檔** | `/etc/nginx/sites-enabled/www.sendemail.ai.conf`<br>`/etc/nginx/sites-enabled/app.sendemail.ai.conf`<br>`/etc/nginx/.htpasswd_mailwizz` | 務必一併備份 `.htpasswd_mailwizz` 與 `www.sendemail.ai.conf` 中的 `/backend`、`/customer` Basic Auth 隔離區塊。 |

---

## 2. 遷移前準備（T-24 小時）

### 2.1 降低 DNS TTL（實現秒級切換）
1. 登入 Cloudflare（或 DNS 託管商），將以下紀錄的 **TTL** 調降至最低（`60 秒` 或 `Auto`）：
   - `A` 紀錄：`www.sendemail.ai`
   - `A` 紀錄：`app.sendemail.ai`
   - 任何自定義追蹤網域（如 `track.sendemail.ai`）與發信伺服器主機名（`mail.sendemail.ai`）
2. **提前申請新 IP 基礎設施白名單與反解（rDNS / PTR）**：
   - 若新伺服器直接負責 SMTP 發信，務必在雲端廠商後台將新 IP 的 **PTR 紀錄（Reverse DNS）** 設為發信網域（如 `mail.sendemail.ai`），並確認防火牆開啟 `25`、`465`、`587`、`80`、`443` 埠。
   - 更新發信網域的 **SPF 紀錄**，提前將新伺服器 IP 加入白名單（`v=spf1 ip4:<舊IP> ip4:<新IP> ... -all`），確保切換瞬間不影響信件送達率。

### 2.2 新伺服器環境初始化
在新 VPS（建議同樣使用 Ubuntu 24.04 LTS + CloudPanel）執行基礎環境建置：
```bash
# 1. 建立共享 Docker 內網
docker network create global-net

# 2. 建立專案目錄
mkdir -p /home/docker-apps/sendemail-saas
ROOT_PW=$(docker exec global-mariadb printenv MYSQL_ROOT_PASSWORD) && docker exec -i global-mariadb mysql -u root -p"$ROOT_PW" << 'EOF'
USE sendemail_saas;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS owner_user_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN IF NOT EXISTS monthly_quota INT UNSIGNED NOT NULL DEFAULT 1000 AFTER status,
  ADD COLUMN IF NOT EXISTS used_quota INT UNSIGNED NOT NULL DEFAULT 0 AFTER monthly_quota,
  ADD INDEX idx_owner_user_id (owner_user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  environment ENUM('live', 'test') NOT NULL DEFAULT 'live',
  scopes JSON NOT NULL,
  last_used_at DATETIME NULL,
  last_used_ip VARCHAR(45) NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_id (tenant_id),
  CONSTRAINT fk_apikey_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

DESCRIBE tenants;
SHOW TABLES FROM sendemail_saas;
