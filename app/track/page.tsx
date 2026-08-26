'use client'
import { useEffect, useState } from 'react'

// 처리 시각 포맷: YYMMDD_HH:MM:SS (24시간, 한국시간)
function fmtStageTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Seoul', year:'2-digit', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}${g('month')}${g('day')}_${g('hour')}:${g('minute')}:${g('second')}`
}

const STATUS_LABEL: Record<string, string> = {
  pending:'검토중', approved:'견적 확정', payment_confirmed:'결제 확인',
  printing:'출력 중', post_processing:'후처리 중', shipping_ready:'배송 준비',
  shipped:'발송 완료', rejected:'거절됨',
}

type TrackData = {
  quote_no: string; status: string; stage_times: Record<string,string>
  created_at: string; final_days: string | null
  shipping_company: string | null; tracking_number: string | null
}

function Milestone({ data }: { data: TrackData }) {
  const steps = [
    { key:'pending', label:'검토중' }, { key:'approved', label:'견적확정' },
    { key:'payment_confirmed', label:'결제확인' }, { key:'printing', label:'출력중' },
    { key:'post_processing', label:'후처리' }, { key:'shipping_ready', label:'배송준비' },
    { key:'shipped', label:'발송완료' },
  ]
  const currentIdx = steps.findIndex(s => s.key === data.status)
  const times = data.stage_times || {}
  const timeFor = (key: string) => key === 'pending' ? data.created_at : times[key]
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:6, padding:'8px 0', overflowX:'auto' }}>
      {steps.map((step, idx) => {
        const isPast = currentIdx >= 0 && idx < currentIdx
        const isCurrent = idx === currentIdx
        const t = fmtStageTime(timeFor(step.key))
        return (
          <div key={step.key} style={{ display:'flex', alignItems:'flex-start', flex:'1 0 auto', minWidth:46 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
              <div style={{ width:32, height:32, borderRadius:'50%',
                background: isCurrent?'#d4a72c':isPast?'#10b981':'#33333a',
                color: isCurrent||isPast?'#fff':'#9ca3af',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, marginBottom:6 }}>
                {idx+1}
              </div>
              <div style={{ fontSize:11, fontWeight:600, whiteSpace:'nowrap', color: isCurrent?'#d4a72c':isPast?'#10b981':'#9ca3af' }}>
                {step.label}
              </div>
              <div style={{ fontSize:8.5, color:'#8a8a90', marginTop:3, minHeight:11, textAlign:'center', lineHeight:1.25, letterSpacing:'-.2px' }}>
                {t}
              </div>
            </div>
            {idx < steps.length-1 && (
              <div style={{ height:2, flex:'0 0 10px', marginTop:15, background: isPast?'#10b981':'#33333a' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function TrackPage() {
  const [code, setCode] = useState('')
  const [data, setData] = useState<TrackData | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const lookup = async (c: string) => {
    const v = c.trim().toUpperCase()
    if (!v) { setErr('확인 번호를 입력해 주세요.'); return }
    setLoading(true); setErr(''); setData(null)
    try {
      const res = await fetch(`/api/track?code=${encodeURIComponent(v)}&t=${Date.now()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setErr(json.error || '조회에 실패했습니다.'); setData(null) }
      else setData(json)
    } catch { setErr('조회 중 오류가 발생했습니다.') }
    finally { setLoading(false); setSearched(true) }
  }

  // 메일 링크(?code=)로 들어오면 자동 조회 + 입력창 채우기
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('code')
    if (c) { setCode(c); lookup(c) }
  }, [])

  const inp: React.CSSProperties = { flex:1, minWidth:0, padding:'11px 14px', border:'1.5px solid #33333a', borderRadius:10, fontSize:15, letterSpacing:1 }
  const btn: React.CSSProperties = { padding:'11px 20px', borderRadius:10, border:'none', background:'#d4a72c', color:'#fff', fontSize:15, fontWeight:600, cursor:'pointer', flexShrink:0 }

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'40px 20px 80px' }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>작업 진행상황 조회</h1>
      <p style={{ color:'#a1a1aa', fontSize:14, marginBottom:20 }}>접수 안내 메일로 받으신 <b>고객 확인 번호</b>를 입력하시면 현재 진행 단계를 확인하실 수 있습니다.</p>

      <div style={{ display:'flex', gap:8, marginBottom:8 }}>
        <input value={code} onChange={e=>setCode(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&lookup(code)}
          placeholder="고객 확인 번호 입력" style={inp} autoFocus />
        <button onClick={()=>lookup(code)} disabled={loading} style={{ ...btn, opacity:loading?0.6:1 }}>
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {err && (
        <div style={{ marginTop:16, padding:'12px 16px', background:'#2a1618', border:'1px solid #fca5a5', borderRadius:10, color:'#f87171', fontSize:14 }}>
          {err}
        </div>
      )}

      {data && (
        <div style={{ marginTop:24, border:'1px solid #33333a', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'16px 18px', background:'#1f1f23', borderBottom:'1px solid #33333a', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <div>
              <div style={{ fontSize:12, color:'#8a8a90' }}>견적 번호</div>
              <div style={{ fontSize:18, fontWeight:800, color:'#d4a72c' }}>{data.quote_no}</div>
            </div>
            <span style={{ padding:'4px 14px', borderRadius:20, fontSize:13, fontWeight:700,
              background: data.status==='rejected'?'#2a1618':'#faf6ea',
              color: data.status==='rejected'?'#dc2626':'#b8901f' }}>
              {STATUS_LABEL[data.status] || data.status}
            </span>
          </div>

          <div style={{ padding:'18px' }}>
            {data.status === 'rejected' ? (
              <div style={{ padding:'14px 16px', background:'#2a1618', border:'1px solid #fecaca', borderRadius:10, color:'#f87171', fontSize:14 }}>
                이 견적은 진행이 어려워 거절 처리되었습니다. 자세한 내용은 담당자에게 문의해 주세요.
              </div>
            ) : (
              <>
                <Milestone data={data} />
                <div style={{ marginTop:14, fontSize:13, color:'#a1a1aa', lineHeight:1.8 }}>
                  <div>접수 일시: {fmtStageTime(data.created_at)}</div>
                  {data.final_days && <div>예상 납기: {data.final_days}</div>}
                  {data.shipping_company && <div>배송사: {data.shipping_company}</div>}
                  {data.tracking_number && <div>송장 번호: {data.tracking_number}</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {searched && !data && !err && !loading && (
        <div style={{ marginTop:16, color:'#8a8a90', fontSize:14 }}>조회 결과가 없습니다.</div>
      )}
    </div>
  )
}
