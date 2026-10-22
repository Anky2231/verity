# Day-0 deploy checklist (do this TODAY, before writing features)

Three services, deployed from one GitHub monorepo.

## 1. Push to GitHub
```bash
git init && git add . && git commit -m "Scaffold" && git branch -M main
git remote add origin <your-repo-url> && git push -u origin main
```

## 2. API → Railway
- New project → Deploy from GitHub → **Root directory: `api`**
- Add a **PostgreSQL** plugin and set `DATABASE_URL` from it (without it the API uses in-memory storage and loses data on restart).
- Variables: `JWT_SECRET` (long random), `WEB_ORIGIN` (Vercel URL, set after step 4), `AI_SERVICE_URL` (private/public URL of ai service), `AI_SERVICE_TOKEN`, `DATABASE_URL`
- Optional: `SMTP_URL` + `MAIL_FROM` for real email; `RUN_LIMIT_PER_MIN`; `SEED_HISTORY=off`
- Check `https://<api-url>/health`

## 3. AI service → Railway
- New service from same repo → **Root directory: `ai`**
- Variables: `AI_SERVICE_TOKEN` (same as api). Optional: `ANTHROPIC_API_KEY` + `MODEL_FAST` (otherwise ToneGuard runs in labelled basic mode). If you add a key, set a spend cap in the Anthropic console first.
- Check `https://<ai-url>/health`

## 4. Web → Vercel
- Import repo → **Root directory: `web`**, framework Next.js
- Variable: `NEXT_PUBLIC_API_URL` = API URL from step 2
- Then set the API's `WEB_ORIGIN` to the Vercel URL and redeploy API.

## 5. Verify
Open the Vercel URL → both status badges show `up` → **Start judge walkthrough** opens the guideline page as Manager. Then run `docs/QA_SCRIPT.md`.

## Keep it warm
Redis is not used in this build. Use an always-on plan, or set the GitHub repository variables `WEB_URL` and `API_URL` so `.github/workflows/keepalive.yml` pings both every 10 minutes. After deploying, leave it idle for an hour and open the URL once to confirm there is no cold start.
