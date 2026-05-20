# Miljobeslut.se — Projektanteckningar

Detta dokument ger en översikt över projektets arkitektur och hur man kör de olika delarna.

## Arkitektur

Systemet består av en databehandlingspipeline, ett webb-API och ett HTML-baserat användargränssnitt.

```
/
├── api/                  # FastAPI-backend (webbserver)
│   ├── main.py           # API-definition med alla endpoints
│   ├── database.py       # Databasanslutning (SQLite)
│   ├── models.py         # Pydantic-modeller för API-data
│   ├── regulations.py    # Hårdkodad data för regelverk
│   ├── pdf_generator.py  # Skapar PDF-rapporter med ReportLab
│   └── ...               # Andra hjälpmoduler
│
├── frontend/             # Tom mapp, ej i användning
│
├── main.py               # Huvudskript för att köra databehandlingspipelinen
├── migration.py          # Steg 1: Importerar metadata från CSV till databasen
├── miner.py              # Steg 2: Extraherar text från PDF:er
├── processor.py          # Steg 3: Geokodar adresser och extraherar bilder
├── backend.py            # Steg 4: Analyserar text med Gemini AI
├── create_map.py         # Steg 5: Skapar en statisk HTML-karta (karta.html)
│
├── Milljöbeslut 2.0.html # Interaktivt webbgränssnitt (SPA-prototyp)
├── karta.html            # Statisk kartvisualisering (genererad av create_map.py)
│
├── risk_data.db          # SQLite-databasfil
├── Input_PDF/            # Rådata (PDF-dokument)
├── assets/               # Genererade bilder från PDF:er
│
├── config.py             # Central konfiguration
├── Dockerfile            # Docker-konfiguration för bygge
└── docker-compose.yml    # Docker Compose för att köra applikationen
```

## Köra systemet

### 1. Databehandlingspipeline

Pipelinen körs via `main.py` och kan exekvera ett eller flera steg.

```bash
# Kör hela pipelinen i rätt ordning (alla 5 steg)
python main.py

# Kör ett specifikt steg
python main.py migrate
python main.py mine
python main.py process
python main.py analyze
python main.py map
```

### 2. Webb-API (FastAPI)

API:et startas separat och används av `Milljöbeslut 2.0.html`.

```bash
uvicorn api.main:app --reload
```

API:et är sedan tillgängligt på `http://localhost:8000`.

### 3. Användargränssnitt

Öppna filen `Milljöbeslut 2.0.html` direkt i en webbläsare för att se prototypen av applikationen.

### 4. Docker (Rekommenderat)

Det enklaste sättet att köra hela systemet (backend och frontend-servering) är med Docker.

```bash
docker compose up --build
```

Systemet blir då tillgängligt på `http://localhost:8000`.

## Konfiguration

- Kopiera `.env.example` till `.env` och fyll i din `GEMINI_API_KEY`.
- Databasen `risk_data.db` skapas och uppdateras automatiskt när pipelinen eller API:et körs.
