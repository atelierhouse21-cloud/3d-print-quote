import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { calcPrice, calcDays, normalizeSettings, calcPriceFDM, calcPriceV2 } from '@/lib/constants'
import { Resend } from 'resend'
import crypto from 'crypto'

const resend = new Resend(process.env.RESEND_API_KEY)

// 서버에서 파일별 계산 근거를 생성(고객 페이지 버전/캐시와 무관하게 항상 저장)
function buildCalc(fl: any, options: any): any {
  const method = fl.method
  const cfg = options?.[method]
  const vol = parseFloat(fl.vol) || 0
  const qty = parseInt(fl.qty) || 1
  const manual = fl.manualReview === true
  if (!cfg || manual || !vol) return null
  const mat = (cfg.materials || []).find((m: any) => m.name === fl.material)
  const qual = (cfg.qualities || []).find((q: any) => q.name === fl.quality)
  if (!mat || !qual) return null
  const density = Number(mat.density) || 1
  const coeff = Number(mat.coefficient) || 0
  const minPrice = Number(mat.minPrice) || 0
  const factor = Number(qual.factor) || 1
  const infill = qual.infill != null ? Number(qual.infill) : 100
  const r2 = (n: number) => Math.round(n * 100) / 100

  if (method === 'FDM') {
    const surf = Number(fl.surfaceArea) || 0
    const tEff = Number(cfg.shellThickness) > 0 ? Number(cfg.shellThickness) : 1.1
    const kLoss = Number(cfg.lossFactor) > 0 ? Number(cfg.lossFactor) : 1.04
    const alpha = Math.min(Math.max(infill, 0), 100) / 100
    let vShell = surf * (Math.max(tEff, 0) / 10)
    if (vShell > vol) vShell = vol
    const vInfill = Math.max(vol - vShell, 0)
    const mass = density * (vShell + vInfill * alpha) * qty * kLoss
    const price = Math.max(calcPriceFDM(vol, surf, density, coeff, qty, factor, infill, tEff, kLoss), minPrice)
    return { method: 'FDM', volume: vol, surfaceArea: surf, infill, shellThickness: tEff, lossFactor: kLoss,
      density, coefficient: coeff, factor, qty, vShell: r2(vShell), vInfill: r2(vInfill), mass: r2(mass), minPrice, price }
  }
  const price = Math.max(calcPriceV2(vol, density, coeff, qty, factor, infill / 100), minPrice)
  return { method, volume: vol, density, coefficient: coeff, factor, qty,
    materialRatio: infill, mass: r2(vol * density * qty), minPrice, price }
}

// 이메일 HTML에 들어가는 사용자 입력값 이스케이프(주입 방지)
const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string))

