-- Verity core schema. Every domain table carries brand_id so Multi-Brand (Round 3) is a UI change, not a migration.
CREATE TABLE orgs   (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE brands (id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), name text NOT NULL);
CREATE TABLE users  (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id),
  name text NOT NULL, email text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('creator','manager','approver','admin')));

CREATE TABLE big_versions (
  id bigserial PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id),
  version int NOT NULL, data jsonb NOT NULL,
  created_by text REFERENCES users(id), published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, version));

CREATE TABLE reviews (
  id bigserial PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id),
  big_version int NOT NULL, title text NOT NULL, content_type text NOT NULL DEFAULT 'blog',
  creator_id text NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','changes_requested','escalated','approved','published')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reviews_status_idx ON reviews (brand_id, status);

CREATE TABLE revisions (
  id bigserial PRIMARY KEY, review_id bigint NOT NULL REFERENCES reviews(id),
  brand_id text NOT NULL, number int NOT NULL, text text NOT NULL,
  score int, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, number));

CREATE TABLE flag_decisions (
  id bigserial PRIMARY KEY, review_id bigint NOT NULL REFERENCES reviews(id),
  revision_number int NOT NULL, brand_id text NOT NULL,
  flag_key text NOT NULL, rule_id text, agent text, quoted_text text,
  decision text NOT NULL CHECK (decision IN ('accepted','disputed','overridden','manual')),
  reason text, actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE comments (
  id bigserial PRIMARY KEY, review_id bigint NOT NULL REFERENCES reviews(id), brand_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id), body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

-- Append-only, hash-chained per brand: tampering with any row breaks every later hash.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, brand_id text NOT NULL, review_id bigint,
  actor_id text, actor_role text, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  ts text NOT NULL, prev_hash text NOT NULL, hash text NOT NULL,
  UNIQUE (brand_id, prev_hash));  -- forbids forking the chain under concurrency

CREATE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
