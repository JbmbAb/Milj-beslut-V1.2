-- Lägger till tabell för kulturmiljöområden från Riksantikvarieämbetet (RAÄ)

CREATE TABLE IF NOT EXISTS "env"."kulturmiljo_omrade" (
    id TEXT PRIMARY KEY, -- Ofta ett unikt ID från källan, t.ex. RAÄ-nummer
    namn TEXT,
    typ TEXT,
    beslutsdatum DATE,
    geom geometry(MultiPolygon, 3006) -- SWEREF99 TM är standard i projektet
);

CREATE INDEX IF NOT EXISTS kulturmiljo_omrade_geom_idx ON env.kulturmiljo_omrade USING GIST (geom);