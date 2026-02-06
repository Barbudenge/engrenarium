export type UICouplingLike = { a?: string; b?: string };

type Vec3Like = { x: number; y: number; z: number };

export type CarrierPathEntry = {
  stageId: number;
  paths: Vec3Like[][];
  z: number;
};

export type RingPathEntry = {
  stageId: number;
  pitchRadius: number;
  annulusZ: number;
  z: number;
};

export type SunPathEntry = {
  stageId: number;
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

export type ArmRingCouplingSegments = {
  armStage: number;
  ringStage: number;
  segments: CouplingSegment[];
  elbows: Vec3Like[];
  pads: Vec3Like[];
};

export type RingCouplingSpan = {
  stageA: number;
  stageB: number;
  zStart: number;
  zEnd: number;
  bendZ: number;
  rInnerA: number;
  rOuterA: number;
  rInnerB: number;
  rOuterB: number;
};

export type SunCouplingSpan = {
  stageA: number;
  stageB: number;
  zStart: number;
  zEnd: number;
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

type BuildRingCouplingParams = {
  couplings: UICouplingLike[] | undefined;
  ringPaths: RingPathEntry[];
  gearThickness: number;
  ringThickness: number;
  alignEps?: number;
};

type BuildArmRingCouplingParams = {
  couplings: UICouplingLike[] | undefined;
  carrierPaths: CarrierPathEntry[];
  ringPaths: RingPathEntry[];
  plateThickness: number;
  gearThickness: number;
  carrierZOffset: number;
  ringThickness: number;
  pegRadius: number;
  minCarrierRadius?: number;
  detourClearance?: number;
  alignEps?: number;
};

type BuildSunCouplingParams = {
  couplings: UICouplingLike[] | undefined;
  sunPaths: SunPathEntry[];
  shaftLength: number;
  alignEps?: number;
};

const ARM_RE = /^omega_b(\d+)$/;
const RING_RE = /^omega_a(\d+)$/;
const SUN_RE = /^omega_s(\d+)$/;

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

function parseRingCouplings(couplings: UICouplingLike[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const c of couplings) {
    if (!c?.a || !c?.b) continue;
    const ma = c.a.match(RING_RE);
    const mb = c.b.match(RING_RE);
    if (!ma || !mb) continue;
    const a = Number(ma[1]);
    const b = Number(mb[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    out.push({ a, b });
  }
  return out;
}

function parseArmRingCouplings(
  couplings: UICouplingLike[]
): { arm: number; ring: number }[] {
  const out: { arm: number; ring: number }[] = [];
  for (const c of couplings) {
    if (!c?.a || !c?.b) continue;
    const aArm = c.a.match(ARM_RE);
    const aRing = c.a.match(RING_RE);
    const bArm = c.b.match(ARM_RE);
    const bRing = c.b.match(RING_RE);
    let arm: number | null = null;
    let ring: number | null = null;
    if (aArm && bRing) {
      arm = Number(aArm[1]);
      ring = Number(bRing[1]);
    } else if (aRing && bArm) {
      arm = Number(bArm[1]);
      ring = Number(aRing[1]);
    }
    if (arm == null || ring == null) continue;
    if (!Number.isFinite(arm) || !Number.isFinite(ring) || arm === ring) continue;
    out.push({ arm, ring });
  }
  return out;
}

function parseSunCouplings(couplings: UICouplingLike[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const c of couplings) {
    if (!c?.a || !c?.b) continue;
    const ma = c.a.match(SUN_RE);
    const mb = c.b.match(SUN_RE);
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

function findPrevStageZ(entries: { z: number }[], zB: number): number | null {
  let best: number | null = null;
  for (const entry of entries) {
    if (entry.z < zB && (best == null || entry.z > best)) {
      best = entry.z;
    }
  }
  return best;
}

function computeRingBaseRadii(
  pitchRadius: number,
  annulusZ: number,
  ringThickness: number
): { inner: number; outer: number } | null {
  if (!Number.isFinite(pitchRadius) || pitchRadius <= 0) return null;
  const teeth = Math.abs(annulusZ);
  if (!Number.isFinite(teeth) || teeth <= 0) return null;
  const rimFactor = (2 * Math.max(0, ringThickness)) / teeth;
  const inner = pitchRadius * (1 + 2 / teeth);
  const outer = pitchRadius * (1 + 2 / teeth + rimFactor);
  if (!Number.isFinite(inner) || !Number.isFinite(outer) || outer <= inner) return null;
  return { inner, outer };
}

function computeMaxCarrierRadius(paths: Vec3Like[][]): number {
  let maxRadius = 0;
  for (const anchors of paths) {
    if (!anchors || anchors.length < 2) continue;
    const center = anchors[0];
    for (let i = 1; i < anchors.length; i++) {
      const p = anchors[i];
      const r = Math.hypot(p.x - center.x, p.y - center.y);
      if (r > maxRadius) maxRadius = r;
    }
  }
  return maxRadius;
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

export function buildArmRingCouplingSegments({
  couplings,
  carrierPaths,
  ringPaths,
  plateThickness,
  gearThickness,
  carrierZOffset,
  ringThickness,
  pegRadius,
  minCarrierRadius,
  detourClearance = 0,
  alignEps = 1e-3,
}: BuildArmRingCouplingParams): ArmRingCouplingSegments[] {
  if (
    !couplings ||
    couplings.length === 0 ||
    carrierPaths.length === 0 ||
    ringPaths.length === 0
  ) {
    return [];
  }

  const pairs = parseArmRingCouplings(couplings);
  if (pairs.length === 0) return [];

  const carrierByStage = new Map<number, CarrierPathEntry>();
  for (const entry of carrierPaths) carrierByStage.set(entry.stageId, entry);

  const ringByStage = new Map<number, RingPathEntry>();
  for (const entry of ringPaths) ringByStage.set(entry.stageId, entry);

  const stageZById = new Map<number, number>();
  const stageRadiusById = new Map<number, number>();

  for (const entry of carrierPaths) {
    stageZById.set(entry.stageId, entry.z);
    const maxRadius = computeMaxCarrierRadius(entry.paths);
    const baseRadius = Math.max(maxRadius, minCarrierRadius ?? 0);
    stageRadiusById.set(entry.stageId, baseRadius);
  }

  for (const entry of ringPaths) {
    stageZById.set(entry.stageId, entry.z);
    const radii = computeRingBaseRadii(entry.pitchRadius, entry.annulusZ, ringThickness);
    if (!radii) continue;
    const prev = stageRadiusById.get(entry.stageId) ?? 0;
    stageRadiusById.set(entry.stageId, Math.max(prev, radii.outer));
  }

  const seen = new Set<string>();
  const out: ArmRingCouplingSegments[] = [];

  for (const { arm, ring } of pairs) {
    const armEntry = carrierByStage.get(arm);
    const ringEntry = ringByStage.get(ring);
    if (!armEntry || !ringEntry) continue;

    const key = `${arm}-${ring}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ringRadii = computeRingBaseRadii(
      ringEntry.pitchRadius,
      ringEntry.annulusZ,
      ringThickness
    );
    if (!ringRadii) continue;

    const armZ = stageZById.get(arm) ?? armEntry.z;
    const ringZ = stageZById.get(ring) ?? ringEntry.z;
    const minZ = Math.min(armZ, ringZ);
    const maxZ = Math.max(armZ, ringZ);
    const betweenStages: number[] = [];
    let avoidRadius = 0;
    for (const [sid, z] of stageZById) {
      if (sid === arm || sid === ring) continue;
      if (z > minZ + alignEps && z < maxZ - alignEps) {
        betweenStages.push(z);
        avoidRadius = Math.max(avoidRadius, stageRadiusById.get(sid) ?? 0);
      }
    }
    betweenStages.sort((a, b) => (armZ <= ringZ ? a - b : b - a));

    const safePeg = Math.max(0, pegRadius);
    const targetRadius = Math.max(0, ringRadii.outer - safePeg);
    const detourBase =
      avoidRadius > 0 ? avoidRadius + detourClearance : targetRadius;
    const detourRadius = Math.max(targetRadius, detourBase);
    const needsDetour = avoidRadius > 0 && detourRadius > targetRadius + alignEps;

    const segments: CouplingSegment[] = [];
    const elbows: Vec3Like[] = [];
    const pads: Vec3Like[] = [];

    const copyCount = armEntry.paths.length;
    if (copyCount === 0) continue;

    for (let c = 0; c < copyCount; c++) {
      const anchorsA = armEntry.paths[c];
      if (!anchorsA || anchorsA.length < 2) continue;

      const centerA = anchorsA[0];
      const centerB = { x: 0, y: 0, z: ringEntry.z };

      for (let p = 1; p < anchorsA.length; p++) {
        const aPt = anchorsA[p];
        const ang = Math.atan2(aPt.y - centerA.y, aPt.x - centerA.x);
        const target = {
          x: centerB.x + targetRadius * Math.cos(ang),
          y: centerB.y + targetRadius * Math.sin(ang),
        };

        const startZ = aPt.z + carrierZOffset + plateThickness + gearThickness;
        const endZ =
          ringZ >= armZ ? ringEntry.z : ringEntry.z + gearThickness;
        const boundsMin = Math.min(startZ, endZ);
        const boundsMax = Math.max(startZ, endZ);
        const bendPlaneZ = (armZ + ringZ) / 2;
        const midZ = clamp(bendPlaneZ, boundsMin, boundsMax);

        const dx = target.x - aPt.x;
        const dy = target.y - aPt.y;
        const xyDist = Math.hypot(dx, dy);

        if (xyDist <= alignEps && !needsDetour) {
          segments.push({
            from: { x: aPt.x, y: aPt.y, z: startZ },
            to: { x: aPt.x, y: aPt.y, z: endZ },
          });
          continue;
        }

        if (!needsDetour) {
          const elbowA = { x: aPt.x, y: aPt.y, z: midZ };
          const elbowB = { x: target.x, y: target.y, z: midZ };
          segments.push({ from: { x: aPt.x, y: aPt.y, z: startZ }, to: elbowA });
          segments.push({ from: elbowA, to: elbowB });
          segments.push({ from: elbowB, to: { x: target.x, y: target.y, z: endZ } });
          elbows.push(elbowA, elbowB);
          continue;
        }

        const detour = {
          x: centerB.x + detourRadius * Math.cos(ang),
          y: centerB.y + detourRadius * Math.sin(ang),
        };
        const firstBetween = betweenStages[0] ?? ((armZ + ringZ) / 2);
        const lastBetween = betweenStages[betweenStages.length - 1] ?? firstBetween;
        const detourOutZ = clamp((armZ + firstBetween) / 2, boundsMin, boundsMax);
        const detourInZ = clamp((lastBetween + ringZ) / 2, boundsMin, boundsMax);

        const elbowA = { x: aPt.x, y: aPt.y, z: detourOutZ };
        const elbowOut = { x: detour.x, y: detour.y, z: detourOutZ };
        const elbowIn = { x: detour.x, y: detour.y, z: detourInZ };
        const elbowB = { x: target.x, y: target.y, z: detourInZ };

        segments.push({ from: { x: aPt.x, y: aPt.y, z: startZ }, to: elbowA });
        segments.push({ from: elbowA, to: elbowOut });
        segments.push({ from: elbowOut, to: elbowIn });
        segments.push({ from: elbowIn, to: elbowB });
        segments.push({ from: elbowB, to: { x: target.x, y: target.y, z: endZ } });
        elbows.push(elbowA, elbowOut, elbowIn, elbowB);
      }
    }

    if (segments.length > 0) {
      out.push({
        armStage: arm,
        ringStage: ring,
        segments,
        elbows,
        pads,
      });
    }
  }

  return out;
}

export function buildRingRingCouplingSpans({
  couplings,
  ringPaths,
  gearThickness,
  ringThickness,
  alignEps = 1e-3,
}: BuildRingCouplingParams): RingCouplingSpan[] {
  if (!couplings || couplings.length === 0 || ringPaths.length === 0) return [];

  const pairs = parseRingCouplings(couplings);
  if (pairs.length === 0) return [];

  const byStage = new Map<number, RingPathEntry>();
  for (const entry of ringPaths) byStage.set(entry.stageId, entry);

  const seen = new Set<string>();
  const out: RingCouplingSpan[] = [];

  for (const { a, b } of pairs) {
    const entryA = byStage.get(a);
    const entryB = byStage.get(b);
    if (!entryA || !entryB) continue;

    let stageA = a;
    let stageB = b;
    let pathA = entryA;
    let pathB = entryB;
    let zA = entryA.z;
    let zB = entryB.z;

    if (zA > zB) {
      [stageA, stageB] = swap(stageA, stageB);
      [pathA, pathB] = swap(pathA, pathB);
      [zA, zB] = swap(zA, zB);
    }

    const key = `${stageA}-${stageB}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const radiiA = computeRingBaseRadii(pathA.pitchRadius, pathA.annulusZ, ringThickness);
    const radiiB = computeRingBaseRadii(pathB.pitchRadius, pathB.annulusZ, ringThickness);
    if (!radiiA || !radiiB) continue;

    const zStart = zA + gearThickness;
    const zEnd = zB;
    if (zEnd - zStart <= alignEps) continue;

    const prevZ = findPrevStageZ(ringPaths, zB) ?? zA;
    const bendZ = (prevZ + zB) / 2;
    const clampedBend = clamp(bendZ, zStart, zEnd);

    out.push({
      stageA,
      stageB,
      zStart,
      zEnd,
      bendZ: clampedBend,
      rInnerA: radiiA.inner,
      rOuterA: radiiA.outer,
      rInnerB: radiiB.inner,
      rOuterB: radiiB.outer,
    });
  }

  return out;
}

export function buildSunSunCouplingSpans({
  couplings,
  sunPaths,
  shaftLength,
  alignEps = 1e-3,
}: BuildSunCouplingParams): SunCouplingSpan[] {
  if (!couplings || couplings.length === 0 || sunPaths.length === 0) return [];

  const pairs = parseSunCouplings(couplings);
  if (pairs.length === 0) return [];

  const byStage = new Map<number, SunPathEntry>();
  for (const entry of sunPaths) byStage.set(entry.stageId, entry);

  const seen = new Set<string>();
  const out: SunCouplingSpan[] = [];

  for (const { a, b } of pairs) {
    const entryA = byStage.get(a);
    const entryB = byStage.get(b);
    if (!entryA || !entryB) continue;

    let stageA = a;
    let stageB = b;
    let zA = entryA.z;
    let zB = entryB.z;

    if (zA > zB) {
      [stageA, stageB] = swap(stageA, stageB);
      [zA, zB] = swap(zA, zB);
    }

    const key = `${stageA}-${stageB}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const zStart = zA - shaftLength;
    const zEnd = zB - shaftLength;
    if (zEnd - zStart <= alignEps) continue;

    out.push({ stageA, stageB, zStart, zEnd });
  }

  return out;
}
