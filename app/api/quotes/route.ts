import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { calcPrice, calcDays } from '@/lib/constants'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// 이메일 HTML에 들어가는 사용자 입력값 이스케이프(주입 방지)
const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string))

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
    const body = await req.json()

    const name     = body.name as string
    const email    = body.email as string
    const company  = body.company as string
    const phone    = body.phone as string
    const address  = (body.address as string) || ''
    const note     = body.note as string
    const method   = body.method as string
    const material = body.material as string
    const color    = body.color as string
    const quality  = body.quality as string
    const qty      = parseInt(body.qty)
    const infill   = parseInt(body.infill) || 20
    const qm       = parseFloat(body.qm) || 1.0
    const vol      = parseFloat(body.vol) || 0
    const fileName = body.fileName as string | null

    // 자동 견적가 (견적번호와 무관하게 먼저 계산)
    const clientAutoPrice = (body.auto_price !== null && body.auto_price !== undefined && body.auto_price !== '')
      ? Number(body.auto_price) : null
    const auto_price = clientAutoPrice != null
      ? clientAutoPrice
      : (vol > 0 ? calcPrice(method, vol, qm, qty, infill) : null)

    const isUnique = (e: any) => !!e && (e.code === '23505' || /duplicate|unique/i.test(e.message || ''))

    // 견적번호 생성 + 저장 (동시 접수로 번호가 겹치면 새 번호로 재시도)
    let data: any = null
    let quote_no = ''
    let file_name: string | null = null
    let storage_path: string | null = null
    let lastErr: any = null

    for (let attempt = 0; attempt < 6; attempt++) {
      quote_no = await getNextQuoteNo()

      // 파일 경로 생성 (실제 업로드는 브라우저에서 직접 처리)
      let file_path: string | null = null
      file_name = null
      storage_path = null
      if (fileName) {
        const ext = fileName.split('.').pop()?.toLowerCase() || 'stl'
        const now = new Date()
        const yyyy = now.getFullYear().toString()
        const mm   = String(now.getMonth()+1).padStart(2,'0')
        const dd   = String(now.getDate()).padStart(2,'0')
        const dateStr = `${yyyy}${mm}${dd}`
        const origName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        const displayName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        const displayOrig = origName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        file_name = `${dateStr}_${quote_no}_${displayName}_${displayOrig}.${ext}`
        const asciiName = name.replace(/[^a-zA-Z0-9_-]/g, '') || `cust${Date.now().toString().slice(-4)}`
        const asciiOrig = origName.replace(/[^a-zA-Z0-9_-]/g, '') || `file${Date.now().toString().slice(-4)}`
        const storageFileName = `${dateStr}_${quote_no}_${asciiName}_${asciiOrig}.${ext}`
        storage_path = `${yyyy}/${mm}/${dd}/${quote_no}/${storageFileName}`
        file_path = storage_path
      }

      const baseRow: any = {
        quote_no, name, email, company, phone, note,
        method, material, color, quality, qty, infill,
        vol_cm3: vol, file_name, file_path, auto_price,
        size_x: parseFloat(body.sizeX) || null,
        size_y: parseFloat(body.sizeY) || null,
        size_z: parseFloat(body.sizeZ) || null,
        status: 'pending',
      }
      const fullRow = {
        ...baseRow, address,
        privacy_consent: body.privacy_consent === true,
        marketing_consent: body.marketing_consent === true,
      }

      // 동의·주소 포함 저장 시도. 컬럼 누락 시 기본 필드로 재시도(견적 생성 보장).
      let res = await supabaseAdmin.from('quotes').insert(fullRow).select().single()
      if (res.error && !isUnique(res.error)) {
        console.warn('[API] 동의/주소 포함 저장 실패 → 기본 필드로 재시도(마이그레이션 필요):', res.error.message)
        res = await supabaseAdmin.from('quotes').insert(baseRow).select().single()
      }
      if (res.error) {
        lastErr = res.error
        if (isUnique(res.error)) continue   // 번호 충돌 → 새 번호로 재시도
        throw res.error
      }
      data = res.data
      break
    }
    if (!data) throw lastErr || new Error('견적 생성에 실패했습니다.')

    // ── 고객 접수 확인 이메일 ──────────────────────────
    const fromEmail = process.env.FROM_EMAIL!
    const adminEmail = process.env.ADMIN_EMAIL!
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://3d-print-quote-kappa.vercel.app'

    console.log('[EMAIL] FROM:', fromEmail, '/ TO(고객):', email, '/ TO(관리자):', adminEmail, '/ SITE:', siteUrl)

    const customerEmailResult = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `[${quote_no}] 3D 프린팅 견적 요청이 접수되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <div style="margin-bottom:24px;">
            <h2 style="font-size:20px;margin:0 0 6px;color:#1a1a1a;">견적 요청 접수 확인</h2>
            <p style="color:#6b7280;margin:0;font-size:14px;">안녕하세요 <b>${esc(name)}</b>님, 견적 요청이 정상적으로 접수되었습니다.</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;width:120px;">견적 번호</td><td style="padding:10px 0;font-weight:700;color:#2563eb;">${quote_no}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">출력 방식</td><td style="padding:10px 0;">${esc(method)}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">소재</td><td style="padding:10px 0;">${esc(material)}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">색상</td><td style="padding:10px 0;">${esc(color)}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">수량</td><td style="padding:10px 0;">${qty}개</td></tr>
            ${file_name ? `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">파일명</td><td style="padding:10px 0;">${esc(file_name)}</td></tr>` : ''}
            ${auto_price ? `<tr><td style="padding:10px 0;color:#6b7280;">예상 금액</td><td style="padding:10px 0;font-weight:700;font-size:16px;color:#15803d;">₩${auto_price.toLocaleString('ko-KR')} (VAT 별도)</td></tr>` : ''}
          </table>
          ${note ? `<div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#374151;"><b>요청 사항:</b> ${esc(note)}</div>` : ''}
          <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e;">
            담당자 검토 후 <b>1~2 영업일 이내</b> 최종 확정 견적을 이메일로 안내드립니다.
          </div>
        </div>
      `,
    })
    if (customerEmailResult.error) {
      console.error('[EMAIL] 고객 발송 실패:', JSON.stringify(customerEmailResult.error))
    } else {
      console.log('[EMAIL] 고객 발송 성공:', customerEmailResult.data?.id)
    }

    // ── 관리자 알림 이메일 ──────────────────────────────
    const adminEmailResult = await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `[새 견적 ${quote_no}] ${name} — ${method} ${qty}개`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:18px;margin:0 0 20px;color:#1a1a1a;">새 견적 요청이 접수되었습니다</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;width:120px;">견적 번호</td><td style="padding:10px 0;font-weight:700;color:#2563eb;">${quote_no}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">고객명</td><td style="padding:10px 0;font-weight:600;">${esc(name)} (${esc(company) || '개인'})</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">연락처</td><td style="padding:10px 0;">${esc(email)}${phone ? ' / ' + esc(phone) : ''}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">방식 / 소재</td><td style="padding:10px 0;">${esc(method)} / ${esc(material)}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">색상 / 품질</td><td style="padding:10px 0;">${esc(color)} / ${esc(quality)}</td></tr>
            <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">수량</td><td style="padding:10px 0;">${qty}개</td></tr>
            ${vol > 0 ? `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">추정 부피</td><td style="padding:10px 0;">~${vol} cm³</td></tr>` : ''}
            ${auto_price ? `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">자동 견적가</td><td style="padding:10px 0;font-weight:700;color:#15803d;">₩${auto_price.toLocaleString('ko-KR')}</td></tr>` : ''}
            ${file_name ? `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">업로드 파일</td><td style="padding:10px 0;">${esc(file_name)}</td></tr>` : ''}
            ${note ? `<tr><td style="padding:10px 0;color:#6b7280;">요청 사항</td><td style="padding:10px 0;">${esc(note)}</td></tr>` : ''}
          </table>
          <a href="${siteUrl}/admin" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
            관리자 페이지에서 확인하기
          </a>
        </div>
      `,
    })
    if (adminEmailResult.error) {
      console.error('[EMAIL] 관리자 발송 실패:', JSON.stringify(adminEmailResult.error))
    } else {
      console.log('[EMAIL] 관리자 발송 성공:', adminEmailResult.data?.id)
    }

    return NextResponse.json({ ok: true, quote_no, storage_path })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ── GET: 견적 목록 조회 (관리자용) ─────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
