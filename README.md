# 🖨️ 3D 프린팅 견적 시스템 — 설치 및 배포 가이드

지금부터 **계정 가입 → 코드 업로드 → 배포** 순서로 진행합니다.
모든 과정은 약 **30~40분** 소요됩니다.

---

## 1단계 — 계정 3개 만들기

아래 사이트에 순서대로 가입합니다 (모두 무료).

| 서비스 | 주소 | 역할 |
|--------|------|------|
| **GitHub** | https://github.com | 코드 저장소 |
| **Vercel** | https://vercel.com | 사이트 배포 (GitHub으로 로그인) |
| **Supabase** | https://supabase.com | 데이터베이스 + 파일 저장 |
| **Resend** | https://resend.com | 이메일 자동 발송 |

---

## 2단계 — Supabase 설정

1. supabase.com 로그인 → **New Project** 클릭
2. 프로젝트 이름 입력 (예: `3d-print-quote`), 지역: **Northeast Asia (Seoul)**
3. 생성 완료 후 좌측 메뉴 **SQL Editor** 클릭
4. `supabase/schema.sql` 파일 전체 내용을 복사해서 붙여넣고 **Run** 클릭
5. 좌측 메뉴 **Project Settings → API** 에서 아래 3가지를 메모장에 복사:
   - `Project URL` → NEXT_PUBLIC_SUPABASE_URL
   - `anon public` key → NEXT_PUBLIC_SUPABASE_ANON_KEY
   - `service_role` key → SUPABASE_SERVICE_ROLE_KEY

---

## 3단계 — Resend 설정 (이메일)

1. resend.com 로그인 → **API Keys** → **Create API Key**
2. 생성된 키 (`re_...`) 를 메모장에 복사 → RESEND_API_KEY
3. **Domains** 탭 → 도메인이 없으면 일단 `onboarding@resend.dev` 를 FROM_EMAIL로 사용 (무료, 하루 100건)

---

## 4단계 — GitHub에 코드 올리기

1. github.com → 우측 상단 **+** → **New repository**
2. Repository name: `3d-print-quote` → **Create repository**
3. 컴퓨터에 이 폴더 전체를 드래그해서 업로드 (또는 git push)
   - GitHub 페이지에서 **uploading an existing file** 링크 클릭
   - 이 폴더 안의 **모든 파일을 선택**해서 드래그 업로드
   - **Commit changes** 클릭

---

## 5단계 — Vercel 배포

1. vercel.com 로그인 (GitHub으로 로그인 권장)
2. **Add New → Project** → GitHub 저장소 `3d-print-quote` 선택 → **Import**
3. **Environment Variables** 섹션에서 아래 항목을 하나씩 추가:

```
NEXT_PUBLIC_SUPABASE_URL        = https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = eyJ...
SUPABASE_SERVICE_ROLE_KEY       = eyJ...
RESEND_API_KEY                  = re_...
ADMIN_EMAIL                     = 내_이메일@gmail.com
ADMIN_PASSWORD                  = 관리자페이지비밀번호
FROM_EMAIL                      = onboarding@resend.dev
NEXT_PUBLIC_SITE_URL            = (배포 후 Vercel이 알려주는 URL, 처음엔 비워도 됨)
```

4. **Deploy** 클릭 → 2~3분 후 완료
5. 완료되면 Vercel이 URL을 알려줍니다 (예: `https://3d-print-quote.vercel.app`)

---

## 완성 후 URL 구조

| 페이지 | 주소 | 용도 |
|--------|------|------|
| 고객 견적 요청 | `https://your-url.vercel.app` | 고객에게 이 링크를 공유 |
| 관리자 대시보드 | `https://your-url.vercel.app/admin` | 사장님만 접근 (비밀번호 보호) |

---

## 이후 운영 방법

- 고객에게 메인 URL을 문자/카카오톡/이메일로 보내면 됩니다
- 견적이 접수되면 관리자 이메일로 알림이 옵니다
- `/admin` 페이지에서 승인/거절 시 고객에게 자동으로 이메일이 발송됩니다
- 무료 플랜 기준 **월 비용 0원**으로 운영 가능합니다

---

## 문의 / 문제 발생 시

각 단계에서 막히면 해당 화면을 캡처해서 Claude에게 보여주세요.
