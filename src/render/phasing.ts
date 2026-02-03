// src/render/phasing.ts
// Faseamento seguindo a ordem/lógica especificada pelo usuário:
//
// 1) Se houver anelar E solar, calcula-se k = (Zs + |Za|) / N.
//    - Se não houver anelar (ou não houver solar), braços igualmente espaçados.
//    - Se k for inteiro, braços igualmente espaçados.
//    - Caso contrário, calcula-se o tick angle θ^ = 2π / (Zs + |Za|) e
//      cada braço θ_i = k_i * θ^ com k_i = arredondar(m*k) (m=0..N-1) com .5 para cima.
// 2) Calcula o ângulo de passo transversal ψ de cada engrenagem (2π/Z).
// 3) Fase da solar φs = 0.
// 4) Fase de cada planeta (para cada cópia i do braço):
//      φp_i = θ_i + 180° - 0,5*ψp*(Zp-1)  (em rad)
// 5) Fase da anelar φa = fase da “planeta acoplada ao anel”:
//      - Se houver 2+ planetas: a última da cadeia (Pk_last).
//      - Se houver apenas 1 planeta: a própria P1.
//    Observação: isso já cobre o “braço torto”, pois a engrenagem acoplada ao anel
//    é a última da cadeia.
//
// Saída compatível com o GearScene.tsx:
//   - copyAngles: number[]
//   - planetOriginal: number[] (P1 por cópia)
//   - planetCoupled?: number[] (P2 por cópia, se existir)
//   - sunPhase?: number (escalar)
//   - ringPhase?: number (escalar)
//   - gearPhaseMap: Record<string, number>
//       * omega_s{stageId} = sunPhase
//       * omega_a{stageId} = ringPhase
//       * omega_p{stageId}_{k}#copy{m} = fase da Pk na cópia m
//
// Observações de robustez:
//   - Aceita ausência de solar/anelar conforme regras acima.
//   - N (cópias) deve ser >= 1 (sem limite superior aqui).

const TAU = Math.PI * 2;

type In = {
  stageId: number;
  solarZ: number | null;         // nº de dentes da solar (externa)
  annulusZ: number | null;       // nº de dentes da anelar (interna) — usar |Za|
  planetsZ: number[];            // nº de dentes dos planetas (P1, P2, ...)
  copies: number;                // nº de cópias do braço
  positions: [number, number][]; // centros das planetas do braço base (referência para braço torto)
};

export type Out = {
  copyAngles: number[];          // θ_i (rad) das cópias do braço (i = 0..N-1)
  planetOriginal: number[];      // fases (rad) de P1 por cópia
  planetCoupled?: number[];      // fases (rad) de P2 por cópia, se houver
  sunPhase?: number;             // fase única da solar (rad)
  ringPhase?: number;            // fase única da anelar (rad)
  gearPhaseMap: Record<string, number>;
};

// ---------- utilidades ----------
const mod2pi = (a: number) => {
  const x = a % TAU;
  return x < 0 ? x + TAU : x;
};

