// Email is optional: with SMTP_URL set we send real mail; otherwise the in-app notification is the delivery channel.
let transport;
export async function sendEmail({ to, subject, text }) {
  if (!process.env.SMTP_URL) return 'skipped';
  try {
    if (!transport) transport = (await import('nodemailer')).default.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: process.env.MAIL_FROM || 'Verity <no-reply@verity.local>', to, subject, text });
    return 'sent';
  } catch (e) { console.error('mail failed:', e.message); return 'failed'; }
}
