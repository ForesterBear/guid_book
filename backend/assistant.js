/**
 * assistant.js — RAG-асистент GuideBOOK
 */

const { smartSearch }    = require('./smartSearch');
const { query: dbQuery } = require('./db');

const OLLAMA_URL = process.env.OLLAMA_URL  || 'http://localhost:11434';
const LLM_MODEL  = process.env.OLLAMA_MODEL || 'phi3:mini';
const USE_LLM    = process.env.ASSISTANT_USE_LLM !== 'false';

// ── Кеш доступності моделі ────────────────────────────────────────────────
let modelAvailable = null;
let lastModelCheck = 0;
const MODEL_CHECK_TTL = 120_000;

async function checkModelLoaded() {
  const now = Date.now();
  if (modelAvailable !== null && now - lastModelCheck < MODEL_CHECK_TTL) return modelAvailable;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) { modelAvailable = false; lastModelCheck = now; return false; }
    const data  = await r.json();
    const names = (data.models || []).map(m => m.name.split(':')[0].toLowerCase());
    modelAvailable = names.includes(LLM_MODEL.split(':')[0].toLowerCase());
  } catch { modelAvailable = false; }
  lastModelCheck = now;
  return modelAvailable;
}

// ── Системний промпт з вбудованим прикладом формату ──────────────────────
const SYSTEM_PROMPT = `Ти — спеціалізований асистент-довідник GuideBOOK з термінології у сфері зв'язку та кібербезпеки Збройних Сил України.

ЦІЛЬ: На основі термінів із глосарію дати розгорнуту структуровану відповідь у форматі енциклопедичної статті.

ОБОВ'ЯЗКОВИЙ ФОРМАТ (дотримуйся ТОЧНО):

[Вступний абзац 2–3 речення без слів "Ось", "На основі", "Звичайно". Пояснюєш тему та контекст.]

---

## 1. [Назва першого критерію/розділу]

[Одне-два речення пояснення цього розділу.]

* **[Назва терміну 1]:** [Розгорнуте пояснення 2–4 речення.]
* **[Назва терміну 2]:** [Розгорнуте пояснення.]
  * [Уточнення або підпункт якщо потрібно]

---

## 2. [Назва другого критерію/розділу]

[Пояснення розділу.]

* **[Назва терміну]:** [Пояснення.]

### [Підрозділ якщо є]

* **[Термін]:** [Пояснення.]

---

## 3. [Наступний розділ]

...

---

[Заключне речення з пропозицією уточнити конкретний аспект.]

ПРАВИЛА:
- Відповідай ВИКЛЮЧНО українською мовою
- Використовуй ТІЛЬКИ терміни та факти з наданого контексту — не вигадуй
- Для запитів-класифікацій ("типи", "види", "методи") — мінімум 3 розділи
- Пиши розгорнуто: кожен термін — 2–4 речення пояснення, а не одне слово
- Назви термінів — жирним шрифтом **ось так**
- Підпункти через два пробіли та *`;

// ── Скорочення назви джерела ──────────────────────────────────────────────
function shortSource(title, fileName) {
  const raw = (title || fileName || 'Невідоме джерело');
  let s = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[A-Z0-9]+\.[A-Z]{2,4}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const firstRepeat = s.search(/\b(В?КДП|НП|ВП|ДСТУ|STANAG)\b.{5,50}\b\1\b/i);
  if (firstRepeat > 0) s = s.slice(0, Math.ceil(s.length / 2)).trim();
  const q = s.match(/["„"«]([^"„"»]{5,70})["„"»]/);
  if (q) {
    const before = s.slice(0, s.indexOf(q[0])).trim();
    const docNum = before.match(/(В?КДП|НП|ВП|ДСТУ)\s+[\d\-(). ]+$/i);
    if (docNum) return `${docNum[0].trim()} "${q[1]}"`;
    return q[1].trim();
  }
  return s.length > 65 ? s.slice(0, 62) + '…' : s;
}

// ── Фільтр сміттєвих термінів ─────────────────────────────────────────────
function isJunkTerm(name, definition) {
  if (!name) return true;
  const n = name.trim();
  if (n.length < 4) return true;
  if (/^(Рис(унок|инок)?\.?\s*[\dА]|Таблиц|Табл\.|Схема\s*\d|Мал\.|Фото\s*\d|Fig\.|Table\s*\d)/i.test(n)) return true;
  if (/^\d+[\.\)]/.test(n)) return true;
  if (/\s(яке|який|яка|що|де|котрий),?\s*$/i.test(n)) return true;
  if (n.length > 200) return true;
  if (!definition || definition.trim().length < 10) return true;
  return false;
}

