import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// DATABASE_URL -> real Postgres (Railway). Otherwise PGlite (real Postgres in WASM) so
// local dev and tests need no Docker. Both expose: query(sql, params) -> rows, exec(sql), close().
export async function openDb({ url = process.env.DATABASE_URL, dir = process.env.PGLITE_DIR } = {}) {
  let db;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
    db = { kind: 'pg', query: async (t, p) => (await pool.query(t, p)).rows, exec: (s) => pool.query(s), close: () => pool.end() };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(dir || undefined);
    await lite.waitReady;
    db = { kind: 'pglite', query: async (t, p) => (await lite.query(t, p)).rows, exec: (s) => lite.exec(s), close: () => lite.close() };
  }
  await migrate(db);
  return db;
}

export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
}
