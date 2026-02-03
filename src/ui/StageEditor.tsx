import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Model, Element, Mesh, Constraint } from "../math/types";
import { solveGearSystem } from "../math/solver";
import { validarMontagem, type MontagemStatus } from "../math/topology";
import { strings, type Lang, type StringKey } from "./i18n";
import { GearScene } from "../render/GearScene";
import { useIsMobile } from "../lib/useIsMobile";
import {
  EXAMPLE_PRESETS,
  type Ex1GearId,
  type Ex2GearId,
  type Ex3GearId,
  type Ex4GearId,
  type UIStage,
  type UISpeed,
  type UIRatio,
  type UICoupling,
} from "./presets";

const EX1_PRESET = EXAMPLE_PRESETS.EX1;
const EX2_PRESET = EXAMPLE_PRESETS.EX2;
const EX3_PRESET = EXAMPLE_PRESETS.EX3;
const EX4_PRESET = EXAMPLE_PRESETS.EX4;

function cloneStages(stages: UIStage[]): UIStage[] {
  return stages.map((s) => ({
    ...s,
    planetsZ: [...s.planetsZ],
  }));
}

function cloneSpeeds(speeds: UISpeed[]): UISpeed[] {
  return speeds.map((s) => ({ ...s }));
}

function cloneCouplings(couplings: UICoupling[]): UICoupling[] {
  return couplings.map((c) => ({ ...c }));
}

function cloneRatio(ratio: UIRatio): UIRatio {
  return { ...ratio };
}

/** ---------- Estilos ---------- */
const layout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "420px minmax(0, 1fr)",
  gap: 16,
  alignItems: "start",
  minHeight: "calc(100vh - 110px)",
  position: "relative",
};

