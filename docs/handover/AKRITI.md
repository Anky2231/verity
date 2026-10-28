# Task for Akriti: prove the backend on a real PostgreSQL

**Why this matters.** Every API test so far ran on PGlite, an in-process Postgres. Round 3 added four migrations (005 to 008)
and many queries that have **never run on a real Postgres server** like Neon, which is what production uses. Real Postgres
behaves differently in small ways (for example it returns `bigint` ids as strings). Finding those before judges do is the most
valuable thing anyone can do now. You designed the schema and endpoints, so this is your area.

**Rules.** Work on a branch, open a pull request, and describe only what you actually did and saw. Do **not** point anything at the
live (production) database.

## 1. Set up (about 20 minutes)
```bash
git clone https://github.com/Swas00/verity.git && cd verity
git checkout -b feat/postgres-verification
cd api && npm install
```
Get a **separate, empty** Postgres to test on. Free options: a new project on https://neon.tech (not the project Verity uses),
or Postgres in Docker (`docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:16`), or a local install. Never use the
production `DATABASE_URL`.

## 2. Run the whole API suite on it
```bash
TEST_DATABASE_URL='postgres://user:pass@host:5432/dbname?sslmode=require' npm test
```
Each test file creates its own schema inside that database, so it is safe on an empty database. Expect 102 passing and 4 skipped.
Anything that fails only on real Postgres is a bug worth fixing. Likely suspects to look at first:
- `bigint` columns (`id`, `review_id`) come back from `pg` as **strings**, not numbers. Look for `===` comparisons, `Number(...)` and JSON shapes in `api/src/routes/*.js` and the tests.
- `bytea` columns (logos, reviewed images) come back as `Buffer`; PGlite returns a `Uint8Array`.
- `ILIKE`, `date_trunc('week', ...)`, `LATERAL` joins, `ON CONFLICT` in `api/src/routes/reviews.js`, `api/src/drift-store.js`, `api/src/report.js`.
- Migration `008_visual.sql` drops a constraint by name (`brand_assets_kind_check`). Confirm that name exists on real Postgres.
For each fix: one small commit with a message saying what differed and how you found it.

## 3. Run the server on it and click through
```bash
DATABASE_URL='postgres://...same test db...' PGSSL=1 PORT=4000 AI_SERVICE_URL=http://127.0.0.1:8000 node src/index.js
```
(start the AI service first: `cd ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m uvicorn app.main:app --port 8000`).
Check, and write down the result of each:
- it starts, applies migrations 001 to 008, and seeds without error (look at the log);
- `GET /brands`, `GET /drift` (as manager), `GET /brand-assets` work; Social is `drifting`;
- `GET /audit/verify` says `ok: true` for both brands;
- restart the server: nothing is seeded twice (review count stays the same).

## 4. Short security review of the Round 3 routes (about 1 hour)
Try to break these and report what happened (it is fine, and valuable, to find nothing):
- `POST /share-links` then `GET /public/report/<token>`: wrong tokens, an expired link, a revoked link (all should be the same 404); more than 60 requests a minute (should be 429).
- `POST /reviews/:id/image` and `POST /brand-assets`: a file that is not an image, an SVG, a very large file, a PDF renamed `.png`.
- A user in one brand using another brand's id in `X-Brand-Id`, and another brand's review id (should be 403 or 404, never data).
Write findings in `docs/SECURITY_REVIEW.md`: what you tried, what happened, anything to fix. Fix small things; list the rest.

## What to hand back
A pull request with: any fixes (one commit each), `docs/SECURITY_REVIEW.md`, and a short comment with the exact commands you ran and the results.
Swastik will review it, run it, and write your line in the README team table from what your commits contain.
