const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

async function clearAll() {
  console.log('🧹 Починаємо повне очищення системи...');
  
  // 1. Очищення БД (MySQL)
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'qwerty123',
      database: process.env.DB_NAME || 'guid_book',
    });
    const connection = await pool.getConnection();
    
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE terms');
    await connection.query('TRUNCATE TABLE sources');
    await connection.query('TRUNCATE TABLE search_history');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    
    connection.release();
    console.log('✅ Базу даних (MySQL) успішно очищено.');
  } catch (err) {
    console.error('❌ Помилка очищення БД:', err.message);
  }

  // 2. Очищення папки з документами
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(uploadsDir, file));
    }
    console.log('✅ Папку завантажень (uploads) очищено.');
  }

  // 3. Очищення векторної бази (LangChain)
  const vectorStoreDir = path.join(__dirname, 'vector_store');
  if (fs.existsSync(vectorStoreDir)) {
    fs.rmSync(vectorStoreDir, { recursive: true, force: true });
    console.log('✅ Векторну базу ШІ (embeddings) очищено.');
  }

  console.log('\n✨ Система повністю чиста та готова до нового заповнення!');
  process.exit(0);
}

clearAll();