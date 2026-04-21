const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const xlsx = require('xlsx');
const { spawn } = require('child_process');
const path = require('path');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Function to extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    console.log(`[Parse] Спроба парсингу PDF: ${filePath}`);
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
    console.log(`[Parse] Спроба парсингу DOCX: ${filePath}`);
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
    console.log(`[Parse] Спроба парсингу DOC за допомогою textract: ${filePath}`);
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
      console.log(`[Parse] Спроба парсингу XLSX/XLS: ${filePath}`);
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
  console.log(`[AI] Генерація визначення для терміну: "${termName}"`);
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

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', prompt, format: 'json', stream: false, options: { temperature: 0.5 } })
  });
  const data = await response.json();
  const parsed = JSON.parse(data.response.trim());
  return parsed;
}

// Function to call local LLM (Ollama) for term extraction
async function callLLMForTerms(text) {
    const prompt = `You are an expert military and IT data extraction AI for the Ukrainian Armed Forces.
Your task is to extract key terms and their definitions from the provided text.
You MUST respond with a valid JSON array of objects. The root of your response MUST be the array itself.

CRITICAL REQUIREMENT: YOU MUST TRANSLATE EVERYTHING TO UKRAINIAN. BOTH TERMS AND DEFINITIONS MUST BE IN UKRAINIAN.

Categories allowed EXACTLY:
- Системи зв’язку
- Кібербезпека
- Криптографія
- Нормативні акти
- Радіоелектронна боротьба
- IT-термінологія

Each object in the array MUST have EXACTLY four keys:
"term": the term name.
"definition": the exact definition from the text. If the definition is physically missing, unreadable, or torn across pages, output EXACTLY "Опис відсутній".
"category": the best matching category from the list above.
"extended_info": a 2-3 sentence technical explanation or context about the term for a specialist (AI insight).

Focus on extracting any concept that looks like a technical, military, or IT-related term. It is better to include a borderline term than to miss an important one.

Example of expected output EXACTLY:
[
  {
    "term": "Кібербезпека",
    "definition": "Захист систем від цифрових атак.",
    "category": "Кібербезпека",
    "extended_info": "Комплекс заходів, що включає захист мереж, пристроїв та даних від несанкціонованого доступу. Включає використання фаєрволів, антивірусів та систем виявлення вторгнень."
  }
]

If the text contains no relevant terms, you MUST return an empty array []. Do not include any introductory text or markdown formatting.

Text:
${text}

JSON Output (in Ukrainian):
`;

    try {
      console.log('[AI] Відправка запиту до Ollama HTTP API...');
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
          // Очищуємо вивід від усіх керуючих символів (0x00-0x1F), які гарантовано ламають JSON.parse
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
          return terms;

          if (terms.length === 0) {
            console.log('\n[AI] Увага: ШІ повернув порожній результат. Відповідь моделі (Raw output):', output.trim());
          }
        } catch (error) {
          console.error('Failed to parse LLM output:', error, '\nRaw output:', output);
          return [];
        }
    } catch (err) {
      console.error('[AI] Помилка з\'єднання з Ollama API:', err.message);
      return [];
    }
}

// Helper function to split text into chunks securely (tries to break at newlines or spaces)
function chunkText(text, maxLength) {
  const chunks = [];
  let currentIdx = 0;
  while (currentIdx < text.length) {
    let endIdx = currentIdx + maxLength;
    if (endIdx < text.length) {
      // Try to find a newline or space to break cleanly
      const lastNewline = text.lastIndexOf('\n', endIdx);
      const lastSpace = text.lastIndexOf(' ', endIdx);
      if (lastNewline > currentIdx + maxLength * 0.8) {
        endIdx = lastNewline;
      } else if (lastSpace > currentIdx + maxLength * 0.8) {
        endIdx = lastSpace;
      }
    }
    chunks.push(text.substring(currentIdx, endIdx));
    currentIdx = endIdx;
  }
  return chunks;
}

// Main function to process document and extract terms
async function processDocument(filePath, progressCallback = async () => {}) {
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

  console.log(`Extracted ${text.trim().length} characters from ${filePath}`);
  console.log(`[Parse] Попередній перегляд витягнутого тексту: "${text.substring(0, 200).replace(/\n/g, ' ')}..."\n`);
  
  if (text.trim().length === 0) {
    console.warn('Warning: Extracted text is empty. If this is a scanned PDF, you might need an OCR library.');
  }

  const MAX_CHARS = 8000; // Безпечний ліміт для вікна контексту моделі (llama3 має 8k токенів)
  const chunks = chunkText(text, MAX_CHARS);
  let allTerms = [];
  const uniqueTermsMap = new Map();

  await progressCallback(25, `Текст вилучено. Розбиття на ${chunks.length} логічних блоків...`);
  console.log(`[AI] Текст розділено на ${chunks.length} частин для обробки ШІ.`);

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[AI] Обробка частини ${i + 1} з ${chunks.length}...`);
    await progressCallback(25 + Math.floor((i / chunks.length) * 65), `ШІ аналізує частину ${i + 1} з ${chunks.length}...`);
    if (chunks[i].trim().length > 0) {
      const terms = await callLLMForTerms(chunks[i]);
      
      const newUniqueTerms = [];
      for (const item of terms) {
        const key = item.term.toLowerCase().trim();
        if (!uniqueTermsMap.has(key)) {
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
  console.log(`[AI] Загалом знайдено ${allTerms.length} термінів. Після видалення дублікатів залишилось: ${uniqueTerms.length}`);
  
  return uniqueTerms;
}

module.exports = { processDocument, generateDefinitionForTerm };