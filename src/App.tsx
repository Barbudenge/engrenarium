import { useEffect, useRef, useState } from "react";
import { StageEditor, type StageEditorHandle } from "./ui/StageEditor";
import { strings, type Lang, getStoredLang, setStoredLang } from "./ui/i18n";
import { useIsMobile } from "./lib/useIsMobile";

export default function App() {
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [lang, setLang] = useState<Lang>(getStoredLang());
  const [exampleToLoad, setExampleToLoad] = useState<"EX1" | "EX2" | "EX3" | "EX4" | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [lastLoadedExample, setLastLoadedExample] = useState<"EX1" | "EX2" | "EX3" | "EX4" | null>(null);
  const stageEditorRef = useRef<StageEditorHandle | null>(null);
  const logoUrl = `${import.meta.env.BASE_URL}logo-engrenarium.png`;
  const mobileLeftOffset = isMobile ? 32 : 0;
  const headerButtonStyle = {
    border: "1px solid var(--btn-border)",
    background: "var(--btn-bg)",
    color: "var(--text)",
    borderRadius: 6,
    padding: isMobile ? "6px 10px" : "6px 11px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: isMobile ? 13 : 14,
    whiteSpace: "nowrap",
  } as const;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setStoredLang(l);
  };

  return (
    <>
      <style>{`
  :root {
    --bg: #0b1220;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --panel-bg: #0f172a;
    --border: #1f2937;
    --input-bg: #0b1220;
    --btn-bg: #111827;
    --btn-border: #334155;
    font-size: 16px;
  }
  :root[data-theme="light"] {
    --bg: #f8fafc;
    --text: #0f172a;
    --muted: #475569;
    --panel-bg: #ffffff;
    --border: #e2e8f0;
    --input-bg: #ffffff;
    --btn-bg: #f1f5f9;
    --btn-border: #cbd5e1;
  }
  html, body, #root {
    height: 100%;
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Segoe UI Symbol";
  }
  body { overflow-x: hidden; }
  #root { min-height: 100dvh; overflow-x: hidden; }
  .wrap {
    width: 100%;
    max-width: 1800px;
    margin: 0 auto;
    padding: 12px 16px;
    box-sizing: border-box;
  }
  .toggle {
    display: inline-flex;
    border: 1px solid var(--btn-border);
    border-radius: 999px;
    padding: 2px;
    background: var(--panel-bg);
    gap: 2px;
  }
  .toggle button {
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .toggle button.active {
    background: #60a5fa20;
    border-color: #60a5fa60;
  }
  @media (max-width: 900px), (pointer: coarse) {
    :root { font-size: 14px; }
    .wrap { padding: 8px 10px; }
    .toggle { padding: 1px; }
    .toggle button { font-size: 13px; padding: 5px 8px; }
  }
`}</style>

      <div className="wrap" style={mobileLeftOffset ? { paddingLeft: mobileLeftOffset } : undefined}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 8 : 12,
            marginBottom: 8,
            flexWrap: "nowrap",
            overflowX: isMobile ? "auto" : "visible",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <img
              src={logoUrl}
              alt="Engrenarium"
              style={{
                width: isMobile ? 22 : 28,
                height: isMobile ? 22 : 28,
                objectFit: "contain",
                flex: "0 0 auto",
              }}
            />
            <h1 style={{ margin: 0, fontSize: isMobile ? 18 : 20, lineHeight: 1.15 }}>
              {strings[lang].appTitle}
            </h1>
          </div>

        <button
          style={headerButtonStyle}
          onClick={() => {
            setExampleToLoad(null);
            setResetSignal((x) => x + 1);
            setLastLoadedExample(null);
          }}
        >
          {strings[lang].newPlanetary}
        </button>
        <button
          style={headerButtonStyle}
          onClick={() => stageEditorRef.current?.savePlanetary()}
        >
          {strings[lang].savePlanetary}
        </button>
        <button
          style={headerButtonStyle}
          onClick={() => stageEditorRef.current?.openLoadDialog()}
        >
          {strings[lang].loadPlanetary}
        </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 10,
              marginLeft: "auto",
              flexWrap: "nowrap",
              overflowX: isMobile ? "auto" : "visible",
            }}
          >
            {/* Painel de exemplos */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                border: "1px solid var(--btn-border)",
                borderRadius: 10,
                background: "var(--panel-bg)",
                width: "auto",
                flexWrap: "nowrap",
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{strings[lang].examples}</div>
              <select
                style={{
                  border: "1px solid var(--btn-border)",
                  background: "var(--btn-bg)",
                  color: "var(--text)",
                  borderRadius: 6,
                  padding: isMobile ? "5px 8px" : "6px 9px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: isMobile ? 12 : 14,
                  minWidth: 110,
                }}
                value={lastLoadedExample ?? ""}
                onChange={(e) => {
                  const value = e.target.value as "EX1" | "EX2" | "EX3" | "EX4" | "";
                  if (!value) return;
                  setExampleToLoad(value);
                }}
              >
                <option value="">{strings[lang].selectExample}</option>
                <option value="EX1">{strings[lang].ex1}</option>
                <option value="EX2">{strings[lang].ex2}</option>
                <option value="EX3">{strings[lang].ex3}</option>
                <option value="EX4">{strings[lang].ex4}</option>
              </select>
            </div>

            {/* seletor de idioma */}
            <div className="toggle" aria-label={strings[lang].language} title={strings[lang].language}>
              <button className={lang === "pt" ? "active" : ""} onClick={() => switchLang("pt")}>
                {strings[lang].langPT}
              </button>
              <button className={lang === "en" ? "active" : ""} onClick={() => switchLang("en")}>
                {strings[lang].langEN}
              </button>
            </div>

            {/* seletor de tema */}
            <div>
              <div className="toggle">
                <button
                  className={theme === "dark" ? "active" : ""}
                  onClick={() => setTheme("dark")}
                  title="Tema escuro"
                  aria-label="Tema escuro"
                >
                  🌙
                </button>
                <button
                  className={theme === "light" ? "active" : ""}
                  onClick={() => setTheme("light")}
                  title="Tema claro"
                  aria-label="Tema claro"
                >
                  ☀️
                </button>
              </div>
            </div>
          </div>
        </div>

        <p style={{ opacity: 0.8, marginTop: 0, marginBottom: 12 }}>
          {strings[lang].appSubtitle}
        </p>

        <StageEditor
          ref={stageEditorRef}
          lang={lang}
          exampleToLoad={exampleToLoad}
          onExampleLoaded={(id) => {
            setExampleToLoad(null);
            setLastLoadedExample(id);
          }}
          resetSignal={resetSignal}
        />
      </div>
    </>
  );
}
