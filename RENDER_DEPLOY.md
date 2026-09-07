# SK Agent — Deploy to Render (Free Tier)

## What you need
- GitHub account (free)
- Render account (free) → https://render.com

---

## Step 1 — Push code to GitHub

1. Go to https://github.com/new → create a **private** repo (keep your API keys safe)
2. Open a terminal in the `whatapp automation` folder and run:

```bash
git init
git add .
git commit -m "SK Agent initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

> Make sure `.env` is in `.gitignore` (it already is) — never push real API keys.

---

## Step 2 — Create Web Service on Render

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect your GitHub account → select your repo
4. Render auto-detects `render.yaml` — it will show the settings pre-filled
5. Click **Create Web Service**

---

## Step 3 — Set Environment Variables (secrets)

In Render Dashboard → your service → **Environment** tab, add:

| Key | Value |
|-----|-------|
| `GROQ_API_KEY` | your Groq key |
| `GROQ_API_KEY1` | your Groq key 1 |
| `GROQ_API_KEY2` | your Groq key 2 |
| `GROQ_API_KEY3` | your Groq key 3 |
| `GEMINI_API_KEY` | your Gemini key |
| `GEMINI_API_KEY2` | your Gemini key 2 |
| `GEMINI_API_KEY3` | your Gemini key 3 |

> `RENDER_EXTERNAL_URL` is set automatically by Render — do NOT add it manually.

---

## Step 4 — First deploy & scan QR

1. Wait for build to finish (~5-10 min first time, Docker pulls Chromium)
2. Click **Logs** tab — watch for:
   ```
   [WhatsApp] ✅ Ready — Mr. Suraj Zalke
   ```
   OR:
   ```
   [WhatsApp] Scan QR code to login:
   ```
3. If QR appears in logs, you need to scan it once:
   - The QR is printed as ASCII in logs — hard to scan
   - Also open: `https://YOUR-SERVICE.onrender.com/health`
   - Better: temporarily expose the dashboard by noting the URL

> **After first QR scan**, the session is saved to the persistent disk (`/app/.wwebjs_auth`).
> You will **never need to scan QR again** unless you manually clear the disk.

---

## Step 5 — Verify keepalive is working

In logs you should see every ~10-12 minutes:
```
[Keepalive] Ping → https://YOUR-SERVICE.onrender.com/health — 200
```

This prevents Render's free tier from sleeping.

---

## Render Free Tier Limits

| Resource | Limit |
|----------|-------|
| RAM | 512 MB |
| CPU | Shared |
| Bandwidth | 100 GB/month |
| Sleep | Never (with self-ping) |
| Persistent disk | 1 GB (stores WhatsApp session) |

---

## Troubleshooting

**Build fails — Chromium not found**
→ The Dockerfile installs it via apt. Check build logs for apt errors.

**"Session not found" after redeploy**
→ The disk at `/app/.wwebjs_auth` persists across deploys. If it's missing, re-scan QR once.

**Bot replies slowly (first message after a long time)**
→ Self-ping is working but Render cold-start can still take 10-30s on first hit.
→ Solution: upgrade to Render Starter ($7/mo) for always-on.

**Memory crash (OOM)**
→ Puppeteer is heavy. If 512MB isn't enough, add this to `.env` on Render:
```
NODE_OPTIONS=--max-old-space-size=400
```
