const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const path = require('path');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'qwerty123',
  database: process.env.DB_NAME || 'guid_book',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function getOllamaPath() {
  const path = process.env.OLLAMA_PATH || 'ollama';
  console.log('Using Ollama path:', path);
  return path;
}

async function getEmbedding(text) {
  return new Promise((resolve, reject) => {
    const ollamaPath = getOllamaPath();
    console.log('Requesting embedding from Ollama for text:', text.slice(0, 100).replace(/\n/g, ' '));
    const ollama = spawn(ollamaPath, ['run', 'nomic-embed-text', '--format', 'json', text], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });

    let output = '';
    let errorOutput = '';

    ollama.stdout.on('data', (data) => {
      output += data.toString();
    });

    ollama.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ollama.on('close', (code) => {
      console.log(`Ollama embedding process exited with code ${code}`);
      if (code === 0) {
        try {
          console.log('Ollama embedding raw output:', output.slice(0, 200));
          const embedding = JSON.parse(output);
          console.log('Parsed embedding length:', Array.isArray(embedding) ? embedding.length : 'unknown');
          resolve(embedding);
        } catch (error) {
          reject(new Error(`Failed to parse embedding output: ${error.message}\n${output}`));
        }
      } else {
        reject(new Error(`Ollama embedding process exited with code ${code}: ${errorOutput}`));
      }
    });

    ollama.on('error', (err) => {
      reject(err);
    });
  });
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