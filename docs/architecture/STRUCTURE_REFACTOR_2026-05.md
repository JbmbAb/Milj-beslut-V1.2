# Strukturrefaktorering 2026-05

## 1. Server-workers (stabilitet)

Bakgrundsjobb ligger i `server/workers/` och ska köras **separat** i produktion.

| Kommando | Syfte |
| -------- | ----- |
| `npm run worker:all` | Alla jobb i en process |
| `npm run worker:gdpr` | GDPR-underhåll (engångskörning) |
| `npm run worker:search` | Sökindexering |
| `npm run worker:municipality` | Kommunstatus-polling |
| `npm run worker:domstol-rss` | Domstol RSS |

HTTP-server (`npm start`): sätt `START_WORKERS_IN_PROCESS=false` i Cloud Run så jobben inte delar process med API.

## 2. Typer (`src/types/`)

Monolitiska `types.ts` är uppdelad i domänfiler under `src/types/`. Root `types.ts` är shim:

```ts
export * from './src/types/index.ts';
```

Nya importer ska helst gå via `src/types` eller befintliga `../types`-sökvägar (shim).

## 3. App-providers (testbarhet)

- `components/app/providers/AppSessionProvider.tsx` — session, bootstrap, auth
- `components/app/providers/AppWorkspaceProvider.tsx` — mode, tabs, permits
- `components/app/AppShell.tsx` — UI-träd
- `components/App.tsx` — tunn wrapper

Testa med `useAppSession` / `useAppWorkspace` i unit-tester genom att wrappa med `AppProviders`.

## 4. Root → `src/` och `scripts/`

| Tidigare (root) | Nu |
| --------------- | --- |
| `index.tsx` | `src/main.tsx` |
| `index.css` | `src/index.css` |
| `check_*.ts`, `list_tables.ts` | `scripts/ops/db-checks/` |
| `seed-localization-demo.ts` | `scripts/seed-localization-demo.ts` |

`index.html` pekar på `/src/main.tsx`.
