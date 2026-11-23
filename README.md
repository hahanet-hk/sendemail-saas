# SendEmail.ai — Email Delivery & DAG Automation Platform

Pre-verified email delivery engine with dual-stack SMTP routing, bounce/FBL circuit breakers, and BullMQ DAG workflow automation.

## 1. System Architecture
- **Frontend (`sendemail-web`)**: Next.js web console (`https://app.sendemail.ai`)
- **Backend API (`sendemail-api`)**: Node.js REST API (`127.0.0.1:8096`) handling authentication, beta invite guards, and campaign/transactional dispatch
- **Worker (`sendemail-worker`)**: BullMQ asynchronous job processor
- **Mail Engine (`php-site-03`)**: MailWizz core handling DKIM signing, transactional queues, and bounce/FBL processing
- **MTA (`Postfix`)**: Host-level dual-stack (IPv4 & IPv6) outbound delivery and local port `2525` bounce ingestion
- **Data Layer**: MariaDB & Redis

## 2. Quick Deployment
1. Copy the sanitized environment template and fill in credentials:
   ```bash
   cp .env.example .env
   ```
2. Build and start all services:
   ```bash
   docker compose up -d --build
   ```

## 3. Operations & Beta Access Control
- **Beta Invite Guard (`BETA_INVITE_CODE`)**: Set `BETA_INVITE_CODE` in `.env` to restrict public sign-ups to invited testers without affecting existing admin or user logins. Leave empty and run `docker compose up -d sendemail-api` to open public registration.
- **Host Cron Schedules**: Managed via `/etc/cron.d/mailwizz-sendemail` (runs `send-campaigns`, `queue`, and `send-transactional-emails` every minute).
- **Mail Delivery Logs**:
  ```bash
  tail -f /var/log/mail.log
  ```

## 4. Documentation Index
- **[Mail Infrastructure & Auth Handover](docs/MAIL_INFRA_HANDOVER.md)**: DNS/FCrDNS records, Postfix dual-stack configuration, Cloudflare Email Routing, cron jobs, and verification flows.
- **[Architecture Context](docs/ARCHITECTURE_CONTEXT.md)**: Core platform design and service boundaries.
