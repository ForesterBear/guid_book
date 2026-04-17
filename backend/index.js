const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

function debugLog(message) {
  try {
    fs.appendFileSync(path.join(__dirname, 'upload-debug.log'), `${new Date().toISOString()} - ${message}\n`);
  } catch (err) {
    console.error('Debug log failed:', err);
  }
}

dotenv.config();

const { semanticSearch, addTermEmbedding } = require('./semanticSearch');
const { processDocument } = require('./ai');

const app = express();
const port = process.env.PORT || 3001;

// Request logger
app.use((req, res, next) => {
  const reqInfo = `Incoming request: ${req.method} ${req.url}`;
  console.log(reqInfo);
  debugLog(reqInfo);
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Error handling middleware for multer
app.use((error, req, res, next) => {
  const errorMsg = `Error handler triggered: ${error && error.message ? error.message : error}`;
  console.error(errorMsg);
  debugLog(errorMsg);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  } else if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'qwerty123',
  database: process.env.DB_NAME || 'guid_book',
  waitForConnections: true,
  connectionLimit: 1,
  queueLimit: 0,
});

// Test Database connection on startup
pool.getConnection()
  .then(connection => {
    console.log('✅ Successfully connected to MySQL database!');
    // Перевіряємо та додаємо колонку extended_info автоматично
    connection.query('ALTER TABLE terms ADD COLUMN extended_info TEXT')
      .then(() => console.log('✅ Стовпець extended_info успішно додано до БД.'))
      .catch(e => {
        if (e.code !== 'ER_DUP_FIELDNAME') {
          console.error('Помилка перевірки стовпця extended_info:', e.message);
        }
      });
    // Перевіряємо та додаємо колонку definition_source_type автоматично
    connection.query("ALTER TABLE terms ADD COLUMN definition_source_type VARCHAR(20) DEFAULT 'Document'")
      .then(() => console.log('✅ Стовпець definition_source_type успішно додано до БД.'))
      .catch(e => {
        if (e.code !== 'ER_DUP_FIELDNAME') {
          console.error('Помилка перевірки стовпця extended_info:', e.message);
        }
      });
    connection.release();
  })
  .catch(err => {
    console.error('❌ Failed to connect to MySQL database. Error:', err.message);
  });

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    console.log('Upload dir:', uploadDir);
    if (!fs.existsSync(uploadDir)) {
      console.log('Creating upload dir');
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    console.log('File originalname:', file.originalname, 'ext:', ext, 'mimetype:', file.mimetype);
    debugLog(`File upload filter: originalname=${file.originalname} ext=${ext} mimetype=${file.mimetype}`);
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Дозволені лише файли типів: PDF, DOCX, DOC, TXT, XLSX, XLS'));
    }
  }
});

// SSE endpoint for progress tracking
const progressClients = new Map();
app.get('/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Вимикаємо буферизацію
  res.flushHeaders(); // Миттєво встановлюємо з'єднання
  
  progressClients.set(taskId, res);
  
  req.on('close', () => {
    progressClients.delete(taskId);
  });
});

// Basic routes
app.get('/', (req, res) => {
  res.send('Informational Reference System Backend');
});

