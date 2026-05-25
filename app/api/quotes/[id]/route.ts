import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { krw } from '@/lib/constants'

const resend = new Resend(process.env.RESEND_API_KEY)

// 이메일 템플릿 함수들
function getStatusEmailTemplate(status: string, quote: any, trackingNumber?: string, shippingCompany?: string) {
  const templates: Record<string, any> = {
    payment_confirmed: {
      subject: `[${quote.quote_no}] 결제가 확인되었습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">💳 결제 확인 완료</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
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
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">🖨️ 출력 작업 진행 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
          <p style="margin-bottom:20px;">3D 프린팅 출력 작업이 진행 중입니다.</p>
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px 16px;font-size:13px;color:#1e40af;">
            <b>견적 번호:</b> ${quote.quote_no}<br/>
            <b>출력 방식:</b> ${quote.method}<br/>
            <b>예상 완료:</b> ${quote.final_days || '영업일 기준'}
          </div>
        </div>
      `
    },
    post_processing: {
      subject: `[${quote.quote_no}] 출력 완료 - 후처리 진행 중`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">✨ 후처리 작업 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
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
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">📦 배송 준비 중</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
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
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">⚠️ 문제 상황 접수</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
          <p style="margin-bottom:20px;">주문하신 제품에 문제가 발생하여 확인 중입니다. 빠른 시일 내에 해결 방안을 안내드리겠습니다.</p>
          <div style="background:#fef2f2;border:2px solid #ef4444;border-radius:8px;padding:16px;font-size:14px;color:#991b1b;">
            <div style="font-weight:700;margin-bottom:8px;">견적 번호: ${quote.quote_no}</div>
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
          <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">🚚 발송 완료</h2>
          <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
          <p style="margin-bottom:20px;">제품 발송이 완료되었습니다. 아래 정보로 배송 조회가 가능합니다.</p>
          <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:16px;font-size:14px;color:#14532d;">
            <div style="display:grid;grid-template-columns:100px 1fr;gap:12px;margin-bottom:12px;">
              <div style="color:#6b7280;font-weight:600;">배송사</div>
              <div style="font-weight:700;">${shippingCompany || '-'}</div>
            </div>
            <div style="display:grid;grid-template-columns:100px 1fr;gap:12px;">
              <div style="color:#6b7280;font-weight:600;">송장번호</div>
              <div style="font-size:18px;font-weight:800;color:#15803d;">${trackingNumber || '-'}</div>
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
    const pw = req.headers.get('x-admin-password')
    if (pw !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

    // ── 상태 변경 ──
    if (action === 'change_status') {
      const { status } = body
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ status })
        .eq('id', params.id)
      if (updateErr) throw updateErr

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
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'shipped', shipping_company, tracking_number })
        .eq('id', params.id)
      if (updateErr) throw updateErr

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
      const { final_price, final_days } = body
      const { error: updateErr } = await supabaseAdmin
        .from('quotes')
        .update({ status: 'approved', final_price, final_days })
        .eq('id', params.id)
      if (updateErr) throw updateErr

      console.log('[API] Approved / Price:', final_price, '/ Days:', final_days)

      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to: quote.email,
        subject: `[${quote.quote_no}] 견적이 확정되었습니다`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
            <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">✅ 견적 확정 안내</h2>
            <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
            <p style="margin-bottom:20px;">요청하신 견적이 확정되었습니다.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;width:120px;">견적 번호</td><td style="padding:10px 0;font-weight:700;">${quote.quote_no}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#6b7280;">확정 금액</td><td style="padding:10px 0;font-weight:700;font-size:18px;color:#15803d;">${krw(final_price)} (VAT 별도)</td></tr>
              <tr><td style="padding:10px 0;color:#6b7280;">예상 납기</td><td style="padding:10px 0;font-weight:600;">${final_days}</td></tr>
            </table>
            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e;">
              입금 확인 후 작업을 시작합니다.
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

      console.log('[API] Rejected')

      const emailResult = await resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to: quote.email,
        subject: `[${quote.quote_no}] 견적 요청 결과 안내`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
            <h2 style="font-size:20px;margin:0 0 16px;color:#1a1a1a;">견적 요청 결과</h2>
            <p style="margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님,</p>
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
