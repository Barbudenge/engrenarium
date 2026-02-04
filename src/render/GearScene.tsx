// src/render/GearScene.tsx
import React, { Suspense, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { Vector3 } from "three";
import { computeStagePhasing } from "./phasing";
import { buildArmArmCouplingSegments } from "./couplings";
import {
  computeMaxPlanetCopies,
  computePlanetArmLayout,
  PX_PER_TOOTH,
} from "../math/planetCopies";
import { strings, type Lang } from "../ui/i18n";
import { DesignTree, type TreeStage } from "../ui/DesignTree";
import type { UICoupling } from "../ui/presets";



// === Involute helpers (módulo em mm) ===
const DEG = Math.PI / 180;
const DEFAULT_PRESSURE_ANGLE = 20 * DEG; // evolvente padrão
const DEFAULT_MODULE_MM = 1;             // módulo padrão
const DEFAULT_EXTRUDE_DEPTH = 5;         // profundidade base da extrusão em Z
const DEFAULT_RING_THICKNESS = 5;        // espessura do anel (em múltiplos do módulo)

type GearProfile = {
  moduleMm: number;
  pressureAngleRad: number;
  extrudeDepth: number;
  backlash: number;
  undercut: boolean;
  ringThickness: number;
};

const GearProfileContext = React.createContext<GearProfile>({
  moduleMm: DEFAULT_MODULE_MM,
  pressureAngleRad: DEFAULT_PRESSURE_ANGLE,
  extrudeDepth: DEFAULT_EXTRUDE_DEPTH,
  backlash: 0,
  undercut: true,
  ringThickness: DEFAULT_RING_THICKNESS,
});

function useGearProfile(): GearProfile {
  return React.useContext(GearProfileContext);
}


type UIStageIn = {
  id: number;
  solarZ: number | null;
  planetsZ: number[];
  annulusZ: number | null;
  lastSolarZ?: number;
  planetCopies?: number;
};

type GearItem =
  | { id: string; kind: "sun";    r: number; pos: [number, number, number]; label: string; omegaId: string }
  | { id: string; kind: "planet"; r: number; pos: [number, number, number]; label: string; omegaId: string }
  | { id: string; kind: "ring";   r: number; pos: [number, number, number]; label: string; omegaId: string };


type RotZProps = {
  omega: number;
  resetOn?: string | number;
  preserveAngleOnReset?: boolean;
  children: React.ReactNode;
};

type StageLayout = { stageId: number; items: GearItem[]; positions: [number, number][]; copies: number; signature: string; };

const COLORS = {
  sun:    "#60a5fa",
  planet: "#22c55e",
  ring:   "#facc15",
  edge:   "#94a3b8",
  text:   "#e5e7eb",
};
const PLANET_COLOR_SEQUENCE = [COLORS.planet, "#f97316", "#a855f7"];

function getPlanetColorByIndex(idx: number) {
  if (PLANET_COLOR_SEQUENCE.length === 0) return COLORS.planet;
  const normalized = ((idx % PLANET_COLOR_SEQUENCE.length) + PLANET_COLOR_SEQUENCE.length) % PLANET_COLOR_SEQUENCE.length;
  return PLANET_COLOR_SEQUENCE[normalized] ?? COLORS.planet;
}

// Keys to control visibility of rendered pieces (visual only)
const stageKey = (sid: number) => `stage-${sid}`;
const sunKey = (sid: number) => `sun-${sid}`;
const ringKey = (sid: number) => `ring-${sid}`;
const carrierKey = (sid: number) => `carrier-${sid}`;
const planetKey = (sid: number, planetIdx: number) => `planet-${sid}-${planetIdx}`;
const stageIdFromKey = (key: string): number | null => {
  const m = key.match(/-(\d+)/);
  return m ? Number(m[1]) : null;
};

// regra de escala (passo = “módulo” visual) vem de ../math/planetCopies
const STAGE_GAP_Z = 20;    // folga entre superfícies consecutivas (Z)
const DISC_THICK   = 1.2;  // espessura visual
const SEGMENTS     = 64;   // segmentos do círculo (mantém leve)
const DOT_PX = 1.0;
const DOT_SURFACE_OFFSET = 0.2;        // desloca o marcador para fora da engrenagem
const GEAR_HOLE_RADIUS = 3;            // raio (mundo) do furo central nas solares/planetas
const SUN_SHAFT_LENGTH = 10;           // comprimento do eixo da solar (para trás)
const SUN_SHAFT_WALL = 2.5;            // espessura da parede do eixo
const SUN_SHAFT_OUTER_RADIUS = GEAR_HOLE_RADIUS + SUN_SHAFT_WALL;
const CARRIER_PLATE_THICKNESS = DISC_THICK * DEFAULT_EXTRUDE_DEPTH * 0.6;
const CARRIER_Z_OFFSET = -CARRIER_PLATE_THICKNESS * 0.6;
const CARRIER_PEG_RADIUS = GEAR_HOLE_RADIUS * 0.8;
const CARRIER_PAD_RADIUS = GEAR_HOLE_RADIUS * 1.35;
const CARRIER_CORE_OUTER_RADIUS = Math.max(GEAR_HOLE_RADIUS * 2.6, (GEAR_HOLE_RADIUS * 1.35) * 1.1);
const BODY_CLEAR = 0.985;
const DEBUG_PHASING = false;
const PHASE_ORIENT = -Math.PI / 2;  // -90°: leva o “0” da geometria (eixo +Y) para o eixo +X
const CARRIER_COLOR = "#e4e4e4";
const BASE_CAM_DIR = new Vector3(-2, 0, 1.65);
const BASE_CAM_DIST_FACTOR = BASE_CAM_DIR.length();
const MIN_FIT_RADIUS = 1e-3;
const BASE_FOV_DEG = 25;

function computeOrthoZoom(viewHeight: number, fittedR: number, cameraZoomMultiplier: number) {
  const safeR = Math.max(MIN_FIT_RADIUS, fittedR);
  const viewH = Math.abs(viewHeight);
  if (!Number.isFinite(viewH) || viewH <= 0) {
    return 1;
  }
  const camZ = Math.max(40, safeR * 2) * (cameraZoomMultiplier ?? 1);
  const desiredDist = camZ * BASE_CAM_DIST_FACTOR;
  const desiredHeight = 2 * desiredDist * Math.tan((BASE_FOV_DEG * DEG) / 2);
  const baseZoom = viewH / Math.max(MIN_FIT_RADIUS, desiredHeight);
  return baseZoom;
}

function syncOrthoFrustum(camera: any, size: { width: number; height: number }) {
  if (!camera || !size) return;
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
}

function radToDegList(arr: number[] | undefined): string {
  if (!arr || arr.length === 0) return "[]";
  return "[" + arr.map((x) => (x * 180 / Math.PI).toFixed(1)).join(", ") + "]";
}

function radToDeg(x?: number): string {
  return x == null ? "[]" : (x * 180 / Math.PI).toFixed(1);
}


// ===== Engrenagem involuta EXTERNA (adaptado de Leemon Baird) =====

// helpers (equivalentes ao script que você mandou)
function polar(r: number, theta: number): [number, number] {
  return [r * Math.sin(theta), r * Math.cos(theta)];
}
function iang(r1: number, r2: number) {
  return Math.sqrt((r2 / r1) * (r2 / r1) - 1) - Math.acos(r1 / r2);
}
function q6(b: number, s: number, t: number, d: number) {
  return polar(d, s * (iang(b, d) + t));
}
function q7(f: number, r: number, b: number, r2: number, t: number, s: number) {
  return q6(b, s, t, (1 - f) * Math.max(b, r) + f * r2);
}

// Constrói o POLÍGONO 2D da engrenagem (pontos no sentido CCW).
// Retorna também o raio de passo "p" (para escalar à sua cena).
function buildInvolutePolygon(
  z: number,
  m: number,
  pressureAngleRad = 20 * Math.PI / 180,
  clearance = 0.25 * m,
  backlash = 0.0,
  undercut = true
) {
  // relação entre o script e módulo: mm_per_tooth = π * m
  const mm_per_tooth = Math.PI * m;

  // variáveis do script original
  const p = (mm_per_tooth * z) / (Math.PI * 2); // raio de passo
  const backlashLinear = Math.max(-mm_per_tooth, Math.min(backlash, mm_per_tooth));
  const baseAddendum = mm_per_tooth / Math.PI - clearance;
  const effectiveAddendum = Math.max(0, baseAddendum - backlashLinear);
  const c = p + effectiveAddendum; // raio externo reduzido pelo backlash
  const b = p * Math.cos(pressureAngleRad);         // base
  const r = p - mm_per_tooth / Math.PI;             // raiz original (mantém furo)
  const halfTooth = mm_per_tooth / 2;
  const t = Math.max(0, halfTooth - backlashLinear / 2); // espessura no passo
  const k = -iang(b, p) - t / (2 * p);                   // ângulo onde involuta encontra base

  let angleRootLeft = -Math.PI / z;
  let angleRootRight = Math.PI / z;

  if (r < b) {
    if (undercut) {
      angleRootLeft = k;
      angleRootRight = -k;
    } else {
      const slopeOffset = ((b - r) / b) * Math.tan(pressureAngleRad);
      angleRootLeft = k - slopeOffset;
      angleRootRight = -(k - slopeOffset);
    }
  }

  // define 1 dente (16 pontos ~ do script)
  const ptsTooth: [number, number][] = [
    polar(r, -Math.PI / z),
    polar(r, r < b ? angleRootLeft : -Math.PI / z),

    q7(0 / 5, r, b, c, k, +1), q7(1 / 5, r, b, c, k, +1), q7(2 / 5, r, b, c, k, +1),
    q7(3 / 5, r, b, c, k, +1), q7(4 / 5, r, b, c, k, +1), q7(5 / 5, r, b, c, k, +1),

    q7(5 / 5, r, b, c, k, -1), q7(4 / 5, r, b, c, k, -1), q7(3 / 5, r, b, c, k, -1),
    q7(2 / 5, r, b, c, k, -1), q7(1 / 5, r, b, c, k, -1), q7(0 / 5, r, b, c, k, -1),

    polar(r, r < b ? angleRootRight : Math.PI / z),
    polar(r, +Math.PI / z),
  ];

  // replica o dente z vezes por rotação
  const step = (2 * Math.PI) / z;
  const all: [number, number][] = [];
  for (let i = 0; i < z; i++) {
    const a = -i * step; // sinal igual ao do script
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const [x, y] of ptsTooth) {
      const xr = x * ca - y * sa;
      const yr = y * ca + x * sa;
      all.push([xr, yr]);
    }
  }
  return { points: all, pitchRadius: p };
}

