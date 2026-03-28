-- Migration: add case_notes table and attachment text/failure fields

-- Case notes (replaces in-memory NOTES_STORE)
CREATE TABLE IF NOT EXISTS "case_notes" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "case_id"    TEXT NOT NULL,
    "text"       TEXT NOT NULL,
    "author"     TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "case_notes_case_id_created_at_idx" ON "case_notes"("case_id", "created_at");

-- Outlook attachment: store extracted text and failure reason
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "extracted_text"       TEXT;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "parse_failure_reason" TEXT;
