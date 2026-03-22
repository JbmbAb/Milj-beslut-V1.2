BEGIN;

DELETE FROM "ProjectMember"
WHERE "projectId" IN (
        SELECT "id" FROM "Project" WHERE "organisationId" = 'test-org-001'
      )
   OR "projectId" = 'test-project-001'
   OR "userId" IN ('test-user-admin-001', 'test-user-consultant-001');

DELETE FROM "Project"
WHERE "id" = 'test-project-001'
   OR "organisationId" = 'test-org-001';

DELETE FROM "User"
WHERE "id" IN ('test-user-admin-001', 'test-user-consultant-001')
   OR "bankidId" IN ('admin:admin', 'consultant:test');

DELETE FROM "Organisation"
WHERE "id" = 'test-org-001'
   OR "orgNumber" = '999999-0001';

INSERT INTO "Organisation" ("id", "name", "orgNumber", "createdAt")
VALUES ('test-org-001', 'Miljobeslut Test Org', '999999-0001', NOW());

INSERT INTO "User" ("id", "organisationId", "bankidId", "role", "createdAt")
VALUES
  ('test-user-admin-001', 'test-org-001', 'admin:admin', 'ADMIN', NOW()),
  ('test-user-consultant-001', 'test-org-001', 'consultant:test', 'CONSULTANT', NOW());

INSERT INTO "Project" ("id", "organisationId", "propertyDesignation", "status", "createdAt")
VALUES ('test-project-001', 'test-org-001', 'TEST 1:1', 'ACTIVE', NOW());

INSERT INTO "ProjectMember" ("id", "projectId", "userId", "accessRole", "createdAt")
VALUES
  ('test-project-member-admin-001', 'test-project-001', 'test-user-admin-001', 'OWNER', NOW()),
  ('test-project-member-consultant-001', 'test-project-001', 'test-user-consultant-001', 'CONTRIBUTOR', NOW());

COMMIT;
