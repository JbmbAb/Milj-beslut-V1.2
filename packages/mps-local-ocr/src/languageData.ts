import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalOcrFailure, type LocalOcrFailureCode } from "./failures.js";

export interface LanguageModelManifestEntry {
  readonly lang: string;
  readonly source: string;
  readonly version: string;
  readonly gitTag: string;
  readonly gitTagObject: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly destination: string;
  readonly runtimeLookup: string;
}

export interface LanguageFileIdentity {
  readonly lang: string;
  readonly version: string;
  readonly sha256: string;
  readonly sourcePath: string;
}

export class LanguageDataError extends Error {
  constructor(
    readonly code: LocalOcrFailureCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "LanguageDataError";
  }
}

export function packagedTessdataDir(): string {
  return fileURLToPath(new URL("../tessdata/", import.meta.url));
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function loadSweManifest(
  tessdataDir: string,
): Promise<LanguageModelManifestEntry> {
  const raw = await readFile(path.join(tessdataDir, "MANIFEST.json"), "utf8");
  const parsed = JSON.parse(raw) as { swe?: LanguageModelManifestEntry };
  const swe = parsed.swe;
  if (!swe?.sha256 || !swe.version) {
    throw new LanguageDataError(
      LocalOcrFailure.LANGUAGE_DATA_MISSING,
      "swe manifest entry is missing",
    );
  }
  return swe;
}

export async function composeTessdataDir(input: {
  readonly languages: readonly string[];
  readonly destinationDir: string;
  readonly packagedDir: string;
  readonly systemTessdataDir: string | null;
}): Promise<readonly LanguageFileIdentity[]> {
  const manifest = await loadSweManifest(input.packagedDir);
  const identities: LanguageFileIdentity[] = [];

  for (const lang of input.languages) {
    if (lang === "swe") {
      const sourcePath = path.join(input.packagedDir, "swe.traineddata");
      const actual = await sha256File(sourcePath).catch(() => null);
      if (!actual) {
        throw new LanguageDataError(
          LocalOcrFailure.LANGUAGE_DATA_MISSING,
          "swe.traineddata is not in the packaged tessdata directory",
        );
      }
      if (actual.toLowerCase() !== manifest.sha256.toLowerCase()) {
        throw new LanguageDataError(
          LocalOcrFailure.LANGUAGE_DATA_HASH_MISMATCH,
          `swe.traineddata sha256 ${actual} does not match manifest ${manifest.sha256}`,
        );
      }
      const destination = path.join(input.destinationDir, "swe.traineddata");
      await copyFile(sourcePath, destination);
      identities.push({
        lang: "swe",
        version: manifest.version,
        sha256: actual.toLowerCase(),
        sourcePath,
      });
      continue;
    }

    if (lang === "eng") {
      if (!input.systemTessdataDir) {
        throw new LanguageDataError(
          LocalOcrFailure.LANGUAGE_DATA_MISSING,
          "eng.traineddata directory was not found beside the local Tesseract install",
        );
      }
      const sourcePath = path.join(input.systemTessdataDir, "eng.traineddata");
      const actual = await sha256File(sourcePath).catch(() => null);
      if (!actual) {
        throw new LanguageDataError(
          LocalOcrFailure.LANGUAGE_DATA_MISSING,
          "eng.traineddata is not in the local Tesseract tessdata directory",
        );
      }
      const destination = path.join(input.destinationDir, "eng.traineddata");
      await copyFile(sourcePath, destination);
      identities.push({
        lang: "eng",
        version: "installed",
        sha256: actual.toLowerCase(),
        sourcePath,
      });
      continue;
    }

    throw new LanguageDataError(
      LocalOcrFailure.UNSUPPORTED_LANGUAGE,
      `unsupported language ${lang}`,
    );
  }

  return identities;
}
