// Alignement mot-à-mot entre le verset ATTENDU et ce qui a été RÉCITÉ.
// C'est le cœur de la vérification — purement algorithmique (distance d'édition),
// aucune IA externe. On classe chaque mot attendu : correct / faux / manquant,
// et on repère les mots récités en trop (insertions).

// Distance d'édition de Levenshtein au niveau des MOTS, avec backtrace.
export function align(expected, hyp) {
  const n = expected.length;
  const m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = expected[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // suppression (mot attendu manquant)
        dp[i][j - 1] + 1,      // insertion (mot récité en trop)
        dp[i - 1][j - 1] + cost // correspondance ou substitution
      );
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const sub = i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (expected[i - 1] === hyp[j - 1] ? 0 : 1);
    if (sub) {
      ops.push({
        type: expected[i - 1] === hyp[j - 1] ? 'match' : 'sub',
        ei: i - 1,
        hyp: hyp[j - 1],
      });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'del', ei: i - 1, hyp: null }); // mot attendu manquant
      i--;
    } else {
      ops.push({ type: 'ins', ei: i, hyp: hyp[j - 1] }); // mot récité en trop
      j--;
    }
  }
  ops.reverse();
  return ops;
}

// Statut par mot ATTENDU : 'correct' | 'wrong' | 'missing'.
export function statusPerExpected(expectedLen, ops) {
  const status = new Array(expectedLen).fill('missing');
  for (const op of ops) {
    if (op.type === 'match') status[op.ei] = 'correct';
    else if (op.type === 'sub') status[op.ei] = 'wrong';
    // 'del' laisse 'missing', 'ins' ne concerne pas un mot attendu
  }
  return status;
}

export function score(status) {
  if (!status.length) return 0;
  const correct = status.filter((s) => s === 'correct').length;
  return correct / status.length;
}

// Mots récités en trop (utile pour signaler les ajouts).
export function extras(ops) {
  return ops.filter((o) => o.type === 'ins').map((o) => o.hyp);
}

// --- Alignement STREAMING (pour le mode "jusqu'à la fin de la sourate") ---
//
// On aligne un segment récité (hyp) sur une FENÊTRE du texte attendu, avec
// "fin libre" côté attendu : on consomme tout l'hypothèse, mais seulement un
// PRÉFIXE de la fenêtre (le reste n'est pas pénalisé, il sera récité plus tard).
// Retourne combien de tokens attendus ont été consommés (= de combien le curseur
// avance) et leur statut.
export function streamAlign(window, hyp) {
  const n = window.length;
  const m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i; // consommer de l'attendu sans hyp = manquant
  for (let j = 0; j <= m; j++) dp[0][j] = j; // hyp sans attendu = en trop

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = window[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  // Fin libre sur l'attendu : on choisit le i qui minimise dp[i][m].
  let iStar = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= n; i++) {
    if (dp[i][m] < best) { best = dp[i][m]; iStar = i; }
  }

  const ops = [];
  let i = iStar;
  let j = m;
  while (i > 0 || j > 0) {
    const sub = i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (window[i - 1] === hyp[j - 1] ? 0 : 1);
    if (sub) {
      ops.push({ type: window[i - 1] === hyp[j - 1] ? 'match' : 'sub', wi: i - 1, hyp: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'del', wi: i - 1 }); i--;
    } else {
      ops.push({ type: 'ins', hyp: hyp[j - 1] }); j--;
    }
  }
  ops.reverse();

  const status = new Array(iStar).fill('missing');
  let matched = 0;
  for (const op of ops) {
    if (op.type === 'match') { status[op.wi] = 'correct'; matched++; }
    else if (op.type === 'sub') status[op.wi] = 'wrong';
  }
  return {
    consumed: iStar,
    matched,
    status,
    errors: best,
    extras: ops.filter((o) => o.type === 'ins').map((o) => o.hyp),
  };
}
