import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { calcPrice, calcDays } from '@/lib/constants'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// 견적 번호 생성
async function getNextQuoteNo(): Promise<string> {
  const supabaseAdmin = getSupabaseAdmin()
  const { count } = await supabaseAdmin
    .from('quotes')
    .select('*', { count: 'exact', head: true })
  const n = (count ?? 0) + 1
  return `Q-${String(n).padStart(3, '0')}`
}

// ── POST: 새 견적 접수 ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const formData = await req.formData()

    const name     = formData.get('name') as string
    const email    = formData.get('email') as string
    const company  = formData.get('company') as string
    const phone    = formData.get('phone') as string
    const note     = formData.get('note') as string
    const method   = formData.get('method') as string
    const material = formData.get('material') as string
    const color    = formData.get('color') as string
    const quality  = formData.get('quality') as string
    const qty      = parseInt(formData.get('qty') as string)
    const infill   = parseInt(formData.get('infill') as string) || 20
    const qm       = parseFloat(formData.get('qm') as string) || 1.0
    const vol      = parseFloat(formData.get('vol') as string) || 0
    const file     = formData.get('file') as File | null

    // 견적 번호 먼저 생성 (파일명에 사용)
    const quote_no  = await getNextQuoteNo()
    const auto_price = vol > 0 ? calcPrice(method, vol, qm, qty, infill) : null

    // 파일 업로드 (Supabase Storage)
    let file_path: string | null = null
    let file_name: string | null = null
    if (file && file.size > 0) {
      // 원본 확장자 추출
      const ext = file.name.split('.').pop()?.toLowerCase() || 'stl'
      // 날짜 포맷
      const now = new Date()
      const yyyy = now.getFullYear().toString()
      const mm   = String(now.getMonth()+1).padStart(2,'0')
      const dd   = String(now.getDate()).padStart(2,'0')
      const dateStr = `${yyyy}${mm}${dd}`
      // 원본 파일명 (확장자 제외, 특수문자 → _)
      const origName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      // DB용 파일명: 한글 포함 (사람이 읽기 쉬운 형식)
      const displayName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      const displayOrig = origName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      file_name = `${dateStr}_${quote_no}_${displayName}_${displayOrig}.${ext}`

      // Storage용 경로: ASCII만 허용
      // 한글 등 비ASCII 문자는 제거하고 빈 문자열이면 fallback 사용
      const asciiName = name.replace(/[^a-zA-Z0-9_-]/g, '') || `cust${Date.now().toString().slice(-4)}`
      const asciiOrig = origName.replace(/[^a-zA-Z0-9_-]/g, '') || `file${Date.now().toString().slice(-4)}`
      const storageFileName = `${dateStr}_${quote_no}_${asciiName}_${asciiOrig}.${ext}`
      // 폴더 구조: 2026/05/15/Q-001/파일명
      const storagePath = `${yyyy}/${mm}/${dd}/${quote_no}/${storageFileName}`
      // Supabase Storage 업로드
      console.log('[UPLOAD] 시도:', storagePath, 'size:', file.size)
      const { data: upData, error: upErr } = await supabaseAdmin.storage
        .from('quote-files')
        .upload(storagePath, file, { upsert: false })
      if (upErr) {
        console.error('[UPLOAD] 실패:', JSON.stringify(upErr))
      } else {
        console.log('[UPLOAD] 성공:', upData)
        file_path = storagePath
      }
    }

    const { data, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        quote_no, name, email, company, phone, note,
        method, material, color, quality, qty, infill,
        vol_cm3: vol, file_name, file_path, auto_price,
        size_x: parseFloat(formData.get('sizeX') as string) || null,
        size_y: parseFloat(formData.get('sizeY') as string) || null,
        size_z: parseFloat(formData.get('sizeZ') as string) || null,
        status: 'pending',
      })
      .select()
      .single()

    if (error) throw error

    // 고객 확인 이메일
    await resend.emails.send({
      from: process.env.FROM_EMAIL!,
      to: email,
      subject: `[${quote_no}] 3D 프린팅 견적 요청이 접수되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;">
          <h2 style="font-size:20px;margin-bottom:8px;">견적 요청 접수 확인</h2>
          <p style="color:#6b7280;margin-bottom:24px;">안녕하세요 <b>${name}</b>님, 견적 요청이 정상적으로 접수되었습니다.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#6b7280;">견적 번호</td><td style="padding:8px 0;font-weight:600;">${quote_no}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">출력 방식</td><td style="padding:8px 0;">${method}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">소재</td><td style="padding:8px 0;">${material}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">수량</td><td style="padding:8px 0;">${qty}개</td></tr>
            ${auto_price ? `<tr><td style="padding:8px 0;color:#6b7280;">예상 금액</td><td style="padding:8px 0;font-weight:700;">₩${auto_price.toLocaleString('ko-KR')}</td></tr>` : ''}
          </table>
          <p style="margin-top:24px;color:#6b7280;font-size:13px;">담당자 검토 후 1~2 영업일 이내 최종 견적을 안내드립니다.</p>
        </div>
      `,
    }).catch(() => {}) // 이메일 실패해도 견적 접수는 유지

    // 관리자 알림 이메일
    await resend.emails.send({
      from: process.env.FROM_EMAIL!,
      to: process.env.ADMIN_EMAIL!,
      subject: `[새 견적 ${quote_no}] ${name} — ${method} ${qty}개`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;">
          <h2 style="font-size:20px;margin-bottom:16px;">새 견적 요청 접수</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#6b7280;">견적 번호</td><td style="padding:8px 0;font-weight:600;">${quote_no}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">고객</td><td style="padding:8px 0;">${name} (${company || '개인'}) / ${email}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">방식 / 소재</td><td style="padding:8px 0;">${method} / ${material}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">색상 / 품질</td><td style="padding:8px 0;">${color} / ${quality}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">수량</td><td style="padding:8px 0;">${qty}개</td></tr>
            ${vol > 0 ? `<tr><td style="padding:8px 0;color:#6b7280;">추정 부피</td><td style="padding:8px 0;">~${vol} cm³</td></tr>` : ''}
            ${auto_price ? `<tr><td style="padding:8px 0;color:#6b7280;">자동 견적가</td><td style="padding:8px 0;font-weight:700;">₩${auto_price.toLocaleString('ko-KR')}</td></tr>` : ''}
            ${note ? `<tr><td style="padding:8px 0;color:#6b7280;">요청 사항</td><td style="padding:8px 0;">${note}</td></tr>` : ''}
            ${file_name ? `<tr><td style="padding:8px 0;color:#6b7280;">업로드 파일</td><td style="padding:8px 0;">${file_name}</td></tr>` : ''}
          </table>
          <a href="${process.env.NEXT_PUBLIC_SITE_URL || ''}/admin" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">관리자 페이지에서 확인하기</a>
        </div>
      `,
    }).catch(() => {})

    return NextResponse.json({ ok: true, quote_no })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ── GET: 견적 목록 조회 (관리자용) ─────────────────────
export async function GET(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  if (pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
