-- Database schema for Informational Reference System
-- MySQL

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT
);

-- Sources/Documents table
CREATE TABLE IF NOT EXISTS sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    security_stamp VARCHAR(50) NOT NULL, -- e.g., 'Public', 'DSP', 'Secret'
    file_type VARCHAR(10) CHECK (file_type IN ('pdf', 'docx'))
);

-- Terms table
CREATE TABLE IF NOT EXISTS terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    term_name VARCHAR(255) NOT NULL,
    definition LONGTEXT NOT NULL,
    category_id INT,
    source_id INT,
    is_actual BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

-- Users table for RBAC
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user' -- e.g., 'admin', 'user'
);

-- Search history
CREATE TABLE IF NOT EXISTS search_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    query_text LONGTEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Term embeddings table for semantic search
CREATE TABLE IF NOT EXISTS term_embeddings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    term_id INT NOT NULL,
    embedding LONGTEXT NOT NULL, -- JSON string of vector
    content LONGTEXT,
    metadata JSON,
    FOREIGN KEY (term_id) REFERENCES terms(id),
    INDEX idx_term_id (term_id)
);

-- Indexes for performance
CREATE INDEX idx_terms_term_name ON terms(term_name);
CREATE INDEX idx_terms_category ON terms(category_id);
CREATE INDEX idx_terms_source ON terms(source_id);
CREATE INDEX idx_terms_is_actual ON terms(is_actual);
CREATE INDEX idx_sources_security_stamp ON sources(security_stamp);
CREATE INDEX idx_search_history_timestamp ON search_history(timestamp);