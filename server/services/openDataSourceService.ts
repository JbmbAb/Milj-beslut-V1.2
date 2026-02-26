interface FetchResult {
  source: string;
  ok: boolean;
  endpoint: string;
  status?: number;
  details?: string;
  sample?: unknown;
}

async function fetchJson(endpoint: string): Promise<FetchResult> {
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    const sample = text.length > 2500 ? text.slice(0, 2500) : text;
    return {
      source: endpoint,
      ok: response.ok,
      endpoint,
      status: response.status,
      sample,
    };
  } catch (error: unknown) {
    return {
      source: endpoint,
      ok: false,
      endpoint,
      details: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

async function fetchText(endpoint: string): Promise<FetchResult> {
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "*/*" },
    });
    const text = await response.text();
    return {
      source: endpoint,
      ok: response.ok,
      endpoint,
      status: response.status,
      sample: text.length > 2500 ? text.slice(0, 2500) : text,
    };
  } catch (error: unknown) {
    return {
      source: endpoint,
      ok: false,
      endpoint,
      details: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

export async function fetchImmediateOpenSources(): Promise<FetchResult[]> {
  const endpoints = [
    {
      id: "scb",
      type: "json" as const,
      url: "https://api.scb.se/OV0104/v2beta/api/v2/tables",
    },
    {
      id: "smhi",
      type: "json" as const,
      url: "https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/18.0686/lat/59.3293/data.json",
    },
    {
      id: "naturvardsverket",
      type: "text" as const,
      url: "https://oppnadata.naturvardsverket.se/",
    },
    {
      id: "sgu",
      type: "text" as const,
      url: "https://resource.sgu.se/service/wms/130/brunnar?request=GetCapabilities&service=WMS",
    },
    {
      id: "msb",
      type: "text" as const,
      url: "https://inspire.msb.se/oversvamning/wms?service=WMS&request=GetCapabilities",
    },
    {
      id: "lantmateriet_open_fastighetsomrade",
      type: "text" as const,
      url: "https://api-ver.lantmateriet.se/fastighetsomrade/atom/v1/",
    },
  ];

  const results = await Promise.all(
    endpoints.map((entry) => (entry.type === "json" ? fetchJson(entry.url) : fetchText(entry.url))),
  );

  return results.map((row, index) => ({
    ...row,
    source: endpoints[index].id,
  }));
}
