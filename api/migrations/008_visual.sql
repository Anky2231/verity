-- Round 3 (VisualGuard): approved and retired logos and palette colours per brand, and the images that were reviewed.
ALTER TABLE brand_assets DROP CONSTRAINT brand_assets_kind_check;
ALTER TABLE brand_assets ADD CONSTRAINT brand_assets_kind_check CHECK (kind IN ('logo','retired_logo','image','palette'));
ALTER TABLE brand_assets ADD COLUMN name text;     -- a palette colour's name, or a logo's display name
ALTER TABLE brand_assets ADD COLUMN hex text;      -- palette colours only, like #c77d0a

CREATE TABLE review_images (
  id bigserial PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES reviews(id),
  brand_id text NOT NULL REFERENCES brands(id),
  revision_number int NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  width int, height int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, revision_number));
