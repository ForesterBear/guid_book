const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const xlsx = require('xlsx');
const path = require('path');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const { enrichTermWithWiki } = require('./wikiAgent');

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

// Function to extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    log(`[Parse] Спроба парсингу PDF: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    
    if (typeof pdfParse !== 'function') {
      throw new Error(`Несумісна версія pdf-parse. Зупиніть сервер та виконайте: npm install pdf-parse@1.1.1`);
    }
    
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`[Parse] Помилка парсингу PDF за допомогою pdf-parse: ${error.message}`);
    throw new Error(`Не вдалося обробити PDF файл. Можливо, він пошкоджений або захищений. Помилка: ${error.message}`);
  }
}

// Function to extract text from DOCX (+ HTML for structure detection)
async function extractTextFromDOCX(filePath) {
  try {
    log(`[Parse] Спроба парсингу DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.warn('Mammoth failed to parse DOCX, falling back to textract:', error.message);
    return extractTextFromDOC(filePath);
  }
}

// Heuristic extraction: знаходить явно визначені терміни без LLM
// Шукає патерни: "ТЕРМІН — визначення", "термін: визначення", нумеровані пункти
function extractDefinedTermsHeuristic(text) {
  const found = new Map();

  // Патерн 1: "Термін — визначення" або "Термін – визначення" (тире різних видів)
  const dashPattern = /^([А-ЯІЇЄA-Z][^\n—–-]{2,60}?)\s*[—–-]{1,2}\s*([^\n]{20,})/gm;
  let m;
  while ((m = dashPattern.exec(text)) !== null) {
    const term = m[1].trim().replace(/^\d+[\.\)]\s*/, '').trim();
    const def = m[2].trim();
    if (term.length >= 3 && term.length <= 80 && def.length >= 20 && !/^\d+$/.test(term)) {
      found.set(term.toLowerCase(), { term, definition: def });
    }
  }

  // Патерн 2: "термін" – це/є/означає "визначення"
  const isPattern = /([А-ЯІЇЄA-Z][^\n]{2,60}?)\s+(?:це|є|означає|—|–)\s+([^\n]{20,})/gi;
  while ((m = isPattern.exec(text)) !== null) {
    const term = m[1].trim();
    const def = m[2].trim();
    if (term.length >= 3 && term.length <= 80 && def.length >= 20) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  // Патерн 3: нумеровані пункти з визначеннями ("1.1. Термін — ...")
  const numberedPattern = /^\d+[\d\.]*\s+([А-ЯІЇЄA-Z][^\n—–]{2,60}?)[—–]\s*([^\n]{20,})/gm;
  while ((m = numberedPattern.exec(text)) !== null) {
    const term = m[1].trim();
    const def = m[2].trim();
    if (term.length >= 3 && term.length <= 80 && def.length >= 20) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  return Array.from(found.values());
}

// Function to extract text from DOC
async function extractTextFromDOC(filePath) {
  return new Promise((resolve, reject) => {
    log(`[Parse] Спроба парсингу DOC за допомогою textract: ${filePath}`);
    textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error, text) => {
      if (error) {
        return reject(error);
      }
      resolve(text);
    });
  });
}

// Function to extract text from XLSX/XLS
async function extractTextFromXLSX(filePath) {
  return new Promise((resolve, reject) => {
    try {
      log(`[Parse] Спроба парсингу XLSX/XLS: ${filePath}`);
      const workbook = xlsx.readFile(filePath);
      let fullText = '';
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = xlsx.utils.sheet_to_csv(worksheet, { FS: ' ' }); // Використовуємо пробіл як роздільник для кращої читабельності
        fullText += `--- Лист: ${sheetName} ---\n${sheetData}\n\n`;
      });
      resolve(fullText);
    } catch (error) {
      reject(new Error(`Не вдалося розпарсити Excel файл: ${error.message}`));
    }
  });
}

// Function to generate definition for a term from scratch
async function generateDefinitionForTerm(termName) {
  log(`[AI] Генерація визначення для терміну: "${termName}"`);
  const prompt = `The term is: "${termName}".
A definition for this term is missing from the source document. Your task is to generate a new one.

You are an expert in Ukrainian military communications and cybersecurity.

1.  Formulate a concise, academic definition for the term (1-2 sentences).
2.  Write a more detailed technical explanation (2-3 sentences) providing context, examples, or specifications.
3.  Ensure the term is relevant to Communications, Cybersecurity, IT, or Military regulations. If it's completely unrelated (e.g., "cooking recipe"), you MUST return an error.

Respond ONLY with a valid JSON object in this format, IN UKRAINIAN:
{
  "definition": "Академічне визначення...",
  "extended_info": "Розширене технічне пояснення..."
}`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', prompt, format: 'json', stream: false, options: { temperature: 0.5 } })
    });
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    const data = await response.json();
    const parsed = JSON.parse(data.response.trim());
    return parsed;
  } catch (error) {
    console.error('[AI] Помилка генерації визначення:', error.message);
    throw new Error(`Не вдалося згенерувати визначення: ${error.message}`);
  }
}

// Function to call local LLM (Ollama) for term extraction
async function callLLMForTerms(text, isRetry = false) {
    const retryPrefix = isRetry
      ? "IMPORTANT: Your previous response was not valid JSON. Return ONLY a valid JSON array. No text before or after it.\n\n"
      : "";

    const prompt = retryPrefix + `You are an elite Ukrainian military terminology extraction AI.
Extract ALL technical terms and their definitions from the text below.

PRIORITY TARGETS (extract these first):
1. Terms explicitly defined with "—", "–", ":", "це", "є", "означає"
2. Terms in numbered lists (e.g., "1.1. Термін — визначення")
3. Abbreviations and their decryptions (e.g., "РЕБ — радіоелектронна боротьба")
4. Technical nouns: equipment names, system names, protocol names, regulation names
5. Military/IT concepts that appear as subject of a sentence

STRICT RULES:
- Output ONLY a valid JSON array. No text before or after.
- ALL text (terms AND definitions) MUST be in UKRAINIAN. Translate if needed.
- If a definition is in the text — copy it exactly. Do NOT invent definitions.
- If no definition in text — write a concise factual definition from your knowledge.
- Do NOT extract: common verbs, adjectives alone, prepositions, generic phrases like "система" or "захист" without context.

Categories (use EXACTLY one):
"Системи зв’язку" | "Кібербезпека" | "Криптографія" | "Нормативні акти" | "Радіоелектронна боротьба" | "IT-термінологія"

Required JSON fields per object:
- "term": concise noun phrase (3–80 chars)
- "definition": definition text (from doc or your knowledge)
- "category": one of the six above
- "extended_info": 1-2 sentence expert insight for a military specialist (in Ukrainian)

EXAMPLES:
[
  {
    "term": "Польовий вузол зв’язку",
    "definition": "Комплекс засобів зв’язку, розгорнутий у польових умовах для забезпечення управління військами.",
    "category": "Системи зв’язку",
    "extended_info": "Включає радіостанції, засоби захищеного зв’язку та апаратуру документального зв’язку. Розгортається силами підрозділів зв’язку за нормативами."
  },
  {
    "term": "РЕБ",
    "definition": "Радіоелектронна боротьба — комплекс заходів із застосування електромагнітної енергії для ураження, придушення або дезорганізації радіоелектронних засобів противника.",
    "category": "Радіоелектронна боротьба",
    "extended_info": "Включає радіоелектронне придушення, захист і розвідку. В умовах сучасних конфліктів є критично важливим компонентом збройної боротьби."
  }
]

TEXT CHUNK:
${text}

JSON:
`;

    try {
      log('[AI] Відправка запиту до Ollama HTTP API...');
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          prompt: prompt,
          format: 'json',
          stream: false,
          options: {
            temperature: 0.1 // Робить відповіді ШІ більш детермінованими та швидкими
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const output = data.response;

        try {
          let terms = [];
          const sanitizedOutput = output.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');

          const mapTerms = (arr) => {
            return arr.map(item => {
              if (typeof item === 'string') return { term: item, definition: 'Опис відсутній (ШІ не надав визначення)' };
              return {
                term: item.term || item.Term || item.TERM || item.Concept || item.concept || item.Name || item.name || '',
              definition: item.definition || item.Definition || item.DEFINITION || item.Description || item.description || 'Опис відсутній',
              category: item.category || item.Category || 'IT-термінологія',
              extended_info: item.extended_info || item.extendedInfo || item.Extended_info || item.Insights || '',
              };
            }).filter(item => item.term);
          };

          let extractedArray = [];
          try {
            const parsed = JSON.parse(sanitizedOutput.trim());

            // Рекурсивна функція для пошуку масиву у вкладених об'єктах
            const findArray = (obj) => {
              if (Array.isArray(obj)) return obj;
              if (typeof obj === 'object' && obj !== null) {
                for (const key in obj) {
                  const result = findArray(obj[key]);
                  if (result && result.length > 0) return result;
                }
              }
              return null;
            };

            extractedArray = findArray(parsed) || [];

            // Fallback для формату словника: { "Термін": "Визначення" }
            if (extractedArray.length === 0 && typeof parsed === 'object' && parsed !== null) {
              const extractFromDict = (obj) => {
                let arr = [];
                for (const key in obj) {
                  const val = obj[key];
                  if (typeof val === 'string') {
                    // Ігноруємо загальні ключі-обгортки, залишаємо лише реальні терміни
                    if (!['terms', 'терміни', 'glossary', 'терміни та визначення'].includes(key.toLowerCase())) {
                      arr.push({ term: key, definition: val });
                    }
                  } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                    arr = arr.concat(extractFromDict(val));
                  }
                }
                return arr;
              };
              extractedArray = extractFromDict(parsed);
            }
          } catch (e) {
            // Fallback: extract array using indexOf/lastIndexOf for safety
            const firstIdx = sanitizedOutput.indexOf('[');
            const lastIdx = sanitizedOutput.lastIndexOf(']');
            if (firstIdx !== -1 && lastIdx !== -1 && lastIdx > firstIdx) {
              try {
                const arrayStr = sanitizedOutput.substring(firstIdx, lastIdx + 1);
                extractedArray = JSON.parse(arrayStr);
              } catch (innerErr) {
                console.warn('Fallback JSON parse failed:', innerErr.message);
              }
            } else {
              console.warn('No JSON array found in LLM output. Raw output:', output);
            }
          }

          terms = mapTerms(extractedArray);

          // Якщо парсинг дав порожній масив і це не retry — спробуємо ще раз
          if (terms.length === 0 && !isRetry) {
            log('[AI] Порожній результат парсингу — виконуємо retry з уточненим промптом...');
            return callLLMForTerms(text, true);
          }

          return terms;
        } catch (error) {
          if (!isRetry) {
            log('[AI] Помилка парсингу JSON, виконуємо retry...');
            return callLLMForTerms(text, true);
          }
          console.error('Failed to parse LLM output after retry:', error, '\nRaw output:', output);
          return [];
        }
    } catch (err) {
      console.error('[AI] Помилка з\'єднання з Ollama API:', err.message);
      return [];
    }
}

// Розбиває текст на чанки по абзацах із overlap.
// Стратегія: спочатку split по \n\n (абзаци), потім склеюємо поки не досягнемо maxLength.
// Overlap: останні OVERLAP_CHARS символів попереднього чанку додаються на початок наступного,
// щоб терміни, які стоять на межі блоків, не губились.
function chunkText(text, maxLength, overlapChars = 400) {
  // Нормалізуємо переноси рядків і розбиваємо на абзаци
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks = [];
  let current = '';
  let prevTail = '';

  for (const para of paragraphs) {
    // Якщо один абзац більший за maxLength — ріжемо його по реченнях
    if (para.length > maxLength) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        if ((current + ' ' + sent).trim().length > maxLength) {
          if (current) {
            chunks.push(current.trim());
            prevTail = current.slice(-overlapChars);
            current = prevTail + '\n\n' + sent;
          } else {
            // Речення саме по собі перевищує ліміт — додаємо як є
            chunks.push(sent.trim());
            prevTail = sent.slice(-overlapChars);
            current = prevTail;
          }
        } else {
          current = current ? current + ' ' + sent : sent;
        }
      }
      continue;
    }

    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length > maxLength) {
      chunks.push(current.trim());
      prevTail = current.slice(-overlapChars);
      current = prevTail + '\n\n' + para;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Main function to process document and extract terms
async function processDocument(filePath, progressCallback = async () => {}, accessLevel = 'Public') {
  let text = '';
  const ext = filePath.split('.').pop().toLowerCase();

  await progressCallback(5, 'Зчитування тексту документа...');
  if (ext === 'pdf') {
    text = await extractTextFromPDF(filePath);
  } else if (ext === 'docx') {
    text = await extractTextFromDOCX(filePath);
  } else if (ext === 'doc') {
    text = await extractTextFromDOC(filePath);
  } else if (ext === 'xlsx' || ext === 'xls') {
    text = await extractTextFromXLSX(filePath);
  } else if (ext === 'txt') {
    text = fs.readFileSync(filePath, 'utf8');
  } else {
    throw new Error('Unsupported file type');
  }

  const charCount = text.trim().length;
  log(`Extracted ${charCount} characters from ${filePath}`);
  if (charCount === 0) {
    console.warn('Warning: Extracted text is empty. Scanned PDF may need OCR.');
  }

  const uniqueTermsMap = new Map();

  // ── Прохід 1: Heuristic extraction (миттєво, без LLM) ──────────────────
  await progressCallback(15, 'Пошук явно визначених термінів (heuristic)...');
  const heuristicTerms = extractDefinedTermsHeuristic(text);
  log(`[Heuristic] Знайдено ${heuristicTerms.length} явно визначених термінів`);
  for (const item of heuristicTerms) {
    item.category = 'IT-термінологія'; // буде уточнено LLM далі
    item.extended_info = '';
    item.definition_source_type = 'Document';
    uniqueTermsMap.set(item.term.toLowerCase().trim(), item);
  }
  if (heuristicTerms.length > 0) {
    await progressCallback(20, `Heuristic: знайдено ${heuristicTerms.length} термінів. Починаємо AI-аналіз...`, heuristicTerms);
  }

  // ── Прохід 2: LLM extraction по чанках (паралельно, PARALLEL_CHUNKS за раз) ──
  const MAX_CHARS = 6000;    // менший чанк → більше контексту для моделі
  const PARALLEL_CHUNKS = 2; // скільки чанків обробляти одночасно
  const chunks = chunkText(text, MAX_CHARS).filter(c => c.trim().length > 50);

  await progressCallback(22, `Текст розбито на ${chunks.length} блоків. Запуск AI...`);
  log(`[AI] ${chunks.length} чанків, паралельність: ${PARALLEL_CHUNKS}`);

  let processedChunks = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL_CHUNKS) {
    const batch = chunks.slice(i, i + PARALLEL_CHUNKS);
    const batchResults = await Promise.all(batch.map(chunk => callLLMForTerms(chunk)));

    const newUniqueTerms = [];
    for (const terms of batchResults) {
      for (const item of terms) {
        const key = item.term.toLowerCase().trim();
        if (!uniqueTermsMap.has(key)) {
          item.definition_source_type = item.definition_source_type || 'Document';
          uniqueTermsMap.set(key, item);
          newUniqueTerms.push(item);
        } else {
          // Зберігаємо довше визначення
          const existing = uniqueTermsMap.get(key);
          if ((item.definition || '').length > (existing.definition || '').length) {
            uniqueTermsMap.set(key, { ...existing, definition: item.definition });
          }
        }
      }
    }

    processedChunks += batch.length;
    const pct = 22 + Math.floor((processedChunks / chunks.length) * 70);
    const msg = `AI: блок ${processedChunks}/${chunks.length} — знайдено ${uniqueTermsMap.size} унікальних термінів`;
    await progressCallback(pct, msg, newUniqueTerms.length > 0 ? newUniqueTerms : null);
  }

  await progressCallback(95, 'Фіналізація результатів...');

  const uniqueTerms = Array.from(uniqueTermsMap.values());
  log(`[AI] Разом унікальних термінів: ${uniqueTerms.length} (з них heuristic: ${heuristicTerms.length})`);
  return uniqueTerms;
}

module.exports = { processDocument, generateDefinitionForTerm };