// 고객 확인 번호(추측하기 어려운 10자리). 헷갈리는 문자(0,O,1,I,L) 제외.
function genTrackingCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(10)
  let s = ''
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length]
  return s
}

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

    // 업로드 파일 목록(여러 개 지원). 없으면 단일 fileName 으로 폴백.
    const rawFiles: any[] = Array.isArray(body.files) && body.files.length
      ? body.files
      : (fileName ? [{ fileName, method, material, color, quality, qty, vol, sizeX: body.sizeX, sizeY: body.sizeY, sizeZ: body.sizeZ, note: '', price: auto_price }] : [])

    // 계산 근거를 서버에서 생성하기 위해 현재 옵션 설정 로드
    let printOptions: any = {}
    try {
      const { data: setRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'print_options').single()
      printOptions = normalizeSettings(setRow?.value || {})
    } catch { printOptions = {} }

    // 1일 접수 제한(전체 총량) 확인 — 오늘(한국시간) 접수 건수가 제한 이상이면 차단
    try {
      const { data: limitRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'daily_order_limit').single()
      const dailyLimit = Number((limitRow?.value as any)?.limit) || 0
      if (dailyLimit > 0) {
        const now = new Date()
        const kst = new Date(now.getTime() + 9 * 3600 * 1000)
        const startUtc = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0) - 9 * 3600 * 1000)
        const { count } = await supabaseAdmin
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .is('deleted_at', null)
          .gte('created_at', startUtc.toISOString())
        if ((count || 0) >= dailyLimit) {
          return NextResponse.json(
            { error: '금일 견적 접수가 마감되었습니다. 내일 다시 시도해 주세요.' },
            { status: 429 }
          )
        }
      }
    } catch { /* 제한 확인 실패 시 접수는 진행 */ }

    // 견적번호 생성 + 저장 (동시 접수로 번호가 겹치면 새 번호로 재시도)
    let data: any = null
    let quote_no = ''
    let file_name: string | null = null
    let storage_path: string | null = null
    let storagePaths: string[] = []
    let lastErr: any = null

    for (let attempt = 0; attempt < 6; attempt++) {
      quote_no = await getNextQuoteNo()

      const now = new Date()
      const yyyy = now.getFullYear().toString()
      const mm   = String(now.getMonth()+1).padStart(2,'0')
      const dd   = String(now.getDate()).padStart(2,'0')
      const dateStr = `${yyyy}${mm}${dd}`
      const displayName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      const asciiName = name.replace(/[^a-zA-Z0-9_-]/g, '') || `cust${Date.now().toString().slice(-4)}`

      // 파일별 정보 + 저장 경로 생성
      const itemsData = rawFiles.map((fl: any, idx: number) => {
        const fn = String(fl.fileName || `file${idx+1}.stl`)
        const ext = fn.split('.').pop()?.toLowerCase() || 'stl'
        const origName = fn.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        const asciiOrig = origName.replace(/[^a-zA-Z0-9_-]/g, '') || `file${idx+1}`
        const display_name = `${dateStr}_${quote_no}_${displayName}_${origName}.${ext}`
        const storageFileName = `${idx+1}_${dateStr}_${quote_no}_${asciiName}_${asciiOrig}.${ext}`
        const path = `${yyyy}/${mm}/${dd}/${quote_no}/${storageFileName}`
        return {
          file_name: display_name,
          file_path: path,
          method: fl.method ?? method, material: fl.material ?? material,
          color: fl.color ?? color, quality: fl.quality ?? quality,
          qty: parseInt(fl.qty) || qty,
          vol: parseFloat(fl.vol) || 0,
          size_x: parseFloat(fl.sizeX) || null, size_y: parseFloat(fl.sizeY) || null, size_z: parseFloat(fl.sizeZ) || null,
          note: String(fl.note || ''),
          price: (fl.price !== null && fl.price !== undefined && fl.price !== '') ? Number(fl.price) : null,
          manualReview: fl.manualReview === true,
          objectCount: (fl.objectCount !== null && fl.objectCount !== undefined) ? Number(fl.objectCount) : null,
          surfaceArea: (fl.surfaceArea !== null && fl.surfaceArea !== undefined) ? Number(fl.surfaceArea) : null,
          calc: (fl.calc && typeof fl.calc === 'object') ? fl.calc : buildCalc(fl, printOptions),
        }
      })
      const first = itemsData[0] || null
      file_name = first?.file_name ?? null
      storage_path = first?.file_path ?? null
      storagePaths = itemsData.map(d => d.file_path)

      const baseRow: any = {
        quote_no, name, email, company, phone, note,
        method, material, color, quality, qty, infill,
        vol_cm3: vol, file_name, file_path: storage_path, auto_price,
        size_x: parseFloat(body.sizeX) || null,
        size_y: parseFloat(body.sizeY) || null,
        size_z: parseFloat(body.sizeZ) || null,
        status: 'pending',
      }
      const fullRow = {
        ...baseRow, address,
        privacy_consent: body.privacy_consent === true,
        marketing_consent: body.marketing_consent === true,
        tracking_code: genTrackingCode(),
        items: itemsData,
        billing: (body.billing && typeof body.billing === 'object')
          ? { cashReceipt: body.billing.cashReceipt === true, taxInvoice: body.billing.taxInvoice === true, refundPolicyConfirmed: body.billing.refundPolicyConfirmed === true }
          : { cashReceipt: false, taxInvoice: false, refundPolicyConfirmed: false },
      }

      // 확장 컬럼 포함 저장 시도. 컬럼 누락 시 기본 필드로 재시도(견적 생성 보장).
      let res = await supabaseAdmin.from('quotes').insert(fullRow).select().single()
      if (res.error && !isUnique(res.error)) {
        console.warn('[API] 확장 컬럼 저장 실패 → 기본 필드로 재시도(마이그레이션 필요):', res.error.message)
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
          ${data.tracking_code ? `
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:20px;">
            <div style="font-weight:700;color:#1e3a8a;margin-bottom:6px;">진행상황 확인 안내</div>
            <p style="margin:0 0 10px;font-size:13px;color:#1e40af;">아래 고객 확인 번호로 작업 진행상황을 확인하실 수 있습니다. 진행상황 페이지의 입력창에 확인 번호를 입력하시면 현재 단계를 보실 수 있습니다.</p>
            <div style="font-size:12px;color:#6b7280;">고객 확인 번호</div>
            <div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#1d4ed8;margin:2px 0 12px;">${esc(data.tracking_code)}</div>
            <a href="${siteUrl}/track?code=${encodeURIComponent(data.tracking_code)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">진행상황 확인하기</a>
            <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;">버튼이 열리지 않으면 다음 주소에서 확인 번호를 입력하세요: ${siteUrl}/track</p>
          </div>` : ''}
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

    return NextResponse.json({ ok: true, quote_no, storage_path, storage_paths: storagePaths, tracking_code: data.tracking_code || null })
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
