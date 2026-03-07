-- ============================================================
-- MANZXY API — Supabase Setup
-- Jalankan script ini di Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- 1. Buat tabel snippets
CREATE TABLE IF NOT EXISTS snippets (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'text',
  description   TEXT DEFAULT '',
  code          TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  author_avatar TEXT DEFAULT '',
  likes         INTEGER DEFAULT 0,
  liked_by      TEXT[] DEFAULT '{}',
  views         INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_snippets_language   ON snippets (language);
CREATE INDEX IF NOT EXISTS idx_snippets_author_id  ON snippets (author_id);
CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets (created_at DESC);

-- 3. Row Level Security — public read, API write via service key
ALTER TABLE snippets ENABLE ROW LEVEL SECURITY;

-- Semua orang bisa baca
CREATE POLICY "Public read" ON snippets
  FOR SELECT USING (true);

-- Semua orang bisa insert (auth dihandle di backend)
CREATE POLICY "Public insert" ON snippets
  FOR INSERT WITH CHECK (true);

-- Update & delete hanya via backend (pakai service key bypass RLS)
CREATE POLICY "Public update" ON snippets
  FOR UPDATE USING (true);

CREATE POLICY "Public delete" ON snippets
  FOR DELETE USING (true);

-- 4. Seed data contoh (opsional, hapus kalau tidak mau)
INSERT INTO snippets (id, title, language, description, code, author_id, author_name, author_avatar, likes, views)
VALUES
  (
    'sample001',
    'Fetch Manzxy API',
    'javascript',
    'Cara call API Manzxy pakai Fetch',
    'fetch(''https://manzxy.my.id/ai/openai?text=hello'')
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));',
    'system',
    'Manzxy',
    'https://c.termai.cc/i151/YU4EKRg.jpg',
    12,
    80
  ),
  (
    'sample002',
    'Python Requests',
    'python',
    'Call API pakai Python requests',
    'import requests

url = "https://manzxy.my.id/ai/openai"
params = {"text": "hello"}
response = requests.get(url, params=params)
print(response.json())',
    'system',
    'Manzxy',
    'https://c.termai.cc/i151/YU4EKRg.jpg',
    8,
    55
  ),
  (
    'sample003',
    'PHP cURL',
    'php',
    'PHP implementation pakai cURL',
    '<?php
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "https://manzxy.my.id/ai/openai?text=hello");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
print_r(json_decode($response, true));
?>',
    'system',
    'Manzxy',
    'https://c.termai.cc/i151/YU4EKRg.jpg',
    5,
    40
  )
ON CONFLICT (id) DO NOTHING;
