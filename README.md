<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c85fb0f1-3062-4d35-b8b2-f24498822624

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Security backend additions

- See `SECURITY_BACKEND_README.md` for secure B2B backend architecture.
- Required env vars are listed in `.env.example`.
- Prisma schema is in `prisma/schema.prisma`.
- Secure API router lives in `server/secureApi.express.ts`.
- Datasource classification and open-source sync:
  - `GET /api/datasources/catalog`
  - `POST /api/datasources/open/sync`
  - `GET /api/datasources/slu/status`
  - `GET /api/datasources/slu/ping/:product` where product is `species_observations|taxonomy|artfakta|metodkatalog`
  - `POST /api/datasources/slu/observations`
  - `POST /api/datasources/slu/proxy`
  - `powershell -ExecutionPolicy Bypass -File scripts/update-datasource-excel.ps1`
  - `powershell -ExecutionPolicy Bypass -File scripts/fetch-open-sources.ps1`
