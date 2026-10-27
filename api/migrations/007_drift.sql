-- Round 3 (Brand Drift Intelligence): which team a person writes for, and one stored digest per brand per week.
ALTER TABLE brand_memberships ADD COLUMN team text;

-- One row per brand and analysis week. The unique key is what makes the weekly digest, and the alerts it sends, happen once.
CREATE TABLE drift_digests (
  id bigserial PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id),
  week text NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, week));
