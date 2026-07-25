-- Minimal seed for E2E tests

-- 1. Create a test organisation
INSERT INTO "Organisation" ("id", "name", "orgNumber", "createdAt")
VALUES ('clxodd5f1000008jp365h3a9t', 'E2E Test Org', '556677-8899', NOW())
ON CONFLICT DO NOTHING;

-- 2. Create the specific project needed for E2E (matches tests/e2e/support.ts E2E_SEEDED_PROJECT_ID)
INSERT INTO "Project" ("id", "organisationId", "propertyDesignation", "status", "createdAt")
VALUES ('test-project-001', 'clxodd5f1000008jp365h3a9t', 'Testfastighet 1:1', 'ACTIVE', NOW())
ON CONFLICT DO NOTHING;

-- Add other necessary seed data below if other tests require it.