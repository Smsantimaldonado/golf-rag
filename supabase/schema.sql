create extension if not exists vector;

create table if not exists public.golf_rule_chunks (
  id text primary key,
  content text not null,
  embedding vector(1536) not null,
  source text,
  source_path text,
  page_start integer,
  page_end integer,
  heading text,
  rule_number text,
  chunk_type text,
  has_visual_context boolean not null default false,
  visual_assets jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.golf_rule_chunks enable row level security;

create index if not exists golf_rule_chunks_rule_number_idx
  on public.golf_rule_chunks (rule_number);

create index if not exists golf_rule_chunks_source_idx
  on public.golf_rule_chunks (source);

create index if not exists golf_rule_chunks_embedding_hnsw_idx
  on public.golf_rule_chunks
  using hnsw (embedding vector_cosine_ops);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists golf_rule_chunks_touch_updated_at on public.golf_rule_chunks;

create trigger golf_rule_chunks_touch_updated_at
before update on public.golf_rule_chunks
for each row
execute function public.touch_updated_at();

create or replace function public.match_golf_rule_chunks(
  query_embedding vector(1536),
  match_count integer default 8,
  exclude_rule_prefixes text[] default '{}'::text[]
)
returns table (
  id text,
  content text,
  source text,
  page_start integer,
  page_end integer,
  heading text,
  rule_number text,
  chunk_type text,
  has_visual_context boolean,
  visual_assets jsonb,
  metadata jsonb,
  distance double precision
)
language sql
stable
as $$
  select
    c.id,
    c.content,
    c.source,
    c.page_start,
    c.page_end,
    c.heading,
    c.rule_number,
    c.chunk_type,
    c.has_visual_context,
    c.visual_assets,
    c.metadata,
    c.embedding <=> query_embedding as distance
  from public.golf_rule_chunks c
  where not exists (
    select 1
    from unnest(exclude_rule_prefixes) as prefix
    where coalesce(c.rule_number, '') like prefix || '%'
  )
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
