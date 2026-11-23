# SendEmail.ai SaaS Platform

SendEmail.ai 是一套支援交易型郵件派發、批量信箱風險驗證、防退信抑制名單閉環與動態範本渲染的多租戶郵件基礎設施平台。

## 規範文件索引（Documentation）

* **[系統架構與安全基線規範 (`docs/ARCHITECTURE_AND_SECURITY.md`)](docs/ARCHITECTURE_AND_SECURITY.md)**：容器服務拓撲、核心資料表結構、雙端 SSRF 縱深防禦、Redis 分層速率限制與計費配額原子扣減規則。
* **[REST API 開發者規格書 (`docs/API_REFERENCE.md`)](docs/API_REFERENCE.md)**：認證方式、標準 HTTP 狀態碼（含 `402` 配額/點數不足與 `429` 限流）、發信、範本、驗證與抑制名單端點明細。
* **[OpenAPI 3.0 機器可讀規格 (`docs/openapi.yaml`)](docs/openapi.yaml)**：標準 OpenAPI 3.0.3 YAML 定義檔，可直接匯入 Postman、Insomnia 或自動化測試工具。

## 目錄結構

* `/api` — Express REST API 服務（端口 `8096`）
* `/worker` — BullMQ 非同步發信、信箱驗證與 Webhook 事件派發背景服務
* `/web` — Next.js 15 管理控制台（端口 `8095`）
* `/docs` — 系統架構、安全基線與 API 規範文件