// gera os ângulos das cópias do braço de acordo com as regras
function computeArmAngles(
  Nraw: number,
  zSun: number | null,
  zRing: number | null,
  planetsZ: number[]
): number[] {
  const N = Math.max(1, Math.round(Nraw || 1));
  if (N <= 1) return [0];

  // Se faltar Sol ou Anel, assume simetria perfeita
  if (zRing == null || zSun == null) {
    return Array.from({ length: N }, (_, i) => (TAU * i) / N);
  }

  // --- Lógica da Fórmula Geral ---
  
  // 1. Determinar o Fator de Direção (D)
  // k = número de estágios planetários em série.
  // Se k for ÍMPAR (1, 3...): O anel gira no sentido oposto ao esperado na relação S-R direta (Soma).
  // Se k for PAR (2, 4... idlers): O anel inverte a lógica (Subtração).
  const k = Math.max(1, planetsZ.length); 
  const D = (k % 2 !== 0) ? 1 : -1;

  // 2. Calcular Z efetivo (Denominador da fórmula do Tick Angle)
  // Para planetas simples em série, os termos Zp se cancelam na fórmula do MDC, 
  // sobrando apenas a relação fundamental S +/- R.
  // Fórmula: Z_eff = | Zs + D * Zr |
  let Z_eff = Math.abs(zSun + D * Math.abs(zRing));

  // Proteção contra Z_eff = 0 (ex: Zs=40, Zr=40, 2 planetas. Infinitas posições).
  if (Z_eff === 0) {
     return Array.from({ length: N }, (_, i) => (TAU * i) / N);
  }

  // 3. Calcular Tick Angle (thetaHat) em radianos
  // thetaHat = 360 / Z_eff
  const thetaHat = TAU / Z_eff;

  // 4. Calcular as posições dos braços
  const angles: number[] = [];
  
  for (let m = 0; m < N; m++) {
    // Ângulo alvo ideal (ex: 0, 120, 240...)
    const targetAngle = (TAU * m) / N;
    
    // Quantos "ticks" cabem idealmente neste ângulo?
    // Arredondamos para o inteiro mais próximo para achar a posição válida física.
    const numTicks = Math.round(targetAngle / thetaHat);
    
    // Posição real = número de ticks * tamanho do tick
    angles.push(mod2pi(numTicks * thetaHat));
  }

  return angles;
}

