-- Run once after the first migration:  npm run db:extras   (idempotent, safe to re-run)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Approximate nearest-neighbour index for chatbot retrieval (cosine distance)
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Fast case-insensitive substring search (ILIKE '%q%') for the learning library & referrals
CREATE INDEX IF NOT EXISTS article_versions_title_trgm   ON "article_versions" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS article_versions_summary_trgm ON "article_versions" USING gin ("summary" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS referral_services_name_trgm   ON "referral_services" USING gin ("name" gin_trgm_ops);
