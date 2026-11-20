-- ============================================================================
-- NOSSO MUNDO ♡ — SCRIPT SQL COMPLETO PARA O SUPABASE
-- Execute este script no SQL Editor do seu projeto Supabase (uma única vez).
-- ============================================================================

-- 1. TABELA DE MENSAGENS (TEXTO, FOTOS NORMAIS/2X, ÁUDIO E VISTO)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null,
  content text,
  media_url text,
  media_type text not null default 'text' check (media_type in ('text', 'image', 'audio')),
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists is_read boolean not null default false;
alter table public.messages add column if not exists read_at timestamptz;

create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- 2. TABELA DE STATUS ONLINE / VISTO POR ÚLTIMO
create table if not exists public.user_status (
  username text primary key,
  is_online boolean not null default false,
  last_seen timestamptz not null default now()
);

insert into public.user_status (username, is_online, last_seen)
values
  ('Gabriel', false, now()),
  ('Samella', false, now())
on conflict (username) do nothing;

-- 3. TABELA DE INSCRIÇÕES WEB PUSH (PARA NOTIFICAÇÕES COM O APP FECHADO)
create table if not exists public.push_subscriptions (
  username text primary key,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);

-- 4. CONCEDER PERMISSÕES BASE E HABILITAR RLS
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.messages to anon, authenticated;
grant select, insert, update on public.user_status to anon, authenticated;
grant select, insert, update on public.push_subscriptions to anon, authenticated;

alter table public.messages replica identity full;
alter table public.user_status replica identity full;

alter table public.messages enable row level security;

drop policy if exists "Permitir leitura rapida de mensagens" on public.messages;
create policy "Permitir leitura rapida de mensagens"
  on public.messages
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Permitir envio rapido de mensagens" on public.messages;
create policy "Permitir envio rapido de mensagens"
  on public.messages
  for insert
  to anon, authenticated
  with check (
    sender_name in ('Gabriel', 'Samella')
    and media_type in ('text', 'image', 'audio')
  );

drop policy if exists "Permitir marcar mensagens como lidas" on public.messages;
create policy "Permitir marcar mensagens como lidas"
  on public.messages
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Permitir apagar mensagens e fotos" on public.messages;
create policy "Permitir apagar mensagens e fotos"
  on public.messages
  for delete
  to anon, authenticated
  using (true);

alter table public.user_status enable row level security;

drop policy if exists "Leitura rapida de status" on public.user_status;
create policy "Leitura rapida de status"
  on public.user_status
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Atualizacao rapida de status" on public.user_status;
create policy "Atualizacao rapida de status"
  on public.user_status
  for insert
  to anon, authenticated
  with check (username in ('Gabriel', 'Samella'));

drop policy if exists "Update rapido de status" on public.user_status;
create policy "Update rapido de status"
  on public.user_status
  for update
  to anon, authenticated
  using (username in ('Gabriel', 'Samella'))
  with check (username in ('Gabriel', 'Samella'));

alter table public.push_subscriptions enable row level security;

drop policy if exists "Gerenciar push subscription" on public.push_subscriptions;
create policy "Gerenciar push subscription"
  on public.push_subscriptions
  for all
  to anon, authenticated
  using (username in ('Gabriel', 'Samella'))
  with check (username in ('Gabriel', 'Samella'));

-- 5. ATIVAR REALTIME NAS TABELAS "messages" E "user_status"
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_status'
  ) then
    alter publication supabase_realtime add table public.user_status;
  end if;
end $$;

-- 6. CRIAR BUCKET PÚBLICO "chat-media" NO STORAGE (FOTOS E ÁUDIOS)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']
)
on conflict (id) do update
set public = true;

drop policy if exists "Leitura publica de midias chat-media" on storage.objects;
create policy "Leitura publica de midias chat-media"
  on storage.objects
  for select
  to public
  using (bucket_id = 'chat-media');

drop policy if exists "Upload rapido de midias chat-media" on storage.objects;
create policy "Upload rapido de midias chat-media"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'chat-media');

drop policy if exists "Exclusao de midias chat-media" on storage.objects;
create policy "Exclusao de midias chat-media"
  on storage.objects
  for delete
  to anon, authenticated
  using (bucket_id = 'chat-media');
