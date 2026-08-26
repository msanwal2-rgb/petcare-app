-- The support assistant: conversations, turns, and the retrieval corpus.
-- Additive throughout: no drops, no renames.

-- pgvector, for the assistant's knowledge retrieval.
--
-- Installed into `public` deliberately. Prisma's *schema engine* sets
-- search_path to the target schema alone, which is why the column below is
-- written `public.vector(1536)` rather than `vector(1536)` — unqualified, it
-- fails with `type "vector" does not exist` when the test harness pushes this
-- schema into `test`. Installing once into `public` and qualifying at the use
-- site makes the type resolvable from `public`, `test` and `test_snapshot`.
--
-- Managed here in raw SQL rather than through Prisma's `postgresqlExtensions`
-- preview feature: that would put Prisma in charge of extension DDL in both
-- `migrate` and `db push` for no gain, when what is needed is one statement.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clientKey" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "modelId" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT NOT NULL DEFAULT '',
    "species" TEXT[],
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "embedding" public.vector(1536),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_userId_updatedAt_idx" ON "assistant_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "assistant_conversations_clientKey_createdAt_idx" ON "assistant_conversations"("clientKey", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_messages_conversationId_createdAt_idx" ON "assistant_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_sourceKey_key" ON "knowledge_chunks"("sourceKey");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_idx" ON "knowledge_chunks"("source");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Approximate nearest-neighbour index over the embeddings.
--
-- HNSW rather than IVFFlat: IVFFlat has to be trained on rows that already
-- exist and rebuilt whenever the corpus changes, and at a few hundred chunks
-- the list count that would make it work is smaller than the noise. HNSW
-- builds incrementally and needs no tuning. Cosine, because the embeddings
-- arrive unit-normalised.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" public.vector_cosine_ops);

-- The lexical half of the hybrid search. An expression index, which Prisma
-- cannot model, so it lives here and only here. Dense retrieval alone confuses
-- near-identical policy chunks ("cancel my booking" vs "cancel my order");
-- fusing it with full-text ranking is what separates them.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_fts_idx"
  ON "knowledge_chunks"
  USING gin (to_tsvector('english', "title" || ' ' || "content"));
