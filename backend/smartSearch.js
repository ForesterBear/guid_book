/**
 * ══════════════════════════════════════════════════════════════
 *  Smart Search Engine — PostgreSQL + pg_trgm + pgvector
 *
 *  Рівні ранжування:
 *   100 — точний збіг назви
 *    85 — назва починається із запиту
 *    70 — всі слова запиту є в назві
 *    50 — назва містить запит як підрядок
 *    30 — всі слова у визначенні
 *    15 — часткові слова (морфологія/стем)
 *
 *  НОВА ФУНКЦІЯ — 3-грами (pg_trgm):
 *   Після LIKE-пошуку виконується trigram similarity query.
 *   Вона ловить помилки в написанні та неточні збіги.
 *   Результати позначаються _source='trigram'.
 *
 *  + семантичний fallback (pgvector cosine distance)
 * ══════════════════════════════════════════════════════════════
 */

const { query: dbQuery } = require('./db');
const { semanticSearch } = require('./semanticSearch');

// ── Мінімальний стемер для укр. мови ─────────────────
const UA_SUFFIXES = [
  'ування','ювання','овання',
  'ністю','ацією','яцією','екцією',
  'ення','іння','яння','ості','ість',
  'ових','овим','овій','ового','ову',
  'альн','ально','ичних','ичний',
  'ичному','ичного','еного','еному','еній',
  'ання','яння','тися','ться',
  'ами','ями','ою','ею','єю',
  'ого','ому','ій','ах','ях','ів','їв','ей','єй',
  'ні','ня','ці','ий','их','ім','ти','ся',
  'ла','ло','ли','ої','ям','ув','юв','ав','яв',
  'і','и','а','я','е','є','о','у','ю',
];

function stem(word) {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  for (const suf of UA_SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      return w.slice(0, w.length - suf.length);
    }
  }
  return w;
}

function normalizeQuery(q) {
  return q.trim().replace(/\s+/g, ' ').replace(/[''ʼ]/g, "'").toLowerCase();
}

const STOP_WORDS = new Set([
  'та','і','й','або','але','що','як','це','для','від','до',
  'про','на','в','у','з','із','зі','за','по','при','під',
  'над','між','через','після','перед','де','коли','якщо',
  'the','of','and','in','to','a','an','is','are','for','with',
]);

