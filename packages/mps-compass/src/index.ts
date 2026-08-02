// 📦 Paket 17 – Mimer Sovereign Compass Geometry (kodspec)

// All geometry is defined in a normalized coordinate system (0–100).

export interface CompassGeometry {
  readonly outerRadius: number;      // e.g. 48
  readonly innerRingRadius: number;  // e.g. 40
  readonly centerRadius: number;     // e.g. 6

  readonly mainAxisLength: number;   // e.g. 52
  readonly mainAxisWidth: number;    // e.g. 4

  readonly minorAxisLength: number;  // e.g. 44
  readonly minorAxisWidth: number;   // e.g. 2;
}

export interface CompassAxis {
  readonly angleDeg: number;         // 0 = North, 90 = East, etc.
  readonly length: number;
  readonly width: number;
  readonly role: "GOVERNANCE" | "RUNTIME" | "REPLAY" | "AUDIT" | "EVOLUTION" | "SCHEDULER" | "TELEMETRY" | "REGISTRY";
}

export interface CompassSvgSpec {
  readonly viewBox: string;          // "0 0 100 100"
  readonly outerCirclePath: string;
  readonly innerRingPath: string;
  readonly centerCirclePath: string;
  readonly axesPaths: readonly string[];
}

// Helpers to build SVG paths from geometry.

export function buildCompassGeometry(): CompassGeometry {
  return {
    outerRadius: 48,
    innerRingRadius: 40,
    centerRadius: 6,
    mainAxisLength: 52,
    mainAxisWidth: 4,
    minorAxisLength: 44,
    minorAxisWidth: 2,
  };
}

export function buildCompassAxes(geom: CompassGeometry): CompassAxis[] {
  const mainRoles: CompassAxis["role"][] = ["GOVERNANCE", "RUNTIME", "REPLAY", "AUDIT"];
  const minorRoles: CompassAxis["role"][] = ["EVOLUTION", "SCHEDULER", "TELEMETRY", "REGISTRY"];

  const mainAngles = [0, 90, 180, 270];
  const minorAngles = [45, 135, 225, 315];

  const mainAxes = mainAngles.map((angleDeg, i) => ({
    angleDeg,
    length: geom.mainAxisLength,
    width: geom.mainAxisWidth,
    role: mainRoles[i],
  }));

  const minorAxes = minorAngles.map((angleDeg, i) => ({
    angleDeg,
    length: geom.minorAxisLength,
    width: geom.minorAxisWidth,
    role: minorRoles[i],
  }));

  return [...mainAxes, ...minorAxes];
}

export function buildCirclePath(cx: number, cy: number, r: number): string {
  // Simple SVG circle path using arc commands
  return [
    `M ${cx - r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
  ].join(" ");
}

export function buildAxisPath(
  cx: number,
  cy: number,
  axis: CompassAxis
): string {
  const rad = (axis.angleDeg * Math.PI) / 180;
  const x2 = cx + axis.length * Math.sin(rad);
  const y2 = cy - axis.length * Math.cos(rad);
  return `M ${cx} ${cy} L ${Number(x2.toFixed(2))} ${Number(y2.toFixed(2))}`;
}

export function buildCompassSvgSpec(geom: CompassGeometry): CompassSvgSpec {
  const cx = 50;
  const cy = 50;

  const outerCirclePath = buildCirclePath(cx, cy, geom.outerRadius);
  const innerRingPath = buildCirclePath(cx, cy, geom.innerRingRadius);
  const centerCirclePath = buildCirclePath(cx, cy, geom.centerRadius);

  const axes = buildCompassAxes(geom);
  const axesPaths = axes.map((axis) => buildAxisPath(cx, cy, axis));

  return {
    viewBox: "0 0 100 100",
    outerCirclePath,
    innerRingPath,
    centerCirclePath,
    axesPaths,
  };
}

export const DEFAULT_COMPASS_SVG_SPEC = buildCompassSvgSpec(buildCompassGeometry());
export * from './MpsCompass';
