/**
 * ══════════════════════════════════════════════════════════════
 *  Інтелектуальний пошук — Smart Search Engine
 *  Рівні ранжування (як у Google):
 *   100 — точний збіг назви
 *    85 — назва починається із запиту
 *    70 — всі слова запиту є в назві
 *    50 — назва містить запит як підрядок
 *    30 — всі слова запиту є в дефініції
 *    15 — часткові слова в назві (морфологія/стем)
 *   + семантичний fallback через векторні ембединги
 * ══════════════════════════════════════════════════════════════
 */

const pool = require('./db');
const { semanticSearch } = require('./semanticSearch');

// ── Мінімальний стемер для української мови ─────────────────
// Відрізає типові закінчення щоб знайти морфологічні форми:
// «зброя» → «збро», матч з «зброєю», «зброї», «зброю» etc.
const UA_SUFFIXES = [
  'ування','ування','ювання','овання',   // дієслівні іменники
  'ністю','ністю',                        // абстрактні
  'ацією','яцією','екцією',               // іноземні запозичення
  'ення','іння','яння',
  'ості','ість',
  'ових','овим','овій','ового','ову',
  'альн','ально',
  'ичних','ичний','ичному','ичного',
  'еного','еному','еній',
  'ання','яння',
  'тися','ться',
  'ами','ями','ою','ею','єю',
  'ого','ому','ій','ій',
  'ах','ях','ів','їв','ей','єй',
  'ою','ею','єю',
  'ню','ні','ня',
  'ці','ці','ці',
  'ий','ій','их','ім',
  'ти','ся',
  'ла','ло','ли',
  'ої','ому',
  'ів','їв',
  'ах','ях',
  'ей','єй',
  'ою','єю',
  'ям','ям',
  'ах','ях',
  'ув','юв',
  'ав','яв',
  'ів',
  'і','и','а','я','е','є','о','у','ю',
];

function stem(word) {
  const w = word.toLowerCase();
  if (w.length <= 4) return w; // короткі слова не стемуємо
  for (const suf of UA_SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      return w.slice(0, w.length - suf.length);
    }
  }
  return w;
}

// ── Нормалізація запиту ──────────────────────────────────────
function normalizeQuery(q) {
  return q
    .trim()
    .replace(/\s+/g, ' ')
    // Замінюємо типографські апострофи
    .replace(/[''ʼ]/g, "'")
    .toLowerCase();
}

// ── Розбиваємо запит на слова (фільтруємо стоп-слова) ───────
const STOP_WORDS = new Set([
  'та','і','й','або','але','що','як','це','для','від','до',
  'про','на','в','у','з','із','зі','за','по','при','під',
  'над','між','через','після','перед','де','коли','якщо',
  'the','of','and','in','to','a','an','is','are','for','with',
]);

