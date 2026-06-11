-- ╔══════════════════════════════════════════════════════════════╗
-- ║  PostgreSQL 16 + pgvector + pg_trgm — схема ІДС каталогізації  ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Розширення
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: векторний пошук (RAG, семантика)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- триграми: нечіткий пошук "3 грами"

-- ── Категорії ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,
    description TEXT
);

-- ── Документи-джерела ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
    id                SERIAL PRIMARY KEY,
    file_name         VARCHAR(255) NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    upload_date       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    security_stamp    VARCHAR(50) NOT NULL,
    file_type         VARCHAR(10),
    is_encrypted      SMALLINT DEFAULT 0,
    processing_status VARCHAR(20) DEFAULT 'confirmed',
    doc_type          VARCHAR(100) DEFAULT 'Інше',
    description       TEXT DEFAULT NULL,
    title             VARCHAR(1000) DEFAULT NULL,
    doc_date          VARCHAR(30) DEFAULT NULL,
    issued_by         VARCHAR(500) DEFAULT NULL
);

-- ── Терміни ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terms (
    id                     SERIAL PRIMARY KEY,
    term_name              VARCHAR(500) NOT NULL,
    definition             TEXT NOT NULL,
    category               VARCHAR(100) DEFAULT 'Освітньо-методичні джерела',
    category_id            INT,
    source_id              INT REFERENCES sources(id),
    is_actual              BOOLEAN DEFAULT TRUE,
    extended_info          TEXT,
    definition_source_type VARCHAR(20) DEFAULT 'Document',
    wiki_image_url         TEXT DEFAULT NULL,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Користувачі (RBAC) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    full_name     VARCHAR(255) NOT NULL DEFAULT 'Користувач',
    email         VARCHAR(255) UNIQUE,
    username      VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'user',
    access_level  VARCHAR(50) NOT NULL DEFAULT 'Public',
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Refresh-токени ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Історія пошуку ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_history (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    type       VARCHAR(50) DEFAULT 'Пошук',
    "timestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Обрані терміни ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term_id    INT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, term_id)
);

-- ── Обрані документи ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_documents (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id  INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, source_id)
);

-- ── Нотатки до документів ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_notes (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id  INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    note       TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, source_id)
);

-- ── Зовнішні посилання (Wiki-Explorer) ─────────────────────────
CREATE TABLE IF NOT EXISTS term_references (
    id          SERIAL PRIMARY KEY,
    term_id     INT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    source_name VARCHAR(255),
    source_url  TEXT
);

-- ── Векторні ембединги (pgvector) ──────────────────────────────
-- nomic-embed-text повертає 768-вимірний вектор
CREATE TABLE IF NOT EXISTS term_embeddings (
    id        SERIAL PRIMARY KEY,
    term_id   INT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    embedding vector(768),
    content   TEXT,
    metadata  JSONB
);

-- ── Журнал активності ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id              SERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(id) ON DELETE SET NULL,
    user_name       VARCHAR(255) DEFAULT NULL,
    user_role       VARCHAR(50) DEFAULT NULL,
    action_type     VARCHAR(60) NOT NULL,
    target_type     VARCHAR(50) DEFAULT NULL,
    target_id       INT DEFAULT NULL,
    details         TEXT DEFAULT NULL,
    is_admin_action SMALLINT DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Чернетки термінів ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS draft_terms (
    id                     SERIAL PRIMARY KEY,
    source_id              INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    term_name              VARCHAR(500) NOT NULL,
    definition             TEXT,
    category               VARCHAR(100) DEFAULT 'Освітньо-методичні джерела',
    extended_info          TEXT,
    wiki_image_url         TEXT,
    definition_source_type VARCHAR(20) DEFAULT 'AI-Generated',
    references_json        JSONB,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Індекси                                                      ║
-- ╚══════════════════════════════════════════════════════════════╝
-- Звичайні
CREATE INDEX IF NOT EXISTS idx_terms_source       ON terms(source_id);
CREATE INDEX IF NOT EXISTS idx_terms_category      ON terms(category);
CREATE INDEX IF NOT EXISTS idx_terms_is_actual     ON terms(is_actual);
CREATE INDEX IF NOT EXISTS idx_sources_stamp       ON sources(security_stamp);
CREATE INDEX IF NOT EXISTS idx_emb_term            ON term_embeddings(term_id);

-- Триграмні (нечіткий пошук "3 грами" за назвою та визначенням)
CREATE INDEX IF NOT EXISTS idx_terms_name_trgm ON terms USING gin (term_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_terms_def_trgm  ON terms USING gin (definition gin_trgm_ops);

-- Векторний (косинусна відстань для семантики/RAG)
CREATE INDEX IF NOT EXISTS idx_emb_vector ON term_embeddings
    USING hnsw (embedding vector_cosine_ops);
