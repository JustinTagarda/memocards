alter table memocards.decks add column if not exists is_sample boolean not null default false;
alter table memocards.user_settings add column if not exists sample_data_seeded_at timestamptz;
