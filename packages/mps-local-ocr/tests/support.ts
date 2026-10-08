import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";
import type { SourceArtifact } from "@miljobeslut/mps-text-projection";
import { packagedTessdataDir } from "../src/languageData.js";
import type { SpawnFn } from "../src/processRunner.js";

export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const SOURCE: SourceArtifact = {
  ref: { artifact_id: "local-ocr-1" },
  doc_name: "bilaga.pdf",
  mime_type: "image/png",
  bytes_content_hash: {
    algorithm: "sha256",
    value: "ab".repeat(32),
  },
};

export function nodeChild(script: string): ChildProcess {
  return spawn(process.execPath, ["-e", script], {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function versionedSpawn(
  version: string,
  onOcr: (args: readonly string[], cwd: string | undefined) => void,
  exitCode = 0,
): SpawnFn {
  return (_command, args, options) => {
    if (args[0] === "--version") {
      return nodeChild(
        `process.stderr.write(${JSON.stringify(`tesseract v${version}\n`)}); process.exit(0);`,
      );
    }
    onOcr(args, options.cwd);
    return nodeChild(`process.exit(${exitCode});`);
  };
}

export function writeOcrText(args: readonly string[], text: string): void {
  writeFileSync(`${args[1]}.txt`, text);
}

export async function makeTempParent(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "mimer-ocr-test-"));
}

export async function writeBadSweDir(parent: string): Promise<string> {
  const dir = path.join(parent, "bad-tessdata");
  await mkdir(dir, { recursive: true });
  await copyFile(
    path.join(packagedTessdataDir(), "MANIFEST.json"),
    path.join(dir, "MANIFEST.json"),
  );
  await writeFile(path.join(dir, "swe.traineddata"), "not-a-model");
  return dir;
}

export function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildSimplePdf(pageTexts: readonly string[]): Buffer {
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  const pageCount = pageTexts.length;
  const fontId = 3;
  let next = 4;
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pageIds.push(next);
    next += 1;
    contentIds.push(next);
    next += 1;
  }

  const addObject = (id: number, body: string) => {
    offsets[id] = Buffer.byteLength(chunks.join(""), "latin1");
    chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  addObject(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let index = 0; index < pageCount; index += 1) {
    const stream = `BT /F1 48 Tf 72 700 Td (${escapePdfText(pageTexts[index] ?? "")}) Tj ET`;
    addObject(
      contentIds[index] ?? 0,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    addObject(
      pageIds[index] ?? 0,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
  }

  const body = chunks.join("");
  const xrefAt = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}
