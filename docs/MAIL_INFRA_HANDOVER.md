# SendEmail.ai 郵件與驗證基礎設施交接文件

## 1. 基礎設施與容器拓撲
- **VPS 主機**：Hostinger VPS (`srv2039125`) — IPv4: `201.18.217.101` / IPv6: `2a02:4780:5e:3a29::1`
- **核心容器**：
  - `sendemail-web`：前端應用 (`https://app.sendemail.ai`)
  - `sendemail-api`：核心 API (`127.0.0.1:8096`)
  - `sendemail-worker`：BullMQ 佇列處理器
  - `php-site-03`：MailWizz 郵件引擎（DKIM 簽章、交易信佇列、退信與排程）
  - `global-mariadb` / `global-redis`：資料庫與佇列儲存
- **宿主機 Postfix MTA**：負責外部雙協定 SMTP 投遞與本機 Port 2525 退信接收

## 2. DNS 與 FCrDNS 三向一致性 (Cloudflare & Hostinger)
- **A / AAAA (`mail.sendemail.ai`)**：`201.18.217.101` / `2a02:4780:5e:3a29::1`（灰雲 DNS only）
- **PTR (IPv4 & IPv6 rDNS)**：`mail.sendemail.ai.`
- **Postfix (`/etc/postfix/main.cf`)**：`myhostname = mail.sendemail.ai`、`smtp_bind_address = 201.18.217.101`、`smtp_bind_address6 = 2a02:4780:5e:3a29::1`
- **SPF (`sendemail.ai`)**：`v=spf1 ip4:201.18.217.101 ip6:2a02:4780:5e:3a29::1 include:_spf.mx.cloudflare.net ~all`
- **DKIM (`mail._domainkey`) & DMARC (`_dmarc`)**：已啟用並與 MailWizz 對齊
- **MX (`sendemail.ai`)**：`route1` / `route2` / `route3.mx.cloudflare.net`（`support@` 與 `abuse@` 轉寄至 `hahanet02@gmail.com`，Catch-all 關閉）
- **MX (`b.sendemail.ai`)**：指向 `mail.sendemail.ai` 接收外部退信

## 3. 自動化排程 (`/etc/cron.d/mailwizz-sendemail`)
- 每分鐘 (`* * * * *`)：`send-campaigns`、`queue`、`send-transactional-emails`
- 定期執行：`bounce-handler` (`*/2`)、`process-delivery-and-bounce-log` (`*/3`)、`feedback-loop-handler` (`*/10`)、`hourly` (`0 *`)、`daily` (`0 0`)

## 4. 註冊驗證與封測邀請碼控制機制
- **樂觀式註冊與驗證解鎖 (`api/routes_auth_security.js`)**：
  - 新用戶註冊成功時先建立帳號並給予基礎沙盒額度（`email_verified=0`、`monthly_quota=50`、`credit_balance=50`），同時非同步寄出 `Verify your SendEmail.ai account` 驗證信。
  - 點擊 `https://app.sendemail.ai/api/v1/auth/verify-email?token=...` 後，自動將 `email_verified` 設為 `1` 並解鎖 `1,000` 封正式月發信額度。
- **封測邀請碼限制 (`BETA_INVITE_CODE`)**：
  - 設定檔位置：`/home/docker-apps/sendemail-saas/.env`（目前預設值：`BETA_INVITE_CODE=SendEmailBeta2026`）。
  - 作用範圍：僅攔截未提供正確 `invite_code` 的新帳號註冊請求（回傳 `403 INVITE_CODE_REQUIRED`）；既有 Admin 與已註冊用戶登入（`/api/v1/auth/login`）完全不受影響。
  - 正式開放註冊方式：將 `.env` 中的 `BETA_INVITE_CODE=` 清空並執行 `docker compose up -d sendemail-api` 即可全面開放公開註冊。
