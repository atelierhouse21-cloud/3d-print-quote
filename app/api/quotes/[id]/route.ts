export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { krw } from '@/lib/constants'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const pw = req.headers.get('x-admin-password')
  if (pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { status, admin_price, admin_days, admin_note } = body
  const supabaseAdmin = getSupabaseAdmin()

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .update({ status, admin_price, admin_days, admin_note })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (status === 'approved') {
    await resend.emails.send({
      from: process.env.FROM_EMAIL!,
      to: quote.email,
      subject: `[${quote.quote_no}] 3D 프린팅 견적이 확정되었습니다 ✅`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;">
          <h2 style="font-size:20px;margin-bottom:8px;">견적 확정 안내</h2>
          <p style="color:#6b7280;margin-bottom:24px;">안녕하세요 <b>${quote.name}</b>님, 담당자 검토가 완료되어 최종 견적을 안내드립니다.</p>
          <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:20px;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">확정 금액 (VAT 별도)</div>
            <div style="font-size:28px;font-weight:800;color:#15803d;">${krw(admin_price ?? quote.auto_price)}</div>
            ${admin_days ? `<div style="margin-top:10px;font-size:13px;color:#6b7280;">납기: <b>${admin_days}</b> (영업일 기준)</div>` : ''}
          </div>
          ${admin_note ? `<p style="font-size:14px;margin-bottom:16px;padding:14px;background:#f9fafb;border-radius:8px;">${admin_note}</p>` : ''}
          <p style="font-size:13px;color:#6b7280;">주문 진행을 원하시면 이 이메일에 회신하거나 담당자에게 연락 주세요.</p>
        </div>
      `,
    }).catch(() => {})
  } else if (status === 'rejected') {
    await resend.emails.send({
      from: process.env.FROM_EMAIL!,
      to: quote.email,
      subject: `[${quote.quote_no}] 견적 요청 결과 안내`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;">
          <h2 style="font-size:20px;margin-bottom:8px;">견적 요청 결과 안내</h2>
          <p style="color:#6b7280;margin-bottom:16px;">안녕하세요 <b>${quote.name}</b>님, 아쉽게도 현재 요청하신 조건으로는 출력이 어렵습니다.</p>
          ${admin_note ? `<p style="font-size:14px;padding:14px;background:#fef2f2;border-radius:8px;margin-bottom:16px;">${admin_note}</p>` : ''}
          <p style="font-size:13px;color:#6b7280;">궁금하신 사항은 담당자에게 문의해 주세요.</p>
        </div>
      `,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
