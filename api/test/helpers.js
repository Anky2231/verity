import crypto from 'node:crypto';
import { openDb } from '../src/db.js';

// Default: in-process Postgres (PGlite). With TEST_DATABASE_URL set, the same tests run against a real
// Postgres server, each database isolated in its own schema so test files can run in parallel.
export async function freshDb() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return openDb({ url: '' });
  const schema = `t_${crypto.randomBytes(6).toString('hex')}`;
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: base });
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`); await admin.end();
  const url = new URL(base); url.searchParams.set('options', `-c search_path=${schema}`);
  return openDb({ url: url.toString() });
}