// Torção ao estilo linear_extrude(twist=...) do OpenSCAD: rotação pura ao longo de Z
function applyHelixTwist(geo: THREE.ExtrudeGeometry, helixAngleRad: number, depth: number, pitchRadius: number) {
  if (!geo || !Number.isFinite(helixAngleRad) || Math.abs(helixAngleRad) < 1e-6 || depth <= 0 || pitchRadius <= 0) {
    return geo;
  }
  const pos = geo.attributes.position;
  const centerZ = depth / 2;
  const twistRate = Math.tan(helixAngleRad) / pitchRadius; // radianos por unidade de Z
  const vec = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos as any, i);
    const zOffset = vec.z - centerZ;
    const theta = zOffset * twistRate;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const rx = vec.x * c - vec.y * s;
    const ry = vec.x * s + vec.y * c;
    (pos as any).setX(i, rx);
    (pos as any).setY(i, ry);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Gera geometria 3D por extrusão de um único Shape fechado
function makeInvoluteGearGeometry(
  z: number,
  m: number,
  pressureAngleRad: number,
  extrudeDepth: number,
  holeRadius = 0,
  backlash = 0,
  undercut = true
) {
  const { points, pitchRadius } = buildInvolutePolygon(
    z,
    m,
    pressureAngleRad,
    0,
    backlash,
    undercut
  );
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();

  if (holeRadius > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: false,
    curveSegments: 10,
    steps: Math.max(1, Math.round(extrudeDepth * 0.5)),
  });
  geo.computeVertexNormals();
  return { geo, rp: pitchRadius };
}

// Engrenagem involuta EXTERNA pronta para a cena; escala XY para casar rp -> rVisual
function Gear3D({
  teeth, rVisual, color, pos, localOmega, thickness = 1.2, phase = 0, resetOn, holeRadius = 0, helixAngleRad = 0, backlashOverride, opacity = 1,
}: {
  teeth: number;
  rVisual: number;
  color: string;
  pos: [number, number, number];
  localOmega: number;
  thickness?: number;
  phase?: number;
  resetOn?: any;
  holeRadius?: number;
  helixAngleRad?: number;
  backlashOverride?: number;
  opacity?: number;
}) {
  const { moduleMm, pressureAngleRad, extrudeDepth, backlash, undercut } = useGearProfile();
  const activeBacklash = backlashOverride != null ? backlashOverride : backlash;
  const baseRp = (teeth * moduleMm) / 2;
  const preScale = rVisual / Math.max(1e-5, baseRp);
  const holeRadiusGeom = holeRadius > 0 ? holeRadius / preScale : 0;
  const { geo, rp } = React.useMemo(
    () => {
      const { geo, rp } = makeInvoluteGearGeometry(
        teeth,
        moduleMm,
        pressureAngleRad,
        extrudeDepth,
        holeRadiusGeom,
        activeBacklash,
        undercut
      );
      applyHelixTwist(geo as any, helixAngleRad ?? 0, extrudeDepth, rp);
      return { geo, rp };
    },
    [teeth, moduleMm, pressureAngleRad, extrudeDepth, holeRadiusGeom, helixAngleRad, activeBacklash, undercut]
  );
  const meshRef = React.useRef<THREE.Mesh>(null!);
  const sXY = rVisual / rp;
  const plugHeight = thickness * extrudeDepth;

  // ângulo absoluto = offset + ω*(t - t0)
  const start = React.useRef(0);
  const offset = React.useRef(0);
  const prevOmega = React.useRef(localOmega);
  const needsReset = React.useRef(true);
  const prevKey = React.useRef<any>(resetOn);

  React.useEffect(() => {
    if (resetOn !== prevKey.current) {
      needsReset.current = true;        // reancora no próximo frame
      prevKey.current = resetOn;
    }
  }, [resetOn]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    // reset (fase mudou)
    if (needsReset.current) {
      start.current = t;
      offset.current = 0;
      prevOmega.current = localOmega;
      meshRef.current.rotation.z = 0;
      needsReset.current = false;
      return;
    }

    // ω mudou → preservar continuidade
    if (localOmega !== prevOmega.current) {
      offset.current += prevOmega.current * (t - start.current);
      start.current = t;
      prevOmega.current = localOmega;
    }

    meshRef.current.rotation.z = offset.current + prevOmega.current * (t - start.current);
  });

  const isVisible = opacity > 0.001;
//.
  return (
    <group position={pos} rotation={[0, 0, phase + PHASE_ORIENT]} visible={isVisible}>
      <mesh ref={meshRef} scale={[sXY, sXY, thickness]}>
        <primitive object={geo} attach="geometry" />
        <meshStandardMaterial
          color={color}
          metalness={0.35}
          roughness={0.45}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      {holeRadius > 0 && (
        <mesh position={[0, 0, plugHeight / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[holeRadius, holeRadius, plugHeight, 48, 1, true]} />
          <meshStandardMaterial
            color={color}
            metalness={0.35}
            roughness={0.45}
            side={THREE.DoubleSide}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      )}
    </group>
  );
}



// ===== Anelar involuta: corpo externo + FURO com contorno de engrenagem EXTERNA =====
function makeInvoluteInternalGeometry(
  z: number,
  m: number,
  pressureAngleRad: number,
  extrudeDepth: number,
  backlash = 0,
  undercut = true,
  ringThickness = DEFAULT_RING_THICKNESS
) {
  // 1) Gera o contorno de uma ENGRENAGEM EXTERNA (mesmo z, módulo, ângulo)
  //    Isso é exatamente o “negativo” que precisamos para o dente interno.
  const { points: holePts, pitchRadius: rp } =
    buildInvolutePolygon(z, m, pressureAngleRad, 0, backlash, undercut);

  // 2) Cria o corpo do anel como um círculo externo “grosso”
  const addendum = 1 * m;
  const ringRim = Math.max(0, ringThickness) * m;
  const R_OUT = rp + addendum + ringRim;    // espessura do anel (ajuste à vontade)
  const OUT_SEG = 128;

  const shape = new THREE.Shape();        // externo CCW
  shape.moveTo(R_OUT, 0);
  for (let i = 1; i <= OUT_SEG; i++) {
    const th = (i / OUT_SEG) * 2 * Math.PI;
    shape.lineTo(R_OUT * Math.cos(th), R_OUT * Math.sin(th));
  }
  shape.closePath();

  // 3) Adiciona o FURO com o contorno da engrenagem externa (revertido → CW)
  const hole = new THREE.Path();
  const first = holePts[0];
  hole.moveTo(first[0], first[1]);
  for (let i = holePts.length - 1; i >= 0; i--) {
    hole.lineTo(holePts[i][0], holePts[i][1]);     // ordem reversa = CW
  }
  hole.closePath();
  shape.holes.push(hole);

  // 4) Extrusão
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: false,
    curveSegments: 10,
    steps: Math.max(1, Math.round(extrudeDepth * 0.5)),
  });
  geo.computeVertexNormals();

  return { geo, rp };
}

