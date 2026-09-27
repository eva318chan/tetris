-- Tetris 排行榜的資料庫設定
-- 在 Supabase Dashboard → SQL editor 貼上執行
-- 注意：同一個 project 用 schema 區分不同應用（guestbook、tetris…）

create schema if not exists tetris;

create table tetris.scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 20),
  score integer not null check (score >= 0 and score < 10000000),
  level integer not null default 1,
  lines integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists scores_score_idx on tetris.scores (score desc);

alter table tetris.scores enable row level security;

-- 任何人都可以看排行榜
create policy "Anyone can read scores"
  on tetris.scores for select
  to anon
  using (true);

-- 任何人都可以送出自己的分數（不能改、不能刪別人的）
create policy "Anyone can submit scores"
  on tetris.scores for insert
  to anon
  with check (true);
