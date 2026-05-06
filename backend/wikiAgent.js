const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY; // optional

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

const WIKI_HEADERS = { 'User-Agent': 'GuidBook/1.0 (military glossary; contact@mitit.edu.ua)' };

// ── Generic safe fetch ──────────────────────────────────────────────────────
async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: WIKI_HEADERS,
      signal: AbortSignal.timeout(opts.timeout || 7000),
      ...opts,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log(`[WikiAgent] fetch error ${url}: ${e.message}`);
    return null;
  }
}

// ── Phase 1: direct title lookup ────────────────────────────────────────────
async function wikiSummaryBySlug(lang, slug) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  const data = await safeFetch(url);
  if (!data || data.type === 'disambiguation' || !data.extract) return null;
  return {
    extract: data.extract,
    image: data?.thumbnail?.source || data?.originalimage?.source || null,
    wikiUrl: data?.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${slug}`,
    lang,
  };
}

// ── Phase 2: Wikipedia Search API — exact phrase in quotes ──────────────────
async function wikiSearchExact(lang, termName) {
  // Wrap in quotes for exact phrase match
  const q = `"${termName}"`;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&utf8=1&origin=*`;
  const data = await safeFetch(url, { timeout: 8000 });
  const hits = data?.query?.search || [];
  for (const hit of hits) {
    const slug = hit.title.replace(/\s+/g, '_');
    const result = await wikiSummaryBySlug(lang, slug);
    if (result) return result;
  }
  return null;
}

// ── Wikipedia: try UK then EN, exact title then search ─────────────────────
async function fetchWikipediaData(termName) {
  const slug = termName.trim().replace(/\s+/g, '_');

  for (const lang of ['uk', 'en']) {
    // Phase 1 — exact title
    const direct = await wikiSummaryBySlug(lang, slug);
    if (direct) {
      log(`[WikiAgent] Wikipedia (${lang}) пряме співпадіння для "${termName}"`);
      return direct;
    }
    // Phase 2 — search with exact phrase
    const found = await wikiSearchExact(lang, termName);
    if (found) {
      log(`[WikiAgent] Wikipedia (${lang}) знайдено через пошук для "${termName}"`);
      return found;
    }
  }

  log(`[WikiAgent] Wikipedia: нічого не знайдено для "${termName}"`);
  return null;
}

// Backward-compat
async function fetchWikipediaImage(termName) {
  const data = await fetchWikipediaData(termName);
  return data?.image || null;
}

