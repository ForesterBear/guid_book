## 1. Назва: ІДС "Глосарій-КБ"

## 2. Стек: 
Node.js + Express + MySQL + React + Vite + Tailwind + Docker + Ollama

## 3. Ролі та доступ
- **admin**: повний доступ, керування юзерами і термінами
- **operator**: завантаження документів, підтвердження термінів
- **user**: тільки перегляд і пошук

## 4. Грифи секретності
- **Public**: бачать всі
- **DSP**: тільки operator і admin
- **Secret**: тільки admin

## 5. Змінні середовища (.env)
`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OLLAMA_URL`, `NODE_ENV`

## 6. Запуск

```bash
docker-compose up -d --build
```
