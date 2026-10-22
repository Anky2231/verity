export const ACTION_LABEL = {
  submit: 'Submit for approval', approve: 'Approve', escalate: 'Escalate to approver', reject: 'Reject',
  final_approve: 'Final approve', send_back: 'Send back', publish: 'Mark as published',
};
export const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', changes_requested: 'Changes requested', escalated: 'Escalated', approved: 'Approved', published: 'Published' };
export const TIPS = {
  confidence: 'How sure the agent is. Below 60% (or a higher cutoff for clauses reviewers often override) it is shown as a suggestion and does not lower the score.',
  severity: 'How serious the issue is under the brand guidelines: low, medium, high or critical.',
  score: 'Compliance score from 0 to 100. Each violation lowers it by its severity, weighted by confidence.',
  delta: 'Change in open flags compared with the previous revision. Negative is better.',
};
export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
