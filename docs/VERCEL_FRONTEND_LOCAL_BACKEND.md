# Vercel (Next.js) + automation on your computer

You can deploy **only the web app** to Vercel and run **FastAPI + Selenium + Chrome** on your own Mac or PC. The browser never talks to your machine directly for secrets: Next.js **API routes** on Vercel call your backend over HTTPS.

## The constraint

Vercel cannot open `http://127.0.0.1:8000` on your laptop. You must expose that port to the internet with a **tunnel** (HTTPS URL) while you work.

## Flow

1. User opens **chat-log-livid.vercel.app** (or your domain).
2. Dashboard calls **`/api/whatsapp/session/*`** on Vercel (same origin).
3. Vercel’s serverless function reads `CHATLOG_AUTOMATION_URL` and **`fetch`es your tunnel** with `X-ChatLog-Secret`.
4. Your machine runs **uvicorn**; Selenium opens Chrome; QR / status respond through the tunnel.

## Step-by-step

### 1. Run the automation API locally

```bash
cd whatsapp-service
source .venv/bin/activate
# CHATLOG_AUTOMATION_SECRET must be set in whatsapp-service/.env
uvicorn main:app --host 127.0.0.1 --port 8000
```

Confirm: `curl -s http://127.0.0.1:8000/health` → `{"status":"ok"}`.

Use **`--host 127.0.0.1`** (default) so only your machine listens; the tunnel forwards in.

### 2. Start an HTTPS tunnel to port 8000

Pick one:

| Tool | Notes |
|------|--------|
| [ngrok](https://ngrok.com/) | `ngrok http 8000` — free URLs change when you restart unless you pay for a reserved domain. |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) | Can use a stable subdomain on your zone. |
| [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/) | If you already use Tailscale. |

Example with ngrok:

```bash
ngrok http 8000
```

Copy the **https** forwarding URL, e.g. `https://abc123.ngrok-free.app` (no trailing slash required).

### 3. Configure Vercel

In **Project → Settings → Environment Variables** (Production and Preview as needed):

| Name | Value |
|------|--------|
| `CHATLOG_AUTOMATION_URL` | Your tunnel URL, e.g. `https://abc123.ngrok-free.app` |
| `CHATLOG_AUTOMATION_SECRET` | Same long random string as in `whatsapp-service/.env` |

Redeploy after saving (or trigger a new deployment).

**Do not** set `CHATLOG_AUTOMATION_URL` to `localhost` in Vercel — it will not reach your computer.

### 4. Keep Supabase env on Vercel

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and any server keys you use must stay set on Vercel as today.

### 5. Day-to-day usage

1. Start **uvicorn** (automation).
2. Start **ngrok** (or your tunnel) pointing at **8000**.
3. If the tunnel URL **changed**, update **`CHATLOG_AUTOMATION_URL`** on Vercel and redeploy (or use a paid/stable tunnel).
4. Use the **production** site; WhatsApp linking hits your local Chrome.

When you stop the tunnel or uvicorn, production **Settings → WhatsApp** will error until they are running again.

## Security

- **`CHATLOG_AUTOMATION_SECRET`** is required: treat it like a password. Anyone who guesses your tunnel URL still needs this header.
- Your tunnel exposes **only** what uvicorn serves; keep dependencies updated and do not commit `.env`.
- For stronger isolation, use a tunnel product that supports **access controls** or run automation on a small VPS instead of your laptop when you outgrow this setup.

## Local Next.js vs Vercel

- **Local dev:** `web/.env.local` can use `CHATLOG_AUTOMATION_URL=http://127.0.0.1:8000` (no tunnel).
- **Vercel:** must use the **public tunnel** URL.

You can keep both: different values in `.env.local` (local) vs Vercel dashboard (production).