const leftCol: React.CSSProperties = {
  display: "grid",
  gridAutoRows: "min-content",
  gap: 12,
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: 4,
  minWidth: 0,
  height: "calc(100vh - 130px)",
};
const card: React.CSSProperties = {
  background: "var(--panel-bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.75rem",
  overflow: "hidden",
};
const label: React.CSSProperties = { margin: 0, fontSize: "0.85rem", opacity: 0.9 };
const input: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "0.4rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--btn-border)",
  background: "var(--input-bg)",
  color: "var(--text)",
};
const row2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center", minWidth: 0 };
const btn: React.CSSProperties = { padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid var(--btn-border)", background: "var(--btn-bg)", color: "var(--text)", cursor: "pointer" };
const small: React.CSSProperties = { fontSize: "0.8rem", color: "var(--muted)" };
const btnIcon: React.CSSProperties = { ...btn, padding: "0.4rem 0.5rem", width: "2.25rem", textAlign: "center", lineHeight: 1 };
const fieldRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 2.25rem 7.5rem", gap: 8, alignItems: "center", minWidth: 0, marginBottom: "0.75rem" };
const fieldRowNoX: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 7.5rem", gap: 8, alignItems: "center", minWidth: 0, marginBottom: "0.75rem" };

/** ---------- Componente ---------- */
export function StageEditor({
  lang = "pt" as Lang,
  exampleToLoad,
  onExampleLoaded,
  resetSignal,
}: {
  lang?: Lang;
  exampleToLoad?: "EX1" | "EX2" | "EX3" | "EX4" | null;
  onExampleLoaded?: (id: "EX1" | "EX2" | "EX3" | "EX4" | null) => void;
  resetSignal?: number;
}) {
  const isMobile = useIsMobile();
  const t = (key: StringKey) => strings[lang][key];
  const [timeScale, setTimeScale] = useState(1.0);
  const [stages, setStages] = useState<UIStage[]>([{ id: 1, solarZ: 40, planetsZ: [20], annulusZ: 80, planetCopies: 3 }]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ==== defaults a partir do primeiro estágio ====
  const firstId = 1;
  const defaultSolar   = `omega_s${firstId}`;
  const defaultAnnulus = `omega_a${firstId}`;

  // Velocidades padrão (Solar e Anelar); usuário pode adicionar mais entradas
  const [speeds, setSpeeds] = useState<UISpeed[]>([
    { var: defaultSolar, value: 10 },
    { var: defaultAnnulus, value: -2 },
  ]);

  const clearSpeedVar = useCallback((omegaId: string) => {
    setSpeeds((current) =>
      current.map((s) => (s.var === omegaId ? { ...s, var: undefined } : s))
    );
  }, []);

  // Relação padrão: Solar / Anelar (ou Solar / Braço se não houver anelar)
  const [ratio, setRatio] = useState<UIRatio>({ entrada: defaultSolar, saida: defaultAnnulus });

  const [couplings, setCouplings] = useState<UICoupling[]>([]);
  const [result, setResult] = useState<null | { velocities: Record<string, number>, ratios: { id:string, value:number }[] }>(null);
  const [error, setError] = useState<string | null>(null);
  const [underdeterminedMessage, setUnderdeterminedMessage] = useState<string | null>(null);
  const [overdeterminedMessage, setOverdeterminedMessage] = useState<string | null>(null);
  const [panelExample, setPanelExample] = useState<"EX1" | "EX2" | "EX3" | "EX4" | null>(null);
  const [selectedGear, setSelectedGear] = useState<string | null>(null);
  const [cameraZoomMultiplier, setCameraZoomMultiplier] = useState(1);
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [cameraZoomFitToken, setCameraZoomFitToken] = useState(0);
  const [resultsCollapsed, setResultsCollapsed] = useState(() => isMobile);
  const resultsCollapsedRef = useRef(resultsCollapsed);
  const DEFAULT_CAMERA_ZOOM = 1;
  const [gearModule, setGearModule] = useState(1);
  const [gearPressureDeg, setGearPressureDeg] = useState(20);
  const [gearWidth, setGearWidth] = useState(5);
  const [gearHelixDeg, setGearHelixDeg] = useState(0);
  const [ringThickness, setRingThickness] = useState(3);
  const [backlash, setBacklash] = useState(0);
  const [undercut, setUndercut] = useState(true);
  const [backlashPlanetsOnly, setBacklashPlanetsOnly] = useState(false);
  const [cameraProjection, setCameraProjection] = useState<"orthographic" | "perspective">("orthographic");
  const [gearPanelOpen, setGearPanelOpen] = useState(false);
  const skipExampleClearRef = useRef(false);
  const SLIDER_MIN_POS = -9;
  const SLIDER_MAX_POS = 9;
  const exampleTitleRef = useRef<HTMLDivElement | null>(null);
  const [examplePanelWidth, setExamplePanelWidth] = useState<number | null>(null);

  // --- Mobile: painel esquerdo em formato "drawer" (arrastar para abrir/fechar)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const drawerTabWidth = 22;
  const drawerWidth = isMobile ? Math.min(420, Math.max(280, Math.round(viewportWidth * 0.92))) : 420;
  const drawerClosedX = -drawerWidth + drawerTabWidth;
  const [drawerX, setDrawerX] = useState(drawerClosedX);
  const drawerXRef = useRef(drawerClosedX);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const drawerDragRef = useRef<null | { pointerId: number; startX: number; startDrawerX: number }>(null);
  const rightColRef = useRef<HTMLDivElement | null>(null);
  const [mobileResultsInset, setMobileResultsInset] = useState<{ left: number; right: number }>(() => ({
    left: drawerTabWidth + 6,
    right: 0,
  }));

  useEffect(() => {
    setCameraResetToken((t) => t + 1);
    setCameraZoomFitToken((t) => t + 1);
  }, [cameraProjection]);
  const resultsDrawerHeight = isMobile ? Math.min(420, Math.max(220, Math.round(viewportHeight * 0.55))) : 0;
  const resultsDrawerClosedY = resultsDrawerHeight;
  const resultsTabWidth = 90;
  const resultsTabHeight = drawerTabWidth;
  const resultsHandleAreaHeight = 44;
  const [resultsDrawerY, setResultsDrawerY] = useState(resultsDrawerClosedY);
  const resultsDrawerYRef = useRef(resultsDrawerClosedY);
  const [resultsDrawerDragging, setResultsDrawerDragging] = useState(false);
  const resultsDragRef = useRef<null | { pointerId: number; startY: number; startDrawerY: number }>(null);

  const clampDrawerX = useCallback((x: number) => Math.max(drawerClosedX, Math.min(0, x)), [drawerClosedX]);

  const setDrawerXClamped = useCallback(
    (x: number) => {
      const clamped = clampDrawerX(x);
      drawerXRef.current = clamped;
      setDrawerX(clamped);
    },
    [clampDrawerX]
  );

  const clampResultsDrawerY = useCallback(
    (y: number) => Math.max(0, Math.min(resultsDrawerClosedY, y)),
    [resultsDrawerClosedY]
  );

  const setResultsDrawerYClamped = useCallback(
    (y: number) => {
      const clamped = clampResultsDrawerY(y);
      resultsDrawerYRef.current = clamped;
      setResultsDrawerY(clamped);
    },
    [clampResultsDrawerY]
  );

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const el = rightColRef.current;
    if (!el || typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    const padLeft = Number.parseFloat(styles.paddingLeft || "0") || 0;
    const padRight = Number.parseFloat(styles.paddingRight || "0") || 0;
    const left = rect.left + padLeft;
    const right = Math.max(0, window.innerWidth - rect.right + padRight);
    setMobileResultsInset({ left, right });
  }, [isMobile, viewportWidth]);

  useLayoutEffect(() => {
    if (!panelExample) {
      setExamplePanelWidth(null);
      return;
    }

    const measure = () => {
      const titleEl = exampleTitleRef.current;
      if (!titleEl) return;
      const paddingX = 20; // container padding (10px each side)
      const desired = Math.ceil(titleEl.getBoundingClientRect().width + paddingX);
      const maxAllowed = typeof window === "undefined" ? desired : Math.max(0, window.innerWidth - 20);
      setExamplePanelWidth(Math.min(desired, maxAllowed));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panelExample, lang]);

  useEffect(() => {
    if (!isMobile) return;
    setDrawerXClamped(mobileLeftOpen ? 0 : drawerClosedX);
  }, [isMobile, mobileLeftOpen, drawerClosedX, setDrawerXClamped]);

  useEffect(() => {
    if (!isMobile) return;
    setResultsDrawerYClamped(resultsCollapsed ? resultsDrawerClosedY : 0);
  }, [isMobile, resultsCollapsed, resultsDrawerClosedY, setResultsDrawerYClamped]);

  useEffect(() => {
    setResultsCollapsed(isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    if (mobileLeftOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobile, mobileLeftOpen]);

  useEffect(() => {
    resultsCollapsedRef.current = resultsCollapsed;
  }, [resultsCollapsed]);

  const startDrawerDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!isMobile) return;
      drawerDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startDrawerX: drawerXRef.current };
      setDrawerDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isMobile]
  );

  const moveDrawerDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = drawerDragRef.current;
      if (!isMobile || !drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      setDrawerXClamped(drag.startDrawerX + dx);
    },
    [isMobile, setDrawerXClamped]
  );

  const endDrawerDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = drawerDragRef.current;
      if (!isMobile || !drag || drag.pointerId !== e.pointerId) return;
      drawerDragRef.current = null;
      setDrawerDragging(false);
      const currentX = drawerXRef.current;
      const openThreshold = drawerClosedX / 2; // metade do caminho
      const shouldOpen = currentX > openThreshold;
      setMobileLeftOpen(shouldOpen);
      setDrawerXClamped(shouldOpen ? 0 : drawerClosedX);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
    },
    [isMobile, drawerClosedX, setDrawerXClamped]
  );

  const startResultsDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!isMobile) return;
      resultsDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startDrawerY: resultsDrawerYRef.current };
      setResultsDrawerDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isMobile]
  );

  const moveResultsDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = resultsDragRef.current;
      if (!isMobile || !drag || drag.pointerId !== e.pointerId) return;
      const dy = e.clientY - drag.startY;
      setResultsDrawerYClamped(drag.startDrawerY + dy);
    },
    [isMobile, setResultsDrawerYClamped]
  );

  const endResultsDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = resultsDragRef.current;
      if (!isMobile || !drag || drag.pointerId !== e.pointerId) return;
      resultsDragRef.current = null;
      setResultsDrawerDragging(false);
      const currentY = resultsDrawerYRef.current;
      const openThreshold = resultsDrawerClosedY / 2; // metade do caminho
      const shouldOpen = currentY < openThreshold;
      setResultsCollapsed(!shouldOpen);
      setResultsDrawerYClamped(shouldOpen ? 0 : resultsDrawerClosedY);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
    },
    [isMobile, resultsDrawerClosedY, setResultsDrawerYClamped]
  );

  const resetCameraDefaults = useCallback(() => {
    setCameraZoomMultiplier(DEFAULT_CAMERA_ZOOM);
    setCameraResetToken((t) => t + 1);
  }, []);

  const snapTimeScale = useCallback((ts: number) => {
    const clamped = Math.max(0.1, Math.min(10, ts));
    if (clamped <= 1) return Number((Math.round(clamped * 10) / 10).toFixed(1));
    return Math.round(clamped);
  }, []);

  const timeScaleFromPos = useCallback((pos: number) => {
    const clamped = Math.max(SLIDER_MIN_POS, Math.min(SLIDER_MAX_POS, pos));
    const raw = clamped <= 0 ? 1 + clamped * 0.1 : 1 + clamped * 1;
    return snapTimeScale(raw);
  }, [SLIDER_MIN_POS, SLIDER_MAX_POS, snapTimeScale]);

  const posFromTimeScale = useCallback((ts: number) => {
    const snapped = snapTimeScale(ts);
    if (snapped <= 1) return Math.round((snapped - 1) / 0.1);
    return Math.round(snapped - 1);
  }, [snapTimeScale]);

  const clearExampleSelectionIfNeeded = useCallback(() => {
    if (!panelExample || skipExampleClearRef.current) return;
    setPanelExample(null);
    setSelectedGear(null);
    onExampleLoaded?.(null);
  }, [panelExample, onExampleLoaded]);

  const runWithExampleContext = useCallback((fn: () => void) => {
    skipExampleClearRef.current = true;
    try {
      fn();
    } finally {
      skipExampleClearRef.current = false;
    }
  }, []);

  const [decimals, setDecimals] = useState<number>(2);
  const [montagem, setMontagem] = useState<Record<number, MontagemStatus>>({});
// Altura relativa da cena 3D (parte de cima da coluna direita).
const [viewFrac, setViewFrac] = useState(0.70);

  const resetToDefaults = useCallback(() => {
    clearExampleSelectionIfNeeded();
    setStages([{ id: 1, solarZ: 40, planetsZ: [20], annulusZ: 80, planetCopies: 3 }]);
    setSpeeds([
      { var: defaultSolar, value: 10 },
      { var: defaultAnnulus, value: -2 },
    ]);
    setRatio({ entrada: defaultSolar, saida: defaultAnnulus });
    setCouplings([]);
    setResult(null);
    setError(null);
    setUnderdeterminedMessage(null);
    setOverdeterminedMessage(null);
    resetCameraDefaults();
    setGearModule(1);
    setGearPressureDeg(20);
    setGearWidth(5);
    setGearHelixDeg(0);
    setRingThickness(3);
    setBacklash(0);
    setUndercut(true);
    setBacklashPlanetsOnly(false);
    setCameraProjection("orthographic");
    setGearPanelOpen(false);
    onExampleLoaded?.(null);
  }, [clearExampleSelectionIfNeeded, defaultAnnulus, defaultSolar, onExampleLoaded, resetCameraDefaults]);

