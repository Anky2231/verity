-- Round 3 groundwork (VisualGuard): approved logos/images per brand. Table only; no agent reads it yet.
CREATE TABLE brand_assets (
  id bigserial PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id),
  kind text NOT NULL CHECK (kind IN ('logo','image','palette')),
  filename text NOT NULL, mime text NOT NULL, data bytea,
  created_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX brand_assets_brand_idx ON brand_assets (brand_id);
