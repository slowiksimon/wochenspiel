// Starter plan for a new household. Days: 0 = Mo ... 6 = So. who: 'a' | 'b' | 'both'.
export function starterTasks(weekKey, now) {
  const t = (id, emoji, title, who, days, pts, order, once) => {
    const data = { title, emoji, who, days, pts, order, createdAt: now };
    if (once) data.once = once;
    return { id, data };
  };
  return [
    t('kita-bringen-a', '🎒', 'Kita/Schule bringen', 'a', [0, 2, 4], 1, 10),
    t('kita-bringen-b', '🎒', 'Kita/Schule bringen', 'b', [1, 3], 1, 10),
    t('haustier', '🐾', 'Haustier versorgen', 'both', [0, 1, 2, 3, 4, 5, 6], 1, 15),
    t('abholen-b', '🧒', 'Kinder abholen', 'b', [0, 2, 4], 1, 30),
    t('abholen-a', '🧒', 'Kinder abholen', 'a', [1, 3], 1, 30),
    t('einkaufen', '🛒', 'Einkaufen', 'both', [5], 2, 40),
    t('kochen-a', '🍳', 'Kochen', 'a', [0, 2, 4], 2, 50),
    t('kochen-b', '🍳', 'Kochen', 'b', [1, 3], 2, 50),
    t('geschirr', '🍽️', 'Spülmaschine ausräumen', 'both', [0, 2, 4], 1, 60),
    t('waesche', '🧺', 'Wäsche waschen', 'a', [5], 2, 70),
    t('muell', '🗑️', 'Müll rausbringen', 'a', [3], 1, 80),
    t('staub', '🧹', 'Staubsaugen/Wischen', 'b', [5], 3, 90),
    t('bad', '🧼', 'Bad & WC putzen', 'a', [6], 3, 100),
    t('betten', '🛏️', 'Betten beziehen', 'b', [6], 2, 110),
    t('pflanzen', '🪴', 'Pflanzen gießen', 'a', [6], 1, 120),
    t('rechnungen', '🧾', 'Rechnungen & Bürokram', 'b', [3], 2, 130),
    t('arzt', '🩺', 'Arzttermine ausmachen', 'a', [4], 1, 140, weekKey),
    t('bett-b', '🌙', 'Ins Bett bringen', 'b', [0, 2, 4, 6], 1, 200),
    t('bett-a', '🌙', 'Ins Bett bringen', 'a', [1, 3, 5], 1, 200)
  ];
}
