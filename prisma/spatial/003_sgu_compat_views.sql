-- Legacy Python importer used shorter table names; platform registry expects canonical names.
-- Create read-only compat views only when legacy base table exists and canonical target is absent.

DO $$
BEGIN
  IF to_regclass('env.sgu_soil_type') IS NOT NULL
     AND to_regclass('env.sgu_soil_type_25k_100k') IS NULL THEN
    EXECUTE 'CREATE VIEW env.sgu_soil_type_25k_100k AS SELECT * FROM env.sgu_soil_type';
    RAISE NOTICE 'Created view env.sgu_soil_type_25k_100k -> env.sgu_soil_type';
  END IF;

  IF to_regclass('env.sgu_well_actual') IS NOT NULL
     AND to_regclass('env.sgu_well') IS NULL THEN
    EXECUTE 'CREATE VIEW env.sgu_well AS SELECT * FROM env.sgu_well_actual';
    RAISE NOTICE 'Created view env.sgu_well -> env.sgu_well_actual';
  END IF;

  IF to_regclass('env.sgu_bedrock') IS NOT NULL
     AND to_regclass('env.sgu_ground_layer_1m') IS NULL THEN
    EXECUTE 'CREATE VIEW env.sgu_ground_layer_1m AS SELECT * FROM env.sgu_bedrock';
    RAISE NOTICE 'Created view env.sgu_ground_layer_1m -> env.sgu_bedrock (legacy aggregate)';
  END IF;
END $$;
