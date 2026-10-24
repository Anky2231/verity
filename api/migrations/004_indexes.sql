-- Indexes for the queries the API actually runs; each one was measured and kept only if it helped with scripts/bulk-seed.js (see docs/DATABASE.md).
CREATE INDEX IF NOT EXISTS audit_review_idx      ON audit_log (review_id, id);
CREATE INDEX IF NOT EXISTS decisions_review_idx  ON flag_decisions (review_id);
CREATE INDEX IF NOT EXISTS comments_review_idx   ON comments (review_id);
CREATE INDEX IF NOT EXISTS reviews_creator_idx   ON reviews (creator_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS reviews_updated_idx   ON reviews (brand_id, updated_at DESC);