// ── Fallback: структурований markdown без LLM ────────────────────────────
function buildSmartFallback(queryText, rows) {
  if (!rows || rows.length === 0) {
    return `## За запитом «${queryText}» нічого не знайдено\n\nСпробуйте інше формулювання або скористайтесь пошуком у глосарії.`;
  }

  const clean = rows.filter(r => !isJunkTerm(r.term_name, r.definition));
  if (clean.length === 0) {
    return `## За запитом «${queryText}» нічого не знайдено\n\nСпробуйте інше формулювання.`;
  }

  // Групуємо за категорією
  const byCategory = new Map();
  for (const r of clean) {
    const cat = r.category || 'Загальне';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(r);
  }

  const isListQuery = /типи|види|клас|форми|метод|способи|різновид|категорі|перелічи|напиши|які.*(існу|є)|розкаж|опиш/i.test(queryText);
  const categories  = Array.from(byCategory.entries());

  let md = '';

  // Вступ
  md += `За запитом **«${queryText}»** у глосарії знайдено **${clean.length} термінів**. `;
  if (isListQuery) {
    md += `Нижче наведено структурований огляд за розділами бази знань.\n\n---\n\n`;
  } else {
    md += `Нижче наведено відповідні визначення.\n\n---\n\n`;
  }

  let sectionNum = 1;

  if (categories.length > 1) {
    for (const [cat, terms] of categories) {
      md += `## ${sectionNum}. ${cat}\n\n`;
      for (const r of terms.slice(0, 6)) {
        const src = shortSource(r.source_title, r.source_file_name);
        const ext = r.extended_info?.trim().length > 30
          ? `\n  * ${r.extended_info.slice(0, 300)}${r.extended_info.length > 300 ? '…' : ''}`
          : '';
        md += `* **${r.term_name}:** ${r.definition}${ext}\n\n`;
        md += `  📄 *${src}*\n\n`;
      }
      if (terms.length > 6) {
        md += `*...ще ${terms.length - 6} термін(ів) у цьому розділі — скористайтесь пошуком.*\n\n`;
      }
      md += `---\n\n`;
      sectionNum++;
    }
  } else {
    const top  = clean.slice(0, 5);
    const rest = clean.slice(5, 12);

    for (const r of top) {
      const src = shortSource(r.source_title, r.source_file_name);
      md += `## ${sectionNum}. ${r.term_name}\n\n`;
      md += `${r.definition}\n\n`;
      if (r.extended_info?.trim().length > 30) {
        md += `> ${r.extended_info.slice(0, 400)}${r.extended_info.length > 400 ? '…' : ''}\n\n`;
      }
      md += `📄 *${src}*\n\n---\n\n`;
      sectionNum++;
    }

    if (rest.length > 0) {
      md += `**Пов'язані терміни:**\n\n`;
      for (const r of rest) {
        md += `* **${r.term_name}** — ${(r.definition || '').slice(0, 130)}${r.definition?.length > 130 ? '…' : ''}\n`;
      }
      md += '\n';
    }
  }

  md += `\n*Якщо потрібна детальніша інформація з конкретного аспекту — уточніть запит або скористайтесь пошуком у глосарії.*`;
  return md;
}

