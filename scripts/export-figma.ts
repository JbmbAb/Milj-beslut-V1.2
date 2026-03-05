import { promises as fs } from "node:fs";
import path from "node:path";

type FigmaNode = {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: {
    width?: number;
    height?: number;
  };
};

type FigmaComponentMeta = {
  key?: string;
  name?: string;
  description?: string;
};

type FigmaFileResponse = {
  name?: string;
  document?: FigmaNode;
  components?: Record<string, FigmaComponentMeta>;
};

type ExportItem = {
  id: string;
  name: string;
  componentName: string;
  fileName: string;
  width: number | null;
  height: number | null;
  layerNames: string[];
};

const ROOT_DIR = process.cwd();
const RAW_OUTPUT = path.join(ROOT_DIR, "figma-raw.json");
const OUT_DIR = path.join(ROOT_DIR, "src", "figma-components");

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#47;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");
}

function parseArgValue(name: string): string {
  const args = process.argv.slice(2);
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) {
    return direct.slice(name.length + 1).trim();
  }
  const index = args.findIndex((arg) => arg === name);
  if (index >= 0 && args[index + 1]) {
    return String(args[index + 1]).trim();
  }
  return "";
}

function parseFigmaFileIdFromUrl(input: string): string {
  if (!input) return "";
  const source = decodeHtmlEntities(input.trim());
  const match = source.match(/\/(?:make|file)\/([a-zA-Z0-9]+)\//);
  return match?.[1] || "";
}

function loadDotEnv(filePath: string) {
  return fs
    .readFile(filePath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;

        const key = trimmed.slice(0, idx).trim();
        if (!key) continue;
        if (process.env[key]) continue;

        let value = trimmed.slice(idx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    })
    .catch(() => {
      // No .env file is fine; script can read from process env.
    });
}

function sanitizeFileStem(input: string): string {
  const ascii = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const stem = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return stem || "figma-component";
}

function toPascalCase(input: string): string {
  const parts = input.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const name = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return name || "FigmaComponent";
}

function walkNodes(node: FigmaNode | undefined, map: Map<string, FigmaNode>) {
  if (!node) return;
  map.set(node.id, node);
  for (const child of node.children || []) {
    walkNodes(child, map);
  }
}

function collectComponentNodes(nodeMap: Map<string, FigmaNode>): string[] {
  const ids: string[] = [];
  for (const [id, node] of nodeMap.entries()) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      ids.push(id);
    }
  }
  return ids;
}

function nodeSize(node: FigmaNode | undefined) {
  const widthRaw = node?.absoluteBoundingBox?.width;
  const heightRaw = node?.absoluteBoundingBox?.height;
  return {
    width: typeof widthRaw === "number" ? Math.round(widthRaw) : null,
    height: typeof heightRaw === "number" ? Math.round(heightRaw) : null,
  };
}

function pickLayerNames(node: FigmaNode | undefined, limit: number = 8): string[] {
  if (!node?.children?.length) return [];
  return node.children
    .map((child) => child.name)
    .filter((name) => typeof name === "string" && name.trim().length > 0)
    .slice(0, limit);
}

function buildComponentSource(item: ExportItem): string {
  const titleLiteral = JSON.stringify(item.name);
  const nodeIdLiteral = JSON.stringify(item.id);
  const sizeLabel =
    item.width && item.height ? `${item.width}x${item.height}` : "size unavailable";
  const sizeLiteral = JSON.stringify(sizeLabel);
  const layerRows =
    item.layerNames.length > 0
      ? item.layerNames.map((layer) => `          <li>${JSON.stringify(layer)}</li>`).join("\n")
      : `          <li>No immediate layers found</li>`;

  return `import React from "react";

export interface ${item.componentName}Props {
  className?: string;
  title?: string;
}

const ${item.componentName}: React.FC<${item.componentName}Props> = ({ className = "", title }) => {
  return (
    <section className={\`rounded-xl border border-slate-200 bg-white p-4 shadow-sm \${className}\`.trim()}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-900">{title || ${titleLiteral}}</h3>
        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-600">${sizeLiteral}</span>
      </header>
      <p className="text-xs text-slate-600">Generated from Figma node ${nodeIdLiteral}.</p>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-700">
${layerRows}
      </ul>
    </section>
  );
};

export default ${item.componentName};
`;
}

async function writeExportFiles(items: ExportItem[]) {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const indexLines: string[] = [];
  for (const item of items) {
    const filePath = path.join(OUT_DIR, item.fileName);
    await fs.writeFile(filePath, buildComponentSource(item), "utf8");
    indexLines.push(`export { default as ${item.componentName} } from "./${item.fileName.replace(/\.tsx$/, "")}";`);
  }

  const indexPath = path.join(OUT_DIR, "index.ts");
  await fs.writeFile(indexPath, `${indexLines.join("\n")}\n`, "utf8");

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

function extractInitialOptions(rawHtml: string): Record<string, unknown> | null {
  const marker = `type="application/json" data-initial>`;
  const markerIndex = rawHtml.indexOf(marker);
  if (markerIndex < 0) return null;

  const jsonStart = markerIndex + marker.length;
  const jsonEnd = rawHtml.indexOf("</script>", jsonStart);
  if (jsonEnd < 0) return null;

  const jsonText = rawHtml.slice(jsonStart, jsonEnd).trim();
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as { INITIAL_OPTIONS?: Record<string, unknown> };
    return parsed.INITIAL_OPTIONS || null;
  } catch {
    return null;
  }
}

