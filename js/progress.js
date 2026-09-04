// Tracks per-word success quietly in the background and decides, without any
// visible score, which words should come around more often. Nothing about
// this is ever shown on screen — it only reorders the rotation.

const Progress = (() => {
  let stats = Storage.loadStats();

  function entry(wordId) {
    if (!stats[wordId]) {
      stats[wordId] = { correct: 0, attempts: 0, practiced: 0, streak: 0, weight: 1.2 };
    }
    return stats[wordId];
  }

  function recordCorrect(wordId) {
    const e = entry(wordId);
    e.correct += 1;
    e.attempts += 1;
    e.streak += 1;
    // she's got it — let it fade into the background of the rotation
    e.weight = Math.max(0.15, e.weight * (e.streak >= 2 ? 0.5 : 0.75));
    Storage.saveStats(stats);
  }

  function recordMiss(wordId) {
    const e = entry(wordId);
    e.attempts += 1;
    e.streak = 0;
    // she missed it — quietly bring it back around sooner
    e.weight = Math.min(5, e.weight * 2.2);
    Storage.saveStats(stats);
  }

  function recordPracticed(wordId) {
    // offline attempt-only mode: we heard an attempt but can't grade it
    const e = entry(wordId);
    e.practiced += 1;
    Storage.saveStats(stats);
  }

  function weightOf(wordId) {
    return entry(wordId).weight;
  }

  // Weighted shuffle without replacement (A-Res / exponential-jitter method):
  // higher-weight (needier) words tend to land earlier, but order still
  // varies run to run so it never feels mechanical.
  function buildRotation(words) {
    return words
      .map((w) => ({ w, key: Math.random() ** (1 / weightOf(w.id)) }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.w);
  }

  function resetAll() {
    stats = {};
    Storage.resetStats();
  }

  function snapshot() {
    // for the parent panel: word id -> {correct, attempts, practiced}
    return stats;
  }

  return { recordCorrect, recordMiss, recordPracticed, buildRotation, resetAll, snapshot };
})();
