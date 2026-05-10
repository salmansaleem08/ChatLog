# ChatLog

Internal product repository. Do not commit secrets; use `.env.example` as the checklist only.

## Git remote and push

This repo already has commits on `main`. You do **not** need `git init` or a duplicate “first commit.”

1. Confirm the remote (already configured for this project):

   ```bash
   git remote -v
   ```

   Expected: `origin` → `https://github.com/salmansaleem08/ChatLog.git`

2. Push from your machine (GitHub must show **your** account as author — use your usual login/SSH or HTTPS credentials):

   ```bash
   git branch -M main
   git push -u origin main
   ```

If GitHub shows an empty repo warning, use the steps above once; do not re-run the generic “echo README” flow from GitHub if it would overwrite your existing history.

## Deploy — Vercel (frontend: `web/`)

1. Import this GitHub repo in [Vercel](https://vercel.com).
2. Set **Root Directory** to **`web`**.
3. Framework: Next.js (auto-detected).
4. Add **environment variables** (Production / Preview as needed):

| Name | Notes |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret — server only |
| `RESEND_API_KEY` | If transactional email is sent from the Next.js app |
| `GEMINI_API_KEY` | If server-side routes call Gemini |
| `OPENROUTER_API_KEY` | If server-side routes call OpenRouter |

5. Deploy. Build command: `npm run build` (default inside `web/`).

## Deploy — Render (Python service: `whatsapp-service/`)

1. New **Web Service** from this repo, or use `render.yaml` if you use Blueprints.
2. **Root Directory**: **`whatsapp-service`**.
3. **Build**: `pip install -r requirements.txt`
4. **Start**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Health check path**: `/health`
6. Add **environment variables**:

| Name | Notes |
|------|--------|
| `GEMINI_API_KEY` | If this service calls Gemini |
| `OPENROUTER_API_KEY` | If this service calls OpenRouter |
| `SUPABASE_URL` | Same value as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | If the service writes to Supabase server-side |

Render sets **`PORT`** automatically — do not hardcode it.

## Where each variable lives

| Variable | Vercel (`web/`) | Render (`whatsapp-service/`) |
|----------|-----------------|------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | No (use `SUPABASE_URL` below for Python) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (if Next uses admin APIs) | Yes (if Python uses admin APIs) |
| `SUPABASE_URL` | No | Yes (duplicate URL value, non-public name for backends) |
| `RESEND_API_KEY` | Yes (if mail from Next.js) | Only if mail from Python |
| `GEMINI_API_KEY` | Yes (if AI from Next.js) | Yes (if AI from Python) |
| `OPENROUTER_API_KEY` | Yes (if AI from Next.js) | Yes (if AI from Python) |

Until features are wired, you can add only Supabase + the keys you actually use on each platform.