function tokenize(q) {
  return q.split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

function getAllowedStamps(access) {
  const levels = { Public: 1, DSP: 2, Secret: 3 };
  const userLevel = levels[access] || 1;
  return Object.keys(levels).filter(k => levels[k] <= userLevel);
}

// ══════════════════════════════════════════════════════
//  MAIN: smartSearch
// ══════════════════════════════════════════════════════
// ── SQL нормалізація апострофів (U+2019 ʼ U+2018 → ASCII ') ────────────
// Українські тексти в БД містять curly apostrophe U+2019 (chr(8217)),
// тоді як пошуковий запит нормалізується до ASCII ' (chr(39)).
// Ця функція повертає SQL-вираз, що нормалізує колонку для порівняння.
const normApo = (col) =>
  `translate(LOWER(${col}), chr(8216)||chr(8217)||chr(700), chr(39)||chr(39)||chr(39))`;

async function smartSearch(rawQuery, user = null, opts = {}) {
  const { limit = 30, semanticFallbackThreshold = 5 } = opts;

  const q       = normalizeQuery(rawQuery);
  const words   = tokenize(q);
  const stems   = words.map(stem);
  const allowed = getAllowedStamps(user?.access_level || 'Public');

  // ── КРОК 1: LIKE-пошук з багаторівневим скорингом ──
  const likeQ = `%${q}%`;

  // Нормалізовані вирази для term_name і definition
  const NN = normApo('t.term_name');
  const ND = normApo('t.definition');

  const whereOrParts = words.length > 1
    ? words.map(() => `(${NN} LIKE ? OR ${ND} LIKE ?)`)
    : [`(${NN} LIKE ? OR ${ND} LIKE ?)`];

  const whereOrParams = words.length > 1
    ? words.flatMap(w => [`%${w}%`, `%${w}%`])
    : [`%${q}%`, `%${q}%`];

  const allWordsInName       = words.map(() => `${NN} LIKE ?`).join(' AND ');
  const allWordsInDef        = words.map(() => `${ND} LIKE ?`).join(' AND ');
  const allWordsInNameParams = words.map(w => `%${w}%`);
  const allWordsInDefParams  = words.map(w => `%${w}%`);

  const scoreExpr = `
    (
      CASE WHEN ${NN} = ?                                THEN 100 ELSE 0 END +
      CASE WHEN ${NN} LIKE ?                             THEN  85 ELSE 0 END +
      CASE WHEN (${allWordsInName || 'FALSE'})           THEN  70 ELSE 0 END +
      CASE WHEN ${NN} LIKE ?                             THEN  50 ELSE 0 END +
      CASE WHEN (${allWordsInDef  || 'FALSE'})           THEN  30 ELSE 0 END +
      CASE WHEN ${ND} LIKE ?                             THEN  15 ELSE 0 END
    )
  `;

  const scoreParams = [
    q,
    `${q}%`,
    ...allWordsInNameParams,
    likeQ,
    ...allWordsInDefParams,
    likeQ,
  ];

  // Штамп-фільтр: $N, $N+1 ...
  const stampPlaceholders = allowed.map(() => '?').join(',');

  const FIGURE_FILTER = `
    AND t.term_name NOT ILIKE 'Рисунок%'
    AND t.term_name NOT ILIKE 'Рис.%'
    AND t.term_name NOT ILIKE 'Рис %'
    AND t.term_name NOT ILIKE 'Рисинок%'
    AND t.term_name NOT ILIKE 'Малюнок%'
    AND t.term_name NOT ILIKE 'Мал.%'
    AND t.term_name NOT ILIKE 'Таблиц%'
    AND t.term_name NOT ILIKE 'Табл.%'
    AND t.term_name NOT ILIKE 'Схема%'
    AND t.term_name NOT ILIKE 'Фото%'
    AND t.term_name NOT ILIKE 'Fig.%'
    AND t.term_name NOT ILIKE 'Table%'
    AND t.term_name NOT SIMILAR TO '[0-9]%'
    AND length(t.term_name) > 3
    AND length(t.definition) > 10
  `;

  const sql = `
    SELECT * FROM (
      SELECT
        t.id, t.term_name, t.definition, t.category, t.extended_info,
        t.source_id, t.is_actual, t.definition_source_type,
        t.wiki_image_url, t.created_at,
        s.file_type, s.security_stamp,
        s.title       AS source_title,
        s.doc_type    AS source_doc_type,
        s.file_name   AS source_file_name,
        s.doc_date    AS source_doc_date,
        s.issued_by   AS source_issued_by,
        ${scoreExpr}  AS _score,
        (
          SELECT json_agg(json_build_object('title', tr.source_name, 'url', tr.source_url))
          FROM term_references tr WHERE tr.term_id = t.id
        ) AS refs
      FROM terms t
      LEFT JOIN sources s ON t.source_id = s.id
      WHERE s.security_stamp IN (${stampPlaceholders})
        AND t.is_actual = TRUE
        AND ( ${whereOrParts.join(' OR ')} )
        ${FIGURE_FILTER}
    ) sub
    WHERE sub._score > 0
    ORDER BY sub._score DESC, sub.term_name ASC
    LIMIT ?
  `;

  // ВАЖЛИВО: порядок params відповідає порядку ? в SQL
  // 1. scoreExpr (SELECT clause) → scoreParams
  // 2. stampPlaceholders (WHERE s.security_stamp IN) → allowed
  // 3. whereOrParts (WHERE ... AND) → whereOrParams
  // 4. LIMIT → limit
  const params = [
    ...scoreParams,
    ...allowed,
    ...whereOrParams,
    limit,
  ];

  const [rows] = await dbQuery(sql, params);

  const dbTerms = rows.map(row => ({
    ...row,
    references: row.refs || [],
    _source: 'db',
    _score:  parseFloat(row._score) || 0,
  }));

  // ── КРОК 2: Режим пошуку ───────────────────────────
  let mode = 'broad';
  if (dbTerms.length > 0 && dbTerms[0]._score >= 100) mode = 'exact';
  else if (dbTerms.length > 0 && dbTerms[0]._score >= 70) mode = 'fuzzy';

  // ── КРОК 3: pg_trgm — 3-грами (нечіткий пошук) ────
  // Запускається якщо LIKE знайшов мало або нічого
  let trigramTerms = [];
  const needTrigram = dbTerms.length < 10 && q.length >= 3;

  if (needTrigram) {
    try {
      const trgStampPh = allowed.map(() => '?').join(',');
      const trgSql = `
        SELECT
          t.id, t.term_name, t.definition, t.category, t.extended_info,
          t.source_id, t.is_actual, t.definition_source_type,
          t.wiki_image_url, t.created_at,
          s.file_type, s.security_stamp,
          s.title    AS source_title,
          s.doc_type AS source_doc_type,
          s.file_name AS source_file_name,
          s.doc_date  AS source_doc_date,
          s.issued_by AS source_issued_by,
          GREATEST(
            similarity(t.term_name, ?),
            similarity(t.definition, ?)
          ) AS trgm_score,
          (
            SELECT json_agg(json_build_object('title', tr.source_name, 'url', tr.source_url))
            FROM term_references tr WHERE tr.term_id = t.id
          ) AS refs
        FROM terms t
        LEFT JOIN sources s ON t.source_id = s.id
        WHERE s.security_stamp IN (${trgStampPh})
          AND t.is_actual = TRUE
          AND (
            similarity(t.term_name, ?) > 0.25
            OR similarity(t.definition, ?) > 0.2
          )
          ${FIGURE_FILTER}
        ORDER BY trgm_score DESC
        LIMIT 10
      `;

      const [trgRows] = await dbQuery(trgSql, [
        q, q,          // GREATEST()
        ...allowed,    // IN stamps
        q, q,          // WHERE similarity
      ]);

      const dbIds = new Set(dbTerms.map(t => t.id));
      trigramTerms = trgRows
        .filter(r => !dbIds.has(r.id) && parseFloat(r.trgm_score) > 0.25)
        .map(r => ({
          ...r,
          references: r.refs || [],
          _source: 'trigram',
          _score:  Math.round(parseFloat(r.trgm_score) * 45),
        }));

      if (trigramTerms.length > 0 && mode === 'broad') mode = 'trigram';
    } catch (e) {
      console.warn('[SmartSearch] pg_trgm query failed:', e.message);
    }
  }

  // ── КРОК 4: Семантичний fallback (pgvector) ────────
  let semanticTerms = [];
  const allSoFar = [...dbTerms, ...trigramTerms];
  const needSemantic = allSoFar.length < semanticFallbackThreshold && q.length >= 4;

  if (needSemantic) {
    try {
      const semResults = await semanticSearch(rawQuery, 8, user);
      const existingIds = new Set(allSoFar.map(t => t.id));

      semanticTerms = semResults
        .filter(r => !existingIds.has(r.termId) && r.score > 0.5)
        .map(r => ({
          id:               r.termId,
          term_name:        r.termName,
          definition:       r.definition,
          category:         r.category,
          source_id:        r.source_id,
          file_type:        r.file_type,
          security_stamp:   r.security_stamp,
          source_title:     r.source_title,
          source_doc_type:  r.source_doc_type,
          source_file_name: r.source_file_name,
          source_doc_date:  r.source_doc_date,
          source_issued_by: r.source_issued_by,
          is_actual:        true,
          references:       r.references || [],
          _source:          'semantic',
          _score:           Math.round(r.score * 60),
          _similarity:      r.score,
        }));

      if (semanticTerms.length > 0) mode = 'semantic';
    } catch (e) {
      console.warn('[SmartSearch] Semantic fallback failed:', e.message);
    }
  }

  // ── КРОК 5: Стемінг (останній резерв) ─────────────
  const merged = [...allSoFar, ...semanticTerms];
  let stemTerms = [];

  if (merged.length < 3 && stems.some(s => s.length >= 3)) {
    const stemWhere = stems.map(() => `LOWER(t.term_name) LIKE ?`).join(' OR ');
    const stemParams = stems.map(s => `%${s}%`);
    const stmStampPh = allowed.map(() => '?').join(',');

    try {
      const [stemRows] = await dbQuery(
        `SELECT t.id, t.term_name, t.definition, t.category, t.source_id, t.is_actual,
                t.definition_source_type, t.wiki_image_url, t.created_at,
                s.file_type, s.security_stamp,
                s.title AS source_title, s.doc_type AS source_doc_type,
                s.file_name AS source_file_name, s.doc_date AS source_doc_date,
                s.issued_by AS source_issued_by
         FROM terms t LEFT JOIN sources s ON t.source_id = s.id
         WHERE s.security_stamp IN (${stmStampPh})
           AND t.is_actual = TRUE AND (${stemWhere})
         ORDER BY t.term_name ASC LIMIT 10`,
        [...allowed, ...stemParams]
      );

      const mergedIds = new Set(merged.map(t => t.id));
      stemTerms = stemRows
        .filter(r => !mergedIds.has(r.id))
        .map(r => ({ ...r, references: [], _source: 'morph', _score: 10 }));
    } catch (e) { /* ignore */ }

    if (stemTerms.length > 0 && mode === 'broad') mode = 'morph';
  }

  const final = [...merged, ...stemTerms];

  return {
    terms: final.slice(0, limit),
    total: final.length,
    mode,
    query:  rawQuery,
    words,
  };
}

// ── Автодоповнення з pg_trgm ─────────────────────────────
async function getSearchSuggestions(prefix, user = null, limit = 10) {
  if (!prefix || prefix.length < 2) return [];
  const allowed = getAllowedStamps(user?.access_level || 'Public');
  const pholds  = allowed.map(() => '?').join(',');
  // Нормалізуємо запит так само як normalizeQuery
  const q = prefix.toLowerCase().trim().replace(/[''ʼ]/g, "'");

  // normApo нормалізує апострофи в назві терміна для коректного LIKE
  const NN = normApo('t.term_name');

  const [rows] = await dbQuery(
    `SELECT DISTINCT t.term_name,
       CASE WHEN ${NN} LIKE ? THEN 0 ELSE 1 END AS _prefix,
       similarity(t.term_name, ?) AS _sim
     FROM terms t
     LEFT JOIN sources s ON t.source_id = s.id
     WHERE s.security_stamp IN (${pholds})
       AND t.is_actual = TRUE
       AND t.term_name NOT ILIKE 'Рисунок%'
       AND t.term_name NOT ILIKE 'Стаття%'
       AND (
         ${NN} LIKE ?
         OR similarity(t.term_name, ?) > 0.18
       )
     ORDER BY _prefix ASC, _sim DESC, t.term_name ASC
     LIMIT ?`,
    [`${q}%`, q, ...allowed, `%${q}%`, q, limit]
  );
  return rows.map(r => r.term_name);
}

module.exports = { smartSearch, getSearchSuggestions };
