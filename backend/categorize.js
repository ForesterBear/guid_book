const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const categories = [
  'Системи зв’язку',
  'Кібербезпека',
  'Криптографія',
  'Нормативні акти',
  'Радіоелектронна боротьба',
  'IT-термінологія'
];

async function categorizeDB() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'qwerty123',
    database: process.env.DB_NAME || 'guid_book',
  });

  const connection = await pool.getConnection();
  
  console.log('\n[1] Перевірка структури БД...');
  try {
    await connection.query('ALTER TABLE terms ADD COLUMN category VARCHAR(100) DEFAULT "IT-термінологія"');
    console.log('✅ Стовпець category успішно додано до таблиці terms.');
  } catch (e) {
    console.log('ℹ️ Стовпець category вже існує.');
  }

  console.log('\n[2] Отримання термінів для сортування...');
  // Обираємо ВСІ терміни, щоб пересортувати базу з нуля після невдалої спроби
  const [terms] = await connection.query('SELECT id, term_name, definition FROM terms');
  console.log(`Знайдено ${terms.length} термінів для категоризації.\n`);

  // Функція для очищення тексту (видаляє апострофи, лапки та приводить до нижнього регістру)
  const normalize = (str) => (str || '').toLowerCase().replace(/['’`"«»]/g, '').trim();

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    process.stdout.write(`[${i+1}/${terms.length}] Аналіз: "${term.term_name}" `);
    
    const prompt = `You are an expert military and IT classifier for the Ukrainian Armed Forces.
Carefully read the Term and its Definition, then classify it into EXACTLY ONE of the following categories based on these strict rules:

1. "Системи зв’язку" - telecommunications, radio equipment, network hardware, data transmission.
2. "Кібербезпека" - STRICTLY protection against cyber attacks, hackers, IT network defense. DO NOT put general military terms here!
3. "Криптографія" - encryption, ciphers, keys, cryptographic protection.
4. "Радіоелектронна боротьба" - EW, jamming, radar, radio reconnaissance.
5. "Нормативні акти" - general military doctrines, laws, organizational structures, rules, state secrets, military security, interoperability, psychological state. (USE THIS FOR ALL GENERAL MILITARY TERMS).
6. "IT-термінологія" - software, AI, algorithms, general computing, databases.

Term: "${term.term_name}"
Definition: "${term.definition}"

Respond ONLY with a valid JSON object in this format: {"category": "Exact Category Name"}`;

    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', prompt: prompt, format: 'json', stream: false, options: { temperature: 0.0 } })
      });
      const data = await response.json();
      
      let predicted = '';
      try {
        const parsed = JSON.parse(data.response.trim());
        predicted = parsed.category || '';
      } catch (err) {
        predicted = data.response.trim();
      }
      
      let finalCategory = 'IT-термінологія'; // За замовчуванням
      for (const cat of categories) {
         if (normalize(predicted).includes(normalize(cat))) { 
           finalCategory = cat; 
           break; 
         }
      }
      
      await connection.query('UPDATE terms SET category = ? WHERE id = ?', [finalCategory, term.id]);
      console.log(`-> Визначено: [${finalCategory}]`);
    } catch (e) {
      console.log(`-> Помилка ШІ: ${e.message}`);
    }
  }
  console.log('\n✅ Всі терміни успішно розсортовано!');
  process.exit(0);
}

categorizeDB();