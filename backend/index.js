const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { authMiddleware, requireRole, generateTokens } = require('./auth');

// Вимикаємо console.log у Production середовищі для чистоти логів
if (process.env.NODE_ENV === 'production') {
  console.log = function () {};
  console.debug = function () {};
}

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
app.use(cookieParser());

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
const pool = require('./db');

// Test Database connection on startup
pool.getConnection()
  .then(async connection => {
    console.log('✅ Successfully connected to MySQL database!');
    try {
      // Перевіряємо та додаємо колонки автоматично
      await connection.query('ALTER TABLE terms ADD COLUMN category VARCHAR(100) DEFAULT "IT-термінологія"').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця category:', e.message); });
      await connection.query('ALTER TABLE terms ADD COLUMN extended_info TEXT').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця extended_info:', e.message); });
      await connection.query("ALTER TABLE terms ADD COLUMN definition_source_type VARCHAR(20) DEFAULT 'Document'").catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця definition_source_type:', e.message); });
      
      // Безпечне додавання нових колонок для користувачів
      await connection.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка додавання is_active:', e.message); });
      
      // Оновлення таблиці історії пошуку
      await connection.query('ALTER TABLE search_history ADD COLUMN type VARCHAR(50) DEFAULT "Пошук"').catch(e => {});

      // Створення таблиці обраного (якщо не існує)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, term_id INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_favorite (user_id, term_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
        )
      `);

      // Перевірка структури та автоматична міграція таблиці users
      const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'email'");
      if (columns.length === 0) {
        console.log('🔄 Оновлення структури таблиці users (міграція зі старої версії)...');
        await connection.query('ALTER TABLE users ADD COLUMN full_name VARCHAR(255) DEFAULT "Користувач"');
        await connection.query('ALTER TABLE users ADD COLUMN email VARCHAR(255)');
        await connection.query('ALTER TABLE users ADD COLUMN access_level VARCHAR(50) DEFAULT "Public"');
        await connection.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE');
        try { await connection.query('ALTER TABLE users MODIFY COLUMN username VARCHAR(100) NULL'); } catch(e){}
        console.log('✅ Таблицю users успішно оновлено.');
      }

      // Автоматичне створення першого адміністратора
      const [rows] = await connection.query('SELECT COUNT(*) as count FROM users WHERE email = ?', ['admin@mitit.edu.ua']);
      if (rows[0].count === 0) {
        const hash = await bcrypt.hash('qwerty123', 10);
        await connection.query(
          "INSERT INTO users (full_name, email, password_hash, role, access_level) VALUES (?, ?, ?, 'admin', 'Secret')",
          ['Михайло Кльоц', 'admin@mitit.edu.ua', hash]
        );
        console.log('✅ Створено адміністратора за замовчуванням: admin@mitit.edu.ua / пароль: qwerty123');
      }
    } catch (e) {
      console.error('Помилка перевірки БД:', e.message);
    } finally {
      connection.release();
    }
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
  const token = req.query.token;
  try {
    if (!token) throw new Error('Token is missing');
    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_here');
  } catch (err) {
    return res.status(401).send('Unauthorized');
  }
  
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

// Helper для визначення доступних грифів секретності для користувача
const getAllowedStamps = (accessLevel) => {
  if (accessLevel === 'Secret') return ['Public', 'DSP', 'Secret'];
  if (accessLevel === 'DSP') return ['Public', 'DSP'];
  return ['Public'];
};

// ── Auth routes (публічні) ──────────────────
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !email.endsWith('@mitit.edu.ua')) {
      return res.status(403).json({ error: 'Доступ дозволено лише для корпоративного домену @mitit.edu.ua' });
    }
    
    const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);

    if (users.length === 0) return res.status(401).json({ error: 'Користувача з таким email не знайдено або акаунт заблоковано' });
    const user = users[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Невірний пароль' });

    const { accessToken, refreshToken } = generateTokens(user);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({ accessToken, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, access_level: user.access_level } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

app.post('/auth/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'Немає refresh token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret_here');
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [decoded.id]);

    if (!rows.length) return res.status(401).json({ error: 'Користувача не знайдено' });

    const { accessToken } = generateTokens(rows[0]);
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Refresh token невалідний' });
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Вихід виконано' });
});

// ── Захищаємо всі наступні роути ───────────────────────────
app.use(authMiddleware);

// ── Мій Профіль (Зміна пароля) ─────────────────────────────
app.post('/auth/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Пароль має містити щонайменше 6 символів' });

    const [users] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });
    
    const valid = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Невірний поточний пароль' });
    
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Пароль успішно змінено' });
  } catch (e) {
    res.status(500).json({ error: 'Помилка сервера при зміні пароля' });
  }
});

// ── Обране (Favorites) ─────────────────────────────────────
app.get('/favorites', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, s.file_type, s.security_stamp FROM user_favorites uf
      JOIN terms t ON uf.term_id = t.id LEFT JOIN sources s ON t.source_id = s.id
      WHERE uf.user_id = ? ORDER BY uf.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Помилка отримання обраного' }); }
});

app.post('/favorites', async (req, res) => {
  try {
    const { termId } = req.body;
    const [existing] = await pool.query('SELECT id FROM user_favorites WHERE user_id = ? AND term_id = ?', [req.user.id, termId]);
    if (existing.length > 0) {
      await pool.query('DELETE FROM user_favorites WHERE id = ?', [existing[0].id]);
      res.json({ status: 'removed' });
    } else {
      await pool.query('INSERT INTO user_favorites (user_id, term_id) VALUES (?, ?)', [req.user.id, termId]);
      res.json({ status: 'added' });
    }
  } catch (e) { res.status(500).json({ error: 'Помилка оновлення обраного' }); }
});

// ── Історія активності (History) ───────────────────────────
app.get('/history', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, query_text as title, type, timestamp as time FROM search_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 30', [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Помилка історії' }); }
});

app.post('/history', async (req, res) => {
  try {
    const { query, type } = req.body;
    await pool.query('INSERT INTO search_history (user_id, query_text, type) VALUES (?, ?, ?)', [req.user.id, query, type || 'Пошук']);
    res.json({ status: 'added' });
  } catch (e) { res.status(500).json({ error: 'Помилка збереження історії' }); }
});

// ── Управління Користувачами (Admin) ───────────────────────
app.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, full_name as name, email, role, access_level as clearance, IF(is_active, "Активний", "Заблокований") as status FROM users');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка отримання користувачів' });
  }
});

app.post('/users', requireRole('admin'), async (req, res) => {
  try {
    const { full_name, email, password, role, access_level } = req.body;
    if (!email.endsWith('@mitit.edu.ua')) return res.status(400).json({ error: 'Тільки корпоративний домен @mitit.edu.ua' });
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role, access_level) VALUES (?, ?, ?, ?, ?)',
      [full_name, email, hash, role, access_level]
    );
    res.json({ message: 'Користувача створено' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Користувач з таким Email вже існує' });
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

app.put('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, clearance, status } = req.body;
    
    if (status === 'Заблокований' && parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Не можна заблокувати власний акаунт' });
    }

    await pool.query(
      'UPDATE users SET role = ?, access_level = ?, is_active = ? WHERE id = ?',
      [role, clearance, status === 'Активний' ? 1 : 0, id]
    );
    res.json({ message: 'Дані користувача оновлено' });
  } catch (err) {
    res.status(500).json({ error: 'Помилка оновлення' });
  }
});

app.delete('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Не можна видалити власний акаунт' });
    
    const connection = await pool.getConnection();
    // Видаляємо пов'язані дані для цілісності бази
    await connection.query('DELETE FROM search_history WHERE user_id = ?', [id]);
    await connection.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
    await connection.query('DELETE FROM users WHERE id = ?', [id]);
    connection.release();
    
    res.json({ message: 'Користувача видалено' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Помилка видалення користувача' });
  }
});

// Аналітичний дашборд
app.get('/analytics', async (req, res) => {
  try {
    const allowedStamps = getAllowedStamps(req.user.access_level);
    const connection = await pool.getConnection();
    
    // Статистика по категоріях
    const [catRows] = await connection.query(`
      SELECT 
          CASE 
              WHEN t.category IN ('Системи зв’язку', 'Кібербезпека', 'Криптографія', 'Нормативні акти', 'Радіоелектронна боротьба') THEN t.category 
              ELSE 'IT-термінологія' 
          END AS category_name,
          COUNT(t.id) AS total_terms,
          ROUND(IFNULL(SUM(CASE WHEN t.is_actual = 1 THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(t.id), 0), 0)) AS actual_percent,
          SUM(CASE WHEN s.security_stamp = 'Public' THEN 1 ELSE 0 END) AS count_open,
          SUM(CASE WHEN s.security_stamp = 'DSP' THEN 1 ELSE 0 END) AS count_dsk,
          SUM(CASE WHEN s.security_stamp = 'Secret' THEN 1 ELSE 0 END) AS count_secret
      FROM terms t
      LEFT JOIN sources s ON t.source_id = s.id
      WHERE s.security_stamp IN (?)
      GROUP BY category_name
    `, [allowedStamps]);

    // Глобальна статистика
    const [globalRows] = await connection.query(`
      SELECT 
          COUNT(t.id) AS total_terms,
          ROUND(IFNULL(SUM(CASE WHEN t.is_actual = 1 THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(t.id), 0), 0)) AS actual_percent,
          SUM(CASE WHEN t.definition_source_type = 'AI-Generated' THEN 1 ELSE 0 END) AS ai_processed
      FROM terms t
      LEFT JOIN sources s ON t.source_id = s.id
      WHERE s.security_stamp IN (?)
    `, [allowedStamps]);

    connection.release();

    const categoryStats = {};
    catRows.forEach(row => {
      categoryStats[row.category_name || 'IT-термінологія'] = {
        total: row.total_terms,
        actualPercentage: row.actual_percent,
        publicCount: row.count_open || 0,
        dsp: row.count_dsk || 0,
        secret: row.count_secret || 0
      };
    });

    res.json({
      global: {
        total: globalRows[0]?.total_terms || 0,
        actualPercentage: globalRows[0]?.actual_percent || 0,
        aiProcessed: globalRows[0]?.ai_processed || 0
      },
      categories: categoryStats
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// File upload route with access level validation
app.post('/upload', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  const startMsg = 'Upload request received';
  console.log(startMsg);
  debugLog(startMsg);
  try {
    const { accessLevel } = req.body;
    const taskId = req.body.taskId;
    
    const updateProgress = async (progress, message, newTerms = null, sourceId = null) => {
      try {
        if (newTerms && newTerms.length > 0) {
          const connection = await pool.getConnection();
          for (let t of newTerms) {
            const [rows] = await connection.query('SELECT id FROM terms WHERE LOWER(term_name) = LOWER(?) LIMIT 1', [t.term]);
            if (rows.length > 0) {
              t.exists_in_db = true; // Сигналізуємо фронтенду, що це дублікат
            }
          }
          connection.release();
        }
      } catch (e) {
        console.error('[DB] Помилка перевірки на дублікати:', e.message);
      }
      if (taskId && progressClients.has(taskId)) {
        progressClients.get(taskId).write(`data: ${JSON.stringify({ progress, message, newTerms, sourceId })}\n\n`);
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
app.post('/confirm-terms', requireRole('admin', 'operator'), async (req, res) => {
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
    res.status(500).json({ error: `Збій при збереженні: ${error.message}` });
  }
});

// Generate definition for a term
app.post('/generate-definition', requireRole('admin', 'operator'), async (req, res) => {
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
app.get('/source/:id', requireRole('admin', 'operator', 'user'), async (req, res) => {
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
    const { category, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const allowedStamps = getAllowedStamps(req.user.access_level);
    const connection = await pool.getConnection();
    
    let query = `
      SELECT t.*, s.file_type, s.security_stamp
      FROM terms t
      JOIN sources s ON t.source_id = s.id
      WHERE s.security_stamp IN (?)
    `;
    let params = [allowedStamps];
    if (category) {
      if (category === 'IT-термінологія') {
        query += ` AND (t.category = ? OR t.category IS NULL OR t.category NOT IN ('Системи зв’язку', 'Кібербезпека', 'Криптографія', 'Нормативні акти', 'Радіоелектронна боротьба'))`;
        params.push(category);
      } else {
        query += ` AND t.category = ?`;
        params.push(category);
      }
    }
    
    // Запит на підрахунок загальної кількості
    const countQuery = query.replace('SELECT t.*, s.file_type, s.security_stamp', 'SELECT COUNT(*) as total');
    const [countResult] = await connection.query(countQuery, params);

    // Додаємо пагінацію та сортування
    query += ` ORDER BY t.term_name ASC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [result] = await connection.query(query, params);
    connection.release();
    res.json({ terms: result, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// Update term (Admin)
app.put('/terms/:id', requireRole('admin'), async (req, res) => {
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
app.delete('/terms/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await pool.getConnection();
    
    // Спочатку обов'язково видаляємо пов'язані вектори ШІ (Foreign Key constraint)
    await connection.query('DELETE FROM term_embeddings WHERE term_id = ?', [id]);
    
    // Після цього безпечно видаляємо сам термін
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
    const allowedStamps = getAllowedStamps(req.user.access_level);
    const results = await semanticSearch(q, allowedStamps);
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
    const allowedStamps = getAllowedStamps(req.user.access_level);
    const connection = await pool.getConnection();
    
    console.log(`[DB] Виконання пошуку LIKE %${q}% у БД`);
    const [result] = await connection.query(
      `SELECT t.*, s.file_type, s.security_stamp 
       FROM terms t 
       LEFT JOIN sources s ON t.source_id = s.id 
       WHERE t.term_name LIKE ? AND t.is_actual = ? AND s.security_stamp IN (?)`,
      [`%${q}%`, true, allowedStamps]
    );
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