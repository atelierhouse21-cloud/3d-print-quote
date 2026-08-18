import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'

// 이메일 HTML 사용자 입력값 이스케이프(주입 방지)
const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string))
import { krw, priceBreakdown } from '@/lib/constants'

const resend = new Resend(process.env.RESEND_API_KEY || 're_missing_key')

// 이메일 템플릿 함수들
function getStatusEmailTemplate(status: string, quote: any, trackingNumber?: string, shippingCompany?: string, issueNote?: string) {
  const templates: Record<string, any> = {
    payment_confirmed: {
      subject: `[${quote.quote_no}] 결제가 확인되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">결제 확인 완료</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">결제가 정상적으로 확인되었습니다. 곧 작업을 시작하겠습니다.</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;font-size:13px;color:#14532d;">
            <b>견적 번호:</b> ${quote.quote_no}<br/>
            <b>확정 금액:</b> ${krw(quote.final_price || quote.auto_price)} (VAT 별도)
          </div>
        </div>
      `
    },
    printing: {
      subject: `[${quote.quote_no}] 3D 출력 작업이 시작되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">출력 작업 진행 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">3D 프린팅 출력 작업이 진행 중입니다.</p>
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px 16px;font-size:13px;color:#1e40af;">
            <b>견적 번호:</b> ${quote.quote_no}<br/>
            <b>출력 방식:</b> ${esc(quote.method)}<br/>
            <b>예상 완료:</b> ${esc(quote.final_days) || '영업일 기준'}
          </div>
        </div>
      `
    },
    post_processing: {
      subject: `[${quote.quote_no}] 출력 완료 - 후처리 진행 중`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">후처리 작업 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">3D 출력이 완료되었습니다. 현재 표면 처리 및 마감 작업을 진행하고 있습니다.</p>
          <div style="background:#fef3f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;font-size:13px;color:#991b1b;">
            <b>견적 번호:</b> ${quote.quote_no}<br/>
            <b>진행 상태:</b> 후처리 중
          </div>
        </div>
      `
    },
    shipping_ready: {
      subject: `[${quote.quote_no}] 작업 완료 - 배송 준비 중`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">배송 준비 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">모든 작업이 완료되었습니다. 현재 배송 준비 중이며, 발송 후 송장번호를 안내드리겠습니다.</p>
          <div style="background:#f0fdfa;border:1px solid #5eead4;border-radius:8px;padding:12px 16px;font-size:13px;color:#134e4a;">
            <b>견적 번호:</b> ${quote.quote_no}<br/>
            <b>진행 상태:</b> 배송 준비 완료
          </div>
        </div>
      `
    },
    issue_reported: {
      subject: `[${quote.quote_no}] 문제 상황이 접수되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">문제 상황 접수</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">주문하신 제품에 문제가 발생하여 확인 중입니다. 빠른 시일 내에 해결 방안을 안내드리겠습니다.</p>
          <div style="background:#fef2f2;border:2px solid #ef4444;border-radius:8px;padding:16px;font-size:14px;color:#991b1b;">
            <div style="font-weight:700;margin-bottom:8px;">견적 번호: ${quote.quote_no}</div>
            ${issueNote ? `<div style="margin-bottom:8px;white-space:pre-wrap;"><b>문제 내용:</b> ${esc(issueNote)}</div>` : ''}
            <div>담당자가 확인 후 개별 연락드리겠습니다.</div>
          </div>
          <p style="margin-top:16px;font-size:13px;color:#6b7280;">문의사항은 <a href="mailto:atelierhuse21@gmail.com" style="color:#2563eb;font-weight:600;text-decoration:none;">atelierhuse21@gmail.com</a>으로 연락 주시기 바랍니다.</p>
        </div>
      `
    },
    shipped: {
      subject: `[${quote.quote_no}] 발송이 완료되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">발송 완료</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
          <p style="margin-bottom:20px;">제품 발송이 완료되었습니다. 아래 정보로 배송 조회가 가능합니다.</p>
          <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:16px;font-size:14px;color:#14532d;">
            <div style="display:grid;grid-template-columns:100px 1fr;gap:12px;margin-bottom:12px;">
              <div style="color:#6b7280;font-weight:600;">배송사</div>
              <div style="font-weight:700;">${esc(shippingCompany) || '-'}</div>
            </div>
            <div style="display:grid;grid-template-columns:100px 1fr;gap:12px;">
              <div style="color:#6b7280;font-weight:600;">송장번호</div>
              <div style="font-size:18px;font-weight:800;color:#15803d;">${esc(trackingNumber) || '-'}</div>
            </div>
          </div>
          <p style="margin-top:16px;font-size:13px;color:#6b7280;">택배사 홈페이지에서 배송 현황을 확인하실 수 있습니다.</p>
        </div>
      `
    }
  }
  return templates[status]
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const { action } = body

    // 견적 조회
    const { data: quote, error: fetchErr } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', params.id)
      .single()
    if (fetchErr || !quote) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    console.log('[API] Action:', action, '/ Quote:', quote.quote_no)

    // 단계별 처리 시각 기록 (컬럼 없을 수 있어 best-effort)
    const stampStage = async (statusKey: string) => {
      const merged = { ...((quote as any).stage_times || {}), [statusKey]: new Date().toISOString() }
      const { error } = await supabaseAdmin.from('quotes').update({ stage_times: merged }).eq('id', params.id)
      if (error) console.warn('[API] 단계 시각 저장 생략(stage_times 컬럼 누락 가능):', error.message)
    }

    // ── 견적 삭제(소프트) ──
    if (action === 'soft_delete') {
      const reason = (body.reason || '').trim()
      // deleted_at 먼저 기록 (필수) — 컬럼 없으면 마이그레이션 안내
      const update: any = { deleted_at: new Date().toISOString() }
      if (reason) update.admin_note = [quote.admin_note, reason].filter(Boolean).join(' | ')
      const { error: delErr } = await supabaseAdmin
        .from('quotes')
        .update(update)
        .eq('id', params.id)
      if (delErr) {
        return NextResponse.json({
          ok: false,
          error: '삭제용 컬럼(deleted_at)이 없습니다. migration2 SQL을 먼저 실행하세요. (' + delErr.message + ')'
        }, { status: 500 })
      }
      // 업로드 파일 제거 (best-effort)
      if (quote.file_path) {
        const { error: rmErr } = await supabaseAdmin.storage.from('quote-files').remove([quote.file_path])
        if (rmErr) console.warn('[API] 파일 삭제 생략:', rmErr.message)
      }
      console.log('[API] Soft-deleted:', quote.quote_no)
      return NextResponse.json({ ok: true })
    }

    // ── 상태 변경 ──
    if (action === 'change_status') {
      const { status } = body
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ status })
        .eq('id', params.id)
      if (updateErr) throw updateErr
      await stampStage(status)

      console.log('[API] Status changed to:', status)

      // 이메일 발송 (approved, rejected, pending 제외)
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        const template = getStatusEmailTemplate(status, quote)
        if (template) {
          console.log('[EMAIL] Sending to:', quote.email, '/ Subject:', template.subject)
          const emailResult = await resend.emails.send({
            from: process.env.FROM_EMAIL!,
            to: quote.email,
            subject: template.subject,
            html: template.html,
          })
          if (emailResult.error) {
            console.error('[EMAIL] 발송 실패:', JSON.stringify(emailResult.error))
          } else {
            console.log('[EMAIL] 발송 성공:', emailResult.data?.id)
          }
        }
      }

      return NextResponse.json({ ok: true })
    }

    // ── 배송 완료 처리 ──
    if (action === 'ship') {
      const { shipping_company, tracking_number } = body

      // 1) 상태 변경 — 반드시 성공
      const { error: statusErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'shipped' })
        .eq('id', params.id)
      if (statusErr) throw statusErr

      // 2) 배송사/송장 저장 — 컬럼이 없을 수 있으므로 실패해도 진행
      const { error: extraErr } = await supabaseAdmin
        .from('quotes')
        .update({ shipping_company, tracking_number })
        .eq('id', params.id)
      if (extraErr) console.warn('[API] 배송정보 저장 생략(스키마 컬럼 누락 가능):', extraErr.message)
      await stampStage('shipped')

      console.log('[API] Shipped / Company:', shipping_company, '/ Tracking:', tracking_number)

      const template = getStatusEmailTemplate('shipped', quote, tracking_number, shipping_company)
      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to: quote.email,
        subject: template.subject,
        html: template.html,
      })
      if (emailResult.error) {
        console.error('[EMAIL] 발송 실패:', JSON.stringify(emailResult.error))
      } else {
        console.log('[EMAIL] 발송 성공:', emailResult.data?.id)
      }

      return NextResponse.json({ ok: true })
    }

    // ── 기존 승인/거절 ──
    if (action === 'approve') {
      // 미입력 시 기존 정보로 확정: 금액은 자동 견적가, 납기는 클라이언트가 보낸 예상 납기
      const finalPrice = (body.final_price !== null && body.final_price !== undefined && body.final_price !== '')
        ? Number(body.final_price)
        : (quote.auto_price ?? null)
      const finalDays = body.final_days || '영업일 기준 협의'
      const adminNote = body.admin_note ?? null

      // 1) 상태 변경 — status 컬럼은 항상 존재하므로 반드시 성공
      const { error: statusErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'approved' })
        .eq('id', params.id)
      if (statusErr) throw statusErr

      // 2) 확정 금액/납기/메모 저장 — 해당 컬럼이 없을 수 있으므로 실패해도 진행
      const { error: extraErr } = await supabaseAdmin
        .from('quotes')
        .update({ final_price: finalPrice, final_days: finalDays, admin_note: adminNote })
        .eq('id', params.id)
      if (extraErr) console.warn('[API] 확정 부가정보 저장 생략(스키마 컬럼 누락 가능):', extraErr.message)
      await stampStage('approved')

      console.log('[API] Approved / Price:', finalPrice, '/ Days:', finalDays)

      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to: quote.email,
        subject: `[${quote.quote_no}] 견적이 확정되었습니다`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
            <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">견적 확정 안내</h2>
            <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
            <p style="margin-bottom:20px;">요청하신 견적이 확정되었습니다.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;width:120px;">견적 번호</td><td style="padding:10px 0;font-weight:700;">${quote.quote_no}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:9px 0;color:#6b7280;">공급가</td><td style="padding:9px 0;text-align:right;">${krw(priceBreakdown(finalPrice).supply)}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:9px 0;color:#6b7280;">부가세 (10%)</td><td style="padding:9px 0;text-align:right;">${krw(priceBreakdown(finalPrice).vat)}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:9px 0;color:#6b7280;">배송비</td><td style="padding:9px 0;text-align:right;">${krw(priceBreakdown(finalPrice).shipping)}</td></tr>
              <tr style="border-bottom:2px solid #e5e7eb;"><td style="padding:11px 0;color:#1a1a1a;font-weight:700;">합계 (VAT·배송비 포함)</td><td style="padding:11px 0;text-align:right;font-weight:800;font-size:18px;color:#15803d;">${krw(priceBreakdown(finalPrice).total)}</td></tr>
              <tr><td style="padding:10px 0;color:#6b7280;">예상 납기</td><td style="padding:10px 0;text-align:right;font-weight:600;">${esc(finalDays)}</td></tr>
            </table>
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;font-size:14px;color:#0c4a6e;margin-bottom:12px;">
              <div style="font-weight:700;margin-bottom:10px;">입금 안내</div>
              <p style="margin:0 0 6px;color:#0369a1;">아래 <b>합계 금액(부가세·배송비 포함) ${krw(priceBreakdown(finalPrice).total)}</b> 을 아래 계좌로 이체해 주시기 바랍니다. 입금이 확인되면 작업이 진행됩니다.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:6px;margin-top:8px;">
                <tr><td style="padding:8px 12px;color:#6b7280;width:90px;">예금주</td><td style="padding:8px 12px;font-weight:600;">하창호</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;">은행</td><td style="padding:8px 12px;font-weight:600;">기업은행</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;">계좌번호</td><td style="padding:8px 12px;font-weight:700;">617-056957-01-013</td></tr>
              </table>
            </div>
          </div>
        `,
      })
      if (emailResult.error) {
        console.error('[EMAIL] 발송 실패:', JSON.stringify(emailResult.error))
      } else {
        console.log('[EMAIL] 발송 성공:', emailResult.data?.id)
      }

      return NextResponse.json({ ok: true })
    } else if (action === 'reject') {
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'rejected' })
        .eq('id', params.id)
      if (updateErr) throw updateErr
      await stampStage('rejected')

      console.log('[API] Rejected')

      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to: quote.email,
        subject: `[${quote.quote_no}] 견적 요청 결과 안내`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
            <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">견적 요청 결과</h2>
            <p style="margin-bottom:16px;">안녕하세요 <b>${esc(quote.name)}</b>님,</p>
            <p style="margin-bottom:20px;">요청하신 견적 건(${quote.quote_no})은 현재 진행이 어려운 상황입니다.</p>
            <p style="color:#6b7280;font-size:13px;">문의사항이 있으시면 <a href="mailto:atelierhuse21@gmail.com" style="color:#2563eb;font-weight:600;text-decoration:none;">atelierhuse21@gmail.com</a>으로 연락 주시기 바랍니다.</p>
          </div>
        `,
      })
      if (emailResult.error) {
        console.error('[EMAIL] 발송 실패:', JSON.stringify(emailResult.error))
      } else {
        console.log('[EMAIL] 발송 성공:', emailResult.data?.id)
      }

      return NextResponse.json({ ok: true })
    }

    // ── 문제 상황 업데이트 ──
    // ── 문제 상황 접수 (내용 작성 + 메일에 내용 포함) ──
    if (action === 'report_issue') {
      const issueNote = (body.issue_note || '').trim()
      if (!issueNote) {
        return NextResponse.json({ ok: false, error: '문제 상황 내용을 입력하세요.' }, { status: 400 })
      }
      // 1) 상태 변경 — 반드시 성공
      const { error: statusErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'issue_reported' })
        .eq('id', params.id)
      if (statusErr) throw statusErr
      // 2) 내용 저장 — 컬럼 없을 수 있어 best-effort
      const { error: noteErr } = await supabaseAdmin
        .from('quotes')
        .update({ issue_note: issueNote })
        .eq('id', params.id)
      if (noteErr) console.warn('[API] issue_note 저장 생략(컬럼 누락 가능):', noteErr.message)
      await stampStage('issue_reported')

      // 3) 내용 포함 메일 발송
      const template = getStatusEmailTemplate('issue_reported', quote, undefined, undefined, issueNote)
      if (template) {
        const emailResult = await resend.emails.send({
          from: process.env.FROM_EMAIL!,
          to: quote.email,
          subject: template.subject,
          html: template.html,
        })
        if (emailResult.error) console.error('[EMAIL] 발송 실패:', JSON.stringify(emailResult.error))
        else console.log('[EMAIL] 발송 성공:', emailResult.data?.id)
      }
      console.log('[API] Issue reported with note')
      return NextResponse.json({ ok: true })
    }

    // ── A/S 접수: 동일 내용으로 새 견적 생성 (견적번호 뒤에 AS01, AS02…) ──
    if (action === 'create_as') {
      // 루트 견적번호 기준으로 다음 AS 번호 계산 (AS 중첩 방지)
      const rootNo = String(quote.quote_no).replace(/AS\d+$/i, '')
      const { data: siblings } = await supabaseAdmin
        .from('quotes')
        .select('quote_no')
        .like('quote_no', `${rootNo}AS%`)
      const nextIdx = (siblings?.length ?? 0) + 1
      const asQuoteNo = `${rootNo}AS${String(nextIdx).padStart(2, '0')}`

      const asNote = `[A/S 접수 — 원본 ${quote.quote_no}]` + (quote.note ? `\n${quote.note}` : '')
      const { data: asRow, error: insErr } = await supabaseAdmin
        .from('quotes')
        .insert({
          quote_no: asQuoteNo,
          name: quote.name, email: quote.email, company: quote.company, phone: quote.phone,
          note: asNote,
          method: quote.method, material: quote.material, color: quote.color, quality: quote.quality,
          qty: quote.qty, infill: quote.infill ?? 20,
          vol_cm3: quote.vol_cm3, file_name: quote.file_name, file_path: quote.file_path,
          auto_price: quote.auto_price,
          size_x: quote.size_x ?? null, size_y: quote.size_y ?? null, size_z: quote.size_z ?? null,
          status: 'pending',
        })
        .select()
        .single()
      if (insErr) throw insErr

      // 원본 처리정보 스냅샷 저장 — 컬럼 없을 수 있어 best-effort
      const asOrigin = {
        quote_no: quote.quote_no,
        shipping_company: quote.shipping_company ?? null,
        tracking_number: quote.tracking_number ?? null,
        final_price: quote.final_price ?? null,
        final_days: quote.final_days ?? null,
        shipped_at: quote.stage_times?.shipped ?? null,
      }
      const { error: origErr } = await supabaseAdmin
        .from('quotes')
        .update({ as_origin: asOrigin })
        .eq('id', asRow.id)
      if (origErr) console.warn('[API] as_origin 저장 생략(컬럼 누락 가능):', origErr.message)

      console.log('[API] A/S quote created:', asQuoteNo)
      return NextResponse.json({ ok: true, quote_no: asQuoteNo })
    }

    if (action === 'update_issue') {
      const { issue_note } = body
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ issue_note })
        .eq('id', params.id)
      if (updateErr) throw updateErr

      console.log('[API] Issue note updated')
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e: any) {
    console.error('[API] Error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
