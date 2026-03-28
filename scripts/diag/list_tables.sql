SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND (table_name LIKE 'sgu_%' OR table_name LIKE 'env_%');
