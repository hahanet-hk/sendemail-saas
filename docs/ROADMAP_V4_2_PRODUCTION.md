# SendEmail.ai v4.2 生產就緒與全域營運 CMS 演進計劃書

- **版本：** v4.2.0-prod-readiness
- **基準架構：** v4.1.1（已完成 Phase 1–4 基礎核心）
- **目標：** 消除從「本機沙盒閉環」跨越到「公網商業營運（`www.sendemail.ai` + `app.sendemail.ai`）」的所有實戰斷點，並建立免改程式碼的 **SuperAdmin 全域 CMS 與加密金鑰管理後台**。

---

## 一、現況實戰缺口總盤點（12 項生產阻斷點）

1. **公網網域與路由未分流：** `sendemail-web`（8095）與 `sendemail-api`（8096）僅綁定 `127.0.0.1`；`www.sendemail.ai` 與 `app.sendemail.ai` 尚未透過 Hostname 分流。
2. **動態 CMS、多語言與多幣別寫死：** 語系（英/繁/簡）、官網文案、新增貨幣（USD/HKD/TWD 以外）及定價均寫死於前端或初始 SQL，無法由 Admin 後台動態增修。
3. **SEO 與 Schema.org 缺失：** 缺少動態 Meta、OpenGraph、`/sitemap.xml`、`/robots.txt` 及 `SoftwareApplication` / `Organization` / `FAQPage` JSON-LD 結構化資料。
4. **第三方金鑰管理不友善：** Cloudflare API Token、Turnstile 金鑰、Airwallex 金鑰、OAuth 憑證與告警機器人皆依賴手動修改 `.env` 並重啟容器。
5. **Cloudflare DNS 與角色信箱未落地：** `support@`、`abuse@`、`billing@` 的 Cloudflare Email Routing 轉發與 DNS 檢測未接通，不符 RFC 2142 與 Airwallex 風控要求。
6. **Dogfooding 系統交易信斷鏈：** 註冊驗證信、忘記密碼重設信、Airwallex 付款收據尚未接入自家 `sendemail-api` 自動發送。
7. **VERP 退信子網域 `b.sendemail.ai` 無真實 SMTP 入口：** VPS 尚未部署監聽 Port 25 的輕量級 SMTP 接收器將真實退信 DSN 灌入 `/api/v1/bounces/ingest`。
8. **Anti-Bot 與防濫用防線為零：** 註冊介面缺少 Cloudflare Turnstile 驗證、Redis IP 頻率限制、拋棄式信箱（Disposable）攔截與「點擊驗證信解鎖免費額度」機制。
9. **租戶自訂網域真實 DKIM 簽章缺失：** 尚未為租戶自動生成 2048-bit RSA DKIM 金鑰對並同步寫入底層發信引擎。
10. **追蹤像素與點擊跳轉鏈路斷裂：** 缺少 `1x1.gif` 開信追蹤端點與連結重寫跳轉器，導致 DAG 引擎的「是否開信」條件分支在真實發信下無法觸發。
11. **A/B 實驗自動勝出依賴手動觸發：** Worker 缺少定時掃描到期實驗並自動切換 100% 勝出版本的背景排程。
12. **Airwallex 與 OAuth 停留在模擬層：** `checkout` 尚未串接 Airwallex 正式 Hosted Checkout / PaymentIntent API；SSO 缺少真實 Google / GitHub `code` 換 Token 回呼處理。

---

## 二、資料庫架構擴充設計（v4.2 新增資料表）

### 1. `system_settings`（AES-256-GCM 加密金鑰與全域設定庫）
| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `setting_key` | `VARCHAR(80) PK` | 設定鍵名（如 `cloudflare_api_token`、`cloudflare_zone_id`、`turnstile_site_key`、`turnstile_secret_key`、`airwallex_client_id`、`airwallex_api_key`、`airwallex_webhook_secret`、`airwallex_env`、`google_client_id`、`google_client_secret`、`github_client_id`、`github_client_secret`、`ops_telegram_bot_token`、`ops_telegram_chat_id`、`default_locale`） |
| `setting_group` | `VARCHAR(32)` | 分組（`cloudflare` / `security` / `billing` / `oauth` / `general`） |
| `value_encrypted` | `TEXT NULL` | AES-256-GCM 密文（敏感金鑰）或明文 JSON（一般設定） |
| `is_secret` | `TINYINT(1)` | `1` 表示前端僅顯示遮罩（如 `cf_****89a2`），不可明文回傳 |
| `updated_by` | `VARCHAR(190)` | 最後修改之 SuperAdmin Email |
| `updated_at` | `DATETIME` | 更新時間 |

