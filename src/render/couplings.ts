export type UICouplingLike = { a?: string; b?: string };

type Vec3Like = { x: number; y: number; z: number };

export type CarrierPathEntry = {
  stageId: number;
  paths: Vec3Like[][];
  z: number;
};

export type CouplingSegment = {
  from: Vec3Like;
  to: Vec3Like;
};

export type ArmCouplingSegments = {
  stageA: number;
  stageB: number;
  segments: CouplingSegment[];
  elbows: Vec3Like[];
  pads: Vec3Like[];
};

type BuildArmCouplingParams = {
  couplings: UICouplingLike[] | undefined;
  carrierPaths: CarrierPathEntry[];
  plateThickness: number;
  gearThickness: number;
  carrierZOffset: number;
  minTargetRadius?: number;
  alignEps?: number;
};

const ARM_RE = /^omega_b(\d+)$/;

function parseArmCouplings(couplings: UICouplingLike[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const c of couplings) {
    if (!c?.a || !c?.b) continue;
    const ma = c.a.match(ARM_RE);
    const mb = c.b.match(ARM_RE);
    if (!ma || !mb) continue;
    const a = Number(ma[1]);
    const b = Number(mb[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    out.push({ a, b });
  }
  return out;
}

function swap<T>(a: T, b: T): [T, T] {
  return [b, a];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findPrevStageZ(carrierPaths: CarrierPathEntry[], zB: number): number | null {
  let best: number | null = null;
  for (const entry of carrierPaths) {
    if (entry.z < zB && (best == null || entry.z > best)) {
      best = entry.z;
    }
  }
  return best;
}

export function buildArmArmCouplingSegments({
  couplings,
  carrierPaths,
  plateThickness,
  gearThickness,
  carrierZOffset,
  minTargetRadius,
  alignEps = 1e-3,
}: BuildArmCouplingParams): ArmCouplingSegments[] {
  if (!couplings || couplings.length === 0 || carrierPaths.length === 0) return [];

  const pairs = parseArmCouplings(couplings);
  if (pairs.length === 0) return [];

  const byStage = new Map<number, CarrierPathEntry>();
  for (const entry of carrierPaths) byStage.set(entry.stageId, entry);

  const seen = new Set<string>();
  const out: ArmCouplingSegments[] = [];

  for (const { a, b } of pairs) {
    const entryA = byStage.get(a);
    const entryB = byStage.get(b);
    if (!entryA || !entryB) continue;

    let stageA = a;
    let stageB = b;
    let pathsA = entryA.paths;
    let pathsB = entryB.paths;
    let zA = entryA.z;
    let zB = entryB.z;

    if (zA > zB) {
      [stageA, stageB] = swap(stageA, stageB);
      [pathsA, pathsB] = swap(pathsA, pathsB);
      [zA, zB] = swap(zA, zB);
    }

    const key = `${stageA}-${stageB}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const segments: CouplingSegment[] = [];
    const elbows: Vec3Like[] = [];
    const pads: Vec3Like[] = [];
    const prevZ = findPrevStageZ(carrierPaths, zB) ?? zA;
    const bendPlaneZ = (prevZ + zB) / 2;
    const copyCount = pathsA.length;
    if (pathsB.length === 0) continue;
    for (let c = 0; c < copyCount; c++) {
      const anchorsA = pathsA[c];
      const anchorsB = pathsB[c % pathsB.length];
      if (!anchorsA || !anchorsB) continue;
      const planetCount = anchorsA.length - 1;
      if (planetCount <= 0) continue;

      const centerA = anchorsA[0];
      const centerB = anchorsB[0];
      let maxRadiusB = 0;
      for (let i = 1; i < anchorsB.length; i++) {
        const p = anchorsB[i];
        maxRadiusB = Math.max(maxRadiusB, Math.hypot(p.x - centerB.x, p.y - centerB.y));
      }
      if (maxRadiusB <= 1e-6) continue;
      const targetRadius = Math.max(maxRadiusB, minTargetRadius ?? 0);

      for (let p = 1; p <= planetCount; p++) {
        const aPt = anchorsA[p];
        const ang = Math.atan2(aPt.y - centerA.y, aPt.x - centerA.x);
        const target = {
          x: centerB.x + targetRadius * Math.cos(ang),
          y: centerB.y + targetRadius * Math.sin(ang),
        };

        const startZ = aPt.z + carrierZOffset + plateThickness + gearThickness;
        const endZ = centerB.z + carrierZOffset - plateThickness / 2;
        const midZ = clamp(bendPlaneZ, Math.min(startZ, endZ), Math.max(startZ, endZ));

        const dx = target.x - aPt.x;
        const dy = target.y - aPt.y;
        const xyDist = Math.hypot(dx, dy);

        if (xyDist <= alignEps) {
          segments.push({
            from: { x: aPt.x, y: aPt.y, z: startZ },
            to: { x: aPt.x, y: aPt.y, z: endZ },
          });
          pads.push({ x: target.x, y: target.y, z: endZ + plateThickness / 2 });
        } else {
          const elbowA = { x: aPt.x, y: aPt.y, z: midZ };
          const elbowB = { x: target.x, y: target.y, z: midZ };
          segments.push({
            from: { x: aPt.x, y: aPt.y, z: startZ },
            to: elbowA,
          });
          segments.push({
            from: elbowA,
            to: elbowB,
          });
          segments.push({
            from: elbowB,
            to: { x: target.x, y: target.y, z: endZ },
          });
          elbows.push(elbowA, elbowB);
          pads.push({ x: target.x, y: target.y, z: endZ + plateThickness / 2 });
        }
      }
    }

    if (segments.length > 0) {
      out.push({ stageA, stageB, segments, elbows, pads });
    }
  }

  return out;
}
