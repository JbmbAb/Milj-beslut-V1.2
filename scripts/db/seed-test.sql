-- Minimal seed for E2E tests

-- 1. Create a test organisation
INSERT INTO "Organisation" ("id", "name", "orgNumber", "createdAt")
VALUES ('clxodd5f1000008jp365h3a9t', 'E2E Test Org', '556677-8899', NOW())
ON CONFLICT DO NOTHING;

-- 2. Create the specific project needed for exec-summary.spec.ts
INSERT INTO "Project" ("id", "organisationId", "propertyDesignation", "status", "createdAt")
VALUES ('clxodd6wg000008l463w1d2f4', 'clxodd5f1000008jp365h3a9t', 'Testfastighet 1:1', 'ACTIVE', NOW())
ON CONFLICT DO NOTHING;

-- Add other necessary seed data below if other tests require it.