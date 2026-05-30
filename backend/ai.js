'use strict';
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const xlsx = require('xlsx');
const path = require('path');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const { enrichTermWithWiki } = require('./wikiAgent');

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

// ── Допустимі категорії (відповідають розділам нормативного переліку) ─────
const VALID_CATEGORIES = [
  'Військові керівні публікації ЗСУ',
  'Закони України',
  'НД ТЗІ',
  'Національні стандарти (ДСТУ)',
  'Союзні публікації НАТО',
  'Освітньо-методичні джерела',
];
const DEFAULT_CATEGORY = 'Освітньо-методичні джерела';

// Нормалізація категорії: перевіряємо чи входить у список, інакше — дефолт
function normalizeAndClassify(rawCategory) {
  if (rawCategory) {
    const norm = rawCategory.trim();
    if (VALID_CATEGORIES.includes(norm)) return norm;
  }
  return DEFAULT_CATEGORY;
}

// Очищення визначення: прибираємо крапку з комою, зайві лапки
function cleanDefinition(def) {
  return def
    .replace(/[;]\s*$/, '')
    .replace(/^[«»“„"']|[«»”"']$/g, '')
    .trim();
}

// ── Парсери файлів ─────────────────────────────────────────────────────────
async function extractTextFromPDF(filePath) {
  try {
    log(`[Parse] PDF: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    if (typeof pdfParse !== 'function') throw new Error('Несумісна версія pdf-parse.');
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`[Parse] Помилка PDF: ${error.message}`);
    throw new Error(`Не вдалося обробити PDF. ${error.message}`);
  }
}

async function extractTextFromDOCX(filePath) {
  try {
    log(`[Parse] DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.warn('Mammoth failed, falling back to textract:', error.message);
    return extractTextFromDOC(filePath);
  }
}

async function extractTextFromDOC(filePath) {
  return new Promise((resolve, reject) => {
    log(`[Parse] DOC: ${filePath}`);
    textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error, text) => {
      if (error) return reject(error);
      resolve(text);
    });
  });
}

async function extractTextFromXLSX(filePath) {
  return new Promise((resolve, reject) => {
    try {
      log(`[Parse] XLSX: ${filePath}`);
      const workbook = xlsx.readFile(filePath);
      let fullText = '';
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = xlsx.utils.sheet_to_csv(worksheet, { FS: ' ' });
        fullText += `--- Лист: ${sheetName} ---\n${sheetData}\n\n`;
      });
      resolve(fullText);
    } catch (error) {
      reject(new Error(`Не вдалося розпарсити Excel: ${error.message}`));
    }
  });
}

