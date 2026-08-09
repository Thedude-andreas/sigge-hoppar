-- Kör i SQL Editor i samma Supabase-projekt som Majkens spelhåla.
-- Tabellen och policyerna är separata från Majkens befintliga `highscores`.

create table if not exists public.rabbit_highscores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(trim(name)) between 1 and 20),
  nights integer not null check (nights between 0 and 9999),
  rabbit text not null check (rabbit in ('sigge', 'kurre')),
  created_at timestamptz not null default now()
);

create index if not exists rabbit_highscores_nights_idx
  on public.rabbit_highscores (nights desc, created_at asc);

alter table public.rabbit_highscores enable row level security;

drop policy if exists "Public can read rabbit highscores" on public.rabbit_highscores;
create policy "Public can read rabbit highscores"
on public.rabbit_highscores
for select
to anon, authenticated
using (true);

drop policy if exists "Public can insert rabbit highscores" on public.rabbit_highscores;
create policy "Public can insert rabbit highscores"
on public.rabbit_highscores
for insert
to anon, authenticated
with check (
  char_length(trim(name)) between 1 and 20
  and nights between 0 and 9999
  and rabbit in ('sigge', 'kurre')
);

grant select, insert on public.rabbit_highscores to anon, authenticated;
grant usage, select on sequence public.rabbit_highscores_id_seq to anon, authenticated;
revoke update, delete on public.rabbit_highscores from anon, authenticated;
