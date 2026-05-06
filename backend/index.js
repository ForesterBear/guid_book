const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireRole, generateTokens } = require('./auth');

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

dotenv.config();

const { semanticSearch, addTermEmbedding } = require('./semanticSearch');
const { processDocument } = require('./ai');
const { enrichTermWithWiki } = require('./wikiAgent');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['http://localhost', 'http://frontend']
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Error handling middleware for multer
app.use((error, req, res, next) => {
  console.error(`Upload error: ${error.message}`);
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
    log('✅ Successfully connected to MySQL database!');
    try {
      // Перевіряємо та додаємо колонки автоматично
      await connection.query('ALTER TABLE terms ADD COLUMN category VARCHAR(100) DEFAULT "IT-термінологія"').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця category:', e.message); });
      await connection.query('ALTER TABLE terms ADD COLUMN extended_info TEXT').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця extended_info:', e.message); });
      await connection.query("ALTER TABLE terms ADD COLUMN definition_source_type VARCHAR(20) DEFAULT 'Document'").catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця definition_source_type:', e.message); });
      await connection.query('ALTER TABLE terms ADD COLUMN wiki_image_url TEXT DEFAULT NULL').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка перевірки стовпця wiki_image_url:', e.message); });
      
      // Безпечне додавання нових колонок для користувачів
      await connection.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('Помилка додавання is_active:', e.message); });
      
      // Оновлення таблиці історії пошуку
      await connection.query('ALTER TABLE search_history ADD COLUMN type VARCHAR(50) DEFAULT "Пошук"').catch(e => {});

      // Створення таблиці обраного (якщо не існує)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS favorites (
          id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, term_id INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_favorite (user_id, term_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
        )
      `);

      // Створення таблиці посилань для Wiki-Explorer
      await connection.query(`
        CREATE TABLE IF NOT EXISTS term_references (
          id INT AUTO_INCREMENT PRIMARY KEY, term_id INT NOT NULL,
          source_name VARCHAR(255), source_url TEXT,
          FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
        )
      `);

      // Статус обробки джерела
      await connection.query(
        "ALTER TABLE sources ADD COLUMN processing_status VARCHAR(20) DEFAULT 'confirmed'"
      ).catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error('processing_status:', e.message); });

      // Таблиця чернеток термінів (зберігаються після AI, до підтвердження користувачем)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS draft_terms (
          id INT AUTO_INCREMENT PRIMARY KEY,
          source_id INT NOT NULL,
          term_name VARCHAR(500) NOT NULL,
          definition TEXT,
          category VARCHAR(100) DEFAULT 'IT-термінологія',
          extended_info TEXT,
          wiki_image_url TEXT,
          definition_source_type VARCHAR(20) DEFAULT 'AI-Generated',
          references_json JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
        )
      `);

      // Перевірка структури та автоматична міграція таблиці users
      const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'email'");
      if (columns.length === 0) {
        log('🔄 Оновлення структури таблиці users (міграція зі старої версії)...');
        await connection.query('ALTER TABLE users ADD COLUMN full_name VARCHAR(255) DEFAULT "Користувач"');
        await connection.query('ALTER TABLE users ADD COLUMN email VARCHAR(255)');
        await connection.query('ALTER TABLE users ADD COLUMN access_level VARCHAR(50) DEFAULT "Public"');
        await connection.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE');
        try { await connection.query('ALTER TABLE users MODIFY COLUMN username VARCHAR(100) NULL'); } catch(e){}
        log('✅ Таблицю users успішно оновлено.');
      }

      // Автоматичне створення першого адміністратора
      const [rows] = await connection.query('SELECT COUNT(*) as count FROM users WHERE email = ?', ['admin@mitit.edu.ua']);
      if (rows[0].count === 0) {
        const hash = await bcrypt.hash('qwerty123', 10);
        await connection.query(
          "INSERT INTO users (full_name, email, password_hash, role, access_level, is_active) VALUES (?, ?, ?, 'admin', 'Secret', 1)",
          ['Адміністратор', 'admin@mitit.edu.ua', hash]
        );
        log('✅ Створено адміністратора за замовчуванням: admin@mitit.edu.ua / пароль: qwerty123');
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
    if (!fs.existsSync(uploadDir)) {
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
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 МБ максимум
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
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
    jwt.verify(token, process.env.JWT_SECRET);
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 10, // максимум 10 спроб
  message: { error: 'Забагато спроб входу. Спробуйте через 15 хвилин.' }
});