function Gear3DInternal({
  teeth, rVisual, color, pos, localOmega, thickness = 1.2, phase = 0, resetOn, helixAngleRad = 0, backlashOverride, opacity = 1,
}: {
  teeth: number;
  rVisual: number;
  color: string;
  pos: [number, number, number];
  localOmega: number;
  thickness?: number;
  phase?: number;
  resetOn?: any;
  helixAngleRad?: number;
  backlashOverride?: number;
  opacity?: number;
}) {
  const { moduleMm, pressureAngleRad, extrudeDepth, backlash, undercut, ringThickness } = useGearProfile();
  const activeBacklash = backlashOverride != null ? backlashOverride : backlash;
  const { geo, rp } = React.useMemo(
    () => {
      const { geo, rp } = makeInvoluteInternalGeometry(
        teeth,
        moduleMm,
        pressureAngleRad,
        extrudeDepth,
        activeBacklash,
        undercut,
        ringThickness
      );
      applyHelixTwist(geo as any, helixAngleRad ?? 0, extrudeDepth, rp);
      return { geo, rp };
    },
    [teeth, moduleMm, pressureAngleRad, extrudeDepth, helixAngleRad, activeBacklash, undercut, ringThickness]
  );
  const meshRef = React.useRef<THREE.Mesh>(null!);
  const sXY = rVisual / rp;

  // ângulo absoluto = offset + ω*(t - t0)
  const start = React.useRef(0);
  const offset = React.useRef(0);
  const prevOmega = React.useRef(localOmega);
  const needsReset = React.useRef(true);
  const prevKey = React.useRef<any>(resetOn);

  React.useEffect(() => {
    if (resetOn !== prevKey.current) {
      needsReset.current = true;
      prevKey.current = resetOn;
    }
  }, [resetOn]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    // reset (fase mudou)
    if (needsReset.current) {
      start.current = t;
      offset.current = 0;
      prevOmega.current = localOmega;
      meshRef.current.rotation.z = 0;
      needsReset.current = false;
      return;
    }

    // ω mudou → preservar continuidade
    if (localOmega !== prevOmega.current) {
      offset.current += prevOmega.current * (t - start.current);
      start.current = t;
      prevOmega.current = localOmega;
    }

    meshRef.current.rotation.z = offset.current + prevOmega.current * (t - start.current);
  });

  const isVisible = opacity > 0.001;

  return (
    <group position={pos} rotation={[0, 0, phase + PHASE_ORIENT]} visible={isVisible}>
      <mesh ref={meshRef} scale={[sXY, sXY, thickness]}>
        <primitive object={geo} attach="geometry" />
        <meshStandardMaterial
          color={color}
          metalness={0.4}
          roughness={0.4}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}



/**
 * Layout esquemático para UMA planetária:
 * - Sol no (0,0)
 * - Planeta1 à direita: x = Rs + Rp1
 * - Planeta_k em “cadeia” à direita: x += Rp_(k-1) + Rp_k
 * - Anelar centrado no (0,0) com raio = x_last + R_last (malha interna)
 */
function buildStageLayout(st: UIStageIn, zBase: number, topologyKey?: string): StageLayout {
  const items: GearItem[] = [];

  const armLayout = computePlanetArmLayout({
    solarZ: st.solarZ,
    annulusZ: st.annulusZ,
    planetsZ: st.planetsZ,
  });

  const {
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
  } = armLayout;

  // 2) Solar: só desenha se existir
  if (hasSun) {
    items.push({
      id: `sun-${st.id}`,
      kind: "sun",
      r: Rs,
      pos: [0, 0, zBase],
      label: "",
      omegaId: `omega_s${st.id}`,
    });
  }

  // 3) Planetas base (1 conjunto)
  positions.forEach((p, k) => {
    const omegaId = `omega_p${st.id}_${k + 1}`;
    items.push({
      id: `${omegaId}-base`,
      kind: "planet",
      r: planetsR[k],
      pos: [p[0], p[1], zBase],
      label: "",
      omegaId,
    });
  });

  // 4) Cópias VISUAIS dos planetas segundo o faseamento
  const maxCopies = computeMaxPlanetCopies(armLayout);
  const copies = Math.max(1, Math.min(maxCopies, Math.round(st.planetCopies ?? 1)));

  const phasing = computeStagePhasing({
    stageId: st.id,
    solarZ,
    annulusZ: ringUsable ? annulusZ : null, // se anel não comporta a planeta, não força faseamento de contato
    planetsZ,
    copies,
    positions, // centros das planetas do braço base
  });

  const copyAngles = phasing.copyAngles;

  if (copies > 1 && planetsR.length > 0 && copyAngles.length === copies) {
    for (let m = 1; m < copies; m++) {
      const ang = copyAngles[m];
      const c = Math.cos(ang), s = Math.sin(ang);

      for (let k = 0; k < planetsR.length; k++) {
        const [x, y] = positions[k];
        const rx = x * c - y * s;
        const ry = x * s + y * c;
        const omegaId = `omega_p${st.id}_${k + 1}`;

        items.push({
          id: `${omegaId}-copy-${m}`,
          kind: "planet",
          r: planetsR[k],
          pos: [rx, ry, zBase],
          label: "",
          omegaId,
        });
      }
    }
  }

  // 5) Anelar
  if (hasRing && annulusZ != null) {
    items.push({
      id: `ring-${st.id}`,
      kind: "ring",
      r: Ra,
      pos: [0, 0, zBase],
      label: "",
      omegaId: `omega_a${st.id}`,
    });
  }

  // 6) Monta o layout e pendura o faseamento
  const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(6) : "NaN");
  const positionsKey = positions.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(";");
  const itemsKey = items
    .map((it) => `${it.kind}:${fmt(it.r)}:${fmt(it.pos[0])}:${fmt(it.pos[1])}:${fmt(it.pos[2])}`)
    .join("|");
  const copyAnglesKey = copyAngles.map(fmt).join(",");
  const annulusSig = annulusZ ?? "null";
  const planetsSig = planetsZ.join(",");
  const signature = [
    `stage=${st.id}`,
    `solar=${solarZ ?? "null"}`,
    `annulus=${annulusSig}`,
    `planets=${planetsSig}`,
    `copies=${copies}`,
    `positions=${positionsKey}`,
    `items=${itemsKey}`,
    `copyAngles=${copyAnglesKey}`,
    `topo=${topologyKey ?? ""}`,
  ].join("||");

  const layout: StageLayout = { stageId: st.id, items, positions, copies, signature };
  (layout as any).__phasing = phasing;

  return layout;
}


// Ajusta câmera/target somente quando resetToken mudar
function AutoFitCamera({
  pos,
  target,
  resetToken,
}: {
  pos: [number, number, number];
  target: [number, number, number];
  resetToken: number | string;
}) {
  const { camera } = useThree();
  const controls = useThree((state: any) => (state as any).controls as any | undefined);

  React.useEffect(() => {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.updateProjectionMatrix();

    if (controls && typeof controls.target?.set === "function") {
      controls.target.set(target[0], target[1], target[2]);
      controls.update?.();
    }
  }, [resetToken, pos, target, camera, controls]);

  return null;
}