// Handler para arrastar a “seta dupla” (⇵) e redimensionar
function startDrag(e: React.MouseEvent) {
  const startY = e.clientY;
  const startFrac = viewFrac;
  function onMove(ev: MouseEvent) {
    const total =
      (document.querySelector("#right-col") as HTMLElement)?.getBoundingClientRect().height ?? 1;
    const dy = ev.clientY - startY;
    const newFrac = Math.max(0.2, Math.min(0.85, startFrac + dy / total));
    setViewFrac(newFrac);
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

  const hasImpossible = React.useMemo(() => {
    const vals = Object.values(montagem || {});
    return vals.some((s: any) => s?.valido === false || s?.tipo === "impossivel" || /imposs[ií]vel/i.test(String(s?.mensagem || "")) );
  }, [montagem]);

  // --- Template em memória para a próxima planetária (não persiste após reload)
  type StageTemplate = Omit<UIStage, "id">;
  const DEFAULT_TEMPLATE: StageTemplate = { solarZ: 24, planetsZ: [12], annulusZ: 48, lastSolarZ: 24, lastAnnulusZ: 48 };
  const lastTemplateRef = React.useRef<StageTemplate>(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));

  function updateStage(stageId: number, mutate: (s: UIStage) => UIStage) {
    clearExampleSelectionIfNeeded();
    setStages((xs) => xs.map((s) => {
      if (s.id !== stageId) return s;
      const ns = mutate(s);
      const { id, ...tpl } = ns as any;
      lastTemplateRef.current = JSON.parse(JSON.stringify(tpl));
      return ns;
    }));
  }

  const omegaOptions = useMemo(() => {
    return buildOmegaOptions(stages, lang);
  }, [stages, lang]);

  // Muda sempre que qualquer parâmetro estrutural mudar (dentes, lista de planetas, cópias)
const topologyKey = useMemo(() => {
  return stages
    .map(s => [
      s.id,
      s.solarZ ?? "null",
      s.planetsZ.join(","),
      s.annulusZ ?? "null",
      s.planetCopies ?? 1,
    ].join("|"))
    .join("||");
}, [stages]);

  const labelById = useMemo(() => {
    const m = new Map<string,string>();
    omegaOptions.forEach(o => m.set(o.id, o.label));
    return m;
  }, [omegaOptions]);

  const renderResultsBody = () => (
    <>
      {Object.keys(montagem).length > 0 && (
        <div
          style={{
            ...small,
            color: hasImpossible ? "#ff6b6b" : "var(--muted-foreground)",
            textAlign: "right",
            marginTop: 2,
            minWidth: 0,
            flex: "1 1 auto",
            overflowWrap: "anywhere",
          }}
        >
          {Object.entries(montagem).map(([id, st]) => (
            <div key={id}>
              <b>{t("planetary")} {id}:</b>{" "}
              {st.tipo === "aberta" ? t("stageOpen")
               : st.tipo === "reto" ? t("armStraight")
               : st.tipo === "curvo" ? t("armStepped")
               : (lang === "en" ? "Carrier" : "Braço")}
              {" — "}
              {lang === "en" ? (st as any).mensagem_en ?? st.mensagem : st.mensagem}
            </div>
          ))}
        </div>
      )}
      {underdeterminedMessage && (
        <div style={{ ...small, color: "#fca5a5", marginTop: 4 }}>
          <b>{lang === "en" ? "Error" : "Erro"}:</b> {underdeterminedMessage}
        </div>
      )}
      {overdeterminedMessage && (
        <div style={{ ...small, color: "#fca5a5", marginTop: 4 }}>
          <b>{lang === "en" ? "Error" : "Erro"}:</b> {overdeterminedMessage}
        </div>
      )}
      {error && error !== underdeterminedMessage && error !== overdeterminedMessage && (
        <div style={{ ...small, color: "#fca5a5", marginTop: 4 }}>
          <b>{lang === "en" ? "Error" : "Erro"}:</b> {error}
        </div>
      )}
      <hr style={{ borderColor: "var(--border)", margin: "8px 0" }} />

      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", columnGap:12, rowGap:4, alignItems:"center" }}>
        <div>
          <label style={{ ...label, display:"block", fontSize:12, marginBottom:2 }}>
            {t("decimalPlaces")}
          </label>
          <input
            style={{ ...input, width:80, textAlign:"center" }}
            type="number" min={0} max={8} value={decimals}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (!Number.isNaN(val) && val >= 0 && val <= 8) setDecimals(val as any);
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <label
            style={{
              ...label,
              display: "block",
              fontSize: 12,
              marginBottom: 2,
              textAlign: "right",
            }}
          >
            {strings[lang].timeScaleLabel}
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
              width: isMobile ? "min(220px, 100%)" : "260px",
            }}
          >
            <input
              style={{ ...input, flex: "1 1 auto", height: 6 }}
              type="range"
              min={SLIDER_MIN_POS}
              max={SLIDER_MAX_POS}
              step={1}
              value={posFromTimeScale(timeScale)}
              onChange={(e) => setTimeScale(timeScaleFromPos(Number(e.target.value)))}
            />
            <input
              style={{
                ...input,
                width: 60,
                textAlign: "center",
                flex: "0 0 auto",
              }}
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={timeScale}
              onChange={(e) => setTimeScale(snapTimeScale(Number(e.target.value)))}
            />
          </div>
        </div>
      </div>

      {!result ? (
        <div style={{ opacity: 0.7 }}>{t("notCalculated")}</div>
      ) : (
        <>
          {(ratio.entrada && ratio.saida && result.ratios?.[0]) && (() => {
            const entradaLabel = labelById.get(ratio.entrada) ?? ratio.entrada;
            const saidaLabel   = labelById.get(ratio.saida)   ?? ratio.saida;
            const relLabel = `${entradaLabel} / ${saidaLabel}`;
            return (
              <div style={{ display:"grid", gap:4 }}>
                <div style={small}><b>{t("relation")}</b> {t("input")} / {t("output")}</div>
                <div><b>{relLabel}:</b> {fmt(result.ratios[0].value, decimals)}</div>
              </div>
            );
          })()}

          <hr style={{ borderColor:"var(--border)", margin:"8px 0" }}/>

          <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:8 }}>
            {(() => {
              const grupos = new Map<number, [string, number][]>();
              for (const [k, v] of Object.entries(result.velocities || {})) {
                const sid = Number(k.match(/omega_[spab](\d+)/)?.[1] ?? 1);
                if (!grupos.has(sid)) grupos.set(sid, []);
                grupos.get(sid)!.push([k, v]);
              }
              function rank(id: string): [number, number] {
                if (id.startsWith("omega_s")) return [0, 0];
                const mp = id.match(/^omega_p(\d+)_(\d+)$/);
                if (mp) return [1, Number(mp[2])];
                if (id.startsWith("omega_a")) return [2, 0];
                if (id.startsWith("omega_b")) return [3, 0];
                return [9, 0];
              }
              return Array.from(grupos.entries()).sort(([a],[b])=>a-b).map(([sid, items]) => (
                <div key={sid}>
                  {grupos.size > 1 && (
                    <div style={{ fontWeight:600, marginBottom:4, opacity:0.9 }}>
                      {t("planetary")} {sid}
                    </div>
                  )}
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {items.sort(([a],[b]) => { const [ra, ia] = rank(a); const [rb, ib] = rank(b); return ra - rb || ia - ib;}).map(([k,v]) => (
                      <div key={k} style={{ background:"var(--input-bg)", border:"1px solid var(--border)", borderRadius:6, padding:"6px 8px", minWidth:140, flex:"0 0 auto" }}>
                        <div style={{ fontSize:12, opacity:0.8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {labelById.get(k) ?? k}
                        </div>
                        <div style={{ fontWeight:600 }}>{fmt(v, decimals)} rpm</div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </>
      )}
    </>
  );

function addPlanet(stageId: number) {
  updateStage(stageId, (s) => {
    // valor padrão do novo planeta (mantém o que você já fazia)
    const newP = s.planetsZ.at(-1) ?? 12;
    const newPlanets = [...s.planetsZ, newP];

    // Se estamos adicionando o 2º planeta pela primeira vez…
    if (s.planetsZ.length === 1) {
      const Ns = s.solarZ ?? s.lastSolarZ ?? 0;
      const Np1 = s.planetsZ[0];
      const Np2 = newP;

      // Fórmula: Na = Ns + 2*(Np1 + Np2)
      const NaAuto = Math.round(Ns + 2 * (Np1 + Np2));

      return {
        ...s,
        planetsZ: newPlanets,
        annulusZ: NaAuto,       // aplica no campo
        lastAnnulusZ: NaAuto,   // guarda como último valor “lembrado”
      };
    }

    // Caso geral (3º planeta em diante): só adiciona o planeta
    return { ...s, planetsZ: newPlanets };
  });
  // zoom-only: mantém posição da câmera, ajusta apenas a distância para caber o novo diâmetro externo
  setCameraZoomFitToken((t) => t + 1);
}

  function removePlanet(stageId: number, idx: number) {
    updateStage(stageId, (s) => {
      const newPlanets = s.planetsZ.filter((_, k) => k !== idx);
      const Ns = s.solarZ ?? s.lastSolarZ;

      if (newPlanets.length === 0 || s.annulusZ == null || Ns == null) {
        return { ...s, planetsZ: newPlanets };
      }

      const maxNa = Ns + 2 * newPlanets.reduce((acc, z) => acc + z, 0);
      const status = validarMontagem(Ns, newPlanets, s.annulusZ, s.planetCopies ?? 1);

      // Se o anelar atual não encaixa mais com o conjunto de planetas, ajusta para o valor limite (braço reto)
      if (!status.valido) {
        return { ...s, planetsZ: newPlanets, annulusZ: maxNa, lastAnnulusZ: maxNa };
      }

      return { ...s, planetsZ: newPlanets };
    });
  }
  function removeSolar(stageId: number) {
    updateStage(stageId, (s) => ({ ...s, lastSolarZ: s.solarZ ?? s.lastSolarZ ?? 20, solarZ: null }));
    const varId = (sid:number)=>`omega_s${sid}`;
    clearSpeedVar(varId(stageId));
    setRatio(r => ({ entrada: r.entrada === varId(stageId) ? undefined : r.entrada, saida: r.saida === varId(stageId) ? undefined : r.saida }));
    setCouplings(cs => cs.filter(c => c.a !== varId(stageId) && c.b !== varId(stageId)));
  }
  function restoreSolar(stageId: number) { updateStage(stageId, (s) => ({ ...s, solarZ: s.lastSolarZ ?? 20 })); }

  function removeAnnulus(stageId: number) {
    updateStage(stageId, (s) => ({ ...s, lastAnnulusZ: s.annulusZ ?? s.lastAnnulusZ ?? 60, annulusZ: null }));
    const varId = (sid:number)=>`omega_a${sid}`;
    clearSpeedVar(varId(stageId));
    setRatio(r => ({ entrada: r.entrada === varId(stageId) ? undefined : r.entrada, saida: r.saida === varId(stageId) ? undefined : r.saida }));
    setCouplings(cs => cs.filter(c => c.a !== varId(stageId) && c.b !== varId(stageId)));
  }
  function restoreAnnulus(stageId: number) { updateStage(stageId, (s) => ({ ...s, annulusZ: s.lastAnnulusZ ?? 60 })); }
  function removeCoupling(index: number) { clearExampleSelectionIfNeeded(); setCouplings(cs => cs.filter((_, i) => i !== index)); }

function addStage() {
  clearExampleSelectionIfNeeded();
  setStages((xs) => {
    const last = xs.at(-1);
    const nextId = (last?.id ?? 0) + 1;

    // Template “lembrado” (Solar/Planetas/Anelar/last*)
    const tpl = JSON.parse(JSON.stringify(lastTemplateRef.current)) as StageTemplate;
    const source = last ?? tpl;

    // Copia exatamente os dentes da planetária anterior; se não houver anterior, usa template
    const planetsZ: number[] = last
      ? [...last.planetsZ]
      : (() => {
          const count = tpl.planetsZ?.length ?? 1;
          const seed = tpl.planetsZ?.at(-1) ?? 12;
          return Array.from({ length: count }, (_, i) =>
            tpl.planetsZ && tpl.planetsZ[i] != null ? tpl.planetsZ[i] : seed
          );
        })();

    // Copia também cópias visuais e “last*” da última planetária existente
    const planetCopies = (source as any).planetCopies ?? 1;

    const novo: UIStage = {
      id: nextId,
      solarZ: source.solarZ ?? null,
      planetsZ,
      annulusZ: source.annulusZ ?? null,
      lastSolarZ: source.lastSolarZ ?? source.solarZ ?? undefined,
      lastAnnulusZ: source.lastAnnulusZ ?? source.annulusZ ?? undefined,
      planetCopies,
    };

    return [...xs, novo];
  });
}

  function removeStage(id: number) {
    clearExampleSelectionIfNeeded();
    if (stages.length === 1) return;
    setStages((xs) => {
      const victim = xs.find((s) => s.id === id);
      if (victim) {
        const { id: _id, ...tpl } = victim as any;
        lastTemplateRef.current = JSON.parse(JSON.stringify(tpl));
      }
      return xs.filter((s) => s.id !== id);
    });
    setCouplings((cs) => cs.filter((c) => (c.a && !belongsToStage(c.a, id)) && (c.b && !belongsToStage(c.b, id))));
  }
  function belongsToStage(omega: string, sid: number) {
    return omega.includes(`omega_s${sid}`) || omega.includes(`omega_a${sid}`) || omega.includes(`omega_b${sid}`) || omega.includes(`omega_p${sid}_`);
  }

  const handleSpeedVarChange = (index: number, value: string) => {
    // Exceção: se há exemplo carregado, permitir editar apenas a 1ª velocidade sem limpar
    if (!(panelExample && index === 0)) clearExampleSelectionIfNeeded();
    const varId = value || undefined;
    setSpeeds((current) => current.map((s, i) => (i === index ? { ...s, var: varId } : s)));
  };

  const handleSpeedValueChange = (index: number, value: number) => {
    if (!(panelExample && index === 0)) clearExampleSelectionIfNeeded();
    setSpeeds((current) => current.map((s, i) => (i === index ? { ...s, value } : s)));
  };

  const addSpeedEntry = () => {
    clearExampleSelectionIfNeeded();
    setSpeeds((current) => [...current, { var: undefined, value: 0 }]);
  };

  const removeSpeedEntry = (index: number) => {
    clearExampleSelectionIfNeeded();
    setSpeeds((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, i) => i !== index);
    });
  };

  const ex1Gears = EX1_PRESET.gears;
  const ex2Gears = EX2_PRESET.gears;
  const ex3Gears = EX3_PRESET.gears;
  const ex4Gears = EX4_PRESET.gears;

  const ex1GearOrder = EX1_PRESET.order;
  const ex2GearOrder = EX2_PRESET.order;
  const ex3GearOrder = EX3_PRESET.order;
  const ex4GearOrder = EX4_PRESET.order;

  /** presets (apenas para preencher mais rapido) */
  function loadEX1() {
    const gear = ex1Gears[0];
    loadEX1FromPanel(gear.id);
  }
  function loadEX2() {
    const gear = ex2Gears[0];
    loadEX2FromPanel(gear.id);
  }
  function loadEX1FromPanel(gearId: Ex1GearId) {
    runWithExampleContext(() => {
      const gear = ex1Gears.find((g) => g.id === gearId) ?? ex1Gears[0];
      setStages(cloneStages(EX1_PRESET.stages));
      setCouplings(cloneCouplings(gear.couplings));
      setSpeeds(cloneSpeeds(gear.speeds));
      setRatio(cloneRatio(gear.ratio));
      setResult(null);
      setError(null);
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      setPanelExample("EX1");
      setSelectedGear(gear.id);
      resetCameraDefaults();
    });
  }
  function loadEX4() {
    const gear = ex4Gears[0];
    loadEX4FromPanel(gear.id);
  }
  function loadEX4FromPanel(gearId: Ex4GearId) {
    runWithExampleContext(() => {
      const gear = ex4Gears.find((g) => g.id === gearId) ?? ex4Gears[0];
      setStages(cloneStages(EX4_PRESET.stages));
      setCouplings(cloneCouplings(gear.couplings));
      setSpeeds(cloneSpeeds(gear.speeds));
      setRatio(cloneRatio(gear.ratio));
      setResult(null);
      setError(null);
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      setPanelExample("EX4");
      setSelectedGear(gear.id);
      resetCameraDefaults();
    });
  }
  function loadEX2FromPanel(gearId: Ex2GearId) {
    runWithExampleContext(() => {
      const gear = ex2Gears.find((g) => g.id === gearId) ?? ex2Gears[0];
      setStages(cloneStages(EX2_PRESET.stages));
      setCouplings(cloneCouplings(gear.couplings));
      setSpeeds(cloneSpeeds(gear.speeds));
      setRatio(cloneRatio(gear.ratio));
      setResult(null);
      setError(null);
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      setPanelExample("EX2");
      setSelectedGear(gear.id);
      resetCameraDefaults();
    });
  }
  function loadEX3(gearId: Ex3GearId = (selectedGear as Ex3GearId) ?? "g1") {
    runWithExampleContext(() => {
      const gear = ex3Gears.find((g) => g.id === gearId) ?? ex3Gears[0];
      setStages(cloneStages(EX3_PRESET.stages));
      setCouplings(cloneCouplings(gear.couplings));
      setSpeeds(cloneSpeeds(gear.speeds));
      setRatio(cloneRatio(gear.ratio));
      setResult(null);
      setError(null);
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      setPanelExample("EX3");
      setSelectedGear(gear.id);
      resetCameraDefaults();
    });
  }

  useEffect(() => {
    if (!exampleToLoad) return;
    if (exampleToLoad === "EX1") loadEX1();
    else if (exampleToLoad === "EX2") loadEX2();
    else if (exampleToLoad === "EX3") loadEX3();
    else if (exampleToLoad === "EX4") loadEX4();
    onExampleLoaded?.(exampleToLoad);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleToLoad]);

  const lastResetSignal = React.useRef(resetSignal);
  useEffect(() => {
    if (resetSignal == null) return;
    if (lastResetSignal.current === resetSignal) return;
    lastResetSignal.current = resetSignal;
    resetToDefaults();
  }, [resetSignal, resetToDefaults]);

// mantém validação de montagem no useEffect (como já está hoje)
useEffect(() => {
  try {
    setError(null);
    setUnderdeterminedMessage(null);
    const statusPorStage: Record<number, MontagemStatus> = {};
    for (const st of stages) {
      const s = validarMontagem(st.solarZ, st.planetsZ, st.annulusZ, st.planetCopies ?? 1);
      statusPorStage[st.id] = s;
      if (!s.valido) {
        setMontagem(statusPorStage);
        const msg = lang === "en" ? (s as any).mensagem_en ?? s.mensagem : s.mensagem;
        throw new Error(`${t("planetary")} ${st.id}: ${msg}`);
      }
    }
    setMontagem(statusPorStage);
  } catch (e:any) {
    setError(e?.message || String(e));
  }
}, [stages, lang]); // <— apenas montagem/erro aqui

const resultMemo = useMemo(() => {
  try {
    if (hasImpossible) return null;
    const model = buildModelFromUI(stages, speeds, couplings, ratio);

    const hasValidRatio = !!(ratio.entrada && ratio.saida);
    const r = solveGearSystem(model as any);

    if ((r as any).isUnderdetermined) {
      return null;
    }

	    return {
	      velocities: r.velocities,
	      ratios: hasValidRatio ? r.ratios : [],
	    };
	  } catch {
	    return null;
	  }
	}, [stages, speeds, couplings, ratio, lang, hasImpossible]);


  /** cálculo automático sempre que algo relevante mudar */
  useEffect(() => {
    try {
      setError(null);
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      const statusPorStage: Record<number, MontagemStatus> = {};
      for (const st of stages) {
        const s = validarMontagem(st.solarZ, st.planetsZ, st.annulusZ, st.planetCopies ?? 1);
        statusPorStage[st.id] = s;
        if (!s.valido) {
          setMontagem(statusPorStage);
          const msg = lang === "en" ? (s as any).mensagem_en ?? s.mensagem : s.mensagem;
          throw new Error(`${t("planetary")} ${st.id}: ${msg}`);
        }
      }
      setMontagem(statusPorStage);

      const model = buildModelFromUI(stages, speeds, couplings, ratio);
      const hasValidRatio = !!(ratio.entrada && ratio.saida);

      const r = solveGearSystem(model as any);

      if ((r as any).isUnderdetermined) {
        const missing = Math.max(1, Number((r as any).missingConstraints ?? 1));
        const isSingular = missing === 1;
        const msg =
          lang === "en"
            ? `The kinematic system is underdetermined. Add ${missing} more known ${isSingular ? "speed or coupling." : "speeds or couplings."}`
            : `O sistema cinemático está subdeterminado. Adicione mais ${missing} ${isSingular ? "velocidade conhecida ou acoplamento." : "velocidades conhecidas ou acoplamentos."}`;
        setError(msg);
        setUnderdeterminedMessage(msg);
        setOverdeterminedMessage(null);
        setResult(null);
        return;
      }

      if ((r as any).isOverdetermined) {
        const extra = Math.max(1, Number((r as any).conflictingConstraints ?? 1));
        const isSingular = extra === 1;
        const msg =
          lang === "en"
            ? `The kinematic system is overdetermined. Remove ${extra} ${isSingular ? "known speed or coupling." : "known speeds or couplings."}`
            : `O sistema cinemático está superdeterminado. Retire ${extra} ${isSingular ? "velocidade conhecida ou acoplamento." : "velocidades conhecidas ou acoplamentos."}`;
        setError(msg);
        setOverdeterminedMessage(msg);
        setUnderdeterminedMessage(null);
        setResult(null);
        return;
      }

      const ratios = hasValidRatio ? r.ratios : [];
      setResult({ velocities: r.velocities, ratios });
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
    } catch (e:any) {
      setError(e?.message || String(e));
      setUnderdeterminedMessage(null);
      setOverdeterminedMessage(null);
      setResult(null);
    }
  }, [stages, speeds, couplings, ratio, lang]);

  /** Garante que, se houver 2+ planetárias, exista ao menos 1 linha A/B visível */
  useEffect(() => {
    if (stages.length > 1 && couplings.length === 0) setCouplings([{}, {}]);
    if (stages.length <= 1 && couplings.length > 0) setCouplings([]);
  }, [stages.length]);

  const layoutStyle: React.CSSProperties = isMobile ? { ...layout, display: "block", minHeight: "auto" } : layout;
  const leftColStyle: React.CSSProperties = isMobile
    ? { ...leftCol, height: "auto", overflow: "visible", paddingRight: 0 }
    : leftCol;
  const cardStyle: React.CSSProperties = isMobile ? { ...card, padding: "0.65rem" } : card;

  const leftPanel = (
    <div style={leftColStyle}>
      {/* Geometria */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t("geometry")}</h3>
        {stages.map((st) => (
          <div key={st.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{t("planetary")} {st.id}</div>
              {stages.length > 1 && <button style={btn} onClick={() => removeStage(st.id)}>{t("remove")}</button>}
            </div>

            {/* SOLAR */}
            {st.solarZ != null ? (
              <div style={fieldRow}>
                <label style={label}>{t("solar")}</label>
                <button style={btnIcon} title={`${t("remove")} ${t("solar")}`} onClick={()=>removeSolar(st.id)}>×</button>
                <input style={input} type="number" value={st.solarZ}
                  onChange={(e) => updateStage(st.id, (s) => ({ ...s, solarZ: Number(e.target.value) }))}/>
              </div>
            ) : (
              <div style={fieldRowNoX}>
                <label style={label}>{t("solar")}</label>
                <button style={btn} onClick={()=>restoreSolar(st.id)}>{t("addSolar")}</button>
              </div>
            )}

            {/* PLANETAS */}
            <div style={{ display:"grid", gap:0 }}>
              {st.planetsZ.map((z, i) => (
                <div key={i} style={st.planetsZ.length >= 2 ? fieldRow : fieldRowNoX}>
                  <label style={label}>{t("planet")} {st.planetsZ.length === 1 ? "" : (i + 1)}</label>
                  {st.planetsZ.length >= 2 && (
                    <button style={btnIcon} title={`${t("remove")} ${t("planet")}`} onClick={() => removePlanet(st.id, i)}>×</button>
                  )}
                  <input style={input} type="number" value={z}
                    onChange={(e) => updateStage(st.id, (s) => ({ ...s, planetsZ: s.planetsZ.map((pz, k) => k === i ? Number(e.target.value) : pz) }))}/>
                </div>
              ))}
              <div style={{ marginTop: 0, marginBottom: 8 }}>
                <button style={{ ...btn, display: "block", margin: 0 }} onClick={() => addPlanet(st.id)}>
                  {t("addPlanet")}
                </button>
              </div>
            </div>

            {/* ANELAR */}
            {st.annulusZ != null ? (
              <div style={fieldRow}>
                <label style={label}>{t("annulus")}</label>
                <button style={btnIcon} title={`${t("remove")} ${t("annulus")}`} onClick={()=>removeAnnulus(st.id)}>×</button>
                <input style={input} type="number" value={st.annulusZ}
                  onChange={(e) => updateStage(st.id, (s) => ({ ...s, annulusZ: e.target.value === "" ? null : Number(e.target.value) }))}/>
              </div>
            ) : (
              <div style={fieldRowNoX}>
                <label style={label}>{t("annulus")}</label>
                <button style={btn} onClick={()=>restoreAnnulus(st.id)}>{t("addAnnulus")}</button>
              </div>
            )}

            {/* CÓPIAS DE PLANETA (visual) */}
            <div style={{ ...fieldRowNoX, marginTop: 8 }}>
              <label style={label}>{t("planetCopies")}</label>
              <input
                style={input}
                type="number"
                min={1}
                max={5}
                value={st.planetCopies ?? 1}
                onChange={(e) =>
                  updateStage(st.id, (s) => ({
                    ...s,
                    planetCopies:
                      e.target.value === "" ? 1 :
                      Math.max(1, Math.min(5, Number(e.target.value)))
                  }))
                }
              />
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {t("meshChainHint")}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button style={btn} onClick={addStage}>{t("addPlanetary")}</button>
        </div>
      </div>

      {/* Acoplamentos */}
      {stages.length > 1 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{t("couplings")}</h3>
          {(() => {
            const rows = (couplings.length > 0) ? couplings : [{}];
            return rows.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: couplings.length > 0 ? "1fr 1fr 36px" : "1fr 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select style={input} value={c.a ?? ""} onChange={(e) => {
                  clearExampleSelectionIfNeeded();
                  const val = e.target.value || undefined;
                  if (couplings.length === 0) setCouplings([{ a: val, b: c.b }]);
                  else setCouplings(cs => cs.map((cc, k) => k === i ? { ...cc, a: val } : cc));
                }}>
                  <option value="">{t("selectA")}</option>
                  {omegaOptions.map(o => (
                    <option key={o.id} value={o.id} disabled={c.b === o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <select style={input} value={c.b ?? ""} onChange={(e) => {
                  clearExampleSelectionIfNeeded();
                  const val = e.target.value || undefined;
                  if (couplings.length === 0) setCouplings([{ a: c.a, b: val }]);
                  else setCouplings(cs => cs.map((cc, k) => k === i ? { ...cc, b: val } : cc));
                }}>
                  <option value="">{t("selectB")}</option>
                  {omegaOptions.map(o => (
                    <option key={o.id} value={o.id} disabled={c.a === o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>

                {couplings.length > 0 && (
                  <button style={btnIcon} title={t("remove")} onClick={() => removeCoupling(i)}>×</button>
                )}
              </div>
            ));
          })()}
          <button style={btn} onClick={() => { clearExampleSelectionIfNeeded(); setCouplings(cs => [...cs, {}]); }}>{t("addCoupling")}</button>
          <div style={small}>{t("couplingHint")}</div>
        </div>
      )}

      {/* Velocidades */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t("speeds")}</h3>
        {speeds.map((speed, idx) => {
          const usedByOthers = new Set(
            speeds.map((s, i) => (i === idx ? undefined : s.var)).filter(Boolean) as string[]
          );
          const showRemove = speeds.length > 1;
          const rowStyle: React.CSSProperties = {
            display: "grid",
            gridTemplateColumns: showRemove ? "1fr 120px 36px" : "1fr 120px",
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
          };

          return (
            <div key={idx} style={rowStyle}>
              <select
                style={input}
                value={speed.var ?? ""}
                onChange={(e) => handleSpeedVarChange(idx, e.target.value)}
              >
                <option value="">{t("selectGearArm")}</option>
                {omegaOptions.map((o) => (
                  <option key={o.id} value={o.id} disabled={usedByOthers.has(o.id)}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                style={input}
                type="number"
                value={speed.value}
                onChange={(e) => handleSpeedValueChange(idx, Number(e.target.value))}
              />
              {showRemove && (
                <button
                  style={btnIcon}
                  title={t("remove")}
                  onClick={() => removeSpeedEntry(idx)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button style={btn} onClick={addSpeedEntry}>{t("addSpeed")}</button>
        <div style={{ ...small, marginTop: 6 }}>{t("sameVarNotAllowed")}</div>
      </div>

      {/* Relação */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>{t("speedRatio")}</h3>
        <div style={{ ...row2, marginBottom: 8 }}>
          <div>
            <label style={label}>{t("input")}</label>
            <select style={input} value={ratio.entrada ?? ""} onChange={(e)=>{ clearExampleSelectionIfNeeded(); setRatio({...ratio, entrada:e.target.value}); }}>
              <option value="">{t("select")}</option>
              {omegaOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>{t("output")}</label>
            <select style={input} value={ratio.saida ?? ""} onChange={(e)=>{ clearExampleSelectionIfNeeded(); setRatio({...ratio, saida:e.target.value}); }}>
              <option value="">{t("select")}</option>
              {omegaOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Perfil das engrenagens (módulo / ângulo de pressão / largura) */}
      <div style={cardStyle}>
        <button
          style={{
            ...btn,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontWeight: 600,
          }}
          type="button"
          onClick={() => setGearPanelOpen((open) => !open)}
        >
          <span>{strings[lang].gearProfile}</span>
          <span style={{ opacity: 0.7 }}>{gearPanelOpen ? "▾" : "▸"}</span>
        </button>

        {gearPanelOpen && (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].pressureAngle}</label>
              <input
                style={input}
                type="number"
                step={1}
                value={gearPressureDeg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) {
                    setGearPressureDeg(20);
                  } else {
                    setGearPressureDeg(v);
                  }
                }}
              />
            </div>

            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].helixAngle}</label>
              <input
                style={input}
                type="number"
                step={1}
                value={gearHelixDeg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) {
                    setGearHelixDeg(0);
                  } else {
                    setGearHelixDeg(v);
                  }
                }}
              />
            </div>

            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].gearWidth}</label>
              <input
                style={input}
                type="number"
                min={0}
                step={1}
                value={gearWidth}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) {
                    setGearWidth(5);
                  } else {
                    setGearWidth(Math.max(0.5, v));
                  }
                }}
              />
            </div>

            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].module}</label>
              <input
                style={input}
                type="number"
                min={0}
                step={1}
                value={gearModule}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) {
                    setGearModule(1);
                  } else {
                    setGearModule(Math.max(0.1, v));
                  }
                }}
              />
            </div>

            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].ringThickness}</label>
              <input
                style={input}
                type="number"
                min={0}
                step={1}
                value={ringThickness}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) {
                    setRingThickness(3);
                  } else {
                    setRingThickness(Math.max(0, v));
                  }
                }}
              />
            </div>

            <div style={fieldRowNoX}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={label}>{strings[lang].backlash}</label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={backlashPlanetsOnly}
                    onChange={(e) => setBacklashPlanetsOnly(e.target.checked)}
                  />
                  {strings[lang].backlashPlanetsOnly}
                </label>
              </div>
              <input
                style={input}
                type="number"
                min={0}
                step={0.1}
                value={backlash}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setBacklash(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
              />
            </div>

            <div style={{ ...fieldRowNoX, gridTemplateColumns: "1fr minmax(0, 1fr)" }}>
              <label style={label}>
                {lang === "en" ? "Interference (undercutting)" : "Interferência (adelgaçamento)"}
              </label>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={undercut}
                  onChange={(e) => setUndercut(e.target.checked)}
                />
              </div>
            </div>

            <div style={fieldRowNoX}>
              <label style={label}>{strings[lang].camera}</label>
              <select
                style={{ ...input, width: "25ch", justifySelf: "end" }}
                value={cameraProjection}
                onChange={(e) => setCameraProjection(e.target.value as "orthographic" | "perspective")}
              >
                <option value="orthographic">{strings[lang].projectionOrthographic}</option>
                <option value="perspective">{strings[lang].projectionPerspective}</option>
              </select>
            </div>

            <div style={{ ...small, marginTop: -4 }}>
              {strings[lang].moduleHint}
            </div>
          </div>
        )}
      </div>

    </div>
  );

  return (
    <div ref={containerRef} style={layoutStyle}>
      {isMobile && (
        <>
          <div
            onClick={() => setMobileLeftOpen(false)}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              zIndex: 90,
              background: "rgba(0,0,0,0.35)",
              opacity: mobileLeftOpen ? 1 : 0,
              pointerEvents: mobileLeftOpen ? "auto" : "none",
              transition: "opacity 180ms ease",
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 0,
              bottom: 0,
              left: 0,
              width: drawerWidth,
              height: "100dvh",
              transform: `translateX(${drawerX}px)`,
              transition: drawerDragging ? "none" : "transform 180ms ease",
              zIndex: 100,
              background: "var(--panel-bg)",
              borderRight: "1px solid var(--border)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            }}
          >
            <div
              onPointerDown={startDrawerDrag}
              onPointerMove={moveDrawerDrag}
              onPointerUp={endDrawerDrag}
              onPointerCancel={endDrawerDrag}
              onClick={() => setMobileLeftOpen((v) => !v)}
              title={mobileLeftOpen ? "Arraste para esconder" : "Arraste para mostrar"}
              style={{
                position: "absolute",
                top: "50%",
                right: 0,
                width: drawerTabWidth,
                height: 90,
                transform: "translateY(-50%)",
                borderRadius: "0 10px 10px 0",
                border: "1px solid var(--border)",
                background: "var(--panel-bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "grab",
                userSelect: "none",
                touchAction: "none",
                color: "var(--text)",
                fontWeight: 700,
              }}
            >
              ≡
            </div>

            <div
              style={{
                height: "100%",
                maxHeight: "100dvh",
                overflow: "auto",
                paddingTop: 10,
                paddingBottom: 10,
                paddingLeft: 10,
                paddingRight: 10 + drawerTabWidth,
                WebkitOverflowScrolling: "touch",
              }}
            >
              {leftPanel}
            </div>
          </div>
        </>
      )}

      {!isMobile && leftPanel}

      {/* Coluna direita */}
      <div
      id="right-col"
      ref={rightColRef}
      style={{
        display: "grid",
        gridTemplateRows: isMobile ? "auto" : `${Math.round(viewFrac * 100)}% 10px 1fr`,
        minHeight: 0,
        gap: isMobile ? 12 : 0,
        height: isMobile ? "auto" : "calc(100vh - 130px)",
        paddingLeft: isMobile ? drawerTabWidth + 6 : undefined,
        boxSizing: "border-box",
      }}
    >
      {/* Cena 3D (topo) */}
      <div
        style={{
          ...cardStyle,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
          height: isMobile ? "100vh" : undefined,
          maxHeight: isMobile ? "100vh" : undefined,
        }}
      >
        {panelExample && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 2,
              background: "var(--panel-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              minWidth: 0,
              width: examplePanelWidth != null ? `${examplePanelWidth}px` : "fit-content",
              maxWidth: "calc(100% - 20px)",
              alignItems: "stretch",
            }}
          >
            <div
              ref={exampleTitleRef}
              style={{
                fontWeight: 700,
                marginBottom: 6,
                lineHeight: 1.25,
                whiteSpace: "pre",
                textAlign: "right",
                display: "inline-block",
                alignSelf: "flex-end",
              }}
            >
              {panelExample === "EX4"
                ? strings[lang].ex4Title
                : panelExample === "EX2"
                ? strings[lang].ex2Title
                : panelExample === "EX1"
                ? strings[lang].ex1Title
                : strings[lang].ex3Title}
            </div>
            <div
              style={{
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                maxHeight: isMobile ? "34vh" : "60vh",
                paddingRight: 2,
              }}
            >
              {(panelExample === "EX3"
                ? ex3GearOrder
                : panelExample === "EX4"
                ? ex4GearOrder
                : panelExample === "EX2"
                ? ex2GearOrder
                : ex1GearOrder).map((gid) => {
                const gearList =
                  panelExample === "EX3"
                    ? ex3Gears
                    : panelExample === "EX4"
                    ? ex4Gears
                    : panelExample === "EX2"
                    ? ex2Gears
                    : ex1Gears;
                const gear = gearList.find((g) => g.id === gid) || gearList[0];
                const active = selectedGear === gid;
                return (
                  <button
                    key={gid}
                    style={{
                      ...btn,
                      width: "100%",
                      minWidth: "100%",
                      textAlign: "left",
                      borderColor: active ? "#60a5fa80" : "var(--btn-border)",
                      background: active ? "#60a5fa30" : "var(--btn-bg)",
                      fontWeight: active ? 700 : 500,
                    }}
                    onClick={() => {
                      if (panelExample === "EX3") loadEX3(gid as Ex3GearId);
                      else if (panelExample === "EX4") loadEX4FromPanel(gid as Ex4GearId);
                      else if (panelExample === "EX2") loadEX2FromPanel(gid as Ex2GearId);
                      else if (panelExample === "EX1") loadEX1FromPanel(gid as Ex1GearId);
                    }}
                  >
                    {gear.label[lang]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <GearScene
          key={resetSignal}
          stages={stages.map(s => ({
            id: s.id,
            solarZ: s.solarZ,
            planetsZ: s.planetsZ,
            annulusZ: s.annulusZ,
            lastSolarZ: s.lastSolarZ,
            planetCopies: s.planetCopies ?? 1,
          }))}
          velocities={hasImpossible ? null : (resultMemo?.velocities ?? null)}
          timeScale={hasImpossible ? 0 : timeScale}
          topologyKey={topologyKey}
          lang={lang}
          cameraZoomMultiplier={cameraZoomMultiplier}
          cameraResetToken={cameraResetToken}
          cameraZoomFitToken={cameraZoomFitToken}
          cameraProjection={cameraProjection}
          gearModule={gearModule}
          gearPressureDeg={gearPressureDeg}
          gearHelixDeg={gearHelixDeg}
          gearWidth={gearWidth}
          ringThickness={ringThickness}
          backlash={backlash}
          undercut={undercut}
          backlashPlanetsOnly={backlashPlanetsOnly}
          visibilityResetToken={resetSignal}
          phaseResetToken={resetSignal}
        />
      </div>

      {/* Divisor (⇵) — arraste para redimensionar */}
      {!isMobile && (
        <div
          onMouseDown={startDrag}
          title="Arraste para redimensionar"
          style={{
            cursor: "row-resize",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            background: "var(--panel-bg)",
          }}
        >
          ⇵
        </div>
      )}

      {/* Painel de resultados (embaixo) */}
      {!isMobile && (
        <div style={{ ...cardStyle, minHeight: 0, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0, flexShrink: 0 }}>{t("results")}</h3>
          </div>
          {renderResultsBody()}
        </div>
      )}
    </div>

    {/* Mobile: painel de resultados em formato "drawer" (igual ao da coluna esquerda) */}
    {isMobile && !resultsCollapsed && (
      <div
        onClick={() => {
          setResultsCollapsed(true);
          setResultsDrawerYClamped(resultsDrawerClosedY);
        }}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          top: 0,
          zIndex: 70,
          background: "rgba(0,0,0,0.35)",
          opacity: 1,
          pointerEvents: "auto",
          transition: "opacity 180ms ease",
        }}
      />
    )}

    {isMobile && (
      <div
        style={{
          position: "fixed",
          left: mobileResultsInset.left,
          right: mobileResultsInset.right,
          bottom: 0,
          height: resultsDrawerHeight + resultsHandleAreaHeight,
          transform: `translateY(${resultsDrawerY}px)`,
          transition: resultsDrawerDragging ? "none" : "transform 180ms ease",
          zIndex: 80,
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            ...cardStyle,
            padding: 0,
            height: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 -10px 30px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              height: resultsHandleAreaHeight,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 14,
                top: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                fontWeight: 700,
                pointerEvents: "none",
              }}
            >
              {t("results")}
            </div>
            <div
              onPointerDown={startResultsDrag}
              onPointerMove={moveResultsDrag}
              onPointerUp={endResultsDrag}
              onPointerCancel={endResultsDrag}
              onClick={() => {
                const nextCollapsed = !resultsCollapsedRef.current;
                setResultsCollapsed(nextCollapsed);
                setResultsDrawerYClamped(nextCollapsed ? resultsDrawerClosedY : 0);
              }}
              title={resultsCollapsed ? "Arraste para mostrar" : "Arraste para esconder"}
              style={{
                width: resultsTabWidth,
                height: resultsTabHeight,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--panel-bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "grab",
                userSelect: "none",
                touchAction: "none",
                color: "var(--text)",
                fontWeight: 700,
              }}
            >
              ≡
            </div>
          </div>

          <div style={{ padding: "0 14px 14px 14px", overflow: "auto", minHeight: 0, flex: "1 1 auto" }}>
            {renderResultsBody()}
          </div>
        </div>
      </div>
    )}
  </div>
);

}

/** ---------- Helpers de nomes ---------- */
const omegaS = (sid:number)=>`omega_s${sid}`;
const omegaA = (sid:number)=>`omega_a${sid}`;
const omegaB = (sid:number)=>`omega_b${sid}`;
const omegaP = (sid:number,k:number)=>`omega_p${sid}_${k}`;

/** Rotulagem amigável (depende de idioma) */
function buildOmegaOptions(stages: {id:number; solarZ:number|null; planetsZ:number[]; annulusZ:number|null}[], lang: Lang) {
  const singleStage = stages.length === 1;
  const byStage = new Map<number, { planets: number; hasAnnulus: boolean }>();
  stages.forEach(st => byStage.set(st.id, { planets: st.planetsZ.length, hasAnnulus: st.annulusZ != null }));
  const ids: string[] = [];
  for (const st of stages) {
    if (st.solarZ != null) ids.push(omegaS(st.id));
    ids.push(omegaB(st.id));
    if (st.annulusZ != null) ids.push(omegaA(st.id));
    st.planetsZ.forEach((_, k) => ids.push(omegaP(st.id, k + 1)));
  }
  const S = strings[lang];
  const opts = ids.map(id => {
    let label = id;
    const mS = id.match(/^omega_s(\d+)$/);
    const mB = id.match(/^omega_b(\d+)$/);
    const mA = id.match(/^omega_a(\d+)$/);
    const mP = id.match(/^omega_p(\d+)_(\d+)$/);
    if (mS) {
      const sid = Number(mS[1]);
      label = singleStage ? S.solar : `${S.planetary} ${sid} • ${S.solar}`;
    } else if (mB) {
      const sid = Number(mB[1]);
      label = singleStage ? S.arm : `${S.planetary} ${sid} • ${S.arm}`;
    } else if (mA) {
      const sid = Number(mA[1]);
      label = singleStage ? S.annulus : `${S.planetary} ${sid} • ${S.annulus}`;
    } else if (mP) {
      const sid = Number(mP[1]);
      const k   = Number(mP[2]);
      const planetsCount = byStage.get(sid)?.planets ?? 1;
      const base = (planetsCount === 1) ? S.planet : `${S.planet} ${k}`;
      label = singleStage ? base : `${S.planetary} ${sid} • ${base}`;
    }
    return { id, label };
  });
  const order = (id:string) => id.startsWith("omega_s") ? 0 : id.startsWith("omega_b") ? 1 : id.startsWith("omega_a") ? 2 : 3;
  return opts.sort((a,b) => {
    const sidA = Number(a.id.match(/\d+/)?.[0] ?? "0");
    const sidB = Number(b.id.match(/\d+/)?.[0] ?? "0");
    if (sidA !== sidB) return sidA - sidB;
    const t = order(a.id) - order(b.id);
    if (t !== 0) return t;
    return a.label.localeCompare(b.label, lang === "pt" ? "pt-BR" : "en-US");
  });
}

/** ---------- UI → Model ---------- */
function buildModelFromUI(
  stages: UIStage[],
  speeds: UISpeed[],
  couplings: UICoupling[],
  ratio: UIRatio
): Model {
  const elements: Element[] = [];
  const meshes: Mesh[] = [];
  const constraints: Constraint[] = [];
  const ratios: { id: string; num: string; den: string }[] = [];

  for (const st of stages) {
    if (st.solarZ != null) elements.push({ id: `sol${st.id}`, type: "solar", N: st.solarZ, omega: omegaS(st.id) });
    elements.push({ id: `arm${st.id}`, type: "arm", omega: omegaB(st.id) });
    st.planetsZ.forEach((Z, k) => { elements.push({ id: `p${st.id}_${k + 1}`, type: "planet", N: Z, omega: omegaP(st.id, k + 1) }); });
    if (st.annulusZ != null) elements.push({ id: `ann${st.id}`, type: "annulus", N: st.annulusZ, omega: omegaA(st.id) });

    if (st.solarZ != null && st.planetsZ.length >= 1) meshes.push({ i: omegaS(st.id), j: omegaP(st.id, 1), carrier: omegaB(st.id), type: "external" });
    for (let k = 1; k < st.planetsZ.length; k++) meshes.push({ i: omegaP(st.id, k), j: omegaP(st.id, k + 1), carrier: omegaB(st.id), type: "external" });
    if (st.annulusZ != null && st.planetsZ.length >= 1) { const last = st.planetsZ.length; meshes.push({ i: omegaP(st.id, last), j: omegaA(st.id), carrier: omegaB(st.id), type: "internal" }); }
  }

  for (const s of speeds) if (s.var != null) constraints.push({ type:"known", var:s.var, value:s.value });
  for (const c of couplings) if (c.a && c.b) constraints.push({ type:"equal", a:c.a, b:c.b });
  if (ratio.entrada && ratio.saida) ratios.push({ id:"entrada/saida", num: ratio.entrada, den: ratio.saida });
  return { elements, meshes, constraints, ratios, carriers: stages.map(st=>({id:`arm${st.id}`, omega:omegaB(st.id)})) };
}

/** ---------- util ---------- */
function fmt(x: number, decimals: number) {
  if (!Number.isFinite(x)) return String(x);
  const eps = 0.5 * Math.pow(10, -decimals);
  let y = Math.abs(x) < eps ? 0 : x;
  y = Number(y.toFixed(decimals));
  if (Object.is(y, -0)) y = 0;
  return y.toFixed(decimals);
}
