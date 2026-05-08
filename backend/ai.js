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

// Список допустимих категорій
const VALID_CATEGORIES = [
  "Системи зв’язку",
  'Кібербезпека',
  'Криптографія',
  'Нормативні акти',
  'Радіоелектронна боротьба',
  'IT-термінологія',
];

// ── Keyword-based класифікатор категорій ───────────────────────────────────
function classifyTermByKeywords(termName, definition) {
  const text = (termName + ' ' + (definition || '')).toLowerCase();

  const rules = [
    {
      category: 'Нормативні акти',
      keywords: [
        'наказ','положення','інструкція','стандарт',
        'регламент','закон ','постанова','директива',
        'нормативний','нормативні','правила','статут',
        'кодекс','доктрина','настанова','керівництво',
        'дсту','stanag','вимоги','норма ','порядок ',
        'затверджено','затвердження','документація',
        'регулювання','перелік ','типовий','відомчий',
        'процедура','технічні умови','технічні вимоги',
        'циркуляр','розпорядження','порядок заст',
        'порядок викон','концепція','протокол наради',
      ],
    },
    {
      category: "Системи зв’язку",
      keywords: [
        "зв’язк","зв'язк",'зв`язк',
        'радіостанц','антена','ретранслятор',
        'вузол зв','засоби зв','телефон','телеграф',
        'супутников','стільников','транкінг',
        'sincgars','маршрутизатор','радіоканал',
        'канал зв','лінія зв','апаратура',
        'польовий вузол','абонентськ','радіозв',
        'кабельн','волоконно-оптич','ствольн',
        'тропосфер','вузловий','техніка зв',
        'організація зв','облік техніки',
        'ремонт техніки','технічне обслуговування',
        'комутатор','перемикач',
        'voip','ip-телефон','диспетчер',
        'кшм','машина зв','засоби радіо',
      ],
    },
    {
      category: 'Кібербезпека',
      keywords: [
        'кібер','вірус','атака','брандмауер',
        'шкідливе програмне забезпечення',
        'шкідливе пз','вразливість','інцидент',
        'cert','soc','пентест','ddos','хакер',
        'кіберзахист','кіберпростір',
        'несанкціонований доступ','захист інформац',
        'інформаційна безпека','кіберінцидент',
        'фішинг','троян','малвар','експлойт',
        'сканування мереж','моніторинг мереж',
        'ips','ids','siem','антивірус',
      ],
    },
    {
      category: 'Криптографія',
      keywords: [
        'крипто','шифрування','дешифрування',
        'ключ шифр','асиметрич','симетрич',
        'цифровий підпис','електронний підпис',
        'ецп','сертифікат',
        'pki','rsa','aes','криптоаналіз','криптографічн',
        'алгоритм шифр','захищений канал',
        'vpn','ssl','tls','hmac','кодування','шифр ',
        'хеш-функц','хешування','хеш ',
      ],
    },
    {
      category: 'Радіоелектронна боротьба',
      keywords: [
        'реб ','радіоелектронна боротьба',
        'придушення','глушіння',
        'перехоплення','радіоелектронн',
        'радар','радіолокац','електромагнітн',
        'завада','радіорозвідк','радіоперехоплення',
        'постановник','прицільн','контрбатарейн',
        'локатор','пасивна розвідка','рез ',
        'активна перешкода','пасивна перешкода',
        'електронна боротьба',
        'бпла','дрон','постановник завад',
      ],
    },
  ];

  const scores = {};
  for (const rule of rules) scores[rule.category] = 0;
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) scores[rule.category] += 1;
    }
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) return best[0];
  return 'IT-термінологія';
}