// Ajusta somente a distância (zoom) mantendo direção/target
function ZoomAdjust({
  cameraResetToken,
  cameraZoomFitToken,
  fittedR,
  cameraZoomMultiplier,
}: {
  cameraResetToken: number | string;
  cameraZoomFitToken: number | string;
  fittedR: number;
  cameraZoomMultiplier: number;
}) {
  const { camera } = useThree();
  const size = useThree((state: any) => (state as any).size as { width: number; height: number });
  const controls = useThree((state: any) => (state as any).controls as any | undefined);
  const lastResetRef = React.useRef(cameraResetToken);
  const lastFitRef = React.useRef(cameraZoomFitToken);
  const lastZoomRef = React.useRef(cameraZoomMultiplier);
  const lastSizeRef = React.useRef({ width: size?.width ?? 0, height: size?.height ?? 0 });
  const firstRunRef = React.useRef(true);

  React.useEffect(() => {
    const resetChanged = lastResetRef.current !== cameraResetToken;
    const fitChanged = lastFitRef.current !== cameraZoomFitToken;
    const zoomChanged = lastZoomRef.current !== cameraZoomMultiplier;
    const sizeChanged =
      lastSizeRef.current.width !== (size?.width ?? 0) ||
      lastSizeRef.current.height !== (size?.height ?? 0);
    lastResetRef.current = cameraResetToken;
    lastFitRef.current = cameraZoomFitToken;
    lastZoomRef.current = cameraZoomMultiplier;
    lastSizeRef.current = { width: size?.width ?? 0, height: size?.height ?? 0 };
    const shouldRun = firstRunRef.current || resetChanged || fitChanged || zoomChanged || sizeChanged;
    firstRunRef.current = false;
    if (!shouldRun) return;

    const targetVec = controls?.target
      ? controls.target.clone()
      : new Vector3(0, 0, 0);
    if ((camera as any)?.isOrthographicCamera) {
      syncOrthoFrustum(camera, size);
      const nextZoom = computeOrthoZoom(size?.height ?? 0, fittedR, cameraZoomMultiplier);
      if (Number.isFinite(nextZoom) && nextZoom > 0) {
        camera.zoom = nextZoom;
        camera.updateProjectionMatrix();
      }
      if (controls && typeof controls.target?.set === "function") {
        controls.target.set(targetVec.x, targetVec.y, targetVec.z);
        controls.update?.();
      }
      return;
    }
    const dir = new Vector3().subVectors(camera.position, targetVec);
    if (dir.length() < 1e-6) dir.copy(BASE_CAM_DIR);

    const camZ = Math.max(40, fittedR * 2) * (cameraZoomMultiplier ?? 1);
    const desiredDist = camZ * BASE_CAM_DIST_FACTOR;
    const newPos = targetVec.clone().add(dir.normalize().multiplyScalar(desiredDist));

    camera.position.copy(newPos);
    camera.updateProjectionMatrix();
    if (controls && typeof controls.target?.set === "function") {
      controls.target.set(targetVec.x, targetVec.y, targetVec.z);
      controls.update?.();
    }
  }, [cameraResetToken, cameraZoomMultiplier, fittedR, camera, controls, size?.width, size?.height, cameraZoomFitToken]);

  return null;
}

type CarrierVisualProps = {
  anchors: Vector3[]; // 0 = centro (sol), demais = planetas
  color?: string;
  opacity?: number;
};

