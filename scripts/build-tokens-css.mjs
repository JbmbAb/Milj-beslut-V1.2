import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const inputPath = path.join(rootDir, "tokens.json");
const outputPath = path.join(rootDir, "tokens.css");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toVarName(parts) {
  return parts
    .join("-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function camelToKebab(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .toLowerCase();
}

function toCssValue(type, value, keyHint = "") {
  if (type === "typography" && isPlainObject(value)) {
    return null;
  }

  if (typeof value === "number") {
    if (type === "spacing" || type === "borderRadius" || keyHint.includes("size") || keyHint.includes("height")) {
      return `${value}px`;
    }
    return String(value);
  }

  if (typeof value !== "string") {
    return String(value);
  }

  const trimmed = value.trim();
  const isNumeric = /^-?\d+(\.\d+)?$/.test(trimmed);

  if (isNumeric && (type === "spacing" || type === "borderRadius" || keyHint.includes("size") || keyHint.includes("height"))) {
    return `${trimmed}px`;
  }

  return trimmed;
}

function collectTokenEntries(node, pathParts = [], entries = []) {
  if (!isPlainObject(node)) {
    return entries;
  }

  if (Object.prototype.hasOwnProperty.call(node, "$value")) {
    entries.push({
      pathParts,
      type: node.$type || "",
      value: node.$value,
    });
    return entries;
  }

  for (const [key, value] of Object.entries(node)) {
    collectTokenEntries(value, [...pathParts, key], entries);
  }

  return entries;
}

function createCssLines(tokens) {
  const lines = [];

  for (const token of tokens) {
    const varBase = toVarName(token.pathParts);

    if (token.type === "typography" && isPlainObject(token.value)) {
      for (const [prop, propValue] of Object.entries(token.value)) {
        const propName = camelToKebab(prop);
        const cssVar = `--${varBase}-${propName}`;
        let cssValue = toCssValue(token.type, propValue, propName);
        if (propName === "font-family") {
          cssValue = `"${String(propValue)}", sans-serif`;
        }
        lines.push(`  ${cssVar}: ${cssValue};`);
      }
      continue;
    }

    const cssVar = `--${varBase}`;
    const cssValue = toCssValue(token.type, token.value);
    lines.push(`  ${cssVar}: ${cssValue};`);
  }

  return lines;
}

if (!fs.existsSync(inputPath)) {
  console.error("tokens.json not found in project root.");
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8");
const json = JSON.parse(raw);

const tokenEntries = [];
for (const [, setTokens] of Object.entries(json)) {
  collectTokenEntries(setTokens, [], tokenEntries);
}

tokenEntries.sort((a, b) => toVarName(a.pathParts).localeCompare(toVarName(b.pathParts)));

const cssLines = createCssLines(tokenEntries);
const css = `:root {\n  /* Generated from tokens.json. Run: npm run tokens:build */\n${cssLines.join("\n")}\n}\n`;

fs.writeFileSync(outputPath, css, "utf8");
console.info(`Generated ${path.basename(outputPath)} from ${path.basename(inputPath)}.`);
