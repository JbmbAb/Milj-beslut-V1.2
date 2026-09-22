#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyDiffScope, validateUnitDefinition } from "./devgov.mjs";

const REPO_PATH_RE =
  /(?:^|["'(\s])((?:\.github|packages|src|server|components|scripts|tests|governance|docs|prisma)\/[A-Za-z0-9_.@/+~-]+)/g;

function parseArgs(argv) {
  const out = { hygiene: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--skip-hygiene") {
      out.hygiene = false;
      continue;
    }
    if (!value.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error("Missing value for " + value);
    out[value.slice(2)] = next;
    index += 1;
  }
  return out;
}

function run(worktree, command, args, timeout = 120_000) {
  return spawnSync(command, args, {
    cwd: worktree,
    encoding: "utf8",
    env: process.env,
    timeout,
  });
}

function git(worktree, args, allowFailure = false) {
  const result = run(worktree, "git", args, 30_000);
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(
      "git " +
        args.join(" ") +
        " failed: " +
        (result.error?.message || result.stderr || "unknown error"),
    );
  }
  return result;
}

function gitPathExists(worktree, ref, path) {
  const result = git(worktree, ["cat-file", "-e", ref + ":" + path], true);
  return !result.error && result.status === 0;
}

function changedPaths(worktree, baseSha, candidateSha) {
  const result = git(worktree, ["diff", "--name-only", baseSha + "..." + candidateSha]);
  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function collectRepoLikePaths(parts) {
  const found = new Set();
  for (const raw of parts.filter((value) => typeof value === "string")) {
    if (/^[A-Za-z0-9_.@/+~-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml)$/.test(raw)) {
      found.add(raw);
    }
    REPO_PATH_RE.lastIndex = 0;
    let match;
    while ((match = REPO_PATH_RE.exec(raw)) !== null) {
      found.add(match[1].replace(/[),;:'"]+$/, ""));
    }
  }
  return [...found].sort();
}

export function findCandidateOnlyRedReferences(definition, candidateSha, existsAt) {
  const findings = [];
  for (const proof of definition.required_red || []) {
    if ((proof.required_head || "base_sha") !== "base_sha") continue;
    const references = collectRepoLikePaths([proof.command, ...(proof.args || [])]);
    for (const path of references) {
      if (existsAt(candidateSha, path) && !existsAt(definition.base_sha, path)) {
        findings.push({ proof_id: proof.id, path });
      }
    }
  }
  return findings;
}

export function findUnusedAllowedPaths(definition, paths) {
  return (definition.allowed_paths || []).filter(
    (pattern) => !paths.some((path) => classifyDiffScope([path], [pattern], []).length === 0),
  );
}

export function collectRedHarnessWarnings(definition) {
  const warnings = [];
  for (const proof of definition.required_red || []) {
    if ((proof.required_head || "base_sha") !== "base_sha") {
      warnings.push(proof.id + ": RED is not anchored to base_sha");
    }
    if (!Array.isArray(proof.blocked_exit_codes) || proof.blocked_exit_codes.length === 0) {
      warnings.push(
        proof.id +
          ": RED declares no blocked_exit_codes; verify that a harness/environment crash cannot satisfy FAIL",
      );
    }
  }
  return warnings;
}

function isRepoFormatScoped(path) {
  return (
    /^\.github\/.*\.(?:md|ya?ml)$/.test(path) ||
    /^docs\/qa\/.*\.md$/.test(path) ||
    /^tests\/.*\.(?:ts|tsx)$/.test(path) ||
    /^scripts\/db\/.*\.ts$/.test(path) ||
    path === "server/createApp.ts" ||
    path === "server/index.ts" ||
    path === "eslint.config.mjs" ||
    path === "vitest.config.ts" ||
    path === "playwright.config.ts" ||
    path === ".prettierrc.json" ||
    path === "package.json"
  );
}

function isLintable(path) {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

function runNodeTool(worktree, relativeBin, args, timeout) {
  const absolute = resolve(worktree, relativeBin);
  if (!existsSync(absolute)) {
    return { status: "SKIPPED", reason: relativeBin + " not installed" };
  }
  const result = run(worktree, process.execPath, [absolute, ...args], timeout);
  return {
    status: result.error || result.status !== 0 ? "FAIL" : "PASS",
    exit_code: result.status,
    stderr: (result.stderr || "").slice(0, 4000),
    stdout: (result.stdout || "").slice(0, 4000),
  };
}

function runHygiene(worktree, paths) {
  const existing = paths.filter((path) => existsSync(resolve(worktree, path)));
  const prettierPaths = existing.filter(isRepoFormatScoped);
  const lintPaths = existing.filter(isLintable);

  return {
    prettier:
      prettierPaths.length === 0
        ? { status: "SKIPPED", reason: "no changed paths in current format:check scope" }
        : runNodeTool(
            worktree,
            "node_modules/prettier/bin/prettier.cjs",
            ["--check", ...prettierPaths],
            180_000,
          ),
    eslint:
      lintPaths.length === 0
        ? { status: "SKIPPED", reason: "no changed lintable paths" }
        : runNodeTool(
            worktree,
            "node_modules/eslint/bin/eslint.js",
            lintPaths,
            180_000,
          ),
  };
}

function runControllerPreflight(worktree, definitionArg, candidateSha) {
  const controller = resolve(worktree, "scripts/devgov/devgov.mjs");
  const result = run(
    worktree,
    process.execPath,
    [
      controller,
      "preflight",
      "--definition",
      definitionArg,
      "--candidate-sha",
      candidateSha,
      "--worktree",
      worktree,
    ],
    120_000,
  );
  return {
    status: result.error || result.status !== 0 ? "FAIL" : "PASS",
    exit_code: result.status,
    stderr: (result.stderr || "").slice(0, 4000),
    stdout: (result.stdout || "").slice(0, 8000),
  };
}

export function buildStaticAuthoringChecks(definition, candidateSha, paths, existsAt) {
  const errors = validateUnitDefinition(definition);
  const candidateOnlyRedReferences = findCandidateOnlyRedReferences(
    definition,
    candidateSha,
    existsAt,
  );
  const unusedAllowedPaths = findUnusedAllowedPaths(definition, paths);
  const warnings = collectRedHarnessWarnings(definition);

  for (const finding of candidateOnlyRedReferences) {
    warnings.push(
      finding.proof_id +
        ": RED references candidate-only path " +
        finding.path +
        "; prove that missing-file/module failure cannot satisfy the RED",
    );
  }
  for (const pattern of unusedAllowedPaths) {
    warnings.push("allowed_paths entry matches no changed path: " + pattern);
  }

  return { errors, warnings, candidateOnlyRedReferences, unusedAllowedPaths };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/devgov/authoring-preflight.mjs",
    "    --definition governance/devgov/units/<unit>.json",
    "    --candidate-sha <40-char sha>",
    "    --worktree <repo path>",
    "    [--skip-hygiene]",
    "",
    "This is authoring assistance only. scripts/devgov/devgov.mjs remains authoritative.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.definition || !args["candidate-sha"] || !args.worktree) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const worktree = resolve(args.worktree);
  const definitionPath = isAbsolute(args.definition)
    ? args.definition
    : resolve(worktree, args.definition);
  const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
  const candidateSha = args["candidate-sha"];
  const paths = changedPaths(worktree, definition.base_sha, candidateSha);
  const staticChecks = buildStaticAuthoringChecks(
    definition,
    candidateSha,
    paths,
    (ref, path) => gitPathExists(worktree, ref, path),
  );
  const controller = runControllerPreflight(worktree, args.definition, candidateSha);
  const hygiene = args.hygiene ? runHygiene(worktree, paths) : { status: "SKIPPED" };

  const errors = [...staticChecks.errors];
  if (controller.status !== "PASS") errors.push("authoritative controller preflight failed");
  if (hygiene.prettier?.status === "FAIL") errors.push("changed-file prettier check failed");
  if (hygiene.eslint?.status === "FAIL") errors.push("changed-file eslint check failed");

  const report = {
    schema_version: "dev-gov-authoring-preflight-v1",
    authoritative: false,
    note: "Authoring feedback only; trusted Dev-Gov evidence is unchanged.",
    unit: definition.unit,
    base_sha: definition.base_sha,
    candidate_sha: candidateSha,
    changed_paths: paths,
    controller_preflight: controller,
    static_checks: staticChecks,
    hygiene,
    errors,
    result: errors.length === 0 ? "PASS" : "FAIL",
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = errors.length === 0 ? 0 : 1;
}

const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          schema_version: "dev-gov-authoring-preflight-v1",
          authoritative: false,
          result: "ERROR",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  });
}
