// Review state machine. Pure, so it is trivially unit-testable and the UI/API share one truth.
export const RULES = [
  { action: 'submit',        from: ['draft', 'changes_requested'], to: 'submitted',         roles: ['creator', 'manager', 'admin'] },
  { action: 'approve',       from: ['submitted'],                  to: 'approved',          roles: ['manager', 'admin'] },
  { action: 'escalate',      from: ['submitted'],                  to: 'escalated',         roles: ['manager', 'admin'] },
  { action: 'reject',        from: ['submitted'],                  to: 'changes_requested', roles: ['manager', 'admin'], reason: true },
  { action: 'final_approve', from: ['escalated'],                  to: 'approved',          roles: ['approver', 'admin'] },
  { action: 'send_back',     from: ['escalated'],                  to: 'changes_requested', roles: ['approver', 'admin'], reason: true },
  { action: 'publish',       from: ['approved'],                   to: 'published',         roles: ['manager', 'approver', 'admin'] },
];

// -> { ok:true, rule } | { ok:false, status, error }
export function decide(action, status, role) {
  const known = RULES.filter((r) => r.action === action);
  if (!known.length) return { ok: false, status: 400, error: 'unknown_action' };
  const rule = known.find((r) => r.from.includes(status));
  if (!rule) return { ok: false, status: 409, error: 'invalid_state', detail: `cannot ${action} while ${status}` };
  if (!rule.roles.includes(role)) return { ok: false, status: 403, error: 'forbidden', required: rule.roles };
  return { ok: true, rule };
}

export const nextActions = (status, role) =>
  RULES.filter((r) => r.from.includes(status) && r.roles.includes(role)).map((r) => ({ action: r.action, reason: !!r.reason }));
