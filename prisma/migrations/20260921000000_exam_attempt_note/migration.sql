-- "Points to be Noted": the student's own note on a result. Additive and nullable.
ALTER TABLE "ExamAttempt"
  ADD COLUMN IF NOT EXISTS "studentNote" TEXT,
  ADD COLUMN IF NOT EXISTS "noteUpdatedAt" TIMESTAMP(3);