// File upload route with access level validation
app.post('/upload', upload.single('file'), async (req, res) => {
  const startMsg = 'Upload request received';
  console.log(startMsg);
  debugLog(startMsg);
  try {
    const { accessLevel } = req.body;
    const taskId = req.body.taskId;
    
    const updateProgress = (progress, message) => {
      if (taskId && progressClients.has(taskId)) {
        progressClients.get(taskId).write(`data: ${JSON.stringify({ progress, message })}\n\n`);
      }
    };

    console.log('Access level:', accessLevel);
    debugLog(`Access level: ${accessLevel}`);
    console.log('Authorization header:', req.headers.authorization);
    debugLog(`Authorization header: ${req.headers.authorization || 'none'}`);
    console.log('File:', req.file);
    debugLog(`File: ${req.file ? req.file.originalname : 'none'}`);
    if (!req.file) {
      const msg = 'No file uploaded';
      console.log(msg);
      debugLog(msg);
      return res.status(400).json({ error: msg });
    }
    console.log('After file check');
    debugLog('After file check');
    if (!accessLevel) {
      const msg = 'Access level (гриф обмеження) is required';
      console.log(msg);
      debugLog(msg);
      return res.status(400).json({ error: msg });
    }

    const filePath = req.file.path;
    console.log('filePath:', filePath);
    debugLog(`filePath: ${filePath}`);
    const filename = req.file.originalname;
    const fileType = path.extname(filename).slice(1);

    // Insert into database
    console.log('Getting connection');
    debugLog('Getting connection');
    const connection = await pool.getConnection();
    console.log('Got connection');
    debugLog('Got connection');
    console.log('Inserting into database');
    debugLog('Inserting into database');
    const [result] = await connection.query(
      'INSERT INTO sources (file_name, file_path, security_stamp, file_type) VALUES (?, ?, ?, ?)',
      [filename, filePath, accessLevel, fileType]
    );
    console.log('Inserted, result:', result);
    debugLog(`Inserted, insertId: ${result.insertId}`);
    const sourceId = result.insertId;
    console.log('SourceId:', sourceId);
    debugLog(`SourceId: ${sourceId}`);
    connection.release();

    console.log('About to process document');
    debugLog('About to process document');
    // Process document for terms
    try {
      updateProgress(5, 'Збереження файлу на сервері...');
      const terms = await processDocument(filePath, updateProgress);
      console.log('Terms extracted:', terms);
      debugLog(`Terms extracted: ${JSON.stringify(terms)}`);
      updateProgress(100, 'Завершено! Формування таблиці...');
      res.json({ message: 'File uploaded successfully', sourceId, pendingTerms: terms });
    } catch (aiError) {
      console.error('AI processing failed:', aiError);
      debugLog(`AI processing failed: ${aiError.message}`);
      res.json({ message: `File uploaded, but AI processing failed: ${aiError.message}`, sourceId });
    }
  } catch (error) {
    console.log('In catch');
    console.error('Upload error:', error);
    debugLog(`Upload error: ${error && error.message ? error.message : error}`);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Confirm terms
app.post('/confirm-terms', async (req, res) => {
  try {
    console.log(`[API] POST /confirm-terms - Отримано термінів: ${req.body.terms?.length || 0} для sourceId: ${req.body.sourceId}`);
    const { terms, sourceId } = req.body;
    const connection = await pool.getConnection();
    
    for (const term of terms) {
      console.log(`[DB] Додавання терміну: "${term.term}"`);
      const [result] = await connection.query(
        'INSERT INTO terms (term_name, definition, source_id, category, extended_info, definition_source_type) VALUES (?, ?, ?, ?, ?, ?)',
        [term.term, term.definition, sourceId, term.category || 'IT-термінологія', term.extended_info || '', term.definition_source_type || 'Document']
      );
      const termId = result.insertId;
      // Add to vector store
      console.log(`[AI] Створення векторного ембедингу для терміну ID: ${termId}`);
      await addTermEmbedding(termId, term.term, term.definition);
    }
    connection.release();
    console.log('[API] POST /confirm-terms - Всі терміни успішно збережені');
    res.json({ message: 'Terms confirmed and added' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

// Generate definition for a term
app.post('/generate-definition', async (req, res) => {
  try {
    const { termName } = req.body;
    if (!termName) {
      return res.status(400).json({ error: 'Term name is required' });
    }
    const { generateDefinitionForTerm } = require('./ai');
    const generatedData = await generateDefinitionForTerm(termName);
    res.json(generatedData);
  } catch (error) {
    res.status(500).json({ error: `Failed to generate definition: ${error.message}` });
  }
});

// Get source file
app.get('/source/:id', async (req, res) => {
  try {
    console.log(`[API] GET /source/${req.params.id} - Запит на отримання файлу джерела`);
    const { id } = req.params;
    const connection = await pool.getConnection();
    const [result] = await connection.query('SELECT file_path FROM sources WHERE id = ?', [id]);
    connection.release();
    
    if (result.length === 0) {
      console.log(`[API] GET /source/${req.params.id} - Помилка: Джерело не знайдено`);
      return res.status(404).json({ error: 'Source not found' });
    }
    console.log(`[API] GET /source/${req.params.id} - Файл знайдено, відправка: ${result[0].file_path}`);
    res.sendFile(result[0].file_path);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get source' });
  }
});

// Get terms
app.get('/terms', async (req, res) => {
  try {
    console.log(`[API] GET /terms - Запит на отримання актуальних термінів (Категорія: ${req.query.category || 'Всі'})`);
    const { category } = req.query;
    const connection = await pool.getConnection();
    
    let query = `
      SELECT t.*, s.file_type, s.security_stamp
      FROM terms t
      JOIN sources s ON t.source_id = s.id
    `;
    let params = [];
    if (category) {
      query += ` WHERE t.category = ?`;
      params.push(category);
    }
    const [result] = await connection.query(query, params);
    connection.release();
    console.log(`[API] GET /terms - Знайдено ${result.length} термінів`);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// Update term (Admin)
app.put('/terms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { term_name, definition, category, extended_info, is_actual, security_stamp } = req.body;
    const connection = await pool.getConnection();
    
    await connection.query(
      'UPDATE terms SET term_name = ?, definition = ?, category = ?, extended_info = ?, is_actual = ? WHERE id = ?',
      [term_name, definition, category, extended_info, is_actual, id]
    );

    if (security_stamp) {
      const [termRows] = await connection.query('SELECT source_id FROM terms WHERE id = ?', [id]);
      if (termRows.length > 0) {
        await connection.query('UPDATE sources SET security_stamp = ? WHERE id = ?', [security_stamp, termRows[0].source_id]);
      }
    }
    
    connection.release();
    console.log(`[API] PUT /terms/${id} - Термін успішно оновлено`);
    res.json({ message: 'Term updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// Delete term (Admin)
app.delete('/terms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await pool.getConnection();
    await connection.query('DELETE FROM terms WHERE id = ?', [id]);
    connection.release();
    console.log(`[API] DELETE /terms/${id} - Термін видалено`);
    res.json({ message: 'Term deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// Semantic search
app.get('/semantic-search', async (req, res) => {
  try {
    console.log(`[API] GET /semantic-search - Старт семантичного пошуку для: "${req.query.q}"`);
    const { q } = req.query;
    const results = await semanticSearch(q);
    console.log(`[API] GET /semantic-search - Пошук завершено. Знайдено ${results.length} результатів`);
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});
// Search terms (basic)
app.get('/search', async (req, res) => {
  try {
    console.log(`[API] GET /search - Старт звичайного пошуку для: "${req.query.q}"`);
    const { q } = req.query;
    const connection = await pool.getConnection();
    
    console.log(`[DB] Виконання пошуку LIKE %${q}% у БД`);
    const [result] = await connection.query(
      `SELECT t.*, s.file_type, s.security_stamp 
       FROM terms t 
       LEFT JOIN sources s ON t.source_id = s.id 
       WHERE t.term_name LIKE ? AND t.is_actual = ?`,
      [`%${q}%`, true]
    );
    // Log search
    console.log(`[DB] Логування історії пошуку`);
    await connection.query('INSERT INTO search_history (query_text) VALUES (?)', [q]);
    connection.release();
    
    console.log(`[API] GET /search - Знайдено ${result.length} термінів`);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});