# Domain Layer (Domänkärna)

Detta är hjärtat i systemet. Här bor kärnobjekt (entities), värdeobjekt (value objects) och domänregler.

- Ingen kännedom om UI eller databas (Prisma/SQL).
- Inga externa API-anrop (fetch).
- Innehåller affärslogik som Project, Requirement, AuditEvent.