// ── Auth routes (публічні) ──────────────────
app.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.endsWith('@mitit.edu.ua')) {
      return res.status(403).json({ error: 'Доступ дозволено лише для корпоративного домену @mitit.edu.ua' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Пароль є обов\'язковим' });
    }
    
    const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND (is_active = 1 OR is_active IS NULL)', [cleanEmail]);

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
    res.status(500).json({ error: `Внутрішня помилка сервера: ${error.message}` });
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
      SELECT t.*, s.file_type, s.security_stamp,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', tr.source_name, 'url', tr.source_url)) FROM term_references tr WHERE tr.term_id = t.id) as refs
      FROM favorites uf
      JOIN terms t ON uf.term_id = t.id LEFT JOIN sources s ON t.source_id = s.id
      WHERE uf.user_id = ? ORDER BY uf.created_at DESC
    `, [req.user.id]);
    res.json(rows.map(row => ({ ...row, references: row.refs ? (typeof row.refs === 'string' ? JSON.parse(row.refs) : row.refs) : [] })));
  } catch (e) { res.status(500).json({ error: 'Помилка отримання обраного' }); }
});

app.post('/favorites/:termId', async (req, res) => {
  try {
    await pool.query('INSERT IGNORE INTO favorites (user_id, term_id) VALUES (?, ?)', [req.user.id, req.params.termId]);
    res.json({ message: 'Додано до улюблених' });
  } catch (e) { res.status(500).json({ error: 'Помилка оновлення обраного' }); }
});

app.delete('/favorites/:termId', async (req, res) => {
  try {
    await pool.query('DELETE FROM favorites WHERE user_id = ? AND term_id = ?', [req.user.id, req.params.termId]);
    res.json({ message: 'Видалено з улюблених' });
  } catch (e) { res.status(500).json({ error: 'Помилка видалення обраного' }); }
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

app.delete('/history', async (req, res) => {
  try {
    await pool.query('DELETE FROM search_history WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Історію очищено' });
  } catch (e) { res.status(500).json({ error: 'Помилка очищення історії' }); }
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
    
    if (!full_name || full_name.length < 2 || full_name.length > 255) return res.status(400).json({ error: 'Некоректне ім\'я' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некоректний email' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль мінімум 8 символів' });

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
    
    // Видаляємо пов'язані дані для цілісності бази
    await pool.query('DELETE FROM search_history WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ message: 'Користувача видалено' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Помилка видалення користувача' });
  }
});

// Нормалізація назви категорії (усуває різницю між U+0027 та U+2019 апострофами)
const KNOWN_CATEGORIES = [
  "Системи зв’язку",   // U+2019 = Ukrainian apostrophe (як в AI-промпті)
  'Кібербезпека',
  'Криптографія',
  'Нормативні акти',
  'Радіоелектронна боротьба',
  'IT-термінологія',
];
const normalizeCategory = (cat) => {
  if (!cat) return 'IT-термінологія';
  // Нормалізуємо будь-який варіант апострофа до U+2019
  const norm = cat.replace(/['‘ʼ]/g, "\u2019").trim();
  return KNOWN_CATEGORIES.includes(norm) ? norm : 'IT-термінологія';
};

// Отримання статистики
app.get('/stats', async (req, res) => {
  try {
    const allowedStamps = getAllowedStamps(req.user.access_level);
    const placeholders = allowedStamps.map(() => '?').join(',');

    // Отримуємо сирі категорії — нормалізація відбувається в JS
    const [rows] = await pool.query(
      `SELECT t.category,
              COUNT(*) as total,
              SUM(COALESCE(t.is_actual, 1)) as actual,
              SUM(t.definition_source_type = 'AI-Generated') as ai_generated
       FROM terms t
       LEFT JOIN sources s ON t.source_id = s.id
       WHERE (s.security_stamp IN (${placeholders}) OR t.source_id IS NULL)
       GROUP BY t.category`,
      allowedStamps
    );

    // Агрегуємо по нормалізованих назвах, завжди повертаємо всі 6 категорій
    const agg = {};
    for (const cat of KNOWN_CATEGORIES) {
      agg[cat] = { category: cat, total: 0, actual: 0, ai_generated: 0 };
    }
    for (const row of rows) {
      const key = normalizeCategory(row.category);
      agg[key].total      += Number(row.total)        || 0;
      agg[key].actual     += Number(row.actual)       || 0;
      agg[key].ai_generated += Number(row.ai_generated) || 0;
    }
    res.json(Object.values(agg));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// File upload route with access level validation
app.post('/upload', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  try {
    const { accessLevel } = req.body;
    const taskId = req.body.taskId;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!accessLevel) return res.status(400).json({ error: 'Access level (гриф обмеження) is required' });

    const filePath = req.file.path;
    const filename = req.file.originalname;
    const fileType = path.extname(filename).slice(1);

    const [result] = await pool.query(
      'INSERT INTO sources (file_name, file_path, security_stamp, file_type) VALUES (?, ?, ?, ?)',
      [filename, filePath, accessLevel, fileType]
    );
    const sourceId = result.insertId;

    // Відповідаємо ОДРАЗУ — клієнт більше не чекає на обробку через HTTP
    res.json({ message: 'File accepted, processing started in background', sourceId, taskId });

    // Фонова обробка (не блокує HTTP-з'єднання)
    const sendSSE = async (progress, message, newTerms = null) => {
      try {
        if (newTerms && newTerms.length > 0) {
          for (const t of newTerms) {
            const [rows] = await pool.query('SELECT id FROM terms WHERE LOWER(term_name) = LOWER(?) LIMIT 1', [t.term]);
            if (rows.length > 0) t.exists_in_db = true;
          }
        }
      } catch (e) {
        console.error('[DB] Помилка перевірки дублікатів:', e.message);
      }
      if (taskId && progressClients.has(taskId)) {
        progressClients.get(taskId).write(`data: ${JSON.stringify({ progress, message, newTerms, sourceId })}\n\n`);
      }
    };

    setImmediate(async () => {
      try {
        // Позначаємо джерело як "в обробці"
        await pool.query("UPDATE sources SET processing_status='processing' WHERE id=?", [sourceId]);

        await sendSSE(5, 'Файл збережено. Починаємо аналіз тексту...');
        let terms = await processDocument(filePath, sendSSE, accessLevel);

        // ── OSINT-збагачення (тільки для Public документів) ────────────────
        if (accessLevel === 'Public' && terms.length > 0) {
          const totalTerms = terms.length;
          await sendSSE(93, `OSINT: аналізуємо ${totalTerms} термінів через Вікіпедію та ШІ...`);

          // Збагачуємо ВСІ терміни пакетами по 3 (Wikipedia + Ollama для кожного)
          const ENRICH_BATCH = 3;
          let enriched = 0;
          for (let i = 0; i < terms.length; i += ENRICH_BATCH) {
            const batch = terms.slice(i, i + ENRICH_BATCH);
            const results = await Promise.all(
              batch.map(t => enrichTermWithWiki(t.term, t.definition).catch(e => {
                console.error(`[OSINT] Помилка для "${t.term}":`, e.message);
                return null;
              }))
            );
            results.forEach((result, j) => {
              if (!result) return;
              const term = batch[j];
              if (result.extended_info) term.extended_info = result.extended_info;
              if (result.wiki_image_url) term.wiki_image_url = result.wiki_image_url;
              if (result.references?.length) term.references = result.references;
            });
            enriched = Math.min(i + ENRICH_BATCH, terms.length);
            const pct = 93 + Math.round((enriched / terms.length) * 6);
            await sendSSE(Math.min(pct, 99), `OSINT: збагачено ${enriched}/${totalTerms} термінів...`);
          }
        }

        // ── Зберігаємо чернетки в БД (стійкість при закритті браузера) ──────
        await pool.query('DELETE FROM draft_terms WHERE source_id = ?', [sourceId]);
        for (const t of terms) {
          await pool.query(
            `INSERT INTO draft_terms
              (source_id, term_name, definition, category, extended_info, wiki_image_url, definition_source_type, references_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sourceId,
              t.term,
              t.definition || '',
              t.category || 'IT-термінологія',
              t.extended_info || '',
              t.wiki_image_url || null,
              t.definition_source_type || 'AI-Generated',
              t.references?.length ? JSON.stringify(t.references) : null,
            ]
          );
        }
        await pool.query("UPDATE sources SET processing_status='pending_review' WHERE id=?", [sourceId]);
        console.log(`[Upload] Збережено ${terms.length} чернеток для source #${sourceId}`);

        // Фінальна SSE-подія — pendingTerms для real-time верифікації
        if (taskId && progressClients.has(taskId)) {
          progressClients.get(taskId).write(`data: ${JSON.stringify({
            progress: 100,
            message: 'Завершено! Формування таблиці...',
            done: true,
            pendingTerms: terms,
            sourceId
          })}\n\n`);
        }
      } catch (aiError) {
        console.error('[Upload] AI processing failed:', aiError);
        await pool.query("UPDATE sources SET processing_status='failed' WHERE id=?", [sourceId]).catch(() => {});
        if (taskId && progressClients.has(taskId)) {
          progressClients.get(taskId).write(`data: ${JSON.stringify({
            progress: 100,
            message: 'Помилка обробки ШІ',
            done: true,
            error: aiError.message,
            sourceId
          })}\n\n`);
        }
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Confirm terms
app.post('/confirm-terms', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { terms, sourceId } = req.body;
    
    for (const term of terms) {
      const [result] = await pool.query(
        'INSERT INTO terms (term_name, definition, source_id, category, extended_info, definition_source_type, wiki_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [term.term, term.definition, sourceId, term.category || 'IT-термінологія', term.extended_info || '', term.definition_source_type || 'Document', term.wiki_image_url || null]
      );
      const termId = result.insertId;

      // Зберігаємо посилання Wiki-Агента
      if (term.references && term.references.length > 0) {
        for (const ref of term.references) {
          await pool.query(
            'INSERT INTO term_references (term_id, source_name, source_url) VALUES (?, ?, ?)',
            [termId, ref.title || 'OSINT Джерело', ref.url]
          );
        }
      }

      // Add to vector store
      await addTermEmbedding(termId, term.term, term.definition);
    }
    // Очищаємо чернетки і оновлюємо статус джерела
    await pool.query('DELETE FROM draft_terms WHERE source_id = ?', [sourceId]);
    await pool.query("UPDATE sources SET processing_status='confirmed' WHERE id=?", [sourceId]);

    res.json({ message: 'Terms confirmed and added' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Збій при збереженні: ${error.message}` });
  }
});

// Pending sources — документи що чекають на підтвердження термінів
app.get('/pending-sources', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.file_name, s.security_stamp, s.upload_date,
              COUNT(d.id) as draft_count
       FROM sources s
       JOIN draft_terms d ON d.source_id = s.id
       WHERE s.processing_status = 'pending_review'
       GROUP BY s.id
       ORDER BY s.upload_date DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Помилка отримання незавершених документів' });
  }
});

// Draft terms — повертає чернетки для конкретного джерела (відновлення після закриття браузера)
app.get('/draft-terms/:sourceId', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { sourceId } = req.params;
    const [source] = await pool.query('SELECT * FROM sources WHERE id = ?', [sourceId]);
    if (!source.length) return res.status(404).json({ error: 'Джерело не знайдено' });

    const [drafts] = await pool.query(
      'SELECT * FROM draft_terms WHERE source_id = ? ORDER BY id',
      [sourceId]
    );

    const terms = drafts.map(d => ({
      localId: d.id,
      term: d.term_name,
      definition: d.definition,
      category: d.category,
      extended_info: d.extended_info,
      wiki_image_url: d.wiki_image_url,
      definition_source_type: d.definition_source_type,
      references: d.references_json
        ? (typeof d.references_json === 'string' ? JSON.parse(d.references_json) : d.references_json)
        : [],
    }));

    res.json({ sourceId: Number(sourceId), source: source[0], terms });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Помилка завантаження чернеток' });
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

// Wiki-Explorer Agent Endpoint — збагачує термін і зберігає в БД якщо є termId
app.post('/wiki-enrich', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { termName, definition, termId } = req.body;
    if (!termName) return res.status(400).json({ error: 'Term name is required' });

    const generatedData = await enrichTermWithWiki(termName, definition || '');

    // Якщо передано termId — зберігаємо результат в БД
    if (termId && (generatedData.extended_info || generatedData.wiki_image_url)) {
      await pool.query(
        'UPDATE terms SET extended_info = ?, wiki_image_url = ? WHERE id = ?',
        [generatedData.extended_info || '', generatedData.wiki_image_url || null, termId]
      );
      // Зберігаємо нові посилання (видаляємо старі спочатку)
      if (generatedData.references?.length) {
        await pool.query('DELETE FROM term_references WHERE term_id = ?', [termId]);
        for (const ref of generatedData.references) {
          await pool.query(
            'INSERT INTO term_references (term_id, source_name, source_url) VALUES (?, ?, ?)',
            [termId, ref.title || 'OSINT', ref.url]
          );
        }
      }
      console.log(`[WikiEnrich] Збережено збагачення для term #${termId}`);
    }

    res.json(generatedData);
  } catch (error) {
    res.status(500).json({ error: `Failed to run OSINT Agent: ${error.message}` });
  }
});