async function runPublicFallback(figmaUrl: string, explicitFileId: string) {
  if (!figmaUrl) {
    throw new Error(
      "Missing FIGMA_TOKEN and no public URL found. Set FIGMA_TOKEN for full export or set FIGMA_MAKE_URL/--url for fallback."
    );
  }

  const response = await fetch(figmaUrl, {
    method: "GET",
    headers: { Accept: "text/html" },
  });

  if (!response.ok) {
    throw new Error(`Public Figma page fetch failed (${response.status}).`);
  }

  const html = await response.text();
  const initialOptions = extractInitialOptions(html);
  const editingFile = (initialOptions?.editing_file as Record<string, unknown> | undefined) || {};
  const fileKey = String(editingFile.key || explicitFileId || parseFigmaFileIdFromUrl(figmaUrl) || "");
  const title = String(editingFile.name || "Figma Public Export");
  const thumbnail = String(editingFile.thumbnail_url || "");

  const fallbackRaw = {
    mode: "public-fallback",
    fetchedAt: new Date().toISOString(),
    url: figmaUrl,
    fileId: fileKey || null,
    title,
    thumbnailUrl: thumbnail || null,
    initialOptions: initialOptions || null,
  };

  await fs.writeFile(RAW_OUTPUT, `${JSON.stringify(fallbackRaw, null, 2)}\n`, "utf8");

  const componentStem = sanitizeFileStem(title);
  const item: ExportItem = {
    id: fileKey || "public-fallback",
    name: title,
    componentName: toPascalCase(componentStem),
    fileName: `${componentStem}.tsx`,
    width: null,
    height: null,
    layerNames: [
      "Public fallback export",
      "Add FIGMA_TOKEN for full component tree",
      thumbnail ? `Thumbnail available: ${thumbnail}` : "No thumbnail available",
    ],
  };

  await writeExportFiles([item]);
  console.log("Public fallback export completed (no FIGMA_TOKEN).");
  console.log(`Raw file: ${RAW_OUTPUT}`);
  console.log(`Component directory: ${OUT_DIR}`);
  console.log("Generated components: 1");
}

async function run() {
  await loadDotEnv(path.join(ROOT_DIR, ".env"));

  const argUrl = parseArgValue("--url");
  const argFileId = parseArgValue("--file-id");
  const figmaUrl = String(argUrl || process.env.FIGMA_MAKE_URL || "").trim();
  const figmaToken = String(process.env.FIGMA_TOKEN || "").trim();

  const fromEnvOrArgFile = String(argFileId || process.env.FIGMA_FILE_ID || "").trim();
  const figmaFileId = fromEnvOrArgFile || parseFigmaFileIdFromUrl(figmaUrl);

  if (!figmaToken) {
    await runPublicFallback(figmaUrl, figmaFileId);
    return;
  }
  if (!figmaFileId) {
    throw new Error("Missing FIGMA_FILE_ID. Set FIGMA_FILE_ID or pass --url/--file-id.");
  }

  const fileUrl = `https://api.figma.com/v1/files/${encodeURIComponent(figmaFileId)}`;
  const response = await fetch(fileUrl, {
    method: "GET",
    headers: {
      "X-Figma-Token": figmaToken,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`Figma API failed (${response.status}): ${reason.slice(0, 300)}`);
  }

  const payload = (await response.json()) as FigmaFileResponse;
  await fs.writeFile(RAW_OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const nodeMap = new Map<string, FigmaNode>();
  walkNodes(payload.document, nodeMap);

  const componentMeta = payload.components || {};
  const componentIds = Object.keys(componentMeta);
  const fallbackIds = collectComponentNodes(nodeMap);
  const exportIds = componentIds.length > 0 ? componentIds : fallbackIds;

  const usedNames = new Set<string>();
  const items: ExportItem[] = exportIds.map((id, index) => {
    const node = nodeMap.get(id);
    const meta = componentMeta[id] || {};
    const sourceName = meta.name || node?.name || `Figma Component ${index + 1}`;
    const stemBase = sanitizeFileStem(sourceName);

    let stem = stemBase;
    let suffix = 2;
    while (usedNames.has(stem)) {
      stem = `${stemBase}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(stem);

    const componentName = toPascalCase(stem);
    const size = nodeSize(node);
    const layers = pickLayerNames(node);

    return {
      id,
      name: sourceName,
      componentName,
      fileName: `${stem}.tsx`,
      width: size.width,
      height: size.height,
      layerNames: layers,
    };
  });

  await writeExportFiles(items);

  console.log(`Export complete for "${payload.name || figmaFileId}".`);
  console.log(`Raw file: ${RAW_OUTPUT}`);
  console.log(`Component directory: ${OUT_DIR}`);
  console.log(`Generated components: ${items.length}`);
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Export failed: ${message}`);
  process.exitCode = 1;
});
