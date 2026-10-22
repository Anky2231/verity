import fs from 'node:fs';
import { DEMO_USERS } from './users.js';

const BIG = JSON.parse(fs.readFileSync(new URL('../seed/lumina_big.json', import.meta.url), 'utf8'));

// Idempotent: safe to run on every boot.
export async function seed(db) {
  await db.query(`INSERT INTO orgs (id, name) VALUES ('org_demo', 'Demo Org') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO brands (id, org_id, name) VALUES ('lumina', 'org_demo', 'Lumina Coffee Co.') ON CONFLICT DO NOTHING`);
  // Second brand row only: proves brand_id isolation is in the schema. No BIG, users or UI for it yet (Round 3).
  await db.query(`INSERT INTO brands (id, org_id, name) VALUES ('northwind', 'org_demo', 'Northwind Tea Co.') ON CONFLICT DO NOTHING`);
  for (const u of DEMO_USERS) {
    await db.query(`INSERT INTO users (id, org_id, name, email, role) VALUES ($1,'org_demo',$2,$3,$4) ON CONFLICT DO NOTHING`,
      [u.id, u.name, u.email, u.role]);
  }
  await db.query(`INSERT INTO big_versions (brand_id, version, data, created_by) VALUES ('lumina', 1, $1, 'u_rajan') ON CONFLICT DO NOTHING`,
    [JSON.stringify(BIG)]);
}