// Get source file
app.get('/source/:id', requireRole('admin', 'operator', 'user'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('SELECT file_path FROM sources WHERE id = ?', [id]);
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    res.sendFile(result[0].file_path);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get source' });
  }
});

// Get terms
app.get('/terms', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 50 } = req.query;
    const parsedLimit = parseInt(limit) || 50;
    const offset = (parseInt(page) - 1) * parsedLimit;
    const allowedStamps = getAllowedStamps(req.user.access_level);
    
    const placeholders = allowedStamps.map(() => '?').join(',');
    let whereClause = `WHERE s.security_stamp IN (${placeholders})`;
    let params = [...allowedStamps];
    
    if (category) {
      if (category === 'IT-термінологія') {
        // Виключаємо всі відомі категорії (нормалізуємо апостроф через REPLACE)
        const otherCats = KNOWN_CATEGORIES.filter(c => c !== 'IT-термінологія');
        // У БД може бути U+2019 або U+0027 — нормалізуємо обидва боки
        const otherNorm = otherCats.map(c => c.replace(/\u2019/g, "'")); // U+2019 → U+0027 для порівняння
        const otherPlaceholders = otherCats.map(() => '?').join(',');
        whereClause += ` AND (REPLACE(t.category, CHAR(8217), CHAR(39)) NOT IN (${otherPlaceholders}) OR t.category IS NULL)`;
        params.push(...otherNorm);
      } else {
        // Нормалізоване порівняння: шукаємо і по U+2019 і по U+0027
        whereClause += ` AND REPLACE(t.category, CHAR(8217), CHAR(39)) = ?`;
        params.push(category.replace(/\u2019/g, "'"));  // U+2019 → U+0027
      }
    }
    
    if (search) {
      whereClause += ` AND (t.term_name LIKE ? OR t.category LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    // Запит на підрахунок загальної кількості
    const countQuery = `SELECT COUNT(*) as total FROM terms t JOIN sources s ON t.source_id = s.id ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);

    // Додаємо пагінацію та сортування
    const query = `
      SELECT t.*, s.file_type, s.security_stamp,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', tr.source_name, 'url', tr.source_url)) FROM term_references tr WHERE tr.term_id = t.id) as refs
      FROM terms t
      JOIN sources s ON t.source_id = s.id
      ${whereClause}
      ORDER BY t.term_name ASC LIMIT ${parsedLimit} OFFSET ${offset}
    `;

    const [result] = await pool.query(query, params);
    
    const mappedResult = result.map(row => ({ ...row, references: row.refs ? (typeof row.refs === 'string' ? JSON.parse(row.refs) : row.refs) : [] }));
    res.json({ terms: mappedResult, total: countResult[0].total, page: parseInt(page), limit: parsedLimit, totalPages: Math.ceil(countResult[0].total / parsedLimit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// Update term (Admin)
app.put('/terms/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { term_name, definition, category, extended_info, is_actual, security_stamp, wiki_image_url } = req.body;

    await pool.query(
      'UPDATE terms SET term_name = ?, definition = ?, category = ?, extended_info = ?, is_actual = ?, wiki_image_url = ? WHERE id = ?',
      [term_name, definition, category, extended_info, is_actual, wiki_image_url || null, id]
    );

    if (security_stamp) {
      const [termRows] = await pool.query('SELECT source_id FROM terms WHERE id = ?', [id]);
      if (termRows.length > 0) {
        await pool.query('UPDATE sources SET security_stamp = ? WHERE id = ?', [security_stamp, termRows[0].source_id]);
      }
    }
    
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
    
    // Спочатку обов'язково видаляємо пов'язані вектори ШІ (Foreign Key constraint)
    await pool.query('DELETE FROM term_embeddings WHERE term_id = ?', [id]);
    
    // Після цього безпечно видаляємо сам термін
    await pool.query('DELETE FROM terms WHERE id = ?', [id]);
    
    res.json({ message: 'Term deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// ── Управління Документами (Admin) ───────────────────────
app.get('/sources', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, file_name, upload_date, security_stamp, file_type FROM sources ORDER BY upload_date DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

app.delete('/sources/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Знаходимо всі терміни, що належать цьому документу
    const [terms] = await pool.query('SELECT id FROM terms WHERE source_id = ?', [id]);
    const termIds = terms.map(t => t.id);
    
    // Видаляємо пов'язані дані (ембединги та обране)
    if (termIds.length > 0) {
      const placeholders = termIds.map(() => '?').join(',');
      await pool.query(`DELETE FROM term_embeddings WHERE term_id IN (${placeholders})`, termIds);
      await pool.query(`DELETE FROM favorites WHERE term_id IN (${placeholders})`, termIds);
    }
    
    // Видаляємо терміни
    await pool.query('DELETE FROM terms WHERE source_id = ?', [id]);
    
    // Отримуємо шлях до файлу і видаляємо джерело з БД
    const [sourcesRows] = await pool.query('SELECT file_path FROM sources WHERE id = ?', [id]);
    await pool.query('DELETE FROM sources WHERE id = ?', [id]);
    
    // Видаляємо фізичний файл з диска
    if (sourcesRows.length > 0 && fs.existsSync(sourcesRows[0].file_path)) {
      fs.unlinkSync(sourcesRows[0].file_path);
    }
    res.json({ message: 'Документ та всі його терміни видалено' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

// Semantic search
app.get('/semantic-search', async (req, res) => {
  try {
    const { q } = req.query;
    const results = await semanticSearch(q, 5, req.user);
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

// Search terms (basic)
app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const allowedStamps = getAllowedStamps(req.user.access_level);
    
    await pool.query(
      'INSERT INTO search_history (user_id, query_text) VALUES (?, ?)',
      [req.user.id, q]
    );

    const placeholders = allowedStamps.map(() => '?').join(',');
    const [result] = await pool.query(
      `SELECT t.*, s.file_type, s.security_stamp,
              (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', tr.source_name, 'url', tr.source_url)) FROM term_references tr WHERE tr.term_id = t.id) as refs
       FROM terms t 
       LEFT JOIN sources s ON t.source_id = s.id 
       WHERE t.term_name LIKE ? AND t.is_actual = ? AND s.security_stamp IN (${placeholders})`,
      [`%${q}%`, true, ...allowedStamps]
    );
    
    const mappedResult = result.map(row => ({ ...row, references: row.refs ? (typeof row.refs === 'string' ? JSON.parse(row.refs) : row.refs) : [] }));
    res.json(mappedResult);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.listen(port, () => {
  log(`Server running on port ${port}`);
});