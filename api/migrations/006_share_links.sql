-- Round 3: read-only compliance report links for clients. Only a hash of the token is stored, so a database leak
-- does not hand out working links.
CREATE TABLE share_links (
  id bigserial PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  token_hash text NOT NULL UNIQUE,
  label text,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz);
CREATE INDEX share_links_brand_idx ON share_links (brand_id, created_at DESC);