### 2. `cms_locales`（動態多語言管理表）
| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `locale_code` | `VARCHAR(16) PK` | 語系代碼（預設寫入 `en`、`zh-Hant`、`zh-Hans`，支援 Admin 線上新增如 `ja`、`ko`） |
| `label` | `VARCHAR(64)` | 顯示名稱（`English`、`繁體中文`、`简体中文`） |
| `default_currency` | `VARCHAR(8)` | 該語系預設聯動幣別（如 `en->USD`、`zh-Hant->HKD`、`zh-Hans->USD`） |
| `is_active` | `TINYINT(1)` | 是否於前台語系選單啟用 |
| `sort_order` | `INT` | 排序權重 |

### 3. `cms_pages_i18n`（動態網頁內容、SEO Meta 與 Schema.org 結構化資料）
| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `id` | `BIGINT PK` | 自增主鍵 |
| `page_slug` | `VARCHAR(64)` | 頁面識別（`home`、`pricing`、`features`、`security`、`legal`） |
| `locale_code` | `VARCHAR(16)` | 關聯 `cms_locales.locale_code` |
| `seo_title` | `VARCHAR(200)` | HTML `<title>` 與 `og:title` |
| `seo_description` | `VARCHAR(500)` | Meta Description 與 `og:description` |
| `og_image_url` | `VARCHAR(255)` | 社群分享預覽圖網址 |
| `schema_jsonld` | `JSON` | 該頁面專屬 Schema.org JSON-LD（`SoftwareApplication` / `FAQPage` / `Organization`） |
| `content_blocks` | `JSON` | 頁面動態區塊內容（Hero 標題、副標、CTA 按鈕文字、FAQ 問答陣列、特性卡片） |
| `updated_at` | `DATETIME` | 更新時間（與 `page_slug + locale_code` 建立複合唯一索引） |

### 4. `supported_currencies`（動態多幣別與自訂定價矩陣）
| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `currency_code` | `VARCHAR(8) PK` | ISO 幣別代碼（預設 `USD`、`HKD`、`TWD`，支援 Admin 線上新增如 `EUR`、`SGD`、`JPY`） |
| `symbol` | `VARCHAR(12)` | 貨幣符號（`$`、`HK$`、`NT$`、`€`） |
| `exchange_rate_to_usd` | `DECIMAL(12,6)` | 相對 USD 參考匯率（用於自動換算與營收歸一化統計） |
| `plan_prices` | `JSON` | 各方案售價映射 `{"free":0,"starter":29,"growth":99,"enterprise":399}` |
| `topup_prices` | `JSON` | 點數包售價映射 `{"pack_10k":15,"pack_50k":60,"pack_200k":199}` |
| `is_active` | `TINYINT(1)` | 是否於前台幣別切換器啟用 |

---

## 三、分批實戰落地執行藍圖（Batch 1 – Batch 5）

### Batch 1：SuperAdmin 全域 CMS、多語言/貨幣/SEO 與加密金鑰管理後台
* **資料庫遷移：** 建立 `system_settings`、`cms_locales`、`cms_pages_i18n`、`supported_currencies` 並寫入預設種子資料（英/繁/簡三語系、USD/HKD/TWD 三幣別、首頁與定價頁預設 SEO + Schema.org）。
* **AES-256-GCM 加密設定服務（`api/lib/settings_vault.js`）：**
  * 以環境變數 `SETTINGS_MASTER_KEY`（若未設則由 `DB_PASSWORD` 派生 SHA-256 金鑰）對敏感金鑰加解密，並快取於 Redis（變更時即時失效快取）。
  * 提供 `GET/PUT /api/v1/superadmin/settings`（敏感欄位自動遮罩）、`POST /api/v1/superadmin/settings/test-cloudflare`（即時驗證 Cloudflare API Token 與 Zone ID 權限、DNS 紀錄與 Email Routing 狀態）。
* **CMS 與幣別動態管理 API：**
  * `GET /api/v1/public/cms?locale=zh-Hant&slug=home`（公開端點，供官網 SSR/CSR 讀取最新文案、啟用幣別、SEO 與 JSON-LD）。
  * `POST/PUT/DELETE /api/v1/superadmin/cms/locales`、`PUT /api/v1/superadmin/cms/pages`、`POST/PUT /api/v1/superadmin/currencies`（Admin 後台即時新增/修改語言、網頁內容、SEO Meta、Schema JSON-LD 與貨幣定價）。
* **SuperAdmin 前端管理介面（升級 `billingTab.js` 或拆出 `cmsAdminTab.js`）：**
  * 提供四大子分頁：**「金鑰與 Cloudflare 設定」**、**「多語言與網頁 CMS」**、**「SEO 與 Schema.org 編輯器」**、**「多幣別與定價管理」**，所有變更即時寫入 `superadmin_audit_logs`。

### Batch 2：獨立商業官網 `www.sendemail.ai`、多語系切換與完整技術 SEO
* **Hostname 路由分流（`web/src/middleware.js`）：**
  * 偵測 `Host` 標頭：`www.sendemail.ai` 導向公開行銷官網路由（`/`、`/pricing`、`/features`、`/security`、`/docs`）；`app.sendemail.ai` 導向開發者控制台（未登入自動顯示登入頁，登入後進入工作台）。
