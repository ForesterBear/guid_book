# Інформаційно-довідкова система

Система для каталогізації термінів зі зв'язку та кібербезпеки з автономною роботою в закритій мережі.

## Архітектура

- **Backend**: Node.js + Express + MySQL + Node.js vector operations
- **Frontend**: React + Vite
- **AI**: Локальна LLM через Ollama (llama3 для екстракції, nomic-embed-text для ембедінгів)
- **Безпека**: RBAC, обов'язкове маркування грифів, локальне зберігання

## Налаштування

1. **Встановіть MySQL та створіть базу даних:**
   ```bash
   mysql -u root -p
   CREATE DATABASE guid_book;
   EXIT;
   ```

2. **Встановіть схему БД:**
   ```bash
   mysql -u root -p guid_book < database/schema.sql
   ```

3. **Встановіть Ollama моделі:**
   ```bash
   ollama pull llama3
   ollama pull nomic-embed-text
   ```

4. **У backend/.env налаштуйте MySQL:**
   ```
   DATABASE_URL=mysql://root:password@localhost:3306/guid_book
   PORT=3001
   JWT_SECRET=your_jwt_secret_here
   ```

## Запуск

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Функціонал

- Завантаження PDF/DOCX з обов'язковою перевіркою грифа обмеження
- Автоматичне видобування термінів за допомогою ШІ з верифікацією користувачем
- Базовий та семантичний пошук термінів
- Візуалізація джерел з прямими посиланнями на файли
- Контроль актуальності термінів
- Логування пошукових запитів

## Безпека

Система працює повністю локально, без зовнішніх API. Всі дані зберігаються в локальній БД з підтримкою грифів обмеження доступу.