function CarrierVisual({ anchors, color = CARRIER_COLOR, opacity = 1 }: CarrierVisualProps) {
  const baseHoleR = GEAR_HOLE_RADIUS;
  const holeR = Math.max(baseHoleR, SUN_SHAFT_OUTER_RADIUS + 0.5); // furo central do braço
  const pegR = CARRIER_PEG_RADIUS;                // diâmetro do pino = 80% do furo (engrenagem)
  // Mantém o "corpo" do braço estável, independente da largura da engrenagem
  const plateThickness = CARRIER_PLATE_THICKNESS;
  const { extrudeDepth } = useGearProfile();
  // Apenas o comprimento do pino acompanha a largura das engrenagens
  const gearThickness = DISC_THICK * extrudeDepth;
  const pegLength = gearThickness + plateThickness; // cobre engrenagem + base do pad
  const padR = CARRIER_PAD_RADIUS;
  const barThickness = plateThickness * 0.7;
  const center = anchors[0];
  const carrierZOffset = CARRIER_Z_OFFSET;
  const coreOuterR = CARRIER_CORE_OUTER_RADIUS;
  const rimThickness = barThickness;
  // posiciona barras/aneis com a face inferior alinhada ao fundo do disco central
  const zAlign = (-plateThickness + barThickness) / 2;

  if (!anchors || anchors.length < 2) return null;

  // Disco central com furo
  const coreMesh = React.useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, coreOuterR, 0, Math.PI * 2);
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: plateThickness,
      bevelEnabled: false,
      curveSegments: 48,
    });
    geo.translate(0, 0, -plateThickness / 2);
    geo.computeVertexNormals();
    return geo;
  }, [holeR, padR, plateThickness, coreOuterR]);

  // Cria uma barra ligando dois pontos no plano XY
  const makeBar = (from: Vector3, to: Vector3, startOffset: number, endOffset: number) => {
    const dir = new Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 1e-4) return null;
    const dirN = dir.clone().normalize();

    const usable = Math.max(0, dist - startOffset - endOffset);
    if (usable <= 0) return null;

    const geo = new THREE.BoxGeometry(usable, barThickness, barThickness);
    const mid = from.clone().addScaledVector(dirN, startOffset + usable / 2);
    const angleZ = Math.atan2(dir.y, dir.x);
    return (
      <mesh position={[mid.x, mid.y, mid.z + zAlign]} rotation={[0, 0, angleZ]}>
        <primitive object={geo} />
        <meshStandardMaterial
          color={color}
          metalness={0.2}
          roughness={0.5}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    );
  };

  const isVisible = opacity > 0.001;

  return (
    <group position={[0, 0, carrierZOffset]} visible={isVisible}>
      {/* Disco central com furo */}
      <mesh position={[center.x, center.y, center.z]}>
        <primitive object={coreMesh} />
        <meshStandardMaterial
          color={color}
          metalness={0.2}
          roughness={0.5}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>

      {/* Círculos ligando as extremidades (um por cada raio distinto das cadeias) */}
      {anchors.length > 1 && (() => {
        const cx = anchors[0].x;
        const cy = anchors[0].y;
        const radii = React.useMemo(() => {
          const vals = anchors.slice(1).map((p) => Math.hypot(p.x - cx, p.y - cy) + padR * 0.2);
          const uniq: number[] = [];
          vals.forEach((r) => {
            const key = Math.round(r * 1000) / 1000;
            if (!uniq.some((u) => Math.abs(u - key) < 1e-6)) uniq.push(key);
          });
          return uniq.sort((a, b) => a - b);
        }, [anchors, cx, cy, padR]);

        const RingBand = ({ radius }: { radius: number }) => {
          const ringMesh = React.useMemo(() => {
            const shape = new THREE.Shape();
            shape.absarc(0, 0, radius, 0, Math.PI * 2);
            const hole = new THREE.Path();
            hole.absarc(0, 0, Math.max(radius - rimThickness, 0), 0, Math.PI * 2, true);
            shape.holes.push(hole);

            const geo = new THREE.ExtrudeGeometry(shape, {
              depth: barThickness,
              bevelEnabled: false,
              curveSegments: 96,
            });
            geo.translate(0, 0, -barThickness / 2);
            geo.computeVertexNormals();
            return geo;
          }, [radius]);

          return (
            <mesh position={[cx, cy, anchors[0].z + zAlign]}>
              <primitive object={ringMesh} />
              <meshStandardMaterial
                color={color}
                metalness={0.15}
                roughness={0.45}
                transparent={opacity < 1}
                opacity={opacity}
              />
            </mesh>
          );
        };

        return radii.map((r, idx) => <RingBand key={idx} radius={r} />);
      })()}

      {/* Barras sequenciais + pads + pinos para cada planeta */}
      {anchors.length >= 2 &&
        anchors.slice(0, -1).map((from, idx) => {
          const to = anchors[idx + 1];
          const isFromCenter = idx === 0;
          const startOffset = isFromCenter ? (coreOuterR + holeR) / 2 : 0; // só corta no disco central
          const endOffset = -padR * 0.5; // penetra até o centro do pad
          const bar = makeBar(from, to, startOffset, endOffset);
          return (
            <React.Fragment key={idx}>
              {bar}
              {/* pad plano (achatado no plano XY) no destino */}
          <mesh position={[to.x, to.y, to.z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[padR, padR, plateThickness, 32]} />
            <meshStandardMaterial
              color={color}
              metalness={0.2}
              roughness={0.5}
              transparent={opacity < 1}
              opacity={opacity}
            />
          </mesh>
          {/* pino na direção Z, partindo do pad e cobrindo a espessura da engrenagem */}
          <mesh position={[to.x, to.y, to.z + plateThickness / 2 + gearThickness / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[pegR, pegR, pegLength, 32]} />
            <meshStandardMaterial
              color={color}
              metalness={0.25}
              roughness={0.45}
              transparent={opacity < 1}
              opacity={opacity}
            />
          </mesh>
            </React.Fragment>
          );
        })}
    </group>
  );
}

type CouplingRodProps = {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  radius: number;
  color: string;
  opacity: number;
};

function CouplingRod({ from, to, radius, color, opacity }: CouplingRodProps) {
  const dir = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = dir.length();
  if (length < 1e-4) return null;
  const mid = new Vector3(
    (from.x + to.x) / 2,
    (from.y + to.y) / 2,
    (from.z + to.z) / 2
  );
  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());

  return (
    <mesh position={[mid.x, mid.y, mid.z]} quaternion={quat}>
      <cylinderGeometry args={[radius, radius, length, 24]} />
      <meshStandardMaterial
        color={color}
        metalness={0.25}
        roughness={0.45}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

type CouplingElbowProps = {
  at: { x: number; y: number; z: number };
  radius: number;
  color: string;
  opacity: number;
};

function CouplingElbow({ at, radius, color, opacity }: CouplingElbowProps) {
  return (
    <mesh position={[at.x, at.y, at.z]}>
      <sphereGeometry args={[radius, 24, 16]} />
      <meshStandardMaterial
        color={color}
        metalness={0.25}
        roughness={0.45}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

type CouplingPadProps = {
  at: { x: number; y: number; z: number };
  radius: number;
  thickness: number;
  color: string;
  opacity: number;
};

function CouplingPad({ at, radius, thickness, color, opacity }: CouplingPadProps) {
  return (
    <mesh position={[at.x, at.y, at.z]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[radius, radius, thickness, 32]} />
      <meshStandardMaterial
        color={color}
        metalness={0.2}
        roughness={0.5}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

const Z_EPS = 0.001;       // para evitar z-fighting



export function Disc({
  r,
  color,
  z,
  filled = true,
}: {
  r: number;
  color: string;
  z: number;
  filled?: boolean;
}) {
  if (filled) {
    const rBody = r * BODY_CLEAR;
    return (
      <group>
        <mesh position={[0, 0, z]}>
          <circleGeometry args={[rBody, SEGMENTS]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} side={2} />
        </mesh>
        <mesh position={[0, 0, z + Z_EPS]}>
          <ringGeometry args={[rBody * 0.985, rBody * 1.01, SEGMENTS]} />
          <meshBasicMaterial color={COLORS.edge} />
        </mesh>
      </group>
    );
  }

  // Anel FINO (pitch circle): traço dourado + hairline prateado
  const THIN = 0.04;               // espessura relativa do traço
  const inner = r * (1 - THIN/2);
  const outer = r * (1 + THIN/2);

  return (
    <group>
      {/* aro dourado exatamente no raio de passo */}
      <mesh position={[0, 0, z]}>
        <ringGeometry args={[inner, outer, SEGMENTS]} />
        <meshBasicMaterial color={COLORS.ring} />
      </mesh>
      {/* hairlines prateados bem finos, colados no aro */}
      <mesh position={[0, 0, z + Z_EPS * 2]}>
        <ringGeometry args={[inner * 0.998, inner * 1.002, SEGMENTS]} />
        <meshBasicMaterial color={COLORS.edge} />
      </mesh>
      <mesh position={[0, 0, z + Z_EPS * 3]}>
        <ringGeometry args={[outer * 0.998, outer * 1.002, SEGMENTS]} />
        <meshBasicMaterial color={COLORS.edge} />
      </mesh>
    </group>
  );
}




export function GearLabel({ text, pos }: { text: string; pos: [number, number, number] }) {
  return (
    <Html position={pos} center distanceFactor={8} style={{ pointerEvents: "none" }}>
      <div style={{
        fontSize: 12, color: COLORS.text, background: "#00000066",
        border: "1px solid #ffffff33", padding: "2px 6px", borderRadius: 6
      }}>{text}</div>
    </Html>
  );
}


/** Marcador (DOT) que gira junto com a engrenagem.
 *  - sem disco de fundo
 *  - aparece acima dos dentes
 *  - ângulo inicial = phase (fase da engrenagem)
 */
function SpinningDisc({
  r,
  color,
  pos,
  localOmega,
  filled = true,
  phase = 0,
  thickness = DISC_THICK,
  resetToken,
  opacity = 1,
}: {
  r: number;
  color: string;
  pos: [number, number, number];
  localOmega: number;
  filled?: boolean;
  phase?: number;
  thickness?: number;
  resetToken?: any;
  opacity?: number;
}) {
  const dotR = DOT_PX;
  const { extrudeDepth } = useGearProfile();

  // raio onde o DOT aparece:
  //  - filled = engrenagem externa (sol/planeta): um pouco acima do passo
  //  - !filled = anelar interno: um pouco para dentro do passo
  const dotPosR = filled ? r * 0.9 : r * 1.05;

  // z acima da espessura da engrenagem, para não ficar escondido
  const dotZ = thickness * extrudeDepth + DOT_SURFACE_OFFSET;

  const isVisible = opacity > 0.001;

  return (
    // fase inicial aplicada aqui
    <group position={pos} rotation={[0, 0, phase + PHASE_ORIENT]} visible={isVisible}>
      {/* Rotação em serviço (ω local da engrenagem) */}
      <RotZ omega={localOmega} resetOn={resetToken ?? phase}>
        <mesh position={[0, dotPosR, dotZ]}>
          <circleGeometry args={[dotR, 32]} />
	          <meshBasicMaterial
	            color={color}
	            side={THREE.DoubleSide}
	            polygonOffset
	            polygonOffsetFactor={-1}
	            polygonOffsetUnits={-1}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      </RotZ>
    </group>
  );
}


function SunShaft({
  pos,
  color,
  localOmega,
  phase = 0,
  resetOn,
  opacity = 1,
}: {
  pos: [number, number, number];
  color: string;
  localOmega: number;
  phase?: number;
  resetOn?: any;
  opacity?: number;
}) {
  const innerR = GEAR_HOLE_RADIUS;
  const outerR = SUN_SHAFT_OUTER_RADIUS;
  const length = SUN_SHAFT_LENGTH;
  const isVisible = opacity > 0.001;

  const shaftMesh = React.useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, 0, Math.PI * 2);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
      curveSegments: 48,
    });
    // estende para trás (lado do braço): z ∈ [-length, 0]
    geo.translate(0, 0, -length);
    geo.computeVertexNormals();
    return geo;
  }, [innerR, outerR, length]);

  return (
    <group position={pos} rotation={[0, 0, phase + PHASE_ORIENT]} visible={isVisible}>
      <RotZ omega={localOmega} resetOn={resetOn}>
        <mesh>
          <primitive object={shaftMesh} />
          <meshStandardMaterial
            color={color}
            metalness={0.35}
            roughness={0.45}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      </RotZ>
    </group>
  );
}


function RotZ({
  omega,
  resetOn,
  preserveAngleOnReset = false,
  children,
}: RotZProps) {
  const ref = React.useRef<THREE.Group | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);

  // Sempre que o resetOn mudar, tratamos como "começar de novo"
  React.useEffect(() => {
    lastTimeRef.current = null; // força re-inicialização do integrador

    const obj = ref.current;
    if (!obj) return;

    // Se não queremos preservar o ângulo, zeramos a rotação acumulada
    if (!preserveAngleOnReset) {
      obj.rotation.z = 0;
    }
    // Se preserveAngleOnReset = true, apenas continuamos do ângulo atual
  }, [resetOn, preserveAngleOnReset]);

  useFrame((state) => {
    const obj = ref.current;
    if (!obj) return;

    const t = state.clock.getElapsedTime();

    // Primeira chamada após montar ou após um resetOn novo:
    if (lastTimeRef.current === null) {
      lastTimeRef.current = t;
      return;
    }

    const dt = t - lastTimeRef.current;
    lastTimeRef.current = t;

    // ω já está nas mesmas unidades que você usa hoje (rad/s)
    obj.rotation.z += omega * dt;
  });

  return <group ref={ref}>{children}</group>;
}




import * as THREE from "three";

// Gera geometria de engrenagem involuta EXTERNA (z dentes, módulo m)
// A geometria é construída em "mm", com raio de passo rp = z*m/2
// Depois o mesh é ESCALADO em XY para casar com o seu raio "visual" (rVisual).



// meshStandardMaterial color={color} metalness={0.15} roughness={0.6}
// Mesh pronto para usar em cena, casando o raio visual (rVisual) com o rp calculado



