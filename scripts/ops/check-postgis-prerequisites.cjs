/**
 * Validate Mimers PostGIS prerequisites (cold-start skill + MB-004 mount).
 * Writes receipt under storage/manifests/postgis-prerequisites-*/
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RECEIPT_DIR = path.join(
  process.cwd(),
  "storage",
  "manifests",
  "postgis-prerequisites-20260807"
);

function sh(cmd) {
  try {
    return {
      ok: true,
      out: execSync(cmd, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      }).trim(),
    };
  } catch (e) {
    return {
      ok: false,
      out: String(e.stdout || ""),
      error: String(e.stderr || e.message || e).slice(0, 500),
    };
  }
}

function freeCGb() {
  const r = sh('powershell -NoProfile -Command "(Get-PSDrive C).Free"');
  if (!r.ok) return null;
  return +(Number(r.out) / 1e9).toFixed(2);
}

function main() {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const checks = [];

  const freeGb = freeCGb();
  checks.push({
    id: "C_FREE",
    ok: freeGb != null && freeGb >= 80,
    detail: { freeGb, requiredGb: 80 },
  });

  const docker = sh("docker info --format {{.ServerVersion}}");
  checks.push({ id: "DOCKER_UP", ok: docker.ok, detail: docker });

  const ps = sh('docker ps --format "{{.Names}}|{{.Status}}"');
  const sandboxes = (ps.out || "")
    .split(/\r?\n/)
    .filter((l) => /mcp|sandbox|node-code-sandbox/i.test(l));
  checks.push({
    id: "NO_MCP_SANDBOXES",
    ok: sandboxes.length === 0,
    detail: { sandboxes },
  });

  const engines = (ps.out || "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("miljobeslut-postgres|"));
  checks.push({
    id: "SINGLE_ENGINE",
    ok: engines.length === 1 && /healthy|Up/i.test(engines[0] || ""),
    detail: { engines, all: ps.out },
  });

  const ready = sh(
    "docker exec miljobeslut-postgres pg_isready -U miljobeslut -d miljobeslut"
  );
  checks.push({ id: "PG_READY", ok: ready.ok && /accepting/i.test(ready.out), detail: ready });

  const nmd = sh(
    'docker exec miljobeslut-postgres bash -lc "test ! -e /var/lib/postgresql/data/geo_master_archive && echo absent || echo present"'
  );
  checks.push({
    id: "NO_NMD_IN_PGDATA",
    ok: nmd.ok && nmd.out.includes("absent"),
    detail: nmd,
  });

  const exts = sh(
    'docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -Atc "SELECT extname FROM pg_extension ORDER BY 1"'
  );
  const extList = (exts.out || "").split(/\r?\n/).filter(Boolean);
  checks.push({
    id: "EXTENSIONS",
    ok:
      extList.includes("postgis") &&
      extList.includes("vector") &&
      extList.includes("pg_trgm"),
    detail: { extList },
  });

  // MB-004: canonical mount must be readable (top-level archive layout)
  const mountCanon = sh(
    'docker exec miljobeslut-postgres bash -lc "ls -1 /mnt/geo_master_archive 2>/dev/null | wc -l"'
  );
  const mountLegacy = sh(
    'docker exec miljobeslut-postgres bash -lc "ls -1 /master-archive 2>/dev/null | wc -l"'
  );
  const pdfProbe = sh(
    'docker exec miljobeslut-postgres bash -lc "test -d /mnt/geo_master_archive/Documents/Sources/PDF && echo yes || echo no"'
  );
  const canonCount = Number(mountCanon.out || 0);
  const legacyCount = Number(mountLegacy.out || 0);
  checks.push({
    id: "MB004_MASTER_MOUNT",
    ok:
      (canonCount >= 5 || legacyCount >= 5) &&
      pdfProbe.ok &&
      pdfProbe.out.includes("yes"),
    detail: {
      canonPath: "/mnt/geo_master_archive",
      canonChildren: canonCount,
      legacyPath: "/master-archive",
      legacyChildren: legacyCount,
      pdfTree: pdfProbe.out,
      note: "H: Google Shared Drive is canonical; Docker uses NTFS runtime mirror",
    },
  });

  const dump = path.join(
    process.cwd(),
    "storage",
    "manifests",
    "postgis-coldstart-prep-20260807",
    "hitl-dump",
    "hitl-unique.dump"
  );
  checks.push({
    id: "HITL_DUMP",
    ok: fs.existsSync(dump),
    detail: { dump, bytes: fs.existsSync(dump) ? fs.statSync(dump).size : 0 },
  });

  const hostMaster =
    "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive";
  checks.push({
    id: "HOST_MASTER_VISIBLE",
    ok: fs.existsSync(path.join(hostMaster, "Data")),
    detail: { hostMaster },
  });

  const failed = checks.filter((c) => !c.ok);
  const report = {
    policy: "Mimers Brunn v2.0.1",
    skill: "mimers-postgis-cold-start",
    checkedAt: new Date().toISOString(),
    ready: failed.length === 0,
    failed: failed.map((f) => f.id),
    checks,
    nextWhenReady: [
      "Cold engine: prisma migrate / spatial bootstrap against DATABASE_URL",
      "PDF + deterministic chunking (before heavy geodata import)",
    ],
  };

  fs.writeFileSync(
    path.join(RECEIPT_DIR, "prerequisites-status.json"),
    JSON.stringify(report, null, 2)
  );
  // MB-004 evidence stub
  fs.writeFileSync(
    path.join(RECEIPT_DIR, "mount-validation.json"),
    JSON.stringify(
      {
        control: "MB-004",
        checkedAt: report.checkedAt,
        runtimePath: "/mnt/geo_master_archive",
        legacyAlias: "/master-archive",
        ok: report.checks.find((c) => c.id === "MB004_MASTER_MOUNT")?.ok === true,
        detail: report.checks.find((c) => c.id === "MB004_MASTER_MOUNT")?.detail,
      },
      null,
      2
    )
  );

  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length === 0 ? 0 : 2);
}

main();