// Нормалізація категорії: апостроф + перевірка + keyword fallback
function normalizeAndClassify(rawCategory, termName, definition) {
  if (rawCategory) {
    // Нормалізуємо будь-який варіант апострофа до U+2019
    const norm = rawCategory.replace(/['‘’ʼ＇`]/g, '’').trim();
    if (VALID_CATEGORIES.includes(norm)) return norm;
  }
  return classifyTermByKeywords(termName, definition);
}

async function extractTextFromPDF(filePath) {
  try {
    log(`[Parse] Спроба парсингу PDF: ${filePath}`);
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
    log(`[Parse] Спроба парсингу DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.warn('Mammoth failed, falling back to textract:', error.message);
    return extractTextFromDOC(filePath);
  }
}

function cleanText(text) {
  return text
    .replace(/^\s*\d{1,4}\s*$/gm, '')
    .replace(/^\s*[-_=.]{4,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Очищення визначення: прибираємо крапку з комою, зайві лапки
function cleanDefinition(def) {
  return def.replace(/[;]\s*$/, '').replace(/^["«»"“„]|["»"”]$/g, '').trim();
}

// Очищення визначення: знімаємо крапку з комою, зайві лапки
function cleanDefinition(def) {
  return def.replace(/[;]\s*$/, '').replace(/^[\u00AB\u00BB\u201C\u201E"']|[\u00AB\u00BB\u201D"']$/g, '').trim();
}

function extractDefinedTermsHeuristic(text) {
  const found = new Map();
  let m;

  // Патерн 1: "Термін — визначення" або "Термін – визначення" (em/en dash)
  const p1 = /^([Ѐ-ӿA-Za-z][^\n—–]{2,80}?)\s*[—–]\s*([^\n]{20,})/gm;
  while ((m = p1.exec(text)) !== null) {
    const term = m[1].trim().replace(/^\d+[\.\)\s]+/, '').trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 80 && def.length >= 15 && !/^\d+$/.test(term))
      found.set(term.toLowerCase(), { term, definition: def });
  }

  // Патерн 2: "термін - визначення;" (одинарний дефіс — типовий формат ЗСУ)
  const p2 = /^([Ѐ-ӿA-Za-z][Ѐ-ӿ\w\s\'’ʼ(),./\-]{2,80}?)\s+-\s+([Ѐ-ӿ\w][^\n\r]{15,}?)[\s;.]*$/gm;
  while ((m = p2.exec(text)) !== null) {
    const term = m[1].trim().replace(/^\d+[\.\)\s]+/, '').trim();
    const def  = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 80 && def.length >= 15
        && !/^\d+$/.test(term) && !/https?:\/\//.test(term)
        // не більше 2 дефісів у назві терміну (фільтр перелічень)
        && (term.match(/-/g) || []).length < 3) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  // Патерн 3: "термін це/є/означає визначення"
  const p3 = /([Ѐ-ӿA-Za-z][^\n]{2,60}?)\s+(?:це|є|означає)\s+([^\n]{20,})/gi;
  while ((m = p3.exec(text)) !== null) {
    const term = m[1].trim(); const def = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 80 && def.length >= 15) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  // Патерн 4: нумеровані пункти "1.1. Термін — визначення"
  const p4 = /^\d+[\d.]*[\.\)\s]+([Ѐ-ӿA-Za-z][^\n—–]{2,60}?)[—–]\s*([^\n]{20,})/gm;
  while ((m = p4.exec(text)) !== null) {
    const term = m[1].trim(); const def = cleanDefinition(m[2]);
    if (term.length >= 3 && term.length <= 80 && def.length >= 15) {
      const key = term.toLowerCase();
      if (!found.has(key)) found.set(key, { term, definition: def });
    }
  }

  return Array.from(found.values()).map(item => ({
    ...item,
    category: classifyTermByKeywords(item.term, item.definition),
    extended_info: '',
    definition_source_type: 'Document',
  }));
}

async function extractTextFromDOC(filePath) {
  return new Promise((resolve, reject) => {
    log(`[Parse] Спроба парсингу DOC: ${filePath}`);
    textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error, text) => {
      if (error) return reject(error);
      resolve(text);
    });
  });
}

async function extractTextFromXLSX(filePath) {
  return new Promise((resolve, reject) => {
    try {
      log(`[Parse] Спроба парсингу XLSX: ${filePath}`);
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

async function generateDefinitionForTerm(termName) {
  log(`[AI] Генерація визначення для: "${termName}"`);
  const prompt = `The term is: "${termName}".` +
    `\nYou are an expert in Ukrainian military communications and cybersecurity.` +
    `\nWrite a concise academic definition (1-2 sentences) and a detailed technical explanation (2-3 sentences).` +
    `\nRespond ONLY with valid JSON IN UKRAINIAN:\n{"definition": "...", "extended_info": "..."}`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, format: 'json', stream: false, options: { temperature: 0.5 } })
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.response.trim());
  } catch (error) {
    console.error('[AI] Помилка генерації:', error.message);
    throw new Error(`Не вдалося згенерувати визначення: ${error.message}`);
  }
}

async function callLLMForTerms(text, isRetry = false) {
  const retryPrefix = isRetry
    ? 'IMPORTANT: Your previous response was not valid JSON. Return ONLY a valid JSON array.\n\n'
    : '';

  const categoriesBlock = `
ПРАВИЛА КАТЕГОРИЗАЦІЇ (оберіть рівно одну):
"Системи зв’язку" — радіо/телефонний зв’язок, антени, ретранслятори, вузли зв’язку, апаратура, кабелі, опволодання та ремонт техніки зв’язку.
"Кібербезпека" — кіберзагрози, шкідливе ПЗ, IDS/IPS/SIEM, інциденти, несанкціонований доступ.
"Криптографія" — шифрування, ключі, еЦП, сертифікати, PKI, RSA/AES, VPN, TLS.
"Нормативні акти" — накази, положення, інструкції, ДСТУ/STANAG, директиви, доктрини, технічні вимоги, нормативи.
"Радіоелектронна боротьба" — РЕБ, придушення, глушіння, радар, радіорозвідка, електромагнітні завади, БПЛА-РЕБ.
"IT-термінологія" — все інше: загальні IT-концепції, програмування, БД, залізно-програмне забезпечення.`;

  const prompt = retryPrefix + `You are an elite Ukrainian military terminology extraction AI.
Extract ALL technical terms and their definitions from the text.

PRIORITY: defined terms (with —, –, :), numbered lists, abbreviations, equipment/system names.
RULES: Output ONLY valid JSON array. All text in UKRAINIAN. Copy definitions from text exactly.

${categoriesBlock}

Required JSON fields per object:
- "term": noun phrase (3-80 chars)
- "definition": exact definition from text (or your knowledge if absent)
- "category": one of the six above (EXACT string)
- "extended_info": 1-2 sentence military expert insight in Ukrainian

TEXT:
${text}

JSON:`;

  try {
    log('[AI] Відправка до Ollama...');
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, format: 'json', stream: false, options: { temperature: 0.1 } })
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    const output = data.response;

    try {
      const sanitized = output.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');

      const mapTerms = (arr) => arr.map(item => {
        if (typeof item === 'string') return { term: item, definition: 'Опис відсутній' };
        const termName   = item.term || item.Term || item.TERM || item.Concept || item.Name || '';
        const definition = item.definition || item.Definition || item.DEFINITION || item.Description || 'Опис відсутній';
        const rawCat     = item.category || item.Category || '';
        return { term: termName, definition,
          category: normalizeAndClassify(rawCat, termName, definition),
          extended_info: item.extended_info || item.extendedInfo || item.Insights || '' };
      }).filter(i => i.term);

      let extractedArray = [];
      try {
        const parsed = JSON.parse(sanitized.trim());
        const findArray = (obj) => {
          if (Array.isArray(obj)) return obj;
          if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) { const r = findArray(obj[key]); if (r && r.length) return r; }
          }
          return null;
        };
        extractedArray = findArray(parsed) || [];
        if (extractedArray.length === 0 && typeof parsed === 'object' && parsed !== null) {
          const extractFromDict = (obj) => {
            let arr = [];
            for (const k in obj) {
              if (typeof obj[k] === 'string') arr.push({ term: k, definition: obj[k] });
              else if (typeof obj[k] === 'object' && !Array.isArray(obj[k])) arr = arr.concat(extractFromDict(obj[k]));
            }
            return arr;
          };
          extractedArray = extractFromDict(parsed);
        }
      } catch (e) {
        const fi = sanitized.indexOf('['), li = sanitized.lastIndexOf(']');
        if (fi !== -1 && li > fi) {
          try { extractedArray = JSON.parse(sanitized.substring(fi, li + 1)); }
          catch (ie) { console.warn('Fallback JSON parse failed:', ie.message); }
        }
      }

      const terms = mapTerms(extractedArray);
      if (terms.length === 0 && !isRetry) { log('[AI] retry...'); return callLLMForTerms(text, true); }
      return terms;
    } catch (err) {
      if (!isRetry) return callLLMForTerms(text, true);
      console.error('Помилка парсингу JSON після retry:', err.message);
      return [];
    }
  } catch (e) {
    console.error('[AI] Помилка Ollama:', e.message);
    return [];
  }
}

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

async function processDocument(filePath, progressCallback = async () => {}, accessLevel = 'Public') {
  let text = '';
  const ext = filePath.split('.').pop().toLowerCase();
  await progressCallback(5, 'Зчитування тексту документа...');
  if      (ext === 'pdf')               text = await extractTextFromPDF(filePath);
  else if (ext === 'docx')              text = await extractTextFromDOCX(filePath);
  else if (ext === 'doc')               text = await extractTextFromDOC(filePath);
  else if (ext === 'xlsx' || ext === 'xls') text = await extractTextFromXLSX(filePath);
  else if (ext === 'txt')               text = fs.readFileSync(filePath, 'utf8');
  else throw new Error('Unsupported file type');

  const charCount = text.trim().length;
  log(`Extracted ${charCount} characters from ${filePath}`);
  if (charCount === 0) console.warn('Warning: Extracted text is empty.');
  text = cleanText(text);

  const uniqueTermsMap = new Map();

  // Прохід 1: Heuristic
  await progressCallback(15, 'Пошук явно визначених термінів (heuristic)...');
  const heuristicTerms = extractDefinedTermsHeuristic(text);
  log(`[Heuristic] Знайдено ${heuristicTerms.length} термінів`);
  for (const item of heuristicTerms) uniqueTermsMap.set(item.term.toLowerCase().trim(), item);
  if (heuristicTerms.length > 0)
    await progressCallback(20, `Heuristic: знайдено ${heuristicTerms.length} термінів. Запуск AI...`, heuristicTerms);

  // Прохід 2: LLM
  const MAX_CHARS = 3500, PARALLEL_CHUNKS = 3;
  const chunks = chunkText(text, MAX_CHARS).filter(c => c.trim().length > 50);
  await progressCallback(22, `Текст розбито на ${chunks.length} блоків. Запуск AI...`);
  let processedChunks = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL_CHUNKS) {
    const batch = chunks.slice(i, i + PARALLEL_CHUNKS);
    const batchResults = await Promise.all(batch.map(c => callLLMForTerms(c)));
    const newTerms = [];
    for (const terms of batchResults) {
      for (const item of terms) {
        const key = item.term.toLowerCase().trim();
        if (!uniqueTermsMap.has(key)) {
          item.definition_source_type = item.definition_source_type || 'Document';
          uniqueTermsMap.set(key, item); newTerms.push(item);
        } else {
          const ex = uniqueTermsMap.get(key);
          if ((item.definition || '').length > (ex.definition || '').length)
            uniqueTermsMap.set(key, { ...ex, definition: item.definition });
        }
      }
    }
    processedChunks += batch.length;
    const pct = 22 + Math.floor((processedChunks / chunks.length) * 70);
    const msg = `AI: блок ${processedChunks}/${chunks.length} — знайдено ${uniqueTermsMap.size} унікальних термінів`;
    await progressCallback(pct, msg, newTerms.length > 0 ? newTerms : null);
  }

  await progressCallback(95, 'Фіналізація результатів...');

  // Прохід 3: фінальна перевірка категорій keyword-класифікатором
  const uniqueTerms = Array.from(uniqueTermsMap.values()).map(item => {
    const kwCat = classifyTermByKeywords(item.term, item.definition);
    if (item.category === 'IT-термінологія' && kwCat !== 'IT-термінологія') {
      log(`[Classify] "${item.term}": IT-термінологія → ${kwCat} (keyword override)`);
      return { ...item, category: kwCat };
    }
    return item;
  });

  log(`[AI] Разом унікальних термінів: ${uniqueTerms.length}`);
  return uniqueTerms;
}

module.exports = { processDocument, generateDefinitionForTerm, classifyTermByKeywords };