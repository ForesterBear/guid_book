const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const { spawn } = require('child_process');
const path = require('path');

// Function to extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    console.log(`[Parse] Спроба парсингу PDF: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.warn('pdf-parse failed to parse PDF, falling back to textract:', error.message);
    return extractTextFromDOC(filePath);
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

// Function to call local LLM (Ollama) for term extraction
function callLLMForTerms(text) {
  return new Promise((resolve, reject) => {
    const ollamaPath = process.env.OLLAMA_PATH || 'ollama';
    console.log('Using Ollama path:', ollamaPath);
    const ollama = spawn(ollamaPath, ['run', 'llama3', '--format', 'json'], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });

    const prompt = `You are a strict data extraction AI.
Your ONLY task is to extract key terms and their definitions from the text below.
You MUST respond with a valid JSON array of objects. Do NOT respond with a JSON object containing arrays. The root of your response MUST be the array itself.
DO NOT output a key-value dictionary (e.g. {"term": "definition"}).

CRITICAL REQUIREMENT: YOU MUST TRANSLATE EVERYTHING TO UKRAINIAN. BOTH TERMS AND DEFINITIONS MUST BE IN UKRAINIAN. NO ENGLISH ALLOWED.

Each object MUST have EXACTLY two keys: "term" and "definition".

Example of expected output EXACTLY:
[
  {"term": "Кібербезпека", "definition": "Захист систем від цифрових атак."},
  {"term": "Автентифікація", "definition": "Процес перевірки особи користувача."}
]

Extract at least 3-5 important concepts if possible. Do not include any introductory text or markdown formatting. If the text is absolute gibberish, return [].

Text:
${text}

JSON Output (in Ukrainian):
`;

    ollama.stdin.write(prompt);
    ollama.stdin.end();

    let output = '';
    ollama.stdout.on('data', (data) => {
      output += data.toString();
    });

    let errorOutput = '';
    ollama.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ollama.on('close', (code) => {
      if (errorOutput) {
        console.error('Ollama STDERR:', errorOutput);
      }

      if (code === 0) {
        try {
          let terms = [];
          // Очищуємо вивід від усіх керуючих символів (0x00-0x1F), які гарантовано ламають JSON.parse
          const sanitizedOutput = output.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');

          const mapTerms = (arr) => {
            return arr.map(item => {
              if (typeof item === 'string') return { term: item, definition: 'Опис відсутній (ШІ не надав визначення)' };
              return {
                term: item.term || item.Term || item.TERM || item.Concept || item.concept || item.Name || item.name || '',
                definition: item.definition || item.Definition || item.DEFINITION || item.Category || item.category || item.Description || item.description || 'Опис відсутній'
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
          resolve(terms);

          if (terms.length === 0) {
            console.log('\n[AI] Увага: ШІ повернув порожній результат. Відповідь моделі (Raw output):', output.trim());
          }
        } catch (error) {
          console.error('Failed to parse LLM output:', error, '\nRaw output:', output);
          resolve([]);
        }
      } else {
        reject(new Error(`Ollama process exited with code ${code}. Error: ${errorOutput}`));
      }
    });

    ollama.on('error', reject);
  });
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
async function processDocument(filePath) {
  let text = '';
  const ext = filePath.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    text = await extractTextFromPDF(filePath);
  } else if (ext === 'docx') {
    text = await extractTextFromDOCX(filePath);
  } else if (ext === 'doc') {
    text = await extractTextFromDOC(filePath);
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

  const MAX_CHARS = 20000; // Безпечний ліміт для вікна контексту моделі
  const chunks = chunkText(text, MAX_CHARS);
  let allTerms = [];

  console.log(`[AI] Текст розділено на ${chunks.length} частин для обробки ШІ.`);

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[AI] Обробка частини ${i + 1} з ${chunks.length}...`);
    if (chunks[i].trim().length > 0) {
      const terms = await callLLMForTerms(chunks[i]);
      allTerms = allTerms.concat(terms);
    }
  }

  // Видаляємо дублікати (без врахування регістру)
  const uniqueTermsMap = new Map();
  for (const item of allTerms) {
    const key = item.term.toLowerCase().trim();
    // Якщо є дублікат, залишаємо той варіант, де визначення довше і детальніше
    if (!uniqueTermsMap.has(key) || item.definition.length > uniqueTermsMap.get(key).definition.length) {
      uniqueTermsMap.set(key, item);
    }
  }
  
  const uniqueTerms = Array.from(uniqueTermsMap.values());
  console.log(`[AI] Загалом знайдено ${allTerms.length} термінів. Після видалення дублікатів залишилось: ${uniqueTerms.length}`);
  
  return uniqueTerms;
}

module.exports = { processDocument };