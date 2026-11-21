-- サブスクリプション（定期支出）の管理
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  name          text    not null,                                   -- サービス名（表示用）
  amount        integer not null check (amount > 0),                -- 1 回の請求額（円）
  cycle         text    not null check (cycle in ('monthly', 'yearly')),
  billing_day   integer not null check (billing_day between 1 and 31),   -- 請求日（月末より大きければ月末）
  billing_month integer check (billing_month between 1 and 12),          -- 年払いの請求月（月払いは null）
  category      text    not null default 'サブスクリプション',
  keyword       text    not null,                                   -- 履歴の店名に含まれる文字（大文字小文字は区別しない）
  color         text    not null,                                   -- カードの色（#rrggbb）
  url           text,                                               -- 管理ページ（解約・プラン変更）の URL
  memo          text,
  active        boolean not null default true,                      -- false なら一時停止中（固定費に数えない）
  created_at    timestamptz default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "anon select" on public.subscriptions;
create policy "anon select" on public.subscriptions for select to anon using (true);
drop policy if exists "anon insert" on public.subscriptions;
create policy "anon insert" on public.subscriptions for insert to anon with check (true);
drop policy if exists "anon update" on public.subscriptions;
create policy "anon update" on public.subscriptions for update to anon using (true) with check (true);
drop policy if exists "anon delete" on public.subscriptions;
create policy "anon delete" on public.subscriptions for delete to anon using (true);
grant select, insert, update, delete on public.subscriptions to anon;
grant all on public.subscriptions to service_role;
