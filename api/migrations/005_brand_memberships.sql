-- Round 3 (multi-brand workspaces): a user's role is now per brand. users.role stays as the user's default role.
CREATE TABLE brand_memberships (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  brand_id text NOT NULL REFERENCES brands(id),
  role text NOT NULL CHECK (role IN ('creator','manager','approver','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand_id));
CREATE INDEX brand_memberships_brand_idx ON brand_memberships (brand_id);
