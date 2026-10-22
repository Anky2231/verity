CREATE TABLE notifications (
  id bigserial PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id),
  user_id text NOT NULL REFERENCES users(id), review_id bigint REFERENCES reviews(id),
  message text NOT NULL, read boolean NOT NULL DEFAULT false,
  email_status text NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('sent','skipped','failed')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_user_idx ON notifications (user_id, read, id DESC);
