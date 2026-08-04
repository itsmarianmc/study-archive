CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    title TEXT,
    doc_date TEXT,
    tags TEXT,
    summary TEXT,
    raw_text TEXT,
    html_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    detected_at TEXT NOT NULL,
    processed_at TEXT,
    user_title TEXT,
    user_summary TEXT,
    notes TEXT,
    ocr_confidence INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);

CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    box INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    next_review_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_flashcards_document ON flashcards(document_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_status ON flashcards(status);
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(next_review_at);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
