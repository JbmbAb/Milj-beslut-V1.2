SELECT 'CNotificationChemical' as tbl, count(*) FROM public.c_notification_chemicals
UNION ALL
SELECT 'PermitApplicationDraft' as tbl, count(*) FROM public."PermitApplicationDraft"
UNION ALL
SELECT 'DocumentRecord' as tbl, count(*) FROM public."DocumentRecord"
UNION ALL
SELECT 'RequirementRecord' as tbl, count(*) FROM public."RequirementRecord"
UNION ALL
SELECT 'RequirementCase' as tbl, count(*) FROM public."RequirementCase"
UNION ALL
SELECT 'decision_cases' as tbl, count(*) FROM public.decision_cases;