// ── LLM-запит ─────────────────────────────────────────────────────────────
async function tryLLM(contextBlocks, queryText) {
  // Явний приклад очікуваного формату у запиті
  const userPrompt =
    `Запит: "${queryText}"\n\n` +
    `=== ТЕРМІНИ З БАЗИ ЗНАНЬ (використовуй ТІЛЬКИ ці дані) ===\n\n` +
    `${contextBlocks}\n\n` +
    `=== ЗАВДАННЯ ===\n` +
    `Дай повну структуровану відповідь на запит, використовуючи ТІЛЬКИ наведені терміни.\n` +
    `Дотримуйся ТОЧНО формату з системного промпту:\n` +
    `- Вступний абзац без "Ось"/"На основі"\n` +
    `- Роздільник ---\n` +
    `- Розділи ## 1. Назва, ## 2. Назва тощо\n` +
    `- Маркери * **Термін:** Пояснення 2-4 речення\n` +
    `- Завершальне речення\n` +
    `Відповідай ТІЛЬКИ українською мовою.`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
      body: JSON.stringify({
        model:  LLM_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
        options: {
          temperature: 0.15,
          num_predict: 1500,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.message?.content || data.response || '').trim();
    // Відкидаємо коротку або порожню відповідь
    if (!text || text.length < 100) return null;
    return text;
  } catch (e) {
    console.warn('[Assistant] LLM timeout/error:', e.message);
    return null;
  }
}

// ── Головна функція ───────────────────────────────────────────────────────
async function ragSearch(queryText, user = null, k = 20) {

  // Крок 1: знайти терміни зі smartSearch
  const sr    = await smartSearch(queryText, user, { limit: k * 2, semanticFallbackThreshold: 0 });
  const terms = sr.terms || [];

  const rows = terms.map(t => ({
    term_id:          t.id,
    term_name:        t.term_name,
    definition:       t.definition,
    extended_info:    t.extended_info || null,
    category:         t.category,
    source_title:     t.source_title,
    source_file_name: t.source_file_name,
    source_doc_type:  t.source_doc_type,
    source_doc_date:  t.source_doc_date,
    source_issued_by: t.source_issued_by,
    _source:          t._source || 'db',
    similarity:       t._similarity != null
      ? t._similarity.toFixed(3)
      : (t._score / 100).toFixed(3),
  }));

  // Крок 2: фільтрація нерелевантного
  const qLower = queryText.toLowerCase().replace(/[''ʼ]/g, "'");
  const qWords = qLower.split(/\s+/).filter(w => w.length >= 3);

  const relevant = rows.filter(r => {
    const name = (r.term_name  || '').toLowerCase().replace(/[''ʼ]/g, "'");
    const def  = (r.definition || '').toLowerCase().replace(/[''ʼ]/g, "'");
    if (r._source === 'semantic') return true;
    if (name.includes(qLower)) return true;
    if (qWords.some(w => name.includes(w))) return true;
    if (qWords.some(w => def.includes(w))) return true;
    return false;
  });

  const finalRows = relevant.length >= 2
    ? relevant
    : rows.filter(r => !isJunkTerm(r.term_name, r.definition));

  if (finalRows.length === 0) {
    return { answer: buildSmartFallback(queryText, []), sources: [], context_terms: 0 };
  }

  // Крок 3: LLM
  let answer = null;
  const modelReady = USE_LLM && await checkModelLoaded();

  if (modelReady) {
    // Будуємо максимально інформативний контекст для LLM
    const contextBlocks = finalRows
      .slice(0, 25)
      .filter(r => !isJunkTerm(r.term_name, r.definition))
      .map((r, i) => {
        const src = shortSource(r.source_title, r.source_file_name);
        const ext = r.extended_info?.trim().length > 20
          ? `\n   Розширення: ${r.extended_info.slice(0, 300)}`
          : '';
        return `[${i + 1}] Термін: "${r.term_name}"\n   Категорія: ${r.category || 'Загальне'}\n   Визначення: ${r.definition}${ext}\n   Джерело: ${src}`;
      })
      .join('\n\n');

    answer = await tryLLM(contextBlocks, queryText);
    if (answer) {
      console.log(`[Assistant] LLM відповів (${answer.length} символів)`);
    } else {
      console.log('[Assistant] LLM не відповів — використовуємо fallback');
    }
  }

  // Крок 4: fallback
  if (!answer) {
    answer = buildSmartFallback(queryText, finalRows);
  }

  // Крок 5: унікальні джерела
  const seenSources = new Set();
  const sources = finalRows
    .filter(r => {
      const key = r.source_title || r.source_file_name;
      if (!key || seenSources.has(key)) return false;
      seenSources.add(key);
      return true;
    })
    .map(r => ({
      termId:      r.term_id,
      termName:    r.term_name,
      sourceTitle: shortSource(r.source_title, r.source_file_name),
      docType:     r.source_doc_type,
      docDate:     r.source_doc_date,
      issuedBy:    r.source_issued_by,
      similarity:  r._source === 'semantic' ? r.similarity : null,
    }));

  return {
    answer,
    sources,
    context_terms: finalRows.length,
    top_terms: finalRows.slice(0, 3).map(r => ({
      id:         r.term_id,
      name:       r.term_name,
      similarity: r._source === 'semantic' ? r.similarity : null,
    })),
  };
}

module.exports = { ragSearch };
