# ChatLog WhatsApp automation (local)

Run the FastAPI service on your machine with a **visible** Chrome window so WhatsApp Web can show a scannable QR code. The hosted Render stack often fails in headless mode; local is the reliable path for linking.

## Prerequisites

- **Python 3.9+** (code avoids `str | None` syntax so 3.9 works). **3.12** recommended: `python3.12 -m venv .venv` if your default `python3` is old.
- **Google Chrome** installed (macOS path below). Selenium 4 can use **Selenium Manager** to download a matching ChromeDriver when `CHROMEDRIVER_PATH` is unset.
- Repo path: adjust commands if your clone is not `~/Documents/ChatLog`.

## One-time setup

```bash
cd /Users/testuser/Documents/ChatLog/whatsapp-service

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
```

Edit **`.env`**:

| Variable | Local value |
|----------|-------------|
| `CHATLOG_AUTOMATION_SECRET` | Long random string (same as Next.js). |
| `WHATSAPP_SESSION_DIR` | e.g. `/Users/testuser/Documents/ChatLog/whatsapp-service/data/wa_sessions` (folder is created automatically). |
| `RENDER` | **Do not set** (so the browser is not forced headless). |
| `HEADLESS` | Leave unset for visible Chrome; set `HEADLESS=1` only if you want headless locally. |

**Wrong for local:** `WHATSAPP_SESSION_DIR=/var/data/...` (that path is for Linux servers with a disk). **Wrong:** `SUPABASE_URL=dlgghobviszabmitknmb` — Supabase URLs must be `https://dlgghobviszabmitknmb.supabase.co`.

If Chrome is not detected, set:

```bash
CHROME_BIN=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

## Run the API (do this **before** `npm run dev`)

If you skip this step, the web app will show **502** and `fetch failed` — Next.js cannot open WhatsApp; only this service can.

```bash
cd /Users/testuser/Documents/ChatLog/whatsapp-service
source .venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Verify from any terminal:

```bash
curl -s http://127.0.0.1:8000/health
```

→ `{"status":"ok"}` (should return immediately). If you previously saw `TypeError: unsupported operand type(s) for |`, pull the latest code (Python 3.9–compatible types) or use Python 3.12 for the venv.

## Run the Next.js app (separate terminal)

```bash
cd /Users/testuser/Documents/ChatLog/web
cp .env.local.example .env.local
# Edit .env.local: Supabase keys + CHATLOG_AUTOMATION_URL=http://127.0.0.1:8000 + same CHATLOG_AUTOMATION_SECRET as whatsapp-service/.env

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, go to **Dashboard → Settings**, start the linking session. A **Chrome** window should open on your Mac; scan the QR from **WhatsApp → Settings → Linked devices**.

## Security

Never commit `.env` or `.env.local`. If secrets were pasted into chat or tickets, **rotate** them in Supabase, OpenRouter, Resend, etc.