function cleanText(text) {
  return text
    .replace(/^\s*\d{1,4}\s*$/gm, '')
    .replace(/^\s*[-_=.]{4,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Визначення структури документа
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Аналізує текст і класифікує кожен рядок як:
 *   'def'    — рядок термін–визначення (глосарій)
 *   'header' — заголовок / коротка лінія
 *   'prose'  — суцільний текст
 *
 * Повертає: { defLines, proseLines, proseText, glossaryRatio }
 */
function detectDocumentStructure(text) {
  // Спочатку склеюємо продовження визначень
  const joined = joinContinuationLines(text);
  // Патерн для рядка типу "термін — визначення" або "термін - визначення"
  const DEF_LINE = /^([^\n]{3,200}?)\s*(?:-|—|–)\s+([^\n]{15,})$/;

  const lines = joined.split('\n');
  const defLines = [];
  const proseLines = [];
  let proseText = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.length < 4) continue; // пропускаємо мікрорядки

    if (DEF_LINE.test(line)) {
      defLines.push(line);
    } else if (line.length < 60 && /^[А-ЯЁЇІЄA-Z0-9]/.test(line)) {
      // Коротка лінія, що починається з великої літери — ймовірно заголовок
      // Не додаємо до prose (не шум)
    } else {
      proseLines.push(line);
      proseText += line + '\n';
    }
  }

  const total = defLines.length + proseLines.length;
  const glossaryRatio = total > 0 ? defLines.length / total : 0;

  log(`[Structure] defLines=${defLines.length}, proseLines=${proseLines.length}, ratio=${glossaryRatio.toFixed(2)}`);
  return { defLines, proseLines, proseText, glossaryRatio };
}

// ═══════════════════════════════════════════════════════════════════════════
// Preprocessing: склеюємо рядки-продовження визначень в один рядок
// ═══════════════════════════════════════════════════════════════════════════
function joinContinuationLines(text) {
  // Патерн "нового" рядка-терміну: починається з літери/цифри і містить тире/дефіс
  const NEW_TERM_LINE = /^[\dА-ЯЁЇІЄа-яёїієA-Za-z\[].*(?:—|–|\s-\s)/;
  // Патерн рядка що виглядає як продовження (не починається з великої літери + дефіс/заголовок)
  const CONTINUATION = /^[а-яёїієa-z\(,;]/;

  const lines = text.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      result.push('');
      continue;
    }

    // Якщо попередній рядок є визначенням і поточний — продовження
    if (result.length > 0 && CONTINUATION.test(trimmed)) {
      const prev = result[result.length - 1];
      // Склеюємо тільки якщо попередній рядок непорожній і містить термін/дефіс
      if (prev && prev.trim() && !prev.endsWith('\n')) {
        // Приєднуємо через пробіл (без переносу рядка)
        result[result.length - 1] = prev.trimEnd() + ' ' + trimmed;
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Швидкий Heuristic-екстрактор (без LLM)
// ═══════════════════════════════════════════════════════════════════════════
function extractDefinedTermsHeuristic(rawText) {
  // Спочатку склеюємо багаторядкові визначення в один рядок
  const text = joinContinuationLines(rawText);
  const found = new Map();
  let m;

  // P1: "Термін — визначення" або "Термін – визначення" (em/en dash)
  const p1 = /^([Ѐ-ӿА-ЯЁЇІЄа-яёїієA-Za-z][^\n—–]{2,200}?)\s*[—–]\s*([^\n]{20,})/gm;
  while ((m = p1.exec(text)) !== null) {
    const term = m[1].trim().replace(/^\d+[\.\)\s]+/, '').trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 200 && def.length >= 15 && !/^\d+$/.test(term))
      found.set(term.toLowerCase(), { term, definition: def });
  }

  // P2: "термін - визначення;" (одинарний дефіс — типовий формат ЗСУ)
  const p2 = /^([Ѐ-ӿА-ЯЁЇІЄа-яёїієA-Za-z][Ѐ-ӿ\w\s’''ʼ(),./\-]{2,200}?)\s+-\s+([Ѐ-ӿ\w][^\n\r]{15,}?)[\s;.]*$/gm;
  while ((m = p2.exec(text)) !== null) {
    const term = m[1].trim().replace(/^\d+[\.\)\s]+/, '').trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 200 && def.length >= 15
        && !/^\d+$/.test(term) && !/https?:\/\//.test(term)
        && (term.match(/-/g) || []).length < 3) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  // P3: "термін це/є/означає визначення"
  const p3 = /([Ѐ-ӿА-ЯЁЇІЄа-яёїієA-Za-z][^\n]{2,200}?)\s+(?:це|є|означає)\s+([^\n]{20,})/gi;
  while ((m = p3.exec(text)) !== null) {
    const term = m[1].trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 200 && def.length >= 15) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  // P4: нумеровані пункти "1.1. Термін — визначення"
  const p4 = /^\d+[\d.]*[\.\)\s]+([Ѐ-ӿА-ЯЁЇІЄа-яёїієA-Za-z][^\n—–]{2,200}?)[—–]\s*([^\n]{20,})/gm;
  while ((m = p4.exec(text)) !== null) {
    const term = m[1].trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 200 && def.length >= 15) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  return Array.from(found.values()).map(item => ({
    ...item,
    category: DEFAULT_CATEGORY,
    extended_info: '',
    definition_source_type: 'Document',
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: LLM — тільки для prose-тексту (спрощений промпт)
// ═══════════════════════════════════════════════════════════════════════════
async function extractFromProse(proseText, knownKeys = new Set(), isRetry = false) {
  const retryPrefix = isRetry
    ? 'IMPORTANT: Your previous response was not valid JSON. Return ONLY a valid JSON array.\n\n'
    : '';

  const prompt = retryPrefix +
    `You are an elite Ukrainian military terminology extraction AI.\n` +
    `Extract ALL technical terms with their COMPLETE definitions from the text below.\n` +
    `PRIORITY: defined terms, equipment names, abbreviations, numbered items.\n` +
    `RULES:\n` +
    `- Output ONLY a valid JSON array, no extra text.\n` +
    `- All text in UKRAINIAN.\n` +
    `- Copy definitions from text FULLY and COMPLETELY — do not truncate or summarize.\n` +
    `- If a definition spans multiple sentences, include all of them.\n` +
    `- Each object: {"term": "...", "definition": "..."}\n` +
    `- term: 3-200 characters\n` +
    `- definition: minimum 15 characters, NO maximum — copy full text\n\n` +
    `TEXT:\n${proseText}\n\nJSON:`;

  try {
    log('[AI/Prose] Відправка до Ollama...');
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.1, num_predict: 4096 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    const output = data.response;

    const mapTerms = (arr) =>
      arr
        .map(item => {
          if (typeof item === 'string') return { term: item, definition: 'Опис відсутній' };
          const termName   = item.term || item.Term || item.TERM || item.Concept || item.Name || '';
          const definition = item.definition || item.Definition || item.DEFINITION || item.Description || 'Опис відсутній';
          return {
            term: termName,
            definition,
            category: DEFAULT_CATEGORY,
            extended_info: '',
            definition_source_type: 'Document',
          };
        })
        .filter(i => i.term && i.term.length >= 3 && i.term.length <= 200 && !knownKeys.has(i.term.toLowerCase().trim()));

    try {
      const sanitized = output.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
      let arr = [];
      try {
        const parsed = JSON.parse(sanitized.trim());
        const findArray = (obj) => {
          if (Array.isArray(obj)) return obj;
          if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) { const r = findArray(obj[key]); if (r && r.length) return r; }
          }
          return null;
        };
        arr = findArray(parsed) || [];
      } catch (e) {
        const fi = sanitized.indexOf('['), li = sanitized.lastIndexOf(']');
        if (fi !== -1 && li > fi) {
          try { arr = JSON.parse(sanitized.substring(fi, li + 1)); } catch (_) {}
        }
      }
      const terms = mapTerms(arr);
      if (terms.length === 0 && !isRetry) {
        log('[AI/Prose] Порожньо — retry...');
        return extractFromProse(proseText, knownKeys, true);
      }
      return terms;
    } catch (err) {
      if (!isRetry) return extractFromProse(proseText, knownKeys, true);
      console.error('[AI/Prose] Помилка парсингу після retry:', err.message);
      return [];
    }
  } catch (e) {
    console.error('[AI/Prose] Помилка Ollama:', e.message);
    return [];
  }
}

// Розбивка тексту на чанки з перекриттям
function chunkText(text, maxLength, overlapChars = 400) {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = []; let current = '', prevTail = '';
  for (const para of paragraphs) {
    if (para.length > maxLength) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        if ((current + ' ' + sent).trim().length > maxLength) {
          if (current) { chunks.push(current.trim()); prevTail = current.slice(-overlapChars); current = prevTail + '\n\n' + sent; }
          else { chunks.push(sent.trim()); prevTail = sent.slice(-overlapChars); current = prevTail; }
        } else { current = current ? current + ' ' + sent : sent; }
      }
      continue;
    }
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length > maxLength) { chunks.push(current.trim()); prevTail = current.slice(-overlapChars); current = prevTail + '\n\n' + para; }
    else current = candidate;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Асинхронне збагачення — extended_info
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Генерує розширений опис для ОДНОГО терміну.
 * Короткий промпт — тільки extended_info (без витягування/категорії).
 * Викликається асинхронно після збереження draft_terms.
 */
async function generateExtendedInfo(termName, definition) {
  const prompt =
    `Ти — військовий аналітик ЗСУ. Термін: "${termName}". Визначення: "${definition}".` +
    `\nНапиши коротку (2-4 речення) ЕНЦИКЛОПЕДИЧНУ ДОВІДКУ українською мовою: роль у ЗСУ, застосування, аналог НАТО.` +
    `\nВідповідь ТІЛЬКИ JSON: {"extended_info": "...markdown тут..."}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.3, num_predict: 400 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.response.trim());
    return parsed.extended_info || '';
  } catch (e) {
    console.warn(`[ExtInfo] Помилка для "${termName}": ${e.message}`);
    return '';
  }
}

/**
 * Збагачує перші N термінів з draft_terms для певного source_id.
 * Викликається НЕ-БЛОКУЮЧИМ способом після збереження термінів.
 */
async function enrichDraftTermsBatch(pool, sourceId, limit = 20) {
  try {
    const [rows] = await pool.query(
      'SELECT id, term_name, definition FROM draft_terms WHERE source_id = ? AND (extended_info IS NULL OR extended_info = \'\') ORDER BY id ASC LIMIT ?',
      [sourceId, limit]
    );
    if (!rows.length) return;
    log(`[Enrich] Збагачення ${rows.length} термінів для source_id=${sourceId}`);

    for (const row of rows) {
      const info = await generateExtendedInfo(row.term_name, row.definition);
      if (info) {
        await pool.query('UPDATE draft_terms SET extended_info = ? WHERE id = ?', [info, row.id]);
      }
    }
    log(`[Enrich] Завершено збагачення для source_id=${sourceId}`);
  } catch (e) {
    console.error('[Enrich] Помилка:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Генерація визначення для одного терміну (ручний режим)
// ═══════════════════════════════════════════════════════════════════════════
async function generateDefinitionForTerm(termName) {
  log(`[AI] Генерація визначення для: "${termName}"`);
  const prompt =
    `The term is: "${termName}".` +
    `\nYou are an expert in Ukrainian military communications and cybersecurity.` +
    `\nWrite a concise academic definition (1-2 sentences) and a detailed technical explanation (2-3 sentences).` +
    `\nRespond ONLY with valid JSON IN UKRAINIAN:\n{"definition": "...", "extended_info": "..."}`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, format: 'json', stream: false, options: { temperature: 0.5 } }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.response.trim());
  } catch (error) {
    console.error('[AI] Помилка генерації:', error.message);
    throw new Error(`Не вдалося згенерувати визначення: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ГОЛОВНИЙ ОРКЕСТРАТОР — Smart Tiered Pipeline
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Поріг: якщо glossaryRatio >= GLOSSARY_THRESHOLD, LLM не викликається.
 * Типові глосарні документи ЗСУ мають ratio 0.7–1.0.
 */
const GLOSSARY_THRESHOLD = 0.4;
const MIN_HEURISTIC_TERMS = 5;

async function processDocument(filePath, progressCallback = async () => {}, accessLevel = 'Public') {
  let text = '';
  const ext = filePath.split('.').pop().toLowerCase();

  // ── Зчитування ──────────────────────────────────────────────────────────
  await progressCallback(5, 'Зчитування тексту документа...');
  if      (ext === 'pdf')               text = await extractTextFromPDF(filePath);
  else if (ext === 'docx')              text = await extractTextFromDOCX(filePath);
  else if (ext === 'doc')               text = await extractTextFromDOC(filePath);
  else if (ext === 'xlsx' || ext === 'xls') text = await extractTextFromXLSX(filePath);
  else if (ext === 'txt')               text = fs.readFileSync(filePath, 'utf8');
  else throw new Error('Unsupported file type');

  const charCount = text.trim().length;
  log(`[Process] Зчитано ${charCount} символів з ${filePath}`);
  if (charCount === 0) console.warn('[Process] Warning: текст порожній.');
  text = cleanText(text);

  // ── Phase 1: Визначення структури ───────────────────────────────────────
  await progressCallback(10, 'Аналіз структури документа...');
  const { defLines, proseText, glossaryRatio } = detectDocumentStructure(text);
  const isGlossary = glossaryRatio >= GLOSSARY_THRESHOLD;
  log(`[Process] glossaryRatio=${glossaryRatio.toFixed(2)}, isGlossary=${isGlossary}`);

  const uniqueTermsMap = new Map();

  // ── Phase 2: Heuristic (завжди) ─────────────────────────────────────────
  await progressCallback(15, 'Пошук явно визначених термінів...');
  const heuristicTerms = extractDefinedTermsHeuristic(text);
  log(`[Heuristic] Знайдено ${heuristicTerms.length} термінів`);
  for (const item of heuristicTerms) uniqueTermsMap.set(item.term.toLowerCase().trim(), item);

  if (heuristicTerms.length > 0)
    await progressCallback(25, `Heuristic: знайдено ${heuristicTerms.length} термінів.`, heuristicTerms);

  // ── Phase 3: LLM — тільки якщо документ не є чистим глосарієм ───────────
  const needsLLM =
    proseText.trim().length > 200 &&
    (glossaryRatio < GLOSSARY_THRESHOLD || heuristicTerms.length < MIN_HEURISTIC_TERMS);

  if (isGlossary && !needsLLM) {
    log('[Process] Документ — глосарій. LLM пропущено.');
    await progressCallback(90, `Глосарій розпізнано. Знайдено ${uniqueTermsMap.size} термінів (без LLM).`);
  } else {
    const knownKeys = new Set(uniqueTermsMap.keys());
    const CHUNK_SIZE = 2500;
    const PARALLEL_CHUNKS = 2;
    const proseChunks = chunkText(proseText, CHUNK_SIZE).filter(c => c.trim().length > 50);

    await progressCallback(27, `Prose-текст: ${proseChunks.length} блоків. Запуск AI...`);
    log(`[Process] LLM: ${proseChunks.length} prose-чанків`);

    let processed = 0;
    for (let i = 0; i < proseChunks.length; i += PARALLEL_CHUNKS) {
      const batch = proseChunks.slice(i, i + PARALLEL_CHUNKS);
      const batchResults = await Promise.all(batch.map(c => extractFromProse(c, knownKeys)));
      const newTerms = [];
      for (const terms of batchResults) {
        for (const item of terms) {
          const key = item.term.toLowerCase().trim();
          if (!uniqueTermsMap.has(key)) {
            uniqueTermsMap.set(key, item);
            knownKeys.add(key);
            newTerms.push(item);
          } else {
            const ex = uniqueTermsMap.get(key);
            if ((item.definition || '').length > (ex.definition || '').length)
              uniqueTermsMap.set(key, { ...ex, definition: item.definition });
          }
        }
      }
      processed += batch.length;
      const pct = 27 + Math.floor((processed / proseChunks.length) * 60);
      await progressCallback(pct, `AI: блок ${processed}/${proseChunks.length} — ${uniqueTermsMap.size} термінів`, newTerms.length ? newTerms : null);
    }
  }

  await progressCallback(95, 'Фіналізація результатів...');

  const uniqueTerms = Array.from(uniqueTermsMap.values());

  log(`[Process] Разом унікальних термінів: ${uniqueTerms.length}`);
  return uniqueTerms;
}

module.exports = {
  processDocument,
  generateDefinitionForTerm,
  generateExtendedInfo,
  enrichDraftTermsBatch,
};
