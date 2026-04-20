const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'qwerty123',
  database: process.env.DB_NAME || 'guid_book',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function getEmbedding(text) {
  try {
    console.log('Requesting embedding from Ollama API for text:', text.slice(0, 100).replace(/\n/g, ' '));
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    throw new Error(`Failed to fetch embedding: ${error.message}`);
  }
}

async function addTermEmbedding(termId, termName, definition) {
  try {
    console.log(`[Embed] Отримання вектора для терміну: ${termName}`);
    const embedding = await getEmbedding(`${termName}: ${definition}`);
    const connection = await pool.getConnection();

    console.log(`[Embed] Збереження вектора в БД для term_id: ${termId}`);
    await connection.query(
      'INSERT INTO term_embeddings (term_id, embedding, content, metadata) VALUES (?, ?, ?, ?)',
      [termId, JSON.stringify(embedding), `${termName}: ${definition}`, JSON.stringify({ termName })]
    );

    connection.release();
  } catch (error) {
    console.error(`[Embed] Помилка додавання ембедингу для term_id: ${termId}`, error);
    throw error; // Перекидаємо помилку, щоб викликаюча функція знала про збій
  }
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticSearch(query, k = 5) {
  try {
    console.log('Starting semantic search for query:', query);
    const queryEmbedding = await getEmbedding(query);
    console.log('Query embedding generated, length:', queryEmbedding.length);
    const connection = await pool.getConnection();

    const [rows] = await connection.query(
      'SELECT term_embeddings.id AS embedding_id, term_embeddings.embedding, terms.id AS term_id, terms.term_name, terms.definition, term_embeddings.content, term_embeddings.metadata, terms.source_id, sources.file_type FROM term_embeddings JOIN terms ON term_embeddings.term_id = terms.id JOIN sources ON terms.source_id = sources.id'
    );
    connection.release();

    const scored = rows.map(row => {
      const embedding = JSON.parse(row.embedding);
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { ...row, score };
    });

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(item => ({
        termId: item.term_id,
        termName: item.term_name,
        definition: item.definition,
        content: item.content,
        source_id: item.source_id,
        file_type: item.file_type,
        score: item.score,
      }));

    return results;
  } catch (error) {
    console.error('Semantic search error:', error);
    return [];
  }
}

module.exports = { addTermEmbedding, semanticSearch };