export interface OcrIdentityParts {
  readonly tesseractVersion: string;
  readonly languages: string;
  readonly languageFiles: readonly {
    readonly lang: string;
    readonly version: string;
    readonly sha256: string;
  }[];
  readonly oem: number;
  readonly psm: number;
  readonly dpi: number | null;
  readonly rendererId: string;
  readonly renderFormat: string;
}

export function formatOcrVersion(parts: OcrIdentityParts): string {
  const models = [...parts.languageFiles]
    .sort((a, b) => a.lang.localeCompare(b.lang))
    .map((file) => `${file.lang}=${file.version}:sha256:${file.sha256}`)
    .join(",");
  return [
    `tesseract@${parts.tesseractVersion}`,
    `oem=${parts.oem}`,
    `psm=${parts.psm}`,
    `langs=${parts.languages}`,
    `models=${models}`,
    `dpi=${parts.dpi ?? "na"}`,
    `renderer=${parts.rendererId}`,
    `render=${parts.renderFormat}`,
  ].join(";");
}

export function parseTesseractVersion(stderr: string): string | null {
  const match = /tesseract v(\S+)/i.exec(stderr);
  return match?.[1] ?? null;
}

export function parsePopplerVersion(stderr: string): string | null {
  const match = /pdftoppm version (\S+)/i.exec(stderr);
  return match?.[1] ?? null;
}

export function parsePdfinfoVersion(stderr: string): string | null {
  const match = /pdfinfo version (\S+)/i.exec(stderr);
  return match?.[1] ?? null;
}

export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function joinPageTexts(pages: readonly string[]): string {
  return pages
    .map((page) => normalizeOcrText(page))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
