-- Live progress + ETA fields for catalog sync, feed runs, and change apply.

-- CatalogSync
ALTER TABLE "CatalogSync"
  ADD COLUMN "progressPhase" TEXT,
  ADD COLUMN "progressDone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressTotal" INTEGER NOT NULL DEFAULT 0;

-- FeedRun
ALTER TABLE "FeedRun"
  ADD COLUMN "progressPhase" TEXT,
  ADD COLUMN "progressDone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressTotal" INTEGER NOT NULL DEFAULT 0;

-- ChangeSet
ALTER TABLE "ChangeSet"
  ADD COLUMN "itemsTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "itemsDone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3);
