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

// Function to extract text from DOCX
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

    const prompt = retryPrefix + `You are an expert military and IT data extraction AI for the Ukrainian Armed Forces.
Your task is to extract key terms and their definitions from the provided text chunk.
You MUST respond with a valid JSON array of objects. The root of your response MUST be the array itself.

CRITICAL REQUIREMENT: YOU MUST TRANSLATE EVERYTHING TO UKRAINIAN. BOTH TERMS AND DEFINITIONS MUST BE IN UKRAINIAN.

Categories allowed EXACTLY (use one of these strings verbatim):
- Системи зв’язку
- Кібербезпека
- Криптографія
- Нормативні акти
- Радіоелектронна боротьба
- IT-термінологія

Each object MUST have EXACTLY these four keys:
"term": the term name (noun phrase, concise).
"definition": exact or paraphrased definition from the text. If missing output "Опис відсутній".
"category": one of the six categories above.
"extended_info": 2-3 sentence specialist technical insight about this term (your own knowledge, in Ukrainian).

Focus on technical, military, and IT concepts. Include borderline terms rather than miss them.
Do NOT extract general words, verbs, or non-technical phrases.

EXAMPLES OF CORRECT OUTPUT:
[
  {
    "term": "Кібербезпека",
    "definition": "Захист інформаційних систем, мереж та даних від цифрових атак і несанкціонованого доступу.",
    "category": "Кібербезпека",
    "extended_info": "Включає фаєрволи, IDS/IPS, шифрування каналів передачі даних та регулярний аудит вразливостей. Стандартизована в рамках ISO 27001 та NIST Cybersecurity Framework."
  },
  {
    "term": "Радіорелейний зв’язок",
    "definition": "Спосіб передачі інформації по радіохвилях між ретрансляційними станціями у прямій видимості.",
    "category": "Системи зв’язку",
    "extended_info": "Використовує діапазони частот від 1 до 40 ГГц. Застосовується для організації магістральних каналів зв’язку в тактичній зоні, де прокладання кабелю неможливе."
  }
]

If the text contains no relevant terms, return an empty array: []
Do NOT include any text outside the JSON array.

Text chunk:
${text}

JSON Output (in Ukrainian):
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

  await progressCallback(10, 'Зчитування тексту документа...');
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

  log(`Extracted ${text.trim().length} characters from ${filePath}`);
  log(`[Parse] Попередній перегляд витягнутого тексту: "${text.substring(0, 200).replace(/\n/g, ' ')}..."\n`);
  
  if (text.trim().length === 0) {
    console.warn('Warning: Extracted text is empty. If this is a scanned PDF, you might need an OCR library.');
  }

  const MAX_CHARS = 8000; // Безпечний ліміт для вікна контексту моделі (llama3 має 8k токенів)
  const chunks = chunkText(text, MAX_CHARS);
  let allTerms = [];
  const uniqueTermsMap = new Map();

  await progressCallback(25, `Текст вилучено. Розбиття на ${chunks.length} логічних блоків...`);
  log(`[AI] Текст розділено на ${chunks.length} частин для обробки ШІ.`);

  for (let i = 0; i < chunks.length; i++) {
    log(`[AI] Обробка частини ${i + 1} з ${chunks.length}...`);
    await progressCallback(25 + Math.floor((i / chunks.length) * 65), `ШІ аналізує частину ${i + 1} з ${chunks.length}...`);
    if (chunks[i].trim().length > 0) {
      const terms = await callLLMForTerms(chunks[i]);
      
      const newUniqueTerms = [];
      for (const item of terms) {
        const key = item.term.toLowerCase().trim();
        if (!uniqueTermsMap.has(key)) {
          
          // === OSINT Автоматизація ===
          if (accessLevel === 'Public' && !['Криптографія', 'Нормативні акти'].includes(item.category)) {
            await progressCallback(25 + Math.floor((i / chunks.length) * 65), `🌐 OSINT-аналіз: ${item.term}...`);
            try {
              log(`[AI] Автоматичний OSINT-аналіз для терміну: ${item.term}`);
              const enriched = await enrichTermWithWiki(item.term, item.definition);
              if (enriched.extended_info) {
                item.extended_info = enriched.extended_info;
                item.references = enriched.references || [];
                item.definition_source_type = 'Wiki-Agent';
              }
            } catch (e) {
              console.error(`[AI] OSINT помилка для ${item.term}:`, e.message);
            }
          }

          uniqueTermsMap.set(key, item);
          newUniqueTerms.push(item);
        } else if (item.definition.length > uniqueTermsMap.get(key).definition.length) {
          uniqueTermsMap.set(key, item); // Оновлюємо, якщо нове визначення довше
        }
      }
      
      if (newUniqueTerms.length > 0) {
        await progressCallback(25 + Math.floor((i / chunks.length) * 65), `Знайдено нові терміни (${newUniqueTerms.length})...`, newUniqueTerms);
      }

      allTerms = allTerms.concat(terms);
    }
  }

  await progressCallback(95, 'Фіналізація результатів...');
  
  const uniqueTerms = Array.from(uniqueTermsMap.values());
  log(`[AI] Загалом знайдено ${allTerms.length} термінів. Після видалення дублікатів залишилось: ${uniqueTerms.length}`);
  
  return uniqueTerms;
}

module.exports = { processDocument, generateDefinitionForTerm };