* **多語系前端引擎：**
  * 頂部導覽列內建語系切換器（讀取 `cms_locales`），切換語系時自動聯動該語系的預設貨幣（如切換繁中自動切至 HKD/TWD，並允許手動覆蓋）。
* **技術 SEO 與 Schema.org 輸出：**
  * 在 `web/src/app/layout.js` 與各公開頁 `generateMetadata` 動態注入 `<title>`、`description`、`canonical`、`hreflang`（多語系交替連結）及 `<script type="application/ld+json">`（`SoftwareApplication` + `Organization` + `FAQPage`）。
  * 建立動態 `/sitemap.xml`（`web/src/app/sitemap.js`）與 `/robots.txt`（`web/src/app/robots.js`），明確開放 `www.sendemail.ai` 並封鎖 `app.sendemail.ai` 控制台路徑。

### Batch 3：Anti-Bot 防隨意註冊防線與 Dogfooding 系統交易信閉環
* **四道註冊/登入安全防線（`api/routes_auth_security.js`）：**
  1. **Cloudflare Turnstile 核銷：** 讀取 `system_settings` 中的 `turnstile_secret_key`，若已啟用則強制向 `https://challenges.cloudflare.com/turnstile/v0/siteverify` 驗證 `cf-turnstile-response`。
  2. **Redis IP 滑動視窗限流：** 單一 IP 每小時最多註冊 2 個帳號、每分鐘最多嘗試登入 5 次（超過回傳 `429 TOO_MANY_REQUESTS`）。
  3. **拋棄式信箱（Disposable）攔截：** 註冊時強制通過內建清洗引擎檢查，拒絕臨時信箱與無效 MX 網域。
  4. **Email 驗證解鎖額度門檻：** 註冊後 `tenants.email_verified` 為 `0`（限制僅能發送測試信給本人信箱），點擊驗證信連結後解鎖完整免費配額與清洗點數。
* **Dogfooding 自家平台發信引擎（`api/lib/dogfood_mailer.js`）：**
  * 透過系統內部系統租戶（`system@sendemail.ai`）直接調用 `sendemail-api` 發送：
    1. 註冊信箱驗證信（`no-reply@sendemail.ai`）
    2. 忘記密碼 / 密碼重設連結信（`POST /api/v1/auth/forgot-password` & `reset-password`）
    3. Airwallex 付款成功收據與發票明細信（`billing@sendemail.ai`）

### Batch 4：VERP 退信接收服務（`b.sendemail.ai`）、開信/點擊追蹤與實驗排程
* **輕量級 SMTP 退信接收容器（`smtp-bounce-receiver`）：**
  * 新增 Node.js `smtp-server` 微服務容器（監聽 Port 25 / 2525），接收寄往 `bounce+*@b.sendemail.ai` 的所有 DSN 退信與 ARF 投訴信，解析後直接呼叫內部 `POST /api/v1/bounces/ingest` 觸發信譽扣分與四層熔斷器。
* **開信像素與點擊重寫追蹤（`api/routes_tracking.js`）：**
  * 發信時自動注入 `<img src="https://app.sendemail.ai/t/o/{tracking_uid}.gif" />` 與連結重寫 `/t/c/{tracking_uid}?u=...`，回寫 `email_events` 並即時驅動 Phase 3 DAG 引擎的 `Condition（是否開信/點擊）` 分支。
* **Worker 背景定時排程補完：**
  * 每 5 分鐘自動掃描已達觀察期的 A/B 實驗並自動選出勝出版本推播剩餘流量；每小時自動拉取網域 DNS 健康度巡檢。

### Batch 5：真實 Airwallex 收銀台、OAuth 回呼與 Nginx 公網 HTTPS 部署
* **Airwallex 正式 PaymentIntent 與 Hosted Checkout：**
  * 讀取 `system_settings` 中的 `airwallex_client_id` 與 `airwallex_api_key`，真實呼叫 Airwallex `/api/v1/authentication/login` 與 `/api/v1/pa/payment_intents/create` 取得 `client_secret` 並導向付款頁面；保留一鍵切換 `sandbox` / `production` 模式。
* **Google / GitHub OAuth 真實 Callback：**
  * 實作 `GET /api/v1/auth/sso/callback`，使用授權碼 `code` 向 Google / GitHub 換取真實用戶資料與 Email 驗證狀態。
* **Nginx 反向代理與 SSL 配置：**
  * 配置 `www.sendemail.ai` 與 `app.sendemail.ai` 的 Nginx VirtualHost 反向代理至 `127.0.0.1:8095` 與 `127.0.0.1:8096`（含 Let's Encrypt HTTPS 憑證與安全標頭）。
