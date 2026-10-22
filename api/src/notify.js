import { sendEmail } from './mailer.js';

// In-app notification (always) + email (when SMTP is configured). Never throws into the request path.
export async function notify(db, { brandId, reviewId, userIds, message }) {
  try {
    for (const id of [...new Set(userIds)]) {
      const [u] = await db.query('SELECT email FROM users WHERE id=$1', [id]);
      if (!u) continue;
      const status = await sendEmail({ to: u.email, subject: `Verity: ${message.slice(0, 80)}`, text: message });
      await db.query('INSERT INTO notifications (brand_id, user_id, review_id, message, email_status) VALUES ($1,$2,$3,$4,$5)',
        [brandId, id, reviewId ?? null, message, status]);
    }
  } catch (e) { console.error('notify failed:', e.message); }
}

export const idsWithRole = async (db, roles) =>
  (await db.query('SELECT id FROM users WHERE role = ANY($1::text[])', [roles])).map((u) => u.id);
