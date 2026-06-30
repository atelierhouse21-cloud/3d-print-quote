-- ============================================================
-- 3D 프린팅 견적 시스템 — 통합 DB 설정 스크립트 (정리본)
-- ------------------------------------------------------------
-- 이 한 파일만 실행하면 앱이 쓰는 모든 테이블·컬럼·정책이 보장됩니다.
-- 모든 구문이 "IF NOT EXISTS / on conflict / drop ... if exists" 방식이라
-- 여러 번 실행해도 안전합니다(중복 생성·오류 없음).
-- Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run 하세요.
-- ============================================================


-- ────────────────────────────────────────────────
-- 1) settings 테이블 (견적 옵션 저장)
-- ────────────────────────────────────────────────
create table if not exists settings (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- 옵션 초기값(이미 있으면 건너뜀). 실제 옵션은 관리자 페이지에서 수정됩니다.
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


-- ────────────────────────────────────────────────
-- 2) quotes 테이블에 필요한 모든 컬럼 (없으면 추가)
-- ────────────────────────────────────────────────

-- 크기 / 견적 처리 / 배송
alter table quotes add column if not exists size_x            numeric;   -- 가로(mm)
alter table quotes add column if not exists size_y            numeric;   -- 세로(mm)
alter table quotes add column if not exists size_z            numeric;   -- 높이(mm)
alter table quotes add column if not exists final_price       integer;   -- 확정 금액(원)
alter table quotes add column if not exists final_days        text;      -- 확정 납기
alter table quotes add column if not exists shipping_company  text;      -- 배송사
alter table quotes add column if not exists tracking_number   text;      -- 송장번호
alter table quotes add column if not exists issue_note        text;      -- 문제 상황 내용

-- 관리자 메모 / 단계 시각 / 삭제 / A·S
alter table quotes add column if not exists admin_price       integer;
alter table quotes add column if not exists admin_days        text;
alter table quotes add column if not exists admin_note        text;
alter table quotes add column if not exists stage_times       jsonb default '{}'::jsonb;  -- {상태: 처리시각(ISO)}
alter table quotes add column if not exists deleted_at        timestamptz;                -- 삭제 시각(있으면 삭제된 건)
alter table quotes add column if not exists as_origin         jsonb;                      -- A/S 원본 스냅샷

-- 개인정보 동의 / 주소
alter table quotes add column if not exists privacy_consent   boolean default false;      -- 개인정보 수집·이용 동의(필수)
alter table quotes add column if not exists marketing_consent boolean default false;      -- 광고·마케팅 활용 동의(선택)
alter table quotes add column if not exists address           text;                       -- 수령(배송) 주소

-- 고객 확인 번호(진행상황 조회용, Q-번호와 별개)
alter table quotes add column if not exists tracking_code     text;

-- 여러 파일(파일별 사양) 저장
alter table quotes add column if not exists items             jsonb default '[]'::jsonb;


-- ────────────────────────────────────────────────
-- 3) 인덱스 (중복 방지 + 조회 속도)
-- ────────────────────────────────────────────────

-- 견적번호 중복 방지 (동시 접수 시 같은 번호 차단)
-- ※ 기존 데이터에 중복된 quote_no 가 있으면 이 줄에서 오류가 납니다.
--    그 경우 중복부터 정리한 뒤 이 줄만 다시 실행하세요.
create unique index if not exists quotes_quote_no_uniq on quotes (quote_no);

-- 고객 확인 번호 중복 방지 + 조회 속도(값이 있는 행만)
create unique index if not exists quotes_tracking_code_uniq
  on quotes (tracking_code) where tracking_code is not null;


-- ────────────────────────────────────────────────
-- 4) Storage 정책 (quote-files 버킷 업로드/조회 권한)
-- ────────────────────────────────────────────────
drop policy if exists "anyone can upload"            on storage.objects;
drop policy if exists "service role can read"        on storage.objects;
drop policy if exists "allow anon insert"            on storage.objects;
drop policy if exists "allow anon select"            on storage.objects;
drop policy if exists "service role can manage files" on storage.objects;

create policy "allow anon insert"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'quote-files');

create policy "allow anon select"
  on storage.objects for select
  to anon
  using (bucket_id = 'quote-files');

create policy "service role can manage files"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'quote-files')
  with check (bucket_id = 'quote-files');


-- ────────────────────────────────────────────────
-- 5) 확인용 — 현재 quotes 컬럼 목록 출력
-- ────────────────────────────────────────────────
select column_name, data_type
from information_schema.columns
where table_name = 'quotes'
order by ordinal_position;
