import fs from 'node:fs';
import { DEMO_USERS } from './users.js';

const BIG = JSON.parse(fs.readFileSync(new URL('../seed/lumina_big.json', import.meta.url), 'utf8'));
const asset = (name) => fs.readFileSync(new URL(`../seed/assets/${name}`, import.meta.url));
const NORTHWIND_BIG = JSON.parse(fs.readFileSync(new URL('../seed/northwind_big.json', import.meta.url), 'utf8'));

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
  // Each demo user belongs to Lumina with their default role.
  for (const u of DEMO_USERS)
    await db.query(`INSERT INTO brand_memberships (user_id, brand_id, role) VALUES ($1,'lumina',$2) ON CONFLICT DO NOTHING`, [u.id, u.role]);
  await db.query(`INSERT INTO big_versions (brand_id, version, data, created_by) VALUES ('lumina', 1, $1, 'u_rajan') ON CONFLICT DO NOTHING`,
    [JSON.stringify(BIG)]);
  // Northwind Tea Co.: a second brand with its own guidelines. Roles differ per brand on purpose:
  // Maya is a creator at Lumina but a manager at Northwind, Rajan the other way round.
  await db.query(`INSERT INTO big_versions (brand_id, version, data, created_by) VALUES ('northwind', 1, $1, 'u_rajan') ON CONFLICT DO NOTHING`,
    [JSON.stringify(NORTHWIND_BIG)]);
  const northwind = { u_rajan: 'creator', u_maya: 'manager', u_anita: 'approver', u_admin: 'admin' };
  for (const [userId, role] of Object.entries(northwind))
    await db.query(`INSERT INTO brand_memberships (user_id, brand_id, role) VALUES ($1,'northwind',$2) ON CONFLICT DO NOTHING`, [userId, role]);
  await seedAssets(db);
}

// Each brand's asset library: its current logo, (for Lumina) the retired 2019 logo, and the palette VisualGuard checks against.
const LIBRARY = {
  lumina: {
    palette: [['Amber', '#c77d0a'], ['Roast brown', '#4b2e1e'], ['Cream', '#f5ebdd'], ['Charcoal', '#222222']],
    logos: [['logo', 'Lumina logo', 'lumina_logo.png'], ['retired_logo', 'Lumina logo (2019, retired)', 'lumina_logo_2019.png']],
  },
  northwind: {
    palette: [['Tea green', '#3f6b4a'], ['Leaf', '#8fb58a'], ['Steam white', '#f4f7f2'], ['Slate', '#2a3a35']],
    logos: [['logo', 'Northwind logo', 'northwind_logo.png']],
  },
};

async function seedAssets(db) {
  for (const [brand, lib] of Object.entries(LIBRARY)) {
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM brand_assets WHERE brand_id=$1', [brand]);
    if (n > 0) continue;   // only the first time: managers may have changed the library since
    for (const [name, hex] of lib.palette)
      await db.query(`INSERT INTO brand_assets (brand_id, kind, filename, mime, name, hex, created_by) VALUES ($1,'palette',$2,'text/plain',$2,$3,'u_rajan')`, [brand, name, hex]);
    for (const [kind, name, file] of lib.logos)
      await db.query(`INSERT INTO brand_assets (brand_id, kind, filename, mime, data, name, created_by) VALUES ($1,$2,$3,'image/png',$4,$5,'u_rajan')`, [brand, kind, file, asset(file), name]);
  }
}
