// Seeded demo accounts. Replaced by Postgres users table once Akriti's schema lands.
export const ROLES = ['creator', 'manager', 'approver', 'admin'];

export const DEMO_USERS = [
  { id: 'u_maya', name: 'Maya', email: 'maya@demo', role: 'creator' },
  { id: 'u_rajan', name: 'Rajan', email: 'rajan@demo', role: 'manager' },
  { id: 'u_anita', name: 'Anita', email: 'anita@demo', role: 'approver' },
  { id: 'u_admin', name: 'Admin', email: 'admin@demo', role: 'admin' },
];
