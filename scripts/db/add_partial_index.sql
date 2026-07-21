-- Skapar ett partial unique index för att förhindra att samma databundle importeras
-- till samma target table mer än en gång, MEN tillåter misslyckade/planerade försök
-- att finnas parallellt (status != 'SUCCESS').

CREATE UNIQUE INDEX IF NOT EXISTS uq_postgis_import_batch 
ON "public"."PostgisImportBatch" (content_bundle_sha256, target_schema, target_table)
WHERE status = 'SUCCESS';
