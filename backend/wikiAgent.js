const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

async function searchWeb(query) {
  if (!TAVILY_API_KEY) {
    console.warn('[WikiAgent] ⚠️ TAVILY_API_KEY не налаштовано. Повертаємо порожній результат пошуку.');
    return [];
  }
  try {
    log(`[WikiAgent] Виконуємо запит до Tavily API: "${query}"`);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        include_answer: false,
        max_results: 3
      })
    });
    if (!response.ok) throw new Error(`Tavily API Error: ${response.status}`);
    const data = await response.json();
    return data.results || [];
  } catch (e) {
    console.error('[WikiAgent] Помилка пошуку:', e.message);
    return [];
  }
}

async function enrichTermWithWiki(termName, definition) {
  log(`[WikiAgent] Запуск OSINT-аналізу для терміну: ${termName}`);
  
  // 1. Формуємо пошуковий запит
  const searchQuery = `${termName} ТТХ характеристики військове обладнання`;
  const searchResults = await searchWeb(searchQuery);
  
  let contextText = '';
  let references = [];
  
  if (searchResults.length > 0) {
    contextText = searchResults.map((r, i) => `Джерело [${i+1}] (${r.url}):\n${r.content}`).join('\n\n');
    references = searchResults.map(r => ({ title: r.title, url: r.url }));
  } else {
    contextText = "Зовнішніх джерел не знайдено. Опирайся на власні знання щодо військової техніки та стандартів.";
  }

  // 2. Синтезуємо таблицю порівняння через Ollama
  const prompt = `You are an elite OSINT military analyst and engineer for the Ukrainian Armed Forces.
Term: "${termName}"
Base Definition: "${definition}"
Web Context:
${contextText}

Task: Create an advanced encyclopedic summary IN UKRAINIAN.
1. Write a 2-3 sentence technical overview.
2. Create a Markdown table comparing "${termName}" with modern NATO equivalents or modern commercial alternatives. Use columns: Характеристика | ${termName} | Аналог (НАТО/Сучасний).

Respond ONLY with a valid JSON in this format:
{
  "encyclopedic_info": "Markdown текст з таблицею..."
}`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', prompt, format: 'json', stream: false, options: { temperature: 0.2 } })
  });
  
  let parsed = {};
  try {
    if (!response.ok) throw new Error(`Ollama API Error: ${response.status}`);
    const data = await response.json();
    const cleanJson = (data.response || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch (error) {
    console.error('[WikiAgent] Помилка генерації або парсингу від Ollama:', error.message);
    parsed = { encyclopedic_info: "Інформація недоступна через помилку генерації ШІ." }; 
  }
  
  return { extended_info: parsed.encyclopedic_info || '', references };
}

module.exports = { enrichTermWithWiki };