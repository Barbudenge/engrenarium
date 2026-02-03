export const PX_PER_TOOTH = 0.6; // leve e compacto (escala de layout)
const ADDENDUM_PX = 2 * PX_PER_TOOTH; // adendo = m; raio de passo ~ z*m/2

const TAU = Math.PI * 2;
const EPS = 1e-6;

export type PlanetArmInput = {
  solarZ: number | null | undefined;
  annulusZ: number | null | undefined;
  planetsZ: number[];
};

export type PlanetArmLayout = {
  solarZ: number | null;
  annulusZ: number | null;
  planetsZ: number[];
  hasSun: boolean;
  hasRing: boolean;
  Rs: number;
  Ra: number;
  planetsR: number[];
  ringUsable: boolean;
  positions: [number, number][];
};

export function radiusFromZ(z: number | null): number {
  return Math.max(2, (z ?? 0) * PX_PER_TOOTH);
}

export function outerRadiusFromZ(z: number | null): number {
  return radiusFromZ(z) + ADDENDUM_PX;
}

export function computePlanetArmLayout(input: PlanetArmInput): PlanetArmLayout {
  const solarZ = Number.isFinite(input.solarZ ?? NaN) ? (input.solarZ as number) : null;
  const annulusZ = Number.isFinite(input.annulusZ ?? NaN) ? (input.annulusZ as number) : null;
  const planetsZ = (input.planetsZ ?? []).map((z) => (Number.isFinite(z) ? z : 0));

  const hasSun = solarZ != null;
  const hasRing = annulusZ != null;

  const Rs = hasSun ? radiusFromZ(solarZ) : 0;
  const Ra = hasRing ? radiusFromZ(annulusZ) : 0;

  const planetsR = planetsZ.map(radiusFromZ);
  const ringUsable = hasRing && planetsR.length > 0 && Ra > planetsR[0] * 1.05;
  const MIN_GAP = planetsR.length > 0 ? Math.max(1, planetsR[0] * 0.1) : 1;

  const positions: [number, number][] = [];

  if (planetsR.length > 0) {
    const Rp1 = planetsR[0];

    if (!hasSun && ringUsable && planetsR.length >= 2) {
      const n = planetsR.length;
      const posRadial: [number, number][] = new Array(n) as any;
      const contactR = Math.max(MIN_GAP, Ra - planetsR[n - 1]);
      posRadial[n - 1] = [contactR, 0];
      for (let k = n - 2; k >= 0; k--) {
        const next = posRadial[k + 1];
        const step = planetsR[k] + planetsR[k + 1];
        posRadial[k] = [Math.max(MIN_GAP, next[0] - step), 0];
      }
      positions.push(...posRadial);
    } else {
      const contactFromRing = Ra - Rp1;
      const x1 = hasSun
        ? Rs + Rp1
        : ringUsable
          ? Math.max(MIN_GAP, contactFromRing)
          : Math.max(MIN_GAP, Rp1);
      positions.push([x1, 0]);

      if (ringUsable && planetsR.length === 2) {
        const Rp2 = planetsR[1];
        const Rcirc = Ra - Rp2;

        const numer = (x1 * x1) + (Rcirc * Rcirc) - (Rp1 + Rp2) * (Rp1 + Rp2);
        const denom = 2 * x1 * Rcirc;
        let cosTheta = numer / (denom !== 0 ? denom : 1e-9);
        cosTheta = Math.max(-1, Math.min(1, cosTheta));
        const theta = Math.acos(cosTheta);

        positions.push([Rcirc * Math.cos(theta), Rcirc * Math.sin(theta)]);
      } else if (ringUsable && planetsR.length >= 3) {
        const rot = (vx: number, vy: number, ang: number): [number, number] => {
          const c = Math.cos(ang), s = Math.sin(ang);
          return [vx * c - vy * s, vx * s + vy * c];
        };

        const finalRadiusFor = (alpha: number): { lastR: number; pts: [number, number][] } => {
          const pts: [number, number][] = [[x1, 0]];
          let dir: [number, number] = [1, 0];

          for (let k = 1; k < planetsR.length; k++) {
            dir = rot(dir[0], dir[1], alpha);
            const step = planetsR[k - 1] + planetsR[k];
            const prev = pts[k - 1];
            pts.push([prev[0] + dir[0] * step, prev[1] + dir[1] * step]);
          }

          const last = pts[pts.length - 1];
          const lastR = Math.hypot(last[0], last[1]);
          return { lastR, pts };
        };

        const target = Ra - planetsR[planetsR.length - 1];
        let lo = 0, hi = Math.PI * 0.9;
        let best = finalRadiusFor(0);

        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2;
          const sim = finalRadiusFor(mid);
          best = sim;
          if (sim.lastR > target) {
            lo = mid;
          } else {
            hi = mid;
          }
        }

        positions.splice(0, positions.length, ...best.pts);
      } else {
        for (let k = 1; k < planetsR.length; k++) {
          const RpPrev = planetsR[k - 1];
          const RpK = planetsR[k];
          const prev = positions[k - 1];
          positions.push([prev[0] + RpPrev + RpK, 0]);
        }
      }
    }
  }

  return {
    solarZ,
    annulusZ,
    planetsZ,
    hasSun,
    hasRing,
    Rs,
    Ra,
    planetsR,
    ringUsable,
    positions,
  };
}

export function computeMaxPlanetCopies(input: PlanetArmInput | PlanetArmLayout): number {
  const layout = "positions" in input ? input : computePlanetArmLayout(input);
  const { positions, planetsZ } = layout;

  if (positions.length === 0) return 1;

  const outerR = planetsZ.map(outerRadiusFromZ);

  let upper = Infinity;
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = positions[i];
    const r = Math.hypot(x, y);
    const Ro = outerR[i];
    if (!Number.isFinite(r) || r <= Ro + EPS) return 1;

    const ratio = Math.min(1, Math.max(0, Ro / r));
    const half = Math.asin(ratio);
    if (!Number.isFinite(half) || half <= 0) continue;

    const Ni = Math.floor(Math.PI / half);
    upper = Math.min(upper, Math.max(1, Ni));
  }

  if (!Number.isFinite(upper) || upper < 1) return 1;

  const maxCandidate = Math.max(1, Math.floor(upper));

  const canFit = (N: number): boolean => {
    if (N <= 1) return true;
    const ang = TAU / N;
    const c = Math.cos(ang), s = Math.sin(ang);
    const rot = positions.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);

    for (let i = 0; i < positions.length; i++) {
      const [xi, yi] = positions[i];
      const ri = outerR[i];
      for (let j = 0; j < rot.length; j++) {
        const dx = xi - rot[j][0];
        const dy = yi - rot[j][1];
        const minDist = ri + outerR[j];
        if (dx * dx + dy * dy < (minDist - EPS) * (minDist - EPS)) return false;
      }
    }

    return true;
  };

  for (let N = maxCandidate; N >= 1; N--) {
    if (canFit(N)) return N;
  }

  return 1;
}
