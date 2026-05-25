-- 설정 테이블 생성
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- 기본 설정값 삽입
insert into settings (key, value) values 
('print_options', '{
  "methods": ["FDM", "SLA", "MJF", "SLS"],
  "materials": {
    "FDM": ["PLA", "ABS", "PETG", "TPU", "Nylon"],
    "SLA": ["Standard Resin", "Tough Resin", "Flexible Resin"],
    "MJF": ["PA12 (Nylon)", "PA11"],
    "SLS": ["PA12 (Nylon)", "TPU"]
  },
  "colors": {
    "FDM": ["White", "Black", "Gray", "Red", "Blue", "Green", "Yellow", "Orange", "Natural"],
    "SLA": ["White", "Clear", "Black", "Gray"],
    "MJF": ["Black", "Gray"],
    "SLS": ["White", "Black", "Gray"]
  },
  "qualities": ["Draft (0.3mm)", "Standard (0.2mm)", "Fine (0.1mm)"]
}'::jsonb)
on conflict (key) do nothing;