function tokenize(q) {
  return q.split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

// ── Отримати ліміт доступу ───────────────────────────────────
function getAllowedStamps(access) {
  const levels = { Public: 1, DSP: 2, Secret: 3 };
  const userLevel = levels[access] || 1;
  return Object.keys(levels).filter(k => levels[k] <= userLevel);
}

// ════════════════════════════════════════════════════════════
//  MAIN: smartSearch
// ════════════════════════════════════════════════════════════
async function smartSearch(rawQuery, user = null, opts = {}) {
  const { limit = 30, semanticFallbackThreshold = 5 } = opts;

  const q      = normalizeQuery(rawQuery);
  const words  = tokenize(q);
  const stems  = words.map(stem);
  const allowed  = getAllowedStamps(user?.access_level || 'Public');
  const pholds   = allowed.map(() => '?').join(',');

  // ── КРОК 1: SQL-пошук з багаторівневим скорингом ──────────
  // Формуємо WHERE: назва АБО дефініція містить хоч щось
  const likeQ = `%${q}%`;
  const whereOr = words.length > 1
    ? words.map(() => `(LOWER(t.term_name) LIKE ? OR LOWER(t.definition) LIKE ?)`).join(' OR ')
    : `(LOWER(t.term_name) LIKE ? OR LOWER(t.definition) LIKE ?)`;

  const whereOrParams = words.length > 1
    ? words.flatMap(w => [`%${w}%`, `%${w}%`])
    : [`%${q}%`, `%${q}%`];

  // Умова "всі слова є в назві"
  const allWordsInName = words.map(() => `LOWER(t.term_name) LIKE ?`).join(' AND ');
  const allWordsInDef  = words.map(() => `LOWER(t.definition) LIKE ?`).join(' AND ');
  const allWordsInNameParams = words.map(w => `%${w}%`);
  const allWordsInDefParams  = words.map(w => `%${w}%`);

  const scoreExpr = `
    (
      CASE WHEN LOWER(t.term_name) = ?                         THEN 100 ELSE 0 END +
      CASE WHEN LOWER(t.term_name) LIKE ?                      THEN  85 ELSE 0 END +
      CASE WHEN (${allWordsInName})                            THEN  70 ELSE 0 END +
      CASE WHEN LOWER(t.term_name) LIKE ?                      THEN  50 ELSE 0 END +
      CASE WHEN (${allWordsInDef})                             THEN  30 ELSE 0 END +
      CASE WHEN LOWER(t.definition) LIKE ?                     THEN  15 ELSE 0 END
    )
  `;

  const scoreParams = [
    q,               // exact
    `${q}%`,         // prefix
    ...allWordsInNameParams,   // all words in name
    likeQ,           // name contains
    ...allWordsInDefParams,    // all words in def
    likeQ,           // def contains
  ];

  const sql = `
    SELECT t.id, t.term_name, t.definition, t.category, t.extended_info,
           t.source_id, t.is_actual, t.definition_source_type,
           t.wiki_image_url, t.created_at,
           s.file_type, s.security_stamp,
           s.title      AS source_title,
           s.doc_type   AS source_doc_type,
           s.file_name  AS source_file_name,
           s.doc_date   AS source_doc_date,
           s.issued_by  AS source_issued_by,
           ${scoreExpr} AS _score,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', tr.source_name, 'url', tr.source_url))
            FROM term_references tr WHERE tr.term_id = t.id) AS refs
    FROM terms t
    LEFT JOIN sources s ON t.source_id = s.id
    WHERE s.security_stamp IN (${pholds})
      AND t.is_actual = 1
      AND ( ${whereOr} )
    HAVING _score > 0
    ORDER BY _score DESC, t.term_name ASC
    LIMIT ?
  `;

  const params = [
    ...allowed,
    ...scoreParams,
    ...whereOrParams,
    limit,
  ];

  const [rows] = await pool.query(sql, params);

  const dbTerms = rows.map(row => ({
    ...row,
    references: row.refs ? (typeof row.refs === 'string' ? JSON.parse(row.refs) : row.refs) : [],
    _source: 'db',
    _score: parseFloat(row._score) || 0,
  }));

  // ── КРОК 2: визначаємо режим пошуку ───────────────────────
  let mode = 'db';
  if (dbTerms.length > 0 && dbTerms[0]._score >= 100) mode = 'exact';
  else if (dbTerms.length > 0 && dbTerms[0]._score >= 70) mode = 'fuzzy';
  else mode = 'broad';

  // ── КРОК 3: Семантичний fallback якщо мало результатів ────
  let semanticTerms = [];
  const needSemantic = dbTerms.length < semanticFallbackThreshold && q.length >= 4;

  if (needSemantic) {
    try {
      const semResults = await semanticSearch(rawQuery, 8, user);
      const dbIds = new Set(dbTerms.map(t => t.id));

      semanticTerms = semResults
        .filter(r => !dbIds.has(r.termId) && r.score > 0.5)
        .map(r => ({
          id: r.termId,
          term_name: r.termName,
          definition: r.definition,
          category: r.category,
          source_id: r.source_id,
          file_type: r.file_type,
          security_stamp: r.security_stamp,
          source_title: r.source_title,
          source_doc_type: r.source_doc_type,
          source_file_name: r.source_file_name,
          source_doc_date: r.source_doc_date,
          source_issued_by: r.source_issued_by,
          is_actual: 1,
          references: r.references || [],
          _source: 'semantic',
          _score: Math.round(r.score * 60), // нормалізуємо 0..1 → 0..60
          _similarity: r.score,
        }));

      if (semanticTerms.length > 0) mode = 'semantic';
    } catch (e) {
      console.warn('[SmartSearch] Semantic fallback failed:', e.message);
    }
  }

  // ── КРОК 4: Merge + deduplicate ───────────────────────────
  const merged = [...dbTerms, ...semanticTerms];

  // ── КРОК 5: Стемінг — додатковий прохід для слабких результатів
  // Якщо мало результатів і є stems — пробуємо стем-пошук
  let stemTerms = [];
  if (merged.length < 3 && stems.length > 0 && stems.some(s => s.length >= 3)) {
    const stemWhere = stems.map(() => `LOWER(t.term_name) LIKE ?`).join(' OR ');
    const stemParams = stems.map(s => `%${s}%`);
    try {
      const [stemRows] = await pool.query(
        `SELECT t.id, t.term_name, t.definition, t.category, t.source_id, t.is_actual,
                t.definition_source_type, t.wiki_image_url, t.created_at,
                s.file_type, s.security_stamp,
                s.title AS source_title, s.doc_type AS source_doc_type,
                s.file_name AS source_file_name, s.doc_date AS source_doc_date,
                s.issued_by AS source_issued_by
         FROM terms t LEFT JOIN sources s ON t.source_id = s.id
         WHERE s.security_stamp IN (${pholds}) AND t.is_actual = 1 AND (${stemWhere})
         ORDER BY t.term_name ASC LIMIT 10`,
        [...allowed, ...stemParams]
      );
      const mergedIds = new Set(merged.map(t => t.id));
      stemTerms = stemRows
        .filter(r => !mergedIds.has(r.id))
        .map(r => ({ ...r, references: [], _source: 'morph', _score: 10 }));
    } catch (e) { /* ігнорувати */ }
    if (stemTerms.length > 0 && mode === 'broad') mode = 'morph';
  }

  const final = [...merged, ...stemTerms];

  return {
    terms: final.slice(0, limit),
    total: final.length,
    mode,          // 'exact' | 'fuzzy' | 'broad' | 'semantic' | 'morph'
    query: rawQuery,
    words,
  };
}

// ── Автодоповнення (suggestions) ────────────────────────────
async function getSearchSuggestions(prefix, user = null, limit = 8) {
  if (!prefix || prefix.length < 2) return [];
  const allowed = getAllowedStamps(user?.access_level || 'Public');
  const pholds  = allowed.map(() => '?').join(',');

  const [rows] = await pool.query(
    `SELECT DISTINCT t.term_name
     FROM terms t
     LEFT JOIN sources s ON t.source_id = s.id
     WHERE s.security_stamp IN (${pholds})
       AND t.is_actual = 1
       AND LOWER(t.term_name) LIKE LOWER(?)
     ORDER BY
       CASE WHEN LOWER(t.term_name) LIKE LOWER(?) THEN 0 ELSE 1 END,
       t.term_name ASC
     LIMIT ?`,
    [...allowed, `%${prefix}%`, `${prefix}%`, limit]
  );

  return rows.map(r => r.term_name);
}

module.exports = { smartSearch, getSearchSuggestions };