export function computeStagePhasing(inp: In): Out {
  const { stageId, solarZ, annulusZ, planetsZ, copies, positions } = inp;

  // 1) Ângulos das cópias do braço
  const N = Math.max(1, Math.round(copies || 1));
  const copyAngles = computeArmAngles(N, solarZ, annulusZ, planetsZ);

  // 3) Fase da solar — sempre 0
  const sunPhase = solarZ != null ? 0 : undefined;

  // 4) Fase das planetas:
  //    - P1 (engrenagem acoplada à solar) mantém a fórmula original.
  //    - Planetas adicionais usam ϕpp_i = -ϕp_i*(Zp/Zpp) + θ_i*(1 + Zp/Zpp) + β_i + parity*0,5*ψpp.
  const ZsEff = solarZ ?? 0; // se não houver solar, Zs = 0
  const planetPhases: number[][] = [];
  const absPhases: number[][] = [];

  // Normaliza as posições das planetas para remover qualquer rotação global
  // do conjunto (por exemplo, quando o braço já está girando). Assim, o
  // faseamento depende apenas da geometria relativa e não do ângulo instantâneo
  // do carrier no momento em que o recálculo é feito.
  let normPositions: [number, number][] = positions ?? [];
  let betaAngles: number[] = [];

  if (positions && positions.length > 0) {
    const [x0, y0] = positions[0];
    const baseAng = Math.atan2(y0, x0);
    const cosB = Math.cos(-baseAng);
    const sinB = Math.sin(-baseAng);

    normPositions = positions.map(([x, y]) => [
      x * cosB - y * sinB,
      x * sinB + y * cosB,
    ]);

    betaAngles = normPositions.map(([x, y]) => Math.atan2(y, x));
  }


  if (planetsZ.length >= 1) {
    const Zp1 = Math.max(1, Math.abs(planetsZ[0]));
    const parity1 = Zp1 % 2 === 0 ? 1 : 0;
    const extra1 = parity1 * (Math.PI / Zp1);       // 0,5 * ψp em rad
    const scale1 = 1 + ZsEff / Zp1;

    planetPhases[0] = copyAngles.map(theta_i =>
      mod2pi(theta_i * scale1 + extra1)
    );

  // --- NOVO LOOP UNIFICADO PARA P1 E PLANETAS EM SÉRIE (Pk) ---
    for (let k = 0; k < planetsZ.length; k++) {
      const currZ = Math.max(1, Math.abs(planetsZ[k]));
      
      // Z da engrenagem anterior: Sol (k=0) ou Planeta anterior (k>0)
      const prevZ = k === 0 
        ? (solarZ ?? 0) // Zs
        : Math.max(1, Math.abs(planetsZ[k - 1])); // Zp
        
      const gearRatio = prevZ / currZ; // Z_anterior / Z_atual (Zp/Zpp)

      // ----------------------------------------------------
      // CÁLCULO CRÍTICO: Ângulo do Vetor de Malha (meshAngle)
      // ----------------------------------------------------
      const currPos = normPositions[k];
      const prevPos = k === 0 
        ? [0, 0] // P1 rola no Sol (origem)
        : normPositions[k - 1]; // Pk rola na Pk-1 (ângulo de malha entre elas)

        
      // Calcula o ângulo do vetor do centro_anterior para o centro_atual
      const dx = currPos[0] - prevPos[0];
      const dy = currPos[1] - prevPos[1];
      const meshAngle = Math.atan2(dy, dx); 
      // ^^^ Este é o ângulo alpha (α) que substitui o beta incorreto.
      // ----------------------------------------------------

      // Seu Offset de Paridade (mantido, pois é um ajuste de passo)
      const parity = currZ % 2 === 0 ? 1 : 0;
      const extra = parity * (Math.PI / currZ); 

      planetPhases[k] = [];
      absPhases[k] = [];

      for (let m = 0; m < N; m++) {
        const theta_i = copyAngles[m]; // Ângulo da cópia do braço
        
        // Fase da engrenagem anterior (ϕ_prev): Sol (0) ou Planeta anterior (absPhases)
        const phi_prev = k === 0 
          ? (sunPhase ?? 0)
          : absPhases[k - 1][m];

        // FÓRMULA CINEMÁTICA CORRIGIDA
        // ϕ_pp = -ϕ_p * (Zp/Zpp) + (θ_i + meshAngle) * (1 + Zp/Zpp) + Offset
        
        // 1. Termo de engrenamento reverso (Rolling)
        const termRoll = -phi_prev * gearRatio;
        
        // 2. Termo de Arrasto (Carrier Motion)
        // O ângulo ABOSLUTO do vetor de malha é: theta_i + meshAngle
        // A engrenagem rola sobre esse vetor arrastado pelo braço.
        const termCarrier = (theta_i + meshAngle) * (1 + gearRatio);
        
        // Fase total (sem o mod2pi)
        const phi_curr_abs = termRoll + termCarrier + extra;

        absPhases[k].push(phi_curr_abs);
        planetPhases[k].push(mod2pi(phi_curr_abs));
      }
    }
  }

// 5) Fase da anelar — usa o conjunto em contato com a anelar
  //    Corrige a posição do contato usando o beta da última planeta.
  let ringPhase: number | undefined;
  
  if (annulusZ != null && planetsZ.length >= 1) {
    const Za = Math.abs(annulusZ);
    
    if (Za > 0) {
      const usesAdditional = planetsZ.length >= 2;
      const idxCoupled = usesAdditional ? planetsZ.length - 1 : 0;
      
      const Zref = Math.abs(planetsZ[idxCoupled] ?? 0);
      
      // Usa absPhases se disponível para precisão, ou planetPhases com fallback
      // (Se você declarou absPhases fora do loop anterior, use absPhases[idxCoupled][0])
      const phiRef = absPhases[idxCoupled]?.[0] ?? planetPhases[idxCoupled]?.[0] ?? 0;
      
      // Pega o ângulo beta (posição geométrica) da última planeta
      const betaLast = betaAngles[idxCoupled] ?? 0;

      // FÓRMULA CORRIGIDA:
      // φa = φp * (Zp/Za) + β * (1 - Zp/Za)
      ringPhase = mod2pi(
        phiRef * (Zref / Za) + 
        betaLast * (1 - Zref / Za)
      );
    }
  }

  // Caso especial: sem SOL, mas com ANEL — reancora planetas na anelar para todas as cópias
  if (solarZ == null && annulusZ != null && ringPhase != null && planetsZ.length >= 1) {
    const Za = Math.abs(annulusZ);
    if (Za > 0) {
      const idxCoupled = planetsZ.length - 1; // planeta em contato direto com o anel
      const Zc = Math.max(1, Math.abs(planetsZ[idxCoupled]));
      const baseBeta =
        betaAngles[idxCoupled] ??
        Math.atan2(normPositions[idxCoupled]?.[1] ?? 0, normPositions[idxCoupled]?.[0] ?? 1);

      planetPhases[idxCoupled] = planetPhases[idxCoupled] || [];
      absPhases[idxCoupled] = absPhases[idxCoupled] || [];

      // 1) Reancora planeta acoplada ao anel em cada cópia usando β rotacionado da cópia
      for (let m = 0; m < N; m++) {
        const betaCopy = mod2pi(baseBeta + copyAngles[m]);
        const phi = ringPhase * (Za / Zc) + betaCopy * (1 - Za / Zc);
        absPhases[idxCoupled][m] = phi;
        planetPhases[idxCoupled][m] = mod2pi(phi);
      }

      // 2) Se houver planetas anteriores em série, propaga fase para trás
      for (let k = idxCoupled - 1; k >= 0; k--) {
        const Zk = Math.max(1, Math.abs(planetsZ[k]));
        const Znext = Math.max(1, Math.abs(planetsZ[k + 1]));
        const gearRatio = Zk / Znext; // Z_k / Z_{k+1}

        const currPos = normPositions[k] ?? [0, 0];
        const nextPos = normPositions[k + 1] ?? currPos;
        const dx = nextPos[0] - currPos[0];
        const dy = nextPos[1] - currPos[1];
        const meshAngle = Math.atan2(dy, dx);

        const parityNext = Znext % 2 === 0 ? 1 : 0;
        const extraNext = parityNext * (Math.PI / Znext);

        planetPhases[k] = planetPhases[k] || [];
        absPhases[k] = absPhases[k] || [];

        for (let m = 0; m < N; m++) {
          const theta_i = copyAngles[m];
          const phi_next =
            absPhases[k + 1]?.[m] ??
            planetPhases[k + 1]?.[m] ??
            0;

          // Inverte a fórmula direta:
          // φ_next = -φ_curr*(Zk/Znext) + (θ_i + meshAngle)*(1 + Zk/Znext) + extra_next
          // => φ_curr = ((θ_i + meshAngle)*(1 + gr) + extra_next - φ_next) / gr
          const phi_curr = ((theta_i + meshAngle) * (1 + gearRatio) + extraNext - phi_next) / gearRatio;

          absPhases[k][m] = phi_curr;
          planetPhases[k][m] = mod2pi(phi_curr);
        }
      }
    }
  }

  // --- Mapa de fases para o render (conforme GearScene) ---
  const gearPhaseMap: Record<string, number> = {};
  // Planetas: todas as cópias
  for (let k = 0; k < planetsZ.length; k++) {
    for (let m = 0; m < N; m++) {
      gearPhaseMap[`omega_p${stageId}_${k + 1}#copy${m}`] = planetPhases[k][m];
    }
  }
  // Solar (se existir) e anelar (se existir): fase única
  if (sunPhase != null)  gearPhaseMap[`omega_s${stageId}`] = sunPhase;
  if (ringPhase != null) gearPhaseMap[`omega_a${stageId}`] = ringPhase;

  // --- Campos de debug esperados pelo painel ---
  const planetOriginal = planetsZ.length >= 1 ? planetPhases[0].slice() : [];
  const planetCoupled  = planetsZ.length >= 2 ? planetPhases[1].slice() : undefined;

  return {
    copyAngles,
    planetOriginal,
    planetCoupled,
    sunPhase,
    ringPhase,
    gearPhaseMap,
  };
}
