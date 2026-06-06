-- ============================================================
-- Database Schema
-- Generated from ERD diagram
-- ============================================================

-- Enable UUID extension (PostgreSQL)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- ENUM TYPES
-- ------------------------------------------------------------

CREATE TYPE entry_status AS ENUM (
    'in_progress',
    'completed'
);

CREATE TYPE sync_state AS ENUM (
    'synced',
    'pending',
    'local_only',
    'failed'
);

CREATE TYPE message_role as ENUM (
    'ai',
    'human'
);

-- ------------------------------------------------------------
-- GALLERIES
-- ------------------------------------------------------------

CREATE TABLE galleries (
    id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID    NOT NULL
);

CREATE INDEX idx_galleries_user_id ON galleries(user_id);

-- ------------------------------------------------------------
-- GALLERY ENTRIES
-- ------------------------------------------------------------

CREATE TABLE gallery_entries (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    gallery_id        UUID            NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    file_name         VARCHAR         NOT NULL,
    local_work_path   VARCHAR,
    status            entry_status    NOT NULL DEFAULT 'in_progress',
    file_hash_sha256  VARCHAR,
    cloud_key         VARCHAR,
    thumbnail_path    VARCHAR,
    is_compressed     BOOLEAN         NOT NULL DEFAULT FALSE,
    file_metadata     JSONB,
    sync_status       sync_state      NOT NULL DEFAULT 'pending',
    last_sync_attempt TIMESTAMP,
    retry_count       INTEGER         NOT NULL DEFAULT 0,
    last_modified_at  TIMESTAMP,
    created_at        TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gallery_entries_gallery_id ON gallery_entries(gallery_id);
CREATE INDEX idx_gallery_entries_status     ON gallery_entries(status);
CREATE INDEX idx_gallery_entries_sync_status ON gallery_entries(sync_status);

-- ------------------------------------------------------------
-- CHATS
-- ------------------------------------------------------------

CREATE TABLE chats (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gallery_entry_id UUID        NOT NULL REFERENCES gallery_entries(id) ON DELETE CASCADE,
    title            VARCHAR,
    created_at       TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chats_gallery_entry_id ON chats(gallery_entry_id);

-- ------------------------------------------------------------
-- MESSAGES
-- ------------------------------------------------------------

CREATE TABLE messages (
    id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id    UUID            NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       message_role    NOT NULL,
    content    TEXT            NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);