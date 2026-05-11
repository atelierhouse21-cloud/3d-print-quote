-- ================================================================
-- 3D 프린팅 견적 시스템 — Supabase 테이블 생성 스크립트
-- Supabase > SQL Editor 에서 실행하세요
-- ================================================================

create table if not exists quotes (
  id             uuid primary key default gen_random_uuid(),
  quote_no       text unique not null,          -- Q-001, Q-002 ...
  name           text not null,
  email          text not null,
  company        text,
  phone          text,
  file_name      text,
  file_path      text,                          -- Supabase Storage 경로
  vol_cm3        numeric,                       -- 추정 부피
  method         text,                          -- FDM / SLA / SLS / MJF
  material       text,
  color          text,
  quality        text,
  qty            integer,
  infill         integer,                       -- FDM 전용
  note           text,                          -- 고객 요청사항
  auto_price     bigint,                        -- 자동 계산 금액
  admin_price    bigint,                        -- 관리자 확정 금액
  admin_days     text,                          -- 관리자 확정 납기
  admin_note     text,                          -- 관리자 메모
  status         text default 'pending',        -- pending / approved / rejected
  created_at     timestamptz default now()
);

-- 파일 업로드용 Storage 버킷 생성
insert into storage.buckets (id, name, public)
values ('quote-files', 'quote-files', false)
on conflict do nothing;

-- Storage 정책: 누구나 업로드 가능 (견적 제출용)
create policy "anyone can upload"
  on storage.objects for insert
  with check (bucket_id = 'quote-files');

-- Storage 정책: service_role 만 다운로드 가능 (관리자)
create policy "service role can read"
  on storage.objects for select
  using (bucket_id = 'quote-files');
