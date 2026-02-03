export type Lang = "pt" | "en";

export const strings = {
  pt: {

appTitle: "Engrenarium",
    appSubtitle: "Coloque as geometrias e velocidades conhecidas. Em “Relação de Velocidades” escolha Entrada e Saída.",

    // Seções
    geometry: "Geometria (dentes)",
    couplings: "Acoplamentos",
    speeds: "Velocidades (rpm)",
    speedRatio: "Relação de Velocidades",
    results: "Resultados",
    renderedTreeTitle: "Peças renderizadas",
    renderedTreeRoot: "Sistema de planetárias",
    gearProfile: "Perfil das engrenagens",

    // Rótulos comuns
    planetary: "Planetária",
    solar: "Solar",
    annulus: "Anelar",
    arm: "Braço",
    planet: "Planeta",
    hideFromView: "Ocultar da renderização",
    showInView: "Mostrar na renderização",
    module: "Módulo (mm)",
    pressureAngle: "Ângulo de pressão ϕ (°)",
    gearWidth: "Largura das engrenagens",
    ringThickness: "Espessura da anelar",
    helixAngle: "Ângulo de hélice Ψ (°)",
    backlash: "Folga",
    backlashPlanetsOnly: "só planetas",
    moduleHint: "Alterar o módulo não muda a renderização na tela, mas muda o diâmetro ao exportar a geometria.",
    camera: "Câmera",
    projectionOrthographic: "Projeção ortográfica",
    projectionPerspective: "Projeção em perspectiva",

    // Botões / ações
    remove: "Remover",
    addPlanet: "+ Planeta",
    addAnnulus: "+ Anelar",
    addSolar: "+ Solar",
    addPlanetary: "+ Adicionar planetária",
    addSpeed: "+ Adicionar velocidade",
    addCoupling: "+ Adicionar acoplamento (ωA = ωB)",
    ex1: "EX1",
    ex2: "EX2",
    ex3: "EX3",
    ex4: "EX4",
    examples: "Exemplos",
    newPlanetary: "Nova planetária",
    viewJSON: "Ver JSON",
    ex1Title: "Diferentes relações\nem uma planetária",
    ex2Title: "Transmissão automática\nFord Modelo T",
    ex3Title: "Transmissão automática\nAllison 1000",
    ex4Title: "Transmissão automática 4R70W\nTipo Ravigneaux",
    timeScaleLabel: "Escala do tempo (1.00 = tempo real)",

    // Placeholders
    select: "(selecionar)",
    selectA: "(selecionar A)",
    selectB: "(selecionar B)",
    selectGearArm: "(escolher engrenagem/braço)",

    // Dicas
    meshChainHint:
      "Cadeia no estágio: Solar ↔ Planeta1 (externo), Planeta1 ↔ Planeta2 (externo), …, Planeta_k ↔ Anelar (interno se houver).",
    couplingHint:
      "Use para acoplar estágios (ex.: planeta do 1º coaxial ao planeta do 2º).",
    sameVarNotAllowed: "Não é possível usar a mesma variável nas duas linhas.",
    renderPlaceholder: "(renderização das engrenagens virá aqui)",

    // Resultados
    decimalPlaces: "Casas decimais",
    notCalculated: "Ainda não calculado.",
    relation: "Relação",
    input: "Entrada",
    output: "Saída",

    // Status de montagem
    stageOpen: "Estágio aberto (sem engrenagem anelar)",
    armStraight: "Braço reto",
    armStepped: "Braço curvo",

    planetCopies: "Quantidade de planetas na órbita",

    // Idioma
    langPT: "PT",
    langEN: "EN",
    language: "Idioma",
  },
  en: {

appTitle: "Engrenarium",
    appSubtitle: "Enter the geometries and known speeds. In “Speed ratio” choose Input and Output.",

    // Sections
    geometry: "Geometry (teeth)",
    couplings: "Couplings",
    speeds: "Speeds (rpm)",
    speedRatio: "Speed ratio",
    results: "Results",
    renderedTreeTitle: "Rendered parts",
    renderedTreeRoot: "Planetary system",
    gearProfile: "Gear profile",

    // Common labels
    planetary: "Planetary",
    solar: "Sun",
    annulus: "Ring",
    arm: "Carrier",
    planet: "Planet",
    hideFromView: "Hide from rendering",
    showInView: "Show in rendering",
    module: "Module (mm)",
    pressureAngle: "Pressure angle ϕ (°)",
    gearWidth: "Gear width",
    ringThickness: "Ring thickness",
    helixAngle: "Helix angle Ψ (°)",
    backlash: "Backlash",
    backlashPlanetsOnly: "Planets only",
    moduleHint: "Changing the module does not affect on-screen rendering, but it does change the diameter when exporting the geometry.",
    camera: "Camera",
    projectionOrthographic: "Orthographic projection",
    projectionPerspective: "Perspective projection",

    // Buttons / actions
    remove: "Remove",
    addPlanet: "+ Planet",
    addAnnulus: "+ Ring",
    addSolar: "+ Sun",
    addPlanetary: "+ Add planetary stage",
    addSpeed: "+ Add speed",
    addCoupling: "+ Add coupling (ωA = ωB)",
    ex1: "EX1",
    ex2: "EX2",
    ex3: "EX3",
    ex4: "EX4",
    examples: "Examples",
    newPlanetary: "New planetary",
    viewJSON: "View JSON",
    ex1Title: "Different ratios\nin one planetary",
    ex2Title: "Ford Model T\nAutomatic Transmission",
    ex3Title: "Allison 1000\nAutomatic Transmission",
    ex4Title: "4R70W Automatic Transmission\nRavigneaux Type",
    timeScaleLabel: "Time scale (1.00 = real time)",

    // Placeholders
    select: "(Select)",
    selectA: "(Select A)",
    selectB: "(Select B)",
    selectGearArm: "(Choose gear/carrier)",

    // Hints
    meshChainHint:
      "Stage chain: Sun ↔ Planet1 (external), Planet1 ↔ Planet2 (external), …, Planet_k ↔ Ring (internal if present).",
    couplingHint:
      "Use to couple stages (e.g., planet of stage 1 coaxial to planet of stage 2).",
    sameVarNotAllowed: "It is not possible to use the same variable on both lines.",
    renderPlaceholder: "(gears rendering will appear here)",

    // Results
    decimalPlaces: "Decimal places",
    notCalculated: "Not yet calculated.",
    relation: "Ratio",
    input: "Input",
    output: "Output",

    // Montage status
    stageOpen: "Open stage (no ring gear)",
    armStraight: "Straight carrier",
    armStepped: "Stepped carrier",

    planetCopies: "Planet count in orbit",

    // Language
    langPT: "PT",
    langEN: "EN",
    language: "Language",
  },
} as const;

export type Strings = typeof strings["pt"];
export type StringKey = keyof Strings;

export function getStoredLang(): Lang {
  if (typeof localStorage === "undefined") return "pt";
  const saved = localStorage.getItem("lang");
  return saved === "en" ? "en" : "pt";
}

export function setStoredLang(lang: Lang) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("lang", lang);
}

export function translate(lang: Lang, key: StringKey): string {
  return strings[lang][key];
}