export function GearScene({
  stages,
  velocities,
  timeScale = 0.35,
  topologyKey,
  lang = "pt" as Lang,
  cameraZoomMultiplier = 1,
  cameraResetToken = 0,
  cameraZoomFitToken = 0,
  cameraProjection = "orthographic",
  gearModule = DEFAULT_MODULE_MM,
  gearPressureDeg = 20,
  gearHelixDeg = 0,
  gearWidth = DEFAULT_EXTRUDE_DEPTH,
  ringThickness = DEFAULT_RING_THICKNESS,
  backlash = 0,
  undercut = true,
  backlashPlanetsOnly = false,
  visibilityResetToken = 0,
  phaseResetToken = 0,
  couplings = [],
}: {
  stages: UIStageIn[];
  velocities: Record<string, number> | null;
  timeScale?: number;
  topologyKey?: string;
  lang?: Lang;
  cameraZoomMultiplier?: number;
  cameraResetToken?: number | string;
  cameraZoomFitToken?: number | string;
  cameraProjection?: "orthographic" | "perspective";
  gearModule?: number;
  gearPressureDeg?: number;
  gearHelixDeg?: number;
  gearWidth?: number;
  ringThickness?: number;
  backlash?: number;
  undercut?: boolean;
  backlashPlanetsOnly?: boolean;
  visibilityResetToken?: number | string;
  phaseResetToken?: number | string;
  couplings?: UICoupling[];
}) {

  const safeModuleMm = gearModule && gearModule > 0 ? gearModule : DEFAULT_MODULE_MM;
  const safeWidth = gearWidth && gearWidth > 0 ? gearWidth : DEFAULT_EXTRUDE_DEPTH;
  const safeRingThickness = Number.isFinite(ringThickness) ? Math.max(0, ringThickness) : DEFAULT_RING_THICKNESS;
  const safePressureDeg = Number.isFinite(gearPressureDeg) ? gearPressureDeg : 20;
  const pressureAngleRad = safePressureDeg * DEG;
  const helixAngleRadBase = (Number.isFinite(gearHelixDeg) ? gearHelixDeg : 0) * DEG;
  const mmPerToothProfile = Math.PI * safeModuleMm;
  const safeBacklash = Number.isFinite(backlash) ? Math.max(0, backlash) : 0;
  const appliedBacklash = Math.max(0, Math.min(safeBacklash, mmPerToothProfile));
  const safeUndercut = undercut !== false;
  const planetsOnlyBacklash = backlashPlanetsOnly === true;

  const gearProfile = React.useMemo<GearProfile>(
    () => ({
      moduleMm: safeModuleMm,
      pressureAngleRad,
      extrudeDepth: safeWidth,
      backlash: appliedBacklash,
      undercut: safeUndercut,
      ringThickness: safeRingThickness,
    }),
    [safeModuleMm, pressureAngleRad, safeWidth, appliedBacklash, safeUndercut, safeRingThickness]
  );

  const [hiddenParts, setHiddenParts] = React.useState<Set<string>>(new Set());
  const [rootCollapsed, setRootCollapsed] = React.useState(false);
  const [collapsedStages, setCollapsedStages] = React.useState<Set<number>>(new Set());

  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const gearVisualThickness = DISC_THICK * safeWidth;
  const stageStepZ = gearVisualThickness + STAGE_GAP_Z;
  const stageCount = stages.length;
  const backlashForKind = React.useCallback(
    (kind: "sun" | "planet" | "ring") => {
      if (planetsOnlyBacklash && kind !== "planet") return 0;
      if (kind === "ring") return -appliedBacklash;
      return appliedBacklash;
    },
    [planetsOnlyBacklash, appliedBacklash]
  );
  const stageZOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let current = 0;
    for (let i = 0; i < stageCount; i++) {
      offsets.push(current);
      current += stageStepZ;
    }
    return offsets;
  }, [stageCount, stageStepZ]);

  React.useEffect(() => {
    const allowed = new Set(stageIds);

    setHiddenParts((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((key) => {
        const sid = stageIdFromKey(key);
        if (sid === null || allowed.has(sid)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      if (!changed && next.size === prev.size) return prev;
      return next;
    });

    setCollapsedStages((prev) => {
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (allowed.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [stageIds]);

  // Reset de visibilidade quando solicitado (ex.: Nova planetária)
  React.useEffect(() => {
    setHiddenParts(new Set());
  }, [visibilityResetToken]);

  // Reset de colapsos para manter consistência visual ao criar nova planetária
  React.useEffect(() => {
    setCollapsedStages(new Set());
    setRootCollapsed(false);
  }, [visibilityResetToken]);

  const treeData: TreeStage[] = useMemo(() => {
    const S = strings[lang];
    return stages.map((st) => {
      const showPlanetIndex = st.planetsZ.length > 1;
      const planets = st.planetsZ.map((_, idx) => ({
        key: planetKey(st.id, idx + 1),
        label: showPlanetIndex ? `${S.planet} ${idx + 1}` : S.planet,
      }));

      const items: { key: string; label: string }[] = [];
      if (st.solarZ != null) items.push({ key: sunKey(st.id), label: S.solar });
      items.push(...planets);
      if (st.annulusZ != null) items.push({ key: ringKey(st.id), label: S.annulus });
      items.push({ key: carrierKey(st.id), label: S.arm });

      return { stageId: st.id, label: `${S.planetary} ${st.id}`, items };
    });
  }, [stages, lang]);

  const toggleVisibility = React.useCallback((key: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleStageCollapsed = React.useCallback((stageId: number) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  const toggleRoot = React.useCallback(() => {
    setRootCollapsed((prev) => !prev);
  }, []);

  const rpmToRad = (rpm: number) => (rpm * Math.PI * 2) / 60 * timeScale;

  const layouts = useMemo(() => {
    const L: StageLayout[] = [];
    for (let k = 0; k < stages.length; k++) {
      const st = stages[k];
      const z = stageZOffsets[k] ?? 0;
      const layout = buildStageLayout(st, z, topologyKey);
      L.push(layout);
    }
    return L;
  }, [stages, topologyKey, phaseResetToken, stageZOffsets]);



  // bounding box simples para enquadrar
  const maxR = useMemo(() => {
    let m = 10;
    layouts.forEach(l => l.items.forEach(it => m = Math.max(m, Math.hypot(it.pos[0], it.pos[1]) + it.r)));
    return m;
  }, [layouts]);

  const VIEW_PAD = 0.01;               // margem relativa (0.1 = 10% de folga)
  const fittedR = maxR * (1 + VIEW_PAD); // raio "enquadrado" com folga
  const cameraStateRef = React.useRef<{ pos: [number, number, number]; target: [number, number, number] } | null>(null);

  // Apenas quando resetToken mudar recalculamos o enquadramento base
  React.useEffect(() => {
    const camZ = Math.max(40, fittedR * 2) * (cameraZoomMultiplier ?? 1);
    cameraStateRef.current = {
      pos: [-camZ * 2, 0, camZ * 1.65] as [number, number, number],
      target: [maxR * 0.25, 0, 0] as [number, number, number],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraResetToken]);

  // fallback inicial
  if (!cameraStateRef.current) {
    const camZ = Math.max(40, fittedR * 2) * (cameraZoomMultiplier ?? 1);
    cameraStateRef.current = {
      pos: [-camZ * 2, 0, camZ * 1.65] as [number, number, number],
      target: [maxR * 0.25, 0, 0] as [number, number, number],
    };
  }

  const lastCameraResetRef = React.useRef(cameraResetToken);
  const lastZoomRef = React.useRef(cameraZoomMultiplier);
  const isOrthographic = cameraProjection === "orthographic";

  // Mantém o ref alinhado com o que o usuário faz nos controles
  React.useEffect(() => {
    const state = (useThree as any).context?.getState?.();
    const camera = state?.camera;
    const controls = state?.controls as any | undefined;
    if (!camera || !controls) return;

    const syncRef = () => {
      const targetVec = controls.target?.clone?.() ?? new Vector3(...(cameraStateRef.current?.target ?? [0, 0, 0]));
      cameraStateRef.current = {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [targetVec.x, targetVec.y, targetVec.z],
      };
    };

    controls.addEventListener?.("change", syncRef);
    syncRef();
    return () => controls.removeEventListener?.("change", syncRef);
  }, []);

  // Atualiza somente o "zoom" (distância) sem mudar o alvo/orientação
  React.useEffect(() => {
    const { camera } = (useThree as any).context?.getState?.() ?? { camera: null };
    const controls = (useThree as any).context?.getState?.()?.controls as any | undefined;
    if (!camera) return;

    const resetChanged = lastCameraResetRef.current !== cameraResetToken;
    lastCameraResetRef.current = cameraResetToken;
    lastZoomRef.current = cameraZoomMultiplier;
    if (!resetChanged) return;

    const targetVec = controls?.target ? controls.target.clone() : new Vector3(...(cameraStateRef.current?.target ?? [0, 0, 0]));
    if ((camera as any)?.isOrthographicCamera) {
      if (controls && typeof controls.target?.set === "function") {
        controls.target.set(targetVec.x, targetVec.y, targetVec.z);
        controls.update?.();
      }
      cameraStateRef.current = { pos: [camera.position.x, camera.position.y, camera.position.z], target: [targetVec.x, targetVec.y, targetVec.z] };
      return;
    }

    const dir = new Vector3().subVectors(camera.position, targetVec);
    if (dir.length() < 1e-6) dir.copy(BASE_CAM_DIR);

    const camZ = Math.max(40, fittedR * 2) * (cameraZoomMultiplier ?? 1);
    const desiredDist = camZ * BASE_CAM_DIST_FACTOR;
    const newPos = targetVec.clone().add(dir.normalize().multiplyScalar(desiredDist));

    camera.position.copy(newPos);
    camera.updateProjectionMatrix();
    if (controls && typeof controls.target?.set === "function") {
      controls.target.set(targetVec.x, targetVec.y, targetVec.z);
      controls.update?.();
    }
    cameraStateRef.current = { pos: [newPos.x, newPos.y, newPos.z], target: [targetVec.x, targetVec.y, targetVec.z] };
  }, [fittedR, cameraZoomMultiplier, cameraResetToken]);

  const carrierPaths = useMemo(() => {
    const out: { stageId: number; paths: Vector3[][]; z: number }[] = [];
    for (let k = 0; k < stages.length; k++) {
      const st = stages[k];
      const z = stageZOffsets[k] ?? 0;
      const L = layouts[k];
      if (!L) continue;
      const ph = (L as any).__phasing as ReturnType<typeof computeStagePhasing> | undefined;

      const base2D: [number, number][] = [[0, 0], ...(L.positions || [])];
      const build3D = (pts2: [number, number][]) => pts2.map(([x, y]) => new Vector3(x, y, z));
      const paths: Vector3[][] = [];

      if (!ph || !ph.copyAngles || ph.copyAngles.length <= 1 || base2D.length < 2) {
        // caminho único (sem cópias)
        paths.push(build3D(base2D));
      } else {
        // um path por cópia (incluindo a base com ângulo 0)
        for (let m = 0; m < ph.copyAngles.length; m++) {
          const ang = ph.copyAngles[m];
          const c = Math.cos(ang), s = Math.sin(ang);
          const rot2D = base2D.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
          paths.push(build3D(rot2D));
        }
      }

      out.push({ stageId: st.id, paths, z });
    }
    return out;
  }, [stages, layouts, stageZOffsets]);

  const carrierResetKeyByStage = useMemo(() => {
    const map = new Map<number, string>();
    for (const stage of layouts) {
      map.set(stage.stageId, `${stage.signature}|carrier|pr${phaseResetToken}|vr${visibilityResetToken}`);
    }
    return map;
  }, [layouts, phaseResetToken, visibilityResetToken]);

  const omegaByStage = useMemo(() => {
    const map = new Map<number, number>();
    for (const st of stages) {
      const wb_rpm = velocities?.[`omega_b${st.id}`] ?? 0;
      map.set(st.id, rpmToRad(wb_rpm));
    }
    return map;
  }, [stages, velocities, timeScale]);

  const carrierOpacityByStage = useMemo(() => {
    const map = new Map<number, number>();
    for (const st of stages) {
      const stageHidden = hiddenParts.has(stageKey(st.id));
      const carrierHidden = stageHidden || hiddenParts.has(carrierKey(st.id));
      map.set(st.id, carrierHidden ? 0 : 1);
    }
    return map;
  }, [stages, hiddenParts]);

  const armCouplingSegments = useMemo(
    () =>
      buildArmArmCouplingSegments({
        couplings,
        carrierPaths,
        plateThickness: CARRIER_PLATE_THICKNESS,
        gearThickness: gearVisualThickness,
        carrierZOffset: CARRIER_Z_OFFSET,
        minTargetRadius: CARRIER_CORE_OUTER_RADIUS,
      }),
    [couplings, carrierPaths, gearVisualThickness]
  );



return (
  <GearProfileContext.Provider value={gearProfile}>
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <Canvas
      key={isOrthographic ? "cam-ortho" : "cam-persp"}
      dpr={[1, 2]}
      orthographic={isOrthographic}
      camera={isOrthographic ? { position: cameraStateRef.current.pos, zoom: 1 } : { position: cameraStateRef.current.pos, fov: 25 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <AutoFitCamera pos={cameraStateRef.current.pos} target={cameraStateRef.current.target} resetToken={cameraResetToken} />
        <ZoomAdjust
          cameraResetToken={cameraResetToken}
          cameraZoomFitToken={cameraZoomFitToken}
          fittedR={fittedR}
          cameraZoomMultiplier={cameraZoomMultiplier ?? 1}
        />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={0.6} />

        {armCouplingSegments.map((group) => {
          const opacity = Math.min(
            carrierOpacityByStage.get(group.stageA) ?? 1,
            carrierOpacityByStage.get(group.stageB) ?? 1
          );
          if (opacity <= 0.001) return null;
          const omega =
            omegaByStage.get(group.stageA) ??
            omegaByStage.get(group.stageB) ??
            0;
          const resetKey =
            carrierResetKeyByStage.get(group.stageA) ??
            carrierResetKeyByStage.get(group.stageB) ??
            phaseResetToken;

          return (
            <RotZ
              key={`arm-cpl-${group.stageA}-${group.stageB}`}
              omega={omega}
              resetOn={resetKey}
            >
              <group>
                {group.segments.map((seg, idx) => (
                  <CouplingRod
                    key={idx}
                    from={seg.from}
                    to={seg.to}
                    radius={CARRIER_PEG_RADIUS}
                    color={CARRIER_COLOR}
                    opacity={opacity}
                  />
                ))}
                {group.elbows.map((elbow, idx) => (
                  <CouplingElbow
                    key={`elbow-${idx}`}
                    at={elbow}
                    radius={CARRIER_PEG_RADIUS}
                    color={CARRIER_COLOR}
                    opacity={opacity}
                  />
                ))}
                {group.pads.map((pad, idx) => (
                  <CouplingPad
                    key={`pad-${idx}`}
                    at={pad}
                    radius={CARRIER_PAD_RADIUS}
                    thickness={CARRIER_PLATE_THICKNESS}
                    color={CARRIER_COLOR}
                    opacity={opacity}
                  />
                ))}
              </group>
            </RotZ>
          );
        })}

        {layouts.map((stage) => {
          const sid = stage.stageId;
          const stageSignature = stage.signature;
	          const stageHidden = hiddenParts.has(stageKey(sid));
	          const stageSrc = stageMap.get(sid);
	          const hasSun = stageSrc?.solarZ != null;
	          const planetCount = stageSrc?.planetsZ?.length ?? 0;
          const helixMag = Math.abs(helixAngleRadBase);
          const helixBaseSign = helixAngleRadBase >= 0 ? 1 : -1;
          const planetHelix = new Map<number, number>();
          if (helixMag > 0) {
            let idx = hasSun ? 1 : 0; // avança uma posição se houver sol
            for (let k = 0; k < planetCount; k++, idx++) {
              const sign = (idx % 2 === 0 ? 1 : -1) * helixBaseSign;
              planetHelix.set(k, sign * helixMag);
            }
          }
          const ringHelix =
            helixMag > 0 && planetCount > 0
              ? planetHelix.get(planetCount - 1) ?? 0 // mesmo sinal da planeta que engrena com o anel
              : helixMag > 0 && hasSun && planetCount === 0
              ? helixBaseSign * helixMag
              : 0;

          const helixAngleFor = (kind: "sun" | "planet" | "ring", planetIdx = 0) => {
            if (!helixMag) return 0;
            if (kind === "sun") return helixBaseSign * helixMag;
            if (kind === "planet") return planetHelix.get(planetIdx) ?? 0;
            if (kind === "ring") return ringHelix;
            return 0;
          };

          const wb_rpm = velocities?.[`omega_b${sid}`] ?? 0;
          const ws_rpm = velocities?.[`omega_s${sid}`] ?? 0;
          const wa_rpm = velocities?.[`omega_a${sid}`] ?? 0;
          const getWp = (k: number) => velocities?.[`omega_p${sid}_${k + 1}`] ?? 0;

	          const wb = rpmToRad(wb_rpm);
	          const ws_local = rpmToRad(ws_rpm - wb_rpm);
	          const wa_local = rpmToRad(wa_rpm - wb_rpm);
	          const carrierResetKey = `${stageSignature}|carrier|pr${phaseResetToken}|vr${visibilityResetToken}`;
	          const pathsForStage = carrierPaths.find(p => p.stageId === sid)?.paths ?? [];
	          const carrierHidden = stageHidden || hiddenParts.has(carrierKey(sid));
          const carrierOpacity = carrierHidden ? 0 : 1;

          return (
            <group key={sid}>
              <RotZ omega={wb} resetOn={carrierResetKey}>
                <group>
                  {pathsForStage.map((pts, i) => (
                    <CarrierVisual key={i} anchors={pts} color={CARRIER_COLOR} opacity={carrierOpacity} />
                  ))}
                </group>

                {stage.items.map((it) => {
                  const ph = (stage as any).__phasing as ReturnType<typeof computeStagePhasing> | undefined;
                  const phaseMap = ph?.gearPhaseMap || {};

                  if (it.kind === "sun") {
                    const sunHidden = stageHidden || hiddenParts.has(sunKey(sid));
                    const sunOpacity = sunHidden ? 0 : 1;
                    const zEst = Math.max(6, Math.round(it.r / PX_PER_TOOTH));
                    const phase = phaseMap[`omega_s${sid}`] ?? 0;
                    const sunResetToken = `${stageSignature}|sun|${phase.toFixed(6)}|pr${phaseResetToken}|vr${visibilityResetToken}`;

                    return (
                      <group key={`${it.id}|${sunResetToken}`}>
                        <SpinningDisc
                          r={it.r}
                          color={COLORS.sun}
                          pos={it.pos}
                          localOmega={ws_local}
                          filled={true}
                          phase={phase}
                          thickness={DISC_THICK}
                          resetToken={sunResetToken}
                          opacity={sunOpacity}
                        />
                        <Gear3D
                          teeth={zEst}
                          rVisual={it.r}
                          color={COLORS.sun}
                          pos={it.pos}
                          localOmega={ws_local}
                          thickness={DISC_THICK}
                          phase={phase}
                          resetOn={sunResetToken}
                          holeRadius={GEAR_HOLE_RADIUS}
                          helixAngleRad={helixAngleFor("sun")}
                          backlashOverride={backlashForKind("sun")}
                          opacity={sunOpacity}
                        />
                        <SunShaft
                          pos={it.pos}
                          color={COLORS.sun}
                          localOmega={ws_local}
                          phase={phase}
                          resetOn={sunResetToken}
                          opacity={sunOpacity}
                        />
                      </group>
                    );
                  }



                  if (it.kind === "ring") {
                    const ringHidden = stageHidden || hiddenParts.has(ringKey(sid));
                    const ringOpacity = ringHidden ? 0 : 1;
                    const zEst = Math.max(8, Math.round(it.r / PX_PER_TOOTH));
                    const phase = phaseMap[`omega_a${sid}`] ?? 0;
                    const ringResetToken = `${stageSignature}|ring|${phase.toFixed(6)}|pr${phaseResetToken}|vr${visibilityResetToken}`;

                    return (
                      <group key={`${it.id}|${ringResetToken}`}>
                        <SpinningDisc
                          r={it.r}
                          color={COLORS.ring}
                          pos={it.pos}
                          localOmega={wa_local}
                          filled={false}
                          phase={phase}
                          thickness={DISC_THICK}
                          resetToken={ringResetToken}
                          opacity={ringOpacity}
                        />
                        <Gear3DInternal
                          teeth={zEst}
                          rVisual={it.r}
                          color={COLORS.ring}
                          pos={it.pos}
                          localOmega={wa_local}
                          thickness={DISC_THICK}
                          phase={phase}
                          resetOn={ringResetToken}
                          helixAngleRad={helixAngleFor("ring")}
                          backlashOverride={backlashForKind("ring")}
                          opacity={ringOpacity}
                        />
                      </group>
                    );
                  }


                  if (it.kind === "planet") {
                    const m = it.id.match(/-copy-(\d+)$/);
                    const copyIdx = m ? Number(m[1]) : 0;
                    const mp = it.omegaId.match(/^omega_p(\d+)_(\d+)$/);
                    const kPlanet = mp ? Number(mp[2]) : 1;
                    const planetKeyId = planetKey(sid, kPlanet);
                    const planetHidden = stageHidden || hiddenParts.has(planetKeyId);
                    const planetOpacity = planetHidden ? 0 : 1;

                    const phaseKey = `omega_p${sid}_${kPlanet}#copy${copyIdx}`;
                    const phase = phaseMap[phaseKey] ?? 0;
                    const orbitAngle = ph?.copyAngles?.[copyIdx];
                    const posKey = `${it.pos[0].toFixed(6)},${it.pos[1].toFixed(6)}`;


                    const idx = mp ? Number(mp[2]) - 1 : 0;
                    const wp_local = rpmToRad(getWp(idx) - wb_rpm);
                    const zEst = Math.max(6, Math.round(it.r / PX_PER_TOOTH));
                    const planetColor = getPlanetColorByIndex(idx);

                    const resetToken = [
                        stageSignature,
                        phaseKey,
                        `Z=${zEst}`, // <--- ADICIONE ISTO: Força reset se o tamanho/dentes mudar
                        `p=${phase.toFixed(6)}`,
                        `a=${orbitAngle == null ? "na" : orbitAngle.toFixed(6)}`,
                        `pos=${posKey}`,
                        `pr=${phaseResetToken}`,
                        `vr=${visibilityResetToken}`
                      ].join("|");
                    
                    return (
                      <group key={`${it.id}|${resetToken}`}>
                        <SpinningDisc
                          r={it.r}
                          color={planetColor}
                          pos={it.pos}
                          localOmega={wp_local}
                          filled={true}
                          phase={phase}
                          thickness={DISC_THICK}
                          resetToken={resetToken}
                          opacity={planetOpacity}
                        />
                        <Gear3D
                          teeth={zEst}
                          rVisual={it.r}
                          color={planetColor}
                          pos={it.pos}
                          localOmega={wp_local}
                          thickness={DISC_THICK}
                          phase={phase}
                          resetOn={resetToken}
                          holeRadius={GEAR_HOLE_RADIUS}
                          helixAngleRad={helixAngleFor("planet", idx)}
                          opacity={planetOpacity}
                          backlashOverride={backlashForKind("planet")}
                        />
                      </group>
                    );
                  }


                  return null;
                })}
              </RotZ>
            </group>
          );
        })}
      </Suspense>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.5}
        enablePan
        minDistance={20}
        maxDistance={Math.max(200, fittedR * 10)}
        target={cameraStateRef.current?.target ?? [maxR * 0.25, 0, 0]}
      />
    </Canvas>

    <DesignTree
      lang={lang}
      treeData={treeData}
      hiddenParts={hiddenParts}
      rootCollapsed={rootCollapsed}
      collapsedStages={collapsedStages}
      onToggleRoot={toggleRoot}
      onToggleStageCollapsed={toggleStageCollapsed}
      onToggleVisibility={toggleVisibility}
      stageKeyForId={stageKey}
    />

    {DEBUG_PHASING && (
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,              // mude aqui para outro canto se quiser
          maxHeight: "40vh",
          maxWidth: "40vw",
          overflow: "auto",
          background: "#000000cc",
          color: "#e5e7eb",
          fontSize: 11,
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid #ffffff33",
          whiteSpace: "pre",
          pointerEvents: "auto",
        }}
      >
        {layouts.map((stage) => {
          const ph = (stage as any).__phasing as ReturnType<typeof computeStagePhasing> | undefined;

          if (!ph) {
            return (
              <div key={stage.stageId} style={{ marginBottom: 6 }}>
                <div>Stage {stage.stageId}: sem dados de phasing.</div>
              </div>
            );
          }

          return (
            <div key={stage.stageId} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Stage {stage.stageId}
              </div>
              <div>copyAngles (deg): {radToDegList(ph.copyAngles)}</div>
              <div>planetOriginal (deg): {radToDegList(ph.planetOriginal)}</div>
              <div>sun (deg): {radToDeg(ph.sunPhase)}</div>
              <div>planetCoupled (deg): {radToDegList(ph.planetCoupled)}</div>
              <div>ring (deg): {radToDeg(ph.ringPhase)}</div>
            </div>
          );
        })}
      </div>
    )}
  </div>
  </GearProfileContext.Provider>
);

}
