const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY; // optional

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

// ── Wikipedia REST API ──────────────────────────────────────────────────────
// Returns { image, extract, wikiUrl } or null
async function fetchWikipediaData(termName) {
  // Wikipedia needs underscores, not spaces
  const slug = termName.trim().replace(/\s+/g, '_');
  const candidates = [
    `https://uk.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`,
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GuidBook/1.0 (educational project; contact@mitit.edu.ua)' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.type === 'disambiguation' || !data.extract) continue;

      const image = data?.thumbnail?.source || data?.originalimage?.source || null;
      const extract = data.extract || null;
      const wikiUrl = data.content_urls?.desktop?.page || url.replace('/api/rest_v1/page/summary/', '/wiki/');

      log(`[WikiAgent] Wikipedia знайшла "${termName}": extract=${extract?.length || 0} chars, image=${!!image}`);
      return { image, extract, wikiUrl };
    } catch (e) {
      log(`[WikiAgent] Wikipedia помилка для "${termName}": ${e.message}`);
    }
  }
  return null;
}

// Backward-compat alias (returns only image URL)
async function fetchWikipediaImage(termName) {
  const data = await fetchWikipediaData(termName);
  return data?.image || null;
}

// ── Optional Tavily search (used only if API key set) ───────────────────────
async function searchWeb(query) {
  if (!TAVILY_API_KEY) return [];
  try {
    log(`[WikiAgent] Tavily: "${query}"`);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', include_answer: false, max_results: 3 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Tavily ${response.status}`);
    const data = await response.json();
    return data.results || [];
  } catch (e) {
    log(`[WikiAgent] Tavily помилка: ${e.message}`);
    return [];
  }
}

// ── Main enrichment function ────────────────────────────────────────────────
async function enrichTermWithWiki(termName, definition) {
  log(`[WikiAgent] Збагачення: "${termName}"`);

  // 1. Wikipedia (fast, free)
  const wikiData = await fetchWikipediaData(termName);
  const wikiExtract = wikiData?.extract || null;
  const wikiImage  = wikiData?.image   || null;
  const wikiUrl    = wikiData?.wikiUrl  || null;

  // 2. Optional Tavily web search (only if key present)
  let tavilyResults = [];
  if (TAVILY_API_KEY) {
    tavilyResults = await searchWeb(`${termName} технічні характеристики`);
  }

  // 3. Build context for Ollama
  let contextParts = [];
  if (wikiExtract) {
    contextParts.push(`Вікіпедія:\n${wikiExtract}`);
  }
  if (tavilyResults.length > 0) {
    contextParts.push(tavilyResults.map((r, i) => `Джерело [${i+1}] (${r.url}):\n${r.content}`).join('\n\n'));
  }
  const contextText = contextParts.length > 0
    ? contextParts.join('\n\n')
    : 'Зовнішніх джерел не знайдено. Використовуй власні знання.';

  // Build references list
  const references = [];
  if (wikiUrl) references.push({ title: `Вікіпедія: ${termName}`, url: wikiUrl });
  tavilyResults.forEach(r => { if (r.url) references.push({ title: r.title || r.url, url: r.url }); });

  // 4. Ollama synthesis
  const prompt = `Ти — експерт-аналітик Збройних Сил України, який складає енциклопедичні статті.
Термін: "${termName}"
Базове визначення: "${definition}"

Додатковий контекст:
${contextText}

Завдання: Склади розширену енциклопедичну статтю ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ.
1. Напиши 2–3 речення технічного огляду (що це, де застосовується).
2. Склади таблицю Markdown з ключовими характеристиками або порівнянням з аналогами.
   Формат таблиці: | Параметр | ${termName} | Аналог / Стандарт |

Відповідь ТІЛЬКИ у форматі JSON:
{"encyclopedic_info": "...markdown текст з таблицею..."}`;

  let encyclopedicInfo = '';
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.2, num_predict: 800 },
      }),
      signal: AbortSignal.timeout(90000), // 90s max per term
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const clean = (data.response || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    encyclopedicInfo = parsed.encyclopedic_info || parsed.encyclopedic_info || '';
  } catch (e) {
    console.error(`[WikiAgent] Ollama помилка для "${termName}":`, e.message);
    // Fallback: if Wikipedia has extract, at least show that
    encyclopedicInfo = wikiExtract
      ? `${wikiExtract}\n\n_Розширений аналіз тимчасово недоступний._`
      : '';
  }

  return {
    extended_info: encyclopedicInfo,
    wiki_image_url: wikiImage,
    references,
  };
}

module.exports = { enrichTermWithWiki, fetchWikipediaImage, fetchWikipediaData };
