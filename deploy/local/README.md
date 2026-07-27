# Lokal prod — TLS med Caddy (Windows)

Primär prod kör på **http://127.0.0.1:8080** via Docker. Caddy lägger TLS framför (valfritt Fas 1).

Relaterat: [docs/ops/local-prod-fas1.md](../../docs/ops/local-prod-fas1.md)

## 1. Installera Caddy

1. Ladda ner från [caddyserver.com/download](https://caddyserver.com/download) (Windows amd64)
2. Lägg `caddy.exe` i PATH eller kör från projektroten

## 2. Konfiguration

```powershell
Copy-Item deploy/local/Caddyfile.example Caddyfile
# Redigera Caddyfile — localhost för dev, riktig domän för prod
```

## 3. Starta

```powershell
# Prod-stack måste köra först
docker compose -f docker-compose.prod.yml up -d

# Caddy (HTTPS localhost med Caddy internal CA, eller Let's Encrypt för riktig domän)
caddy run --config Caddyfile
```

- **localhost:** Caddy använder lokalt trust-cert; webbläsare kan kräva undantag första gången
- **Riktig domän:** DNS A-record → serverns IP; Caddy hämtar Let's Encrypt automatiskt

## 4. CORS

Uppdatera `.env.production`:

```env
CORS_ALLOW_ORIGINS=https://miljobeslut.se,http://localhost:8080
```

Starta om app: `docker compose -f docker-compose.prod.yml up -d app`

## Säkerhet

- Exponera endast port 443 (och 80 för ACME) utåt — inte 5434 (Postgres)
- Brandvägg Windows: tillåt 443 in, blockera 5434 utifrån