// ── DuckDuckGo Instant Answer — free, no key, exact phrase ─────────────────
async function fetchDuckDuckGo(termName) {
  // Exact phrase + military context
  const q = `"${termName}" ЗСУ військовий`;
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&kl=ua-ua`;
  const data = await safeFetch(url, { timeout: 7000, headers: { 'User-Agent': 'GuidBook/1.0' } });
  if (!data) return null;

  const abstract = data.Abstract || '';
  const abstractUrl = data.AbstractURL || '';
  const abstractSource = data.AbstractSource || '';

  if (abstract && abstract.length > 80) {
    log(`[WikiAgent] DuckDuckGo знайшов для "${termName}": ${abstract.substring(0, 60)}...`);
    return { text: abstract, url: abstractUrl, source: abstractSource };
  }
  return null;
}

// ── Optional Tavily (only when API key configured) ──────────────────────────
async function fetchTavily(termName) {
  if (!TAVILY_API_KEY) return [];
  // Exact term in quotes for precise search
  const query = `"${termName}" ЗСУ військова техніка тактика`;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', include_answer: false, max_results: 3 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    log(`[WikiAgent] Tavily error: ${e.message}`);
    return [];
  }
}

// ── Main enrichment ─────────────────────────────────────────────────────────
async function enrichTermWithWiki(termName, definition) {
  log(`[WikiAgent] Збагачення (військовий контекст): "${termName}"`);

  // Gather all sources in parallel
  const [wikiData, ddgData, tavilyResults] = await Promise.all([
    fetchWikipediaData(termName),
    fetchDuckDuckGo(termName),
    fetchTavily(termName),
  ]);

  const wikiExtract = wikiData?.extract || null;
  const wikiImage   = wikiData?.image   || null;
  const wikiUrl     = wikiData?.wikiUrl  || null;

  // Build context block for Ollama
  const contextParts = [];
  if (wikiExtract) {
    contextParts.push(`[Вікіпедія]\n${wikiExtract}`);
  }
  if (ddgData?.text) {
    contextParts.push(`[${ddgData.source || 'DuckDuckGo'}]\n${ddgData.text}`);
  }
  if (tavilyResults.length > 0) {
    contextParts.push(tavilyResults.map((r, i) => `[Веб-джерело ${i+1}: ${r.url}]\n${r.content}`).join('\n\n'));
  }

  const hasContext = contextParts.length > 0;
  const contextText = hasContext
    ? contextParts.join('\n\n')
    : 'Зовнішніх відкритих джерел не знайдено. Використовуй власні знання про застосування цього терміну в Збройних Силах України та стандартах НАТО.';

  // Build references
  const references = [];
  if (wikiUrl)    references.push({ title: `Вікіпедія: ${wikiData?.lang === 'uk' ? 'УК' : 'EN'} — ${termName}`, url: wikiUrl });
  if (ddgData?.url) references.push({ title: ddgData.source || 'DuckDuckGo', url: ddgData.url });
  tavilyResults.forEach(r => { if (r.url) references.push({ title: r.title || r.url, url: r.url }); });

  // ── Ollama: military-focused synthesis prompt ──
  const prompt = `Ти — старший військовий аналітик та укладач термінологічного словника Збройних Сил України з досвідом роботи з документацією НАТО та ЗСУ.

ТЕРМІН: "${termName}"
ВИЗНАЧЕННЯ З ДОКУМЕНТА ЗСУ: "${definition}"

ВІДКРИТІ ДЖЕРЕЛА (знайдено автоматично):
${contextText}

ЗАВДАННЯ:
Склади коротку ЕНЦИКЛОПЕДИЧНУ СТАТТЮ про цей термін у контексті ЗБРОЙНИХ СИЛ УКРАЇНИ.
Стаття повинна бути ВИКЛЮЧНО УКРАЇНСЬКОЮ МОВОЮ та містити:

1. ОГЛЯД (2–4 речення): Що це таке, яку роль виконує у ЗСУ або збройних силах НАТО, де застосовується.
2. ТАБЛИЦЯ у форматі Markdown (обов'язково):

| Характеристика | Значення / Опис | Стандарт / Аналог НАТО |
|---|---|---|
| Сфера застосування | ... | ... |
| Підрозділи ЗСУ | ... | ... |
| Нормативна база | ... | ... |

Додай 2–4 рядки відповідно до специфіки терміну "${termName}".

Відповідь ВИКЛЮЧНО у форматі JSON (без коментарів, без зайвого тексту):
{"encyclopedic_info": "...увесь markdown тут..."}`;

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
        options: { temperature: 0.15, num_predict: 900 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const raw = (data.response || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);
    encyclopedicInfo = parsed.encyclopedic_info || parsed.encyclopedicInfo || '';
  } catch (e) {
    console.error(`[WikiAgent] Ollama error for "${termName}":`, e.message);
    // Fallback: use raw Wikipedia text if available
    if (wikiExtract) {
      encyclopedicInfo = `${wikiExtract}\n\n*Автоматичний розширений аналіз тимчасово недоступний.*`;
    }
  }

  return {
    extended_info: encyclopedicInfo,
    wiki_image_url: wikiImage,
    references,
  };
}

module.exports = { enrichTermWithWiki, fetchWikipediaImage, fetchWikipediaData };
