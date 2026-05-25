'use client'
import { useState, useEffect } from 'react'
import { METHODS, krw, calcDays } from '@/lib/constants'
import type { Quote } from '@/lib/constants'

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth:900, margin:'0 auto', padding:'24px 16px 60px' },
  card: { background:'#fff', borderRadius:16, border:'1px solid #e5e7eb' },
  body: { padding:24 },
  btn:  { padding:'9px 20px', borderRadius:9, fontSize:14, fontWeight:600, cursor:'pointer', border:'none', display:'inline-flex', alignItems:'center', gap:6 },
  sBtn: { padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', background:'#fff', color:'#374151', border:'1.5px solid #d1d5db' },
  inp:  { width:'100%', padding:'10px 12px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:14, fontFamily:'inherit', outline:'none' },
  lbl:  { fontSize:12, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.4px', display:'block', marginBottom:6 } as React.CSSProperties,
  grp:  { display:'flex', flexDirection:'column', gap:6 },
}

const BADGE: Record<string, React.CSSProperties> = {
  pending:  { background:'#fffbeb', color:'#92400e', border:'1px solid #fcd34d' },
  approved: { background:'#f0fdf4', color:'#14532d', border:'1px solid #86efac' },
  payment_confirmed: { background:'#eff6ff', color:'#1e40af', border:'1px solid #93c5fd' },
  printing: { background:'#f5f3ff', color:'#5b21b6', border:'1px solid #c4b5fd' },
  post_processing: { background:'#fdf4ff', color:'#86198f', border:'1px solid #f0abfc' },
  shipping_ready: { background:'#f0fdfa', color:'#134e4a', border:'1px solid #5eead4' },
  shipped: { background:'#f0fdf4', color:'#14532d', border:'1px solid #86efac' },
  issue_reported: { background:'#fef2f2', color:'#991b1b', border:'1px solid #fca5a5' },
  rejected: { background:'#fef2f2', color:'#7f1d1d', border:'1px solid #fca5a5' },
}

const BADGE_LABEL: Record<string, string> = { 
  pending:'검토 중', 
  approved:'승인됨', 
  payment_confirmed:'결제 확인',
  printing:'출력 중',
  post_processing:'후처리 중',
  shipping_ready:'배송 준비',
  shipped:'발송 완료',
  issue_reported:'문제 상황',
  rejected:'거절됨' 
}

const STATUS_LABELS: Record<string, string> = {
  pending: '검토중',
  approved: '견적 확정',
  payment_confirmed: '결제 확인',
  printing: '출력 중',
  post_processing: '후처리 중',
  shipping_ready: '배송 준비',
  shipped: '발송 완료',
  issue_reported: '문제 상황 접수',
  rejected: '거절',
}

// Supabase Storage 파일 다운로드
async function downloadFile(filePath: string, fileName: string, password: string) {
  try {
    const res = await fetch(`/api/admin/download?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-admin-password': password }
    })
    if (!res.ok) throw new Error('다운로드 실패')
    const { url } = await res.json()
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  } catch (e: any) {
    alert('다운로드 오류: ' + e.message)
  }
}

// 마일스톤 UI
function Milestone({ status }: { status: string }) {
  const steps = [
    { key: 'pending', label: '검토중' },
    { key: 'approved', label: '견적확정' },
    { key: 'payment_confirmed', label: '결제확인' },
    { key: 'printing', label: '출력중' },
    { key: 'post_processing', label: '후처리' },
    { key: 'shipping_ready', label: '배송준비' },
    { key: 'shipped', label: '발송완료' },
  ]
  
  const currentIdx = steps.findIndex(s => s.key === status)
  
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'16px 0', borderBottom:'1px solid #e5e7eb' }}>
      {steps.map((step, idx) => {
        const isPast = idx < currentIdx
        const isCurrent = idx === currentIdx
        
        return (
          <div key={step.key} style={{ display:'flex', alignItems:'center', flex:1 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
              <div style={{
                width:32, height:32, borderRadius:'50%',
                background: isCurrent ? '#2563eb' : isPast ? '#10b981' : '#e5e7eb',
                color: isCurrent || isPast ? '#fff' : '#9ca3af',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12, fontWeight:700,
                marginBottom:6
              }}>
                {isPast ? '✓' : idx+1}
              </div>
              <div style={{
                fontSize:11, fontWeight:600,
                color: isCurrent ? '#2563eb' : isPast ? '#10b981' : '#9ca3af'
              }}>
                {step.label}
              </div>
            </div>
            {idx < steps.length - 1 && (
              <div style={{
                flex:0.5, height:2,
                background: isPast ? '#10b981' : '#e5e7eb',
                marginBottom:28
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed]     = useState(false)
  const [quotes, setQuotes]     = useState<Quote[]>([])
  const [sel, setSel]           = useState<Quote | null>(null)
  const [loading, setLoading]   = useState(false)
  const [aForm, setAForm]       = useState({ price:'', days:'', note:'' })
  const [filter, setFilter]     = useState<'all'|'pending'|'approved'|'rejected'>('all')

  const fetchQuotes = async (pw: string) => {
    const res = await fetch('/api/quotes', { headers: { 'x-admin-password': pw } })
    if (!res.ok) throw new Error('인증 실패')
    return res.json() as Promise<Quote[]>
  }

  const login = async () => {
    setLoading(true)
    try {
      const data = await fetchQuotes(password)
      setQuotes(data); setAuthed(true)
    } catch { alert('비밀번호가 올바르지 않습니다.') }
    finally { setLoading(false) }
  }

  const refresh = async () => {
    const data = await fetchQuotes(password)
    setQuotes(data)
  }

  const decide = async (status: 'approved'|'rejected') => {
    if (!sel) return
    setLoading(true)
    try {
      await fetch(`/api/quotes/${sel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: status === 'approved' ? 'approve' : 'reject',
          final_price: aForm.price ? parseInt(aForm.price.replace(/\D/g,'')) : null,
          final_days: aForm.days || calcDays(sel.method, sel.qty),
          admin_note: aForm.note,
        }),
      })
      await refresh()
      setSel(null)
    } catch (e: any) { alert('오류: ' + e.message) }
    finally { setLoading(false) }
  }

  const filtered = quotes.filter(q => filter === 'all' || q.status === filter)
  const counts = {
    pending:  quotes.filter(q=>q.status==='pending').length,
    approved: quotes.filter(q=>q.status==='approved').length,
    rejected: quotes.filter(q=>q.status==='rejected').length,
  }

  // 로그인 화면
  if (!authed) return (
    <div style={{ maxWidth:400, margin:'80px auto', padding:24 }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <div style={{ fontSize:36, marginBottom:8 }}>🔐</div>
        <h2 style={{ fontSize:20, fontWeight:700 }}>관리자 로그인</h2>
        <p style={{ color:'#6b7280', marginTop:4 }}>3D 프린팅 견적 관리 시스템</p>
      </div>
      <div style={S.card}>
        <div style={S.body}>
          <div style={S.grp}>
            <label style={S.lbl}>관리자 비밀번호</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&login()} style={S.inp} placeholder="비밀번호 입력" autoFocus />
          </div>
          <button style={{ ...S.btn, background:'#2563eb', color:'#fff', width:'100%', justifyContent:'center', marginTop:16 }}
            onClick={login} disabled={loading}>
            {loading ? '확인 중...' : '로그인'}
          </button>
        </div>
      </div>
    </div>
  )

  // 상세 화면
  if (sel) return (
    <div style={S.wrap}>
      <button style={{ ...S.sBtn, marginBottom:20 }} onClick={()=>setSel(null)}>← 목록으로</button>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <span style={{ fontSize:18, fontWeight:700 }}>{sel.quote_no}</span>
        <span style={{ padding:'3px 12px', borderRadius:20, fontSize:12, fontWeight:600, ...BADGE[sel.status] }}>
          {BADGE_LABEL[sel.status]}
        </span>
        <span style={{ fontSize:13, color:'#9ca3af' }}>{new Date(sel.created_at).toLocaleString('ko-KR')}</span>
      </div>

      {sel.status !== 'rejected' && <Milestone status={sel.status} />}
      
      <Section title="견적 정보" style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Info label="견적 번호" value={sel.quote_no} />
          <div style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>진행 상태</label>
            <select
              value={sel.status}
              onChange={async (e) => {
                if (!confirm(`상태를 "${STATUS_LABELS[e.target.value]}"(으)로 변경하시겠습니까?`)) return
                try {
                  const res = await fetch(`/api/quotes/${sel.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type':'application/json', 'x-admin-password': password },
                    body: JSON.stringify({ action: 'change_status', status: e.target.value })
                  })
                  const json = await res.json()
                  if (!json.ok) throw new Error(json.error)
                  alert('상태가 변경되고 고객에게 이메일이 발송되었습니다.')
                  refresh()
                } catch(e:any) { alert('오류: '+e.message) }
              }}
              style={{ padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, width:'100%' }}>
              {Object.entries(STATUS_LABELS).map(([k,v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        {sel.status === 'shipping_ready' && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:12, marginBottom:12 }}>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>배송사</label>
                <select
                  id={`company-${sel.id}`}
                  defaultValue={(sel as any).shipping_company || '우체국택배'}
                  onChange={(e) => {
                    const customInput = document.getElementById(`company-custom-${sel.id}`) as HTMLInputElement
                    if (customInput) {
                      customInput.style.display = e.target.value === '기타' ? 'block' : 'none'
                    }
                  }}
                  style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13 }}>
                  <option value="우체국택배">우체국택배</option>
                  <option value="CJ대한통운">CJ대한통운</option>
                  <option value="롯데택배">롯데택배</option>
                  <option value="한진택배">한진택배</option>
                  <option value="로젠택배">로젠택배</option>
                  <option value="기타">기타 (직접입력)</option>
                </select>
                <input
                  type="text"
                  placeholder="배송사명 입력"
                  id={`company-custom-${sel.id}`}
                  style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, marginTop:8, display:'none' }}
                />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>송장번호</label>
                <input
                  type="text"
                  placeholder="송장번호 입력"
                  defaultValue={(sel as any).tracking_number || ''}
                  id={`tracking-${sel.id}`}
                  style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13 }}
                />
              </div>
            </div>
            <button
              onClick={async () => {
                const companySelect = document.getElementById(`company-${sel.id}`) as HTMLSelectElement
                const companyCustom = document.getElementById(`company-custom-${sel.id}`) as HTMLInputElement
                const trackingInput = document.getElementById(`tracking-${sel.id}`) as HTMLInputElement
                
                const company = companySelect.value === '기타' ? companyCustom.value.trim() : companySelect.value
                const trackingNo = trackingInput.value.trim()
                
                if (!company) { alert('배송사를 선택하거나 입력하세요'); return }
                if (!trackingNo) { alert('송장번호를 입력하세요'); return }
                if (!confirm('배송 정보를 등록하고 발송 완료 상태로 변경하시겠습니까?')) return
                
                try {
                  const res = await fetch(`/api/quotes/${sel.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type':'application/json', 'x-admin-password': password },
                    body: JSON.stringify({ action: 'ship', shipping_company: company, tracking_number: trackingNo })
                  })
                  const json = await res.json()
                  if (!json.ok) throw new Error(json.error)
                  alert('발송 완료 처리되고 고객에게 이메일이 발송되었습니다.')
                  refresh()
                } catch(e:any) { alert('오류: '+e.message) }
              }}
              style={{ padding:'10px 20px', background:'#10b981', color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', width:'100%' }}>
              📦 발송 완료 처리
            </button>
          </div>
        )}
      </Section>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        <Section title="고객 정보">
          <Info label="이름" value={`${sel.name} (${sel.company||'개인'})`} />
          <Info label="이메일" value={sel.email} />
          {sel.phone && <Info label="연락처" value={sel.phone} />}
        </Section>
        <Section title="업로드 파일">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
            <div style={{ flex:1 }}>
              <Info label="파일명" value={sel.file_name||'-'} />
            </div>
            {sel.file_path && (
              <button
                onClick={()=>downloadFile(sel.file_path!, sel.file_name||'download', password)}
                style={{ flexShrink:0, display:'inline-flex', alignItems:'center', gap:6,
                  padding:'7px 14px', background:'#2563eb', color:'#fff', border:'none',
                  borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                ⬇ 파일 다운로드
              </button>
            )}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginTop:8 }}>
            <Info label="X (가로)" value={(sel as any).size_x ? `${(sel as any).size_x} mm` : '-'} />
            <Info label="Y (세로)" value={(sel as any).size_y ? `${(sel as any).size_y} mm` : '-'} />
            <Info label="Z (높이)" value={(sel as any).size_z ? `${(sel as any).size_z} mm` : '-'} />
            <Info label="부피" value={sel.vol_cm3 ? `${sel.vol_cm3} cm³` : '-'} />
          </div>
        </Section>
      </div>

      <Section title="출력 사양" style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          <Info label="방식" value={METHODS[sel.method]?.label||sel.method} />
          <Info label="소재" value={sel.material} />
          <Info label="색상" value={sel.color} />
          <Info label="품질" value={sel.quality} />
          <Info label="수량" value={`${sel.qty}개`} />
          <Info label="자동 견적가" value={krw(sel.auto_price)||'-'} bold />
          {sel.infill && <Info label="충전율" value={`${sel.infill}%`} />}
        </div>
        {sel.note && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
            <Info label="고객 요청 사항" value={sel.note} />
          </div>
        )}
      </Section>

      {sel.status === 'pending' ? (
        <Section title="관리자 결정">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div style={S.grp}>
              <label style={S.lbl}>확정 금액 (원) — 비워두면 자동 견적가 사용</label>
              <input type="text" value={aForm.price} onChange={e=>setAForm(p=>({...p,price:e.target.value}))}
                placeholder={krw(sel.auto_price)||''} style={S.inp} />
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>확정 납기</label>
              <input type="text" value={aForm.days} onChange={e=>setAForm(p=>({...p,days:e.target.value}))}
                placeholder={calcDays(sel.method, sel.qty)} style={S.inp} />
            </div>
            <div style={{ ...S.grp, gridColumn:'1/-1' }}>
              <label style={S.lbl}>관리자 메모 (고객에게 이메일로 전달됩니다)</label>
              <textarea value={aForm.note} onChange={e=>setAForm(p=>({...p,note:e.target.value}))}
                placeholder="출력 가능 여부, 특이사항, 고객 안내 내용..."
                style={{ ...S.inp, minHeight:80, resize:'vertical' }} />
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <button style={{ ...S.btn, background:'#fff', color:'#dc2626', border:'1.5px solid #fca5a5' }}
              onClick={()=>decide('rejected')} disabled={loading}>✕ 거절</button>
            <button style={{ ...S.btn, background:'#16a34a', color:'#fff' }}
              onClick={()=>decide('approved')} disabled={loading}>
              {loading?'처리 중...':'✓ 승인 및 이메일 발송'}
            </button>
          </div>
        </Section>
      ) : (
        <Section title="처리 결과">
          {(sel as any).final_price && <Info label="확정 금액" value={krw((sel as any).final_price)} bold />}
          {(sel as any).final_days  && <Info label="확정 납기" value={(sel as any).final_days} />}
          {(sel as any).admin_note  && <Info label="관리자 메모" value={(sel as any).admin_note} />}
          
          {sel.status === 'shipped' && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:12 }}>
                <Info label="배송사" value={(sel as any).shipping_company || '-'} />
                <Info label="송장번호" value={(sel as any).tracking_number || '-'} bold />
              </div>
            </div>
          )}
          
          {sel.status === 'issue_reported' && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>문제 상황 내용</label>
              <textarea
                defaultValue={(sel as any).issue_note || ''}
                id={`issue-note-${sel.id}`}
                placeholder="발생한 문제 상황을 상세히 입력하세요..."
                style={{ width:'100%', padding:'10px 12px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, minHeight:100, resize:'vertical', fontFamily:'inherit' }}
              />
              <button
                onClick={async () => {
                  const textarea = document.getElementById(`issue-note-${sel.id}`) as HTMLTextAreaElement
                  const issueNote = textarea.value.trim()
                  if (!issueNote) { alert('문제 상황 내용을 입력하세요'); return }
                  if (!confirm('문제 상황을 저장하시겠습니까?')) return
                  try {
                    const res = await fetch(`/api/quotes/${sel.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type':'application/json', 'x-admin-password': password },
                      body: JSON.stringify({ action: 'update_issue', issue_note: issueNote })
                    })
                    const json = await res.json()
                    if (!json.ok) throw new Error(json.error)
                    alert('문제 상황이 저장되었습니다.')
                    refresh()
                  } catch(e:any) { alert('오류: '+e.message) }
                }}
                style={{ marginTop:8, padding:'8px 16px', background:'#dc2626', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                💾 문제 상황 저장
              </button>
            </div>
          )}
        </Section>
      )}
    </div>
  )

  // 목록 화면
  return (
    <div style={S.wrap}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700, marginBottom:2 }}>🗂 견적 관리 대시보드</h1>
          <div style={{ fontSize:13, color:'#6b7280' }}>
            전체 {quotes.length}건 &nbsp;·&nbsp;
            <span style={{ color:'#d97706', fontWeight:600 }}>검토 중 {counts.pending}건</span> &nbsp;·&nbsp;
            <span style={{ color:'#16a34a', fontWeight:600 }}>승인 {counts.approved}건</span> &nbsp;·&nbsp;
            거절 {counts.rejected}건
          </div>
        </div>
        <button style={S.sBtn} onClick={refresh}>↻ 새로고침</button>
      </div>

      <div style={{ display:'flex', gap:4, marginBottom:16, background:'#f3f4f6', padding:3, borderRadius:10, width:'fit-content' }}>
        {(['all','pending','approved','rejected'] as const).map(f => (
          <button key={f} onClick={()=>setFilter(f)} style={{
            padding:'6px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:500,
            background: filter===f ? '#fff' : 'transparent',
            color: filter===f ? '#1a1a1a' : '#6b7280',
            boxShadow: filter===f ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
          }}>
            {f==='all'?'전체':BADGE_LABEL[f]} {f!=='all'&&`(${counts[f]})`}
          </button>
        ))}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'40px 0', color:'#9ca3af' }}>견적 요청이 없습니다</div>
        )}
        {filtered.map(q => (
          <button key={q.id} onClick={()=>{setSel(q);setAForm({price:'',days:'',note:''})}} style={{
            display:'flex', alignItems:'center', gap:12, padding:'14px 16px',
            background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, cursor:'pointer',
            textAlign:'left', width:'100%', transition:'border-color .15s',
          }}
          onMouseEnter={e=>(e.currentTarget.style.borderColor='#93c5fd')}
          onMouseLeave={e=>(e.currentTarget.style.borderColor='#e5e7eb')}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                <span style={{ fontWeight:700, fontSize:14 }}>{q.quote_no}</span>
                <span style={{ padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:600, ...BADGE[q.status] }}>
                  {BADGE_LABEL[q.status]}
                </span>
                <span style={{ fontSize:11, color:'#9ca3af' }}>{new Date(q.created_at).toLocaleString('ko-KR')}</span>
              </div>
              <div style={{ fontSize:13, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {q.name} ({q.company||'개인'}) &nbsp;·&nbsp; {q.file_name} &nbsp;·&nbsp; {METHODS[q.method]?.label||q.method} &nbsp;·&nbsp; {q.qty}개
              </div>
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>{krw((q as any).final_price||q.auto_price)}</div>
            </div>
            <span style={{ color:'#9ca3af', fontSize:18 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background:'#f9fafb', borderRadius:12, padding:18, marginBottom:12, ...style }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>{title}</div>
      {children}
    </div>
  )
}

function Info({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight: bold ? 700 : 500 }}>{value}</div>
    </div>
  )
}
