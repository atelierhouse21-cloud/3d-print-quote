'use client'
import { useState, useEffect, useRef } from 'react'
import { METHODS, krw, calcDays, COURIERS, normalizeSettings, defaultMethodCfg, DEFAULT_DENSITY, DEFAULT_COEFF, RETENTION_MS } from '@/lib/constants'
import type { Quote, PrintOptions, MethodCfg, MaterialCfg, QualityCfg } from '@/lib/constants'

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
  pending:'검토 중', approved:'승인됨', payment_confirmed:'결제 확인',
  printing:'출력 중', post_processing:'후처리 중', shipping_ready:'배송 준비',
  shipped:'발송 완료', issue_reported:'문제 상황', rejected:'거절됨'
}

const STATUS_LABELS: Record<string, string> = {
  pending:'검토중', approved:'견적 확정', payment_confirmed:'결제 확인',
  printing:'출력 중', post_processing:'후처리 중', shipping_ready:'배송 준비',
  shipped:'발송 완료', issue_reported:'문제 상황 접수', rejected:'거절',
}

// ── 단계별 다음 처리(단순 상태 전환 + 안내 메일) ──
// 견적 확정(approve)·발송(ship)은 별도 폼이 필요하므로 여기 포함하지 않는다.
const NEXT_STEP: Record<string, { next: string; label: string }> = {
  approved:          { next: 'payment_confirmed', label: '결제 확인 처리' },
  payment_confirmed: { next: 'printing',          label: '출력 시작 처리' },
  printing:          { next: 'post_processing',   label: '후처리 시작 처리' },
  post_processing:   { next: 'shipping_ready',    label: '배송 준비 완료 처리' },
}

// ── 설정 정규화는 lib/constants의 공용 normalizeSettings 사용 ──

// ── Supabase 파일 다운로드 ──
async function downloadFile(filePath: string, fileName: string, password: string) {
  try {
    const res = await fetch(`/api/admin/download?path=${encodeURIComponent(filePath)}`, {
      headers: { 'x-admin-password': password }
    })
    if (!res.ok) throw new Error('다운로드 실패')
    const { url } = await res.json()
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
  } catch (e: any) { alert('다운로드 오류: ' + e.message) }
}

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

// ── 마일스톤 ──
function Milestone({ quote }: { quote: Quote }) {
  const steps = [
    { key:'pending', label:'검토중' }, { key:'approved', label:'견적확정' },
    { key:'payment_confirmed', label:'결제확인' }, { key:'printing', label:'출력중' },
    { key:'post_processing', label:'후처리' }, { key:'shipping_ready', label:'배송준비' },
    { key:'shipped', label:'발송완료' },
  ]
  const currentIdx = steps.findIndex(s => s.key === quote.status)
  const times = quote.stage_times || {}
  // pending(검토중) 시각은 접수 시각(created_at) 사용
  const timeFor = (key: string) => key === 'pending' ? quote.created_at : times[key]
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'16px 0', borderBottom:'1px solid #e5e7eb' }}>
      {steps.map((step, idx) => {
        const isPast = idx < currentIdx; const isCurrent = idx === currentIdx
        const t = fmtStageTime(timeFor(step.key))
        return (
          <div key={step.key} style={{ display:'flex', alignItems:'flex-start', flex:1 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
              <div style={{ width:32, height:32, borderRadius:'50%',
                background: isCurrent?'#2563eb':isPast?'#10b981':'#e5e7eb',
                color: isCurrent||isPast?'#fff':'#9ca3af',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, marginBottom:6 }}>
                {idx+1}
              </div>
              <div style={{ fontSize:11, fontWeight:600, color: isCurrent?'#2563eb':isPast?'#10b981':'#9ca3af' }}>
                {step.label}
              </div>
              <div style={{ fontSize:8.5, color:'#9ca3af', marginTop:3, minHeight:11, textAlign:'center', lineHeight:1.25, letterSpacing:'-.2px' }}>
                {t}
              </div>
            </div>
            {idx < steps.length-1 && (
              <div style={{ flex:0.5, height:2, background: isPast?'#10b981':'#e5e7eb', marginTop:15 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 방식별 설정 카드 (v2: 단가계수 / 소재별 밀도·색상 / 품질별 보정값) ──
function MethodSettingCard({
  method, cfg, onChange
}: {
  method: string
  cfg: MethodCfg
  onChange: (method: string, cfg: MethodCfg) => void
}) {
  const m = METHODS[method]
  const [newMat, setNewMat]   = useState('')
  const [newQual, setNewQual] = useState('')
  const [newColorFor, setNewColorFor] = useState<Record<number, string>>({})

  const inpS:  React.CSSProperties = { padding:'6px 8px', border:'1.5px solid #d1d5db', borderRadius:6, fontSize:13, fontFamily:'inherit', outline:'none' }
  const delBtn: React.CSSProperties = { background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:6, width:28, height:28, cursor:'pointer', fontSize:13, flexShrink:0, lineHeight:1 }
  const addBtn: React.CSSProperties = { background:'#2563eb', color:'#fff', border:'none', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontSize:13, fontWeight:600, flexShrink:0 }
  const secTitle: React.CSSProperties = { fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase' as const, letterSpacing:'.4px', marginBottom:10, paddingBottom:6, borderBottom:'1px solid #e5e7eb' }

  const setMaterials = (materials: MaterialCfg[]) => onChange(method, { ...cfg, materials })
  const setQualities = (qualities: QualityCfg[]) => onChange(method, { ...cfg, qualities })

  const addMat = () => {
    const n = newMat.trim(); if (!n) return
    if (cfg.materials.some(x => x.name === n)) { alert('이미 있는 소재입니다.'); return }
    setMaterials([...cfg.materials, { name:n, density: DEFAULT_DENSITY[n] ?? 1.0, coefficient: DEFAULT_COEFF[method] ?? 1000, minPrice: 0, colors: [] }]); setNewMat('')
  }
  const removeMat = (i: number) => setMaterials(cfg.materials.filter((_, idx) => idx !== i))
  const updMatName = (i: number, name: string) => setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, name } : x))
  const updMatDensity = (i: number, val: string) => {
    const v = parseFloat(val); setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, density: isNaN(v) ? 0 : v } : x))
  }
  const updMatCoeff = (i: number, val: string) => {
    const v = parseFloat(val); setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, coefficient: isNaN(v) ? 0 : v } : x))
  }
  const updMatMinPrice = (i: number, val: string) => {
    const v = parseFloat(val); setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, minPrice: isNaN(v) ? 0 : v } : x))
  }
  const addColor = (i: number) => {
    const c = (newColorFor[i] || '').trim(); if (!c) return
    if (cfg.materials[i].colors.includes(c)) { alert('이미 있는 색상입니다.'); return }
    setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, colors:[...x.colors, c] } : x))
    setNewColorFor(p => ({ ...p, [i]: '' }))
  }
  const removeColor = (i: number, c: string) =>
    setMaterials(cfg.materials.map((x, idx) => idx===i ? { ...x, colors: x.colors.filter(v => v !== c) } : x))

  const addQual = () => {
    const n = newQual.trim(); if (!n) return
    if (cfg.qualities.some(q => q.name === n)) { alert('이미 있는 품질입니다.'); return }
    setQualities([...cfg.qualities, { name:n, factor:1.0 }]); setNewQual('')
  }
  const removeQual = (i: number) => setQualities(cfg.qualities.filter((_, idx) => idx !== i))
  const updQualName = (i: number, name: string) => setQualities(cfg.qualities.map((q, idx) => idx===i ? { ...q, name } : q))
  const updQualFactor = (i: number, val: string) => {
    const v = parseFloat(val); setQualities(cfg.qualities.map((q, idx) => idx===i ? { ...q, factor: isNaN(v) ? 0 : v } : q))
  }

  return (
    <div style={{
      border: `2px solid ${cfg.enabled ? '#2563eb' : '#e5e7eb'}`,
      borderRadius: 12, overflow: 'hidden', marginBottom: 16,
      opacity: cfg.enabled ? 1 : 0.55, transition: 'all .2s'
    }}>
      {/* 헤더 */}
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 18px',
        background: cfg.enabled ? '#eff6ff' : '#f9fafb',
        borderBottom: `1px solid ${cfg.enabled ? '#bfdbfe' : '#e5e7eb'}`
      }}>
        <div>
          <span style={{ fontSize:16, fontWeight:700, color: cfg.enabled?'#2563eb':'#9ca3af' }}>{m.label}</span>
          <span style={{ fontSize:12, color:'#6b7280', marginLeft:8 }}>{m.sub}</span>
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
          <span style={{ fontSize:12, color:'#6b7280' }}>{cfg.enabled ? '활성' : '비활성'}</span>
          <div onClick={() => onChange(method, { ...cfg, enabled: !cfg.enabled })}
            style={{ width:44, height:24, borderRadius:12, cursor:'pointer',
              background: cfg.enabled ? '#2563eb' : '#d1d5db', position:'relative', transition:'background .2s' }}>
            <div style={{ position:'absolute', top:3, left: cfg.enabled ? 23 : 3, width:18, height:18,
              borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
          </div>
        </label>
      </div>

      {cfg.enabled && (
        <div style={{ padding:'16px 18px' }}>
          {/* 소재 & 색상 & 단가계수 */}
          <div style={{ marginBottom:18 }}>
            <div style={secTitle}>소재 &amp; 밀도 &amp; 단가계수 &amp; 최소금액 &amp; 색상 <span style={{ color:'#9ca3af', fontWeight:400 }}>({cfg.materials.length})</span></div>
            <p style={{ fontSize:11, color:'#6b7280', margin:'0 0 10px' }}>
              예상금액 = 부피 × 밀도 × <b>단가계수(소재별)</b> × 수량 × 품질보정값 &nbsp;|&nbsp; 계산값이 <b>최소금액</b>보다 작으면 최소금액으로 적용됩니다(0이면 미적용).
            </p>
            {cfg.materials.map((mat, i) => (
              <div key={i} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 12px', marginBottom:8, background:'#fff' }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
                  <input value={mat.name} onChange={e => updMatName(i, e.target.value)} placeholder="소재명"
                    style={{ ...inpS, flex:1, minWidth:90, fontWeight:600 }} />
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize:11, color:'#6b7280' }}>밀도</span>
                    <input type="number" step="0.01" min={0} value={mat.density}
                      onChange={e => updMatDensity(i, e.target.value)} style={{ ...inpS, width:60 }} />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize:11, color:'#6b7280' }}>단가계수</span>
                    <input type="number" step="1" min={0} value={mat.coefficient}
                      onChange={e => updMatCoeff(i, e.target.value)} style={{ ...inpS, width:80, fontWeight:700 }} />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize:11, color:'#6b7280' }}>최소금액</span>
                    <input type="number" step="100" min={0} value={mat.minPrice}
                      onChange={e => updMatMinPrice(i, e.target.value)} style={{ ...inpS, width:90 }} />
                  </div>
                  <button onClick={() => removeMat(i)} title="소재 삭제" style={delBtn}>×</button>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:11, color:'#9ca3af', fontWeight:700 }}>색상:</span>
                  {mat.colors.map(c => (
                    <span key={c} style={{ display:'inline-flex', alignItems:'center', gap:4, background:'#eff6ff',
                      border:'1px solid #bfdbfe', borderRadius:6, padding:'3px 8px', fontSize:12 }}>
                      {c}
                      <span onClick={() => removeColor(i, c)} style={{ cursor:'pointer', color:'#9ca3af', fontWeight:700 }}>×</span>
                    </span>
                  ))}
                  {mat.colors.length === 0 && <span style={{ fontSize:11, color:'#dc2626' }}>색상을 1개 이상 추가하세요</span>}
                  <span style={{ display:'inline-flex', gap:4, alignItems:'center' }}>
                    <input value={newColorFor[i] || ''} onChange={e => setNewColorFor(p => ({ ...p, [i]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColor(i) } }}
                      placeholder="색상 추가" style={{ ...inpS, width:96, padding:'4px 7px' }} />
                    <button onClick={() => addColor(i)} style={{ ...addBtn, padding:'5px 10px' }}>+</button>
                  </span>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:6, marginTop:4 }}>
              <input value={newMat} onChange={e => setNewMat(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMat() } }}
                placeholder="새 소재명 입력 (예: PLA)" style={{ ...inpS, flex:1 }} />
              <button onClick={addMat} style={addBtn}>+ 소재 추가</button>
            </div>
          </div>

          {/* 품질 & 보정값 */}
          <div>
            <div style={secTitle}>품질 &amp; 보정값 <span style={{ color:'#9ca3af', fontWeight:400 }}>({cfg.qualities.length})</span></div>
            {cfg.qualities.map((q, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                <input value={q.name} onChange={e => updQualName(i, e.target.value)} placeholder="품질명"
                  style={{ ...inpS, flex:1, minWidth:0 }} />
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                  <span style={{ fontSize:11, color:'#6b7280' }}>보정값</span>
                  <input type="number" step="0.1" min={0} value={q.factor}
                    onChange={e => updQualFactor(i, e.target.value)} style={{ ...inpS, width:64 }} />
                </div>
                <button onClick={() => removeQual(i)} title="품질 삭제" style={delBtn}>×</button>
              </div>
            ))}
            <div style={{ display:'flex', gap:6, marginTop:4 }}>
              <input value={newQual} onChange={e => setNewQual(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQual() } }}
                placeholder="새 품질명 입력 (예: 표준 0.2mm)" style={{ ...inpS, flex:1 }} />
              <button onClick={addQual} style={addBtn}>+ 품질 추가</button>
            </div>
            <p style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>
              보정값 1.0 = 기본가, 1.5 = 1.5배, 0.8 = 20% 할인. 품질이 1개면 고객은 선택 없이 자동 적용됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 ──
export default function AdminPage() {
  const [password, setPassword]     = useState('')
  const [failCount, setFailCount]   = useState(0)
  const [locked, setLocked]         = useState(false)
  const [authed, setAuthed]         = useState(false)
  const [quotes, setQuotes]         = useState<Quote[]>([])
  const [sel, setSel]               = useState<Quote | null>(null)
  const [loading, setLoading]       = useState(false)
  const [aForm, setAForm]           = useState({ price:'', days:'', note:'' })
  const [filter, setFilter]         = useState<'all'|'pending'|'approved'|'rejected'|'shipped'|'as'|'deleted'>('all')
  const [tab, setTab]               = useState<'quotes'|'settings'>('quotes')
  const [editSettings, setEditSettings] = useState<PrintOptions | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [issueDraft, setIssueDraft]     = useState('')
  const [selectedIds, setSelectedIds]   = useState<string[]>([])
  const [search, setSearch]             = useState('')
  const [visibleCount, setVisibleCount] = useState(30)

  const fetchQuotes = async (pw: string) => {
    const res = await fetch('/api/quotes', { headers: { 'x-admin-password': pw } })
    if (!res.ok) throw new Error('인증 실패')
    return res.json() as Promise<Quote[]>
  }

  const MAX_LOGIN_TRIES = 5
  const login = async () => {
    if (locked) return
    setLoading(true)
    try {
      const data = await fetchQuotes(password)
      setQuotes(data); setAuthed(true); setFailCount(0)
    } catch {
      const next = failCount + 1
      setFailCount(next)
      if (next >= MAX_LOGIN_TRIES) {
        setLocked(true)
        setTimeout(() => { setLocked(false); setFailCount(0) }, 60000)
      }
    }
    finally { setLoading(false) }
  }

  const refresh = async () => {
    const data = await fetchQuotes(password); setQuotes(data)
  }

  // ── 보유기간 만료 견적 자동 삭제 (관리자 접속 시 1회) ──
  const purgedRef = useRef(false)
  useEffect(() => {
    if (!authed || purgedRef.current) return
    const now = Date.now()
    const expired = quotes.filter(q => !q.deleted_at && (now - new Date(q.created_at).getTime() > RETENTION_MS))
    if (expired.length === 0) return
    purgedRef.current = true
    ;(async () => {
      for (const q of expired) {
        try {
          await fetch(`/api/quotes/${q.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type':'application/json', 'x-admin-password': password },
            body: JSON.stringify({ action: 'soft_delete', reason: '개인정보 보관기간 만료로 인한 자동 삭제' })
          })
        } catch {}
      }
      refresh()
    })()
  }, [authed, quotes])

  const loadSettings = async () => {
    try {
      const res  = await fetch('/api/settings')
      const raw  = await res.json()
      const normalized = normalizeSettings(raw)
      setEditSettings(normalized)
    } catch(e) { console.error(e) }
  }

  const saveSettings = async () => {
    if (!editSettings) return
    // 검증: 활성 방식별로 단가계수·소재·색상·품질 확인
    for (const [method, cfg] of Object.entries(editSettings) as [string, MethodCfg][]) {
      if (!cfg.enabled) continue
      if (!cfg.materials.length) { alert(`${method}: 소재를 최소 1개 추가하세요.`); return }
      for (const mat of cfg.materials) {
        if (!mat.name.trim())      { alert(`${method}: 소재명을 입력하세요.`); return }
        if (!mat.density || mat.density <= 0) { alert(`${method} · ${mat.name}: 밀도를 0보다 크게 입력하세요.`); return }
        if (!mat.coefficient || mat.coefficient <= 0) { alert(`${method} · ${mat.name}: 단가계수를 0보다 크게 입력하세요.`); return }
        if (!mat.colors.length)    { alert(`${method} · ${mat.name}: 색상을 최소 1개 추가하세요.`); return }
      }
      if (!cfg.qualities.length) { alert(`${method}: 품질을 최소 1개 추가하세요.`); return }
      for (const q of cfg.qualities) {
        if (!q.name.trim())        { alert(`${method}: 품질명을 입력하세요.`); return }
        if (!q.factor || q.factor <= 0) { alert(`${method} · ${q.name}: 보정값을 0보다 크게 입력하세요.`); return }
      }
    }
    const activeCount = Object.values(editSettings).filter((c: any) => c.enabled).length
    if (activeCount === 0) { alert('최소 1개의 출력 방식을 활성화해야 합니다.'); return }

    if (!confirm('설정을 저장하시겠습니까?')) return
    setSavingSettings(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({ key: 'print_options', value: editSettings })
      })
      const json = await res.json()
      if (!json.ok && json.error) throw new Error(json.error)
      alert('설정이 저장되었습니다. 고객 견적 페이지에 즉시 반영됩니다.')
      loadSettings()
    } catch(e:any) { alert('오류: ' + e.message) }
    finally { setSavingSettings(false) }
  }

  const updateMethodCfg = (method: string, cfg: MethodCfg) => {
    setEditSettings((prev) => prev ? ({ ...prev, [method]: cfg }) : prev)
  }

  const decide = async (status: 'approved'|'rejected') => {
    if (!sel) return
    setLoading(true)
    try {
      // 확정 금액/납기 미입력 시 기존 정보(자동 견적가 / 예상 납기)로 확정
      const finalPrice = aForm.price.trim()
        ? (parseInt(aForm.price.replace(/\D/g,'')) || null)
        : (sel.auto_price ?? null)
      const finalDays = aForm.days.trim() || calcDays(sel.method, sel.qty)

      const res = await fetch(`/api/quotes/${sel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({
          action: status === 'approved' ? 'approve' : 'reject',
          final_price: finalPrice,
          final_days: finalDays,
          admin_note: aForm.note,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || '처리에 실패했습니다.')

      alert(status === 'approved'
        ? '견적이 확정되었으며, 고객에게 확정 메일이 발송되었습니다.'
        : '견적이 거절 처리되었습니다.')
      await refresh(); setSel(null)
    } catch (e: any) { alert('오류: ' + e.message) }
    finally { setLoading(false) }
  }

  const changeStatus = async (next: string, label: string) => {
    if (!sel) return
    if (!confirm(`"${label}"을(를) 진행하시겠습니까?\n고객에게 안내 메일이 발송됩니다.`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes/${sel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'change_status', status: next })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      alert(`'${label}'가 완료되었으며, 고객에게 안내 메일이 발송되었습니다.`)
      setSel({ ...sel, status: next, stage_times: { ...(sel.stage_times || {}), [next]: new Date().toISOString() } } as Quote)
      refresh()
    } catch(e:any) { alert('오류: ' + e.message) }
    finally { setLoading(false) }
  }

  const activeQuotes  = quotes.filter(q => !q.deleted_at)
  const deletedQuotes = quotes.filter(q => !!q.deleted_at)
  const isAS = (q: Quote) => /AS\d+$/i.test(q.quote_no)
  const filtered =
    filter === 'deleted' ? deletedQuotes :
    filter === 'as'      ? activeQuotes.filter(isAS) :
    filter === 'shipped' ? activeQuotes.filter(q => q.status === 'shipped') :
    filter === 'all'     ? activeQuotes :
                           activeQuotes.filter(q => q.status === filter)
  const counts = {
    all:      activeQuotes.length,
    pending:  activeQuotes.filter(q=>q.status==='pending').length,
    approved: activeQuotes.filter(q=>q.status==='approved').length,
    rejected: activeQuotes.filter(q=>q.status==='rejected').length,
    shipped:  activeQuotes.filter(q=>q.status==='shipped').length,
    as:       activeQuotes.filter(isAS).length,
    deleted:  deletedQuotes.length,
  }
  // 검색(견적번호·이름·이메일·업체명·연락처) + 페이지네이션
  const kw = search.trim().toLowerCase()
  const searched = kw
    ? filtered.filter(q => [q.quote_no, q.name, q.email, q.company, q.phone]
        .some(v => (v || '').toLowerCase().includes(kw)))
    : filtered
  const pageItems = searched.slice(0, visibleCount)

  // ── 선택 삭제(소프트) ──
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const bulkDelete = async () => {
    if (selectedIds.length === 0) { alert('삭제할 견적을 선택하세요.'); return }
    if (!confirm(`선택한 ${selectedIds.length}건을 삭제하시겠습니까?\n삭제 후에는 '삭제' 탭에서 요약만 확인할 수 있으며, 업로드된 파일은 제거됩니다.`)) return
    setLoading(true)
    try {
      for (const id of selectedIds) {
        const res = await fetch(`/api/quotes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type':'application/json', 'x-admin-password': password },
          body: JSON.stringify({ action: 'soft_delete' })
        })
        const json = await res.json()
        if (!json.ok) throw new Error(json.error)
      }
      if (sel && selectedIds.includes(sel.id)) setSel(null)
      setSelectedIds([])
      await refresh()
    } catch(e:any) { alert('삭제 오류: ' + e.message) }
    finally { setLoading(false) }
  }

  // ── 문제 상황 접수 (내용 작성) ──
  const submitIssue = async () => {
    if (!sel) return
    const text = issueDraft.trim()
    if (!text) { alert('문제 상황 내용을 입력하세요.'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes/${sel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'report_issue', issue_note: text })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      alert('문제 상황이 접수되었으며, 고객에게 내용이 포함된 안내 메일이 발송되었습니다.')
      setSel({ ...sel, status: 'issue_reported', issue_note: text,
        stage_times: { ...(sel.stage_times || {}), issue_reported: new Date().toISOString() } } as Quote)
      setShowIssueForm(false); setIssueDraft('')
      refresh()
    } catch(e:any) { alert('오류: ' + e.message) }
    finally { setLoading(false) }
  }

  // ── A/S 접수: 동일 내용 새 견적 생성 ──
  const createAS = async () => {
    if (!sel) return
    if (!confirm(`${sel.quote_no} 건에 대한 A/S 견적을 새로 생성하시겠습니까?\n동일 내용의 '검토 중' 견적이 만들어집니다.`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes/${sel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'x-admin-password': password },
        body: JSON.stringify({ action: 'create_as' })
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      alert(`A/S 견적 ${json.quote_no} 이(가) '검토 중' 상태로 생성되었습니다.`)
      setSel(null)
      await refresh()
    } catch(e:any) { alert('오류: ' + e.message) }
    finally { setLoading(false) }
  }

  // ── 로그인 화면 ──
  if (!authed) return (
    <div style={{ maxWidth:400, margin:'80px auto', padding:24 }}>
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <h2 style={{ fontSize:20, fontWeight:700 }}>관리자 로그인</h2>
        <p style={{ color:'#6b7280', marginTop:4 }}>3D 프린팅 견적 관리 시스템</p>
      </div>
      <div style={S.card}><div style={S.body}>
        <div style={S.grp}>
          <label style={S.lbl}>관리자 비밀번호</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&login()} style={S.inp} placeholder="비밀번호 입력" autoFocus />
        </div>
        {locked ? (
          <div style={{ marginTop:10, fontSize:13, color:'#dc2626', fontWeight:600 }}>
            시도 횟수를 초과했습니다. 약 1분 후 다시 시도해 주세요.
          </div>
        ) : failCount > 0 ? (
          <div style={{ marginTop:10, fontSize:13, color:'#dc2626' }}>
            비밀번호가 올바르지 않습니다. (남은 시도: {MAX_LOGIN_TRIES - failCount}/{MAX_LOGIN_TRIES}회)
          </div>
        ) : null}
        <button style={{ ...S.btn, background:(loading||locked)?'#9ca3af':'#2563eb', color:'#fff', width:'100%', justifyContent:'center', marginTop:16, cursor:(loading||locked)?'not-allowed':'pointer' }}
          onClick={login} disabled={loading||locked}>
          {loading ? '확인 중...' : '로그인'}
        </button>
      </div></div>
    </div>
  )

  // ── 상세 화면 ──
  if (sel) return (
    <div style={S.wrap}>
      <button style={{ ...S.sBtn, marginBottom:20 }} onClick={()=>{ setSel(null); setShowIssueForm(false) }}>← 목록으로</button>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <span style={{ fontSize:18, fontWeight:700 }}>{sel.quote_no}</span>
        <span style={{ padding:'3px 12px', borderRadius:20, fontSize:12, fontWeight:600, ...BADGE[sel.status] }}>
          {BADGE_LABEL[sel.status]}
        </span>
        <span style={{ fontSize:13, color:'#9ca3af' }}>{new Date(sel.created_at).toLocaleString('ko-KR')}</span>
      </div>

      {sel.status !== 'rejected' && <Milestone quote={sel} />}

      <Section title="견적 정보" style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Info label="견적 번호" value={sel.quote_no} />
          <div style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>다음 단계 처리</label>
            {sel.status === 'pending' && (
              <div style={{ fontSize:13, color:'#92400e', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'9px 12px' }}>
                아래 <b>관리자 결정</b>에서 금액·납기를 입력해 <b>승인</b>하거나 거절하세요.
              </div>
            )}
            {sel.status === 'shipping_ready' && (
              <div style={{ fontSize:13, color:'#134e4a', background:'#f0fdfa', border:'1px solid #5eead4', borderRadius:8, padding:'9px 12px' }}>
                아래 <b>송장번호</b>를 입력하면 발송 완료 처리되고 메일이 발송됩니다.
              </div>
            )}
            {sel.status === 'shipped' && (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:13, color:'#15803d', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'9px 12px' }}>
                  모든 단계가 완료되었습니다.
                </div>
                <button onClick={createAS} disabled={loading}
                  style={{ ...S.sBtn, color:'#b45309', border:'1.5px solid #fcd34d', background:'#fffbeb', width:'100%', justifyContent:'center' }}>
                  A/S 접수 (동일 내용 새 견적 생성)
                </button>
              </div>
            )}
            {sel.status === 'rejected' && (
              <div style={{ fontSize:13, color:'#7f1d1d', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'9px 12px' }}>
                거절 처리된 견적입니다.
              </div>
            )}
            {sel.status === 'issue_reported' && (
              <div style={{ fontSize:13, color:'#991b1b', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'9px 12px' }}>
                문제 상황 처리 중입니다. 아래에서 내용을 관리하세요.
              </div>
            )}
            {NEXT_STEP[sel.status] && (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <button onClick={()=>changeStatus(NEXT_STEP[sel.status].next, NEXT_STEP[sel.status].label)} disabled={loading}
                  style={{ ...S.btn, background:'#2563eb', color:'#fff', width:'100%', justifyContent:'center' }}>
                  {loading ? '처리 중...' : `${NEXT_STEP[sel.status].label} →`}
                </button>
                <button onClick={()=>{ setIssueDraft((sel.issue_note as string)||''); setShowIssueForm(true) }} disabled={loading}
                  style={{ ...S.sBtn, color:'#dc2626', border:'1.5px solid #fca5a5', width:'100%', justifyContent:'center' }}>
                  문제 상황 접수
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 문제 상황 내용 작성 폼 */}
        {showIssueForm && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#dc2626', marginBottom:6 }}>문제 상황 내용 (고객에게 메일로 전달됩니다)</label>
            <textarea value={issueDraft} onChange={e=>setIssueDraft(e.target.value)}
              placeholder="발생한 문제 상황을 상세히 입력하세요..."
              style={{ width:'100%', padding:'10px 12px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, minHeight:90, resize:'vertical', fontFamily:'inherit' }} />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:8 }}>
              <button onClick={()=>{ setShowIssueForm(false); setIssueDraft('') }} disabled={loading}
                style={{ ...S.sBtn }}>취소</button>
              <button onClick={submitIssue} disabled={loading}
                style={{ ...S.btn, background:'#dc2626', color:'#fff' }}>
                {loading ? '접수 중...' : '문제 상황 접수 및 메일 발송'}
              </button>
            </div>
          </div>
        )}
        {sel.status === 'shipping_ready' && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>배송사 / 송장번호</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <select id={`carrier-${sel.id}`} defaultValue={(sel as any).shipping_company || COURIERS[0]}
                style={{ padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, minWidth:140 }}>
                {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="text" placeholder="송장번호 입력" defaultValue={(sel as any).tracking_number || ''}
                id={`tracking-${sel.id}`}
                style={{ flex:1, minWidth:140, padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13 }} />
              <button onClick={async () => {
                const carrierEl  = document.getElementById(`carrier-${sel.id}`) as HTMLSelectElement
                const input      = document.getElementById(`tracking-${sel.id}`) as HTMLInputElement
                const carrier    = carrierEl?.value || ''
                const trackingNo = input?.value.trim()
                if (!carrier)    { alert('배송사를 선택하세요'); return }
                if (!trackingNo && carrier !== '직접 수령') { alert('송장번호를 입력하세요'); return }
                if (!confirm(`'${carrier}' / ${trackingNo || '(송장 없음)'} 으로 발송 완료 처리하시겠습니까?`)) return
                try {
                  const res = await fetch(`/api/quotes/${sel.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type':'application/json', 'x-admin-password': password },
                    body: JSON.stringify({ action: 'ship', shipping_company: carrier, tracking_number: trackingNo })
                  })
                  const json = await res.json()
                  if (!json.ok) throw new Error(json.error)
                  alert('발송 완료 처리되었으며, 고객에게 배송사·송장번호 안내 메일이 발송되었습니다.')
                  setSel({ ...sel, status: 'shipped', shipping_company: carrier, tracking_number: trackingNo,
                    stage_times: { ...(sel.stage_times || {}), shipped: new Date().toISOString() } } as Quote)
                  refresh()
                } catch(e:any) { alert('오류: '+e.message) }
              }}
                style={{ padding:'8px 16px', background:'#10b981', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                발송 완료
              </button>
            </div>
          </div>
        )}
      </Section>

      {sel.as_origin && (
        <Section title="원본(직전) 처리 정보 — A/S" style={{ marginBottom:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            <Info label="원본 견적번호" value={sel.as_origin.quote_no || '-'} />
            <Info label="원본 확정금액" value={sel.as_origin.final_price ? krw(sel.as_origin.final_price) : '-'} />
            <Info label="원본 확정납기" value={sel.as_origin.final_days || '-'} />
            <Info label="원본 배송사"   value={sel.as_origin.shipping_company || '-'} />
            <Info label="원본 송장번호" value={sel.as_origin.tracking_number || '-'} bold />
            <Info label="원본 발송시각" value={fmtStageTime(sel.as_origin.shipped_at) || '-'} />
          </div>
        </Section>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        <Section title="고객 정보">
          <Info label="이름" value={`${sel.name} (${sel.company||'개인'})`} />
          <Info label="이메일" value={sel.email} />
          {sel.phone && <Info label="연락처" value={sel.phone} />}
          {sel.address && <Info label="수령 주소" value={sel.address} />}
          <Info label="마케팅 활용 동의" value={sel.marketing_consent ? '동의' : '미동의'} />
        </Section>
        <Section title="업로드 파일">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
            <div style={{ flex:1 }}><Info label="파일명" value={sel.file_name||'-'} /></div>
            {sel.file_path && (
              <button onClick={()=>downloadFile(sel.file_path!, sel.file_name||'download', password)}
                style={{ flexShrink:0, display:'inline-flex', alignItems:'center', gap:6,
                  padding:'7px 14px', background:'#2563eb', color:'#fff', border:'none',
                  borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                다운로드
              </button>
            )}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginTop:8 }}>
            <Info label="X (가로)" value={(sel as any).size_x ? `${(sel as any).size_x} mm` : '-'} />
            <Info label="Y (세로)" value={(sel as any).size_y ? `${(sel as any).size_y} mm` : '-'} />
            <Info label="Z (높이)" value={(sel as any).size_z ? `${(sel as any).size_z} mm` : '-'} />
            <Info label="부피"     value={sel.vol_cm3 ? `${sel.vol_cm3} cm³` : '-'} />
          </div>
        </Section>
      </div>

      <Section title="출력 사양" style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          <Info label="방식"     value={METHODS[sel.method]?.label||sel.method} />
          <Info label="소재"     value={sel.material} />
          <Info label="색상"     value={sel.color} />
          <Info label="품질"     value={sel.quality} />
          <Info label="수량"     value={`${sel.qty}개`} />
          <Info label="자동 견적가" value={krw(sel.auto_price)||'-'} bold />
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
              onClick={()=>decide('rejected')} disabled={loading}>거절</button>
            <button style={{ ...S.btn, background:'#16a34a', color:'#fff' }}
              onClick={()=>decide('approved')} disabled={loading}>
              {loading?'처리 중...':'승인 및 이메일 발송'}
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
                <Info label="배송사"  value={(sel as any).shipping_company || '-'} />
                <Info label="송장번호" value={(sel as any).tracking_number || '-'} bold />
              </div>
            </div>
          )}
          {sel.status === 'issue_reported' && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #e5e7eb' }}>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#6b7280', marginBottom:6 }}>문제 상황 내용</label>
              <textarea defaultValue={(sel as any).issue_note || ''} id={`issue-note-${sel.id}`}
                placeholder="발생한 문제 상황을 상세히 입력하세요..."
                style={{ width:'100%', padding:'10px 12px', border:'1.5px solid #d1d5db', borderRadius:8, fontSize:13, minHeight:100, resize:'vertical', fontFamily:'inherit' }} />
              <button onClick={async () => {
                const textarea = document.getElementById(`issue-note-${sel.id}`) as HTMLTextAreaElement
                const issueNote = textarea.value.trim()
                if (!issueNote) { alert('문제 상황 내용을 입력하세요'); return }
                if (!confirm('저장하시겠습니까?')) return
                try {
                  const res = await fetch(`/api/quotes/${sel.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type':'application/json', 'x-admin-password': password },
                    body: JSON.stringify({ action: 'update_issue', issue_note: issueNote })
                  })
                  const json = await res.json()
                  if (!json.ok) throw new Error(json.error)
                  alert('저장되었습니다.'); refresh()
                } catch(e:any) { alert('오류: '+e.message) }
              }}
                style={{ marginTop:8, padding:'8px 16px', background:'#dc2626', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                문제 상황 저장
              </button>
            </div>
          )}
        </Section>
      )}
    </div>
  )

  // ── 목록 화면 ──
  return (
    <div style={S.wrap}>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:20, fontWeight:700, marginBottom:16 }}>견적 관리 대시보드</h1>
        <div style={{ display:'flex', gap:8, marginBottom:16, borderBottom:'2px solid #e5e7eb' }}>
          <button onClick={()=>setTab('quotes')} style={{
            padding:'10px 20px', background:'none', border:'none',
            borderBottom: tab==='quotes'?'3px solid #2563eb':'3px solid transparent',
            color: tab==='quotes'?'#2563eb':'#6b7280', fontSize:14, fontWeight:700, cursor:'pointer'
          }}>견적 목록</button>
          <button onClick={()=>{ setTab('settings'); if(!editSettings) loadSettings() }} style={{
            padding:'10px 20px', background:'none', border:'none',
            borderBottom: tab==='settings'?'3px solid #2563eb':'3px solid transparent',
            color: tab==='settings'?'#2563eb':'#6b7280', fontSize:14, fontWeight:700, cursor:'pointer'
          }}>견적 옵션 설정</button>
        </div>
      </div>

      {/* ── 견적 목록 탭 ── */}
      {tab === 'quotes' && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <div style={{ fontSize:13, color:'#6b7280' }}>
              전체 {activeQuotes.length}건 &nbsp;·&nbsp;
              <span style={{ color:'#d97706', fontWeight:600 }}>검토 중 {counts.pending}건</span> &nbsp;·&nbsp;
              <span style={{ color:'#16a34a', fontWeight:600 }}>승인 {counts.approved}건</span> &nbsp;·&nbsp;
              거절 {counts.rejected}건 &nbsp;·&nbsp;
              <span style={{ color:'#dc2626', fontWeight:600 }}>삭제 {counts.deleted}건</span>
            </div>
            <button style={S.sBtn} onClick={refresh}>↻ 새로고침</button>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <select value={filter} onChange={e=>{ setFilter(e.target.value as typeof filter); setVisibleCount(30) }}
                style={{ padding:'9px 14px', border:'1.5px solid #d1d5db', borderRadius:10, fontSize:14, fontWeight:600,
                  background:'#fff', cursor:'pointer', minWidth:150, color: filter==='deleted'?'#dc2626':'#1a1a1a' }}>
                <option value="all">전체 ({counts.all})</option>
                <option value="pending">검토중 ({counts.pending})</option>
                <option value="approved">승인됨 ({counts.approved})</option>
                <option value="rejected">거절됨 ({counts.rejected})</option>
                <option value="shipped">완료 ({counts.shipped})</option>
                <option value="as">A/S ({counts.as})</option>
                <option value="deleted">삭제 ({counts.deleted})</option>
              </select>
              <input value={search} onChange={e=>{ setSearch(e.target.value); setVisibleCount(30) }}
                placeholder="견적번호·이름·이메일·업체·연락처 검색"
                style={{ padding:'9px 12px', border:'1.5px solid #d1d5db', borderRadius:10, fontSize:13, minWidth:220 }} />
            </div>
            {filter !== 'deleted' && (
              <button onClick={bulkDelete} disabled={loading || selectedIds.length===0}
                style={{
                  padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600,
                  cursor: selectedIds.length===0 ? 'not-allowed' : 'pointer',
                  border:'1.5px solid #fca5a5',
                  background: selectedIds.length===0 ? '#fafafa' : '#fef2f2',
                  color: selectedIds.length===0 ? '#9ca3af' : '#dc2626',
                }}>
                선택 삭제{selectedIds.length>0 ? ` (${selectedIds.length})` : ''}
              </button>
            )}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {searched.length === 0 && (
              <div style={{ textAlign:'center', padding:'40px 0', color:'#9ca3af' }}>
                {kw ? '검색 결과가 없습니다' : (filter==='deleted' ? '삭제된 견적이 없습니다' : '견적 요청이 없습니다')}
              </div>
            )}

            {/* 활성 견적 — 좌측 체크박스 선택, 클릭=상세 */}
            {filter !== 'deleted' && pageItems.map(q => {
              const checked = selectedIds.includes(q.id)
              return (
                <div key={q.id} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'14px 16px',
                  background: checked ? '#eff6ff' : '#fff',
                  border:`1px solid ${checked ? '#93c5fd' : '#e5e7eb'}`, borderRadius:12, transition:'all .15s',
                }}>
                  <input type="checkbox" checked={checked} onChange={()=>toggleSelect(q.id)}
                    style={{ width:17, height:17, cursor:'pointer', accentColor:'#2563eb', flexShrink:0 }} />
                  <div onClick={()=>{ setSel(q); setAForm({price:'',days:'',note:''}); setShowIssueForm(false) }}
                    style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                        <span style={{ fontWeight:700, fontSize:14 }}>{q.quote_no}</span>
                        <span style={{ padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:600, ...BADGE[q.status] }}>
                          {BADGE_LABEL[q.status]}
                        </span>
                        <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600,
                          ...(q.marketing_consent
                            ? { background:'#f0fdf4', color:'#15803d', border:'1px solid #86efac' }
                            : { background:'#f3f4f6', color:'#9ca3af', border:'1px solid #e5e7eb' }) }}>
                          마케팅 {q.marketing_consent ? '동의' : '미동의'}
                        </span>
                        <span style={{ fontSize:11, color:'#9ca3af' }}>{new Date(q.created_at).toLocaleString('ko-KR')}</span>
                      </div>
                      <div style={{ fontSize:13, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {q.name} ({q.company||'개인'}) &nbsp;·&nbsp; {q.file_name} &nbsp;·&nbsp; {METHODS[q.method]?.label||q.method} &nbsp;·&nbsp; {q.qty}개
                      </div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:15, fontWeight:700 }}>{krw(q.final_price||q.auto_price)}</div>
                    </div>
                    <span style={{ color:'#9ca3af', fontSize:18 }}>›</span>
                  </div>
                </div>
              )
            })}

            {/* 삭제된 견적 — 요약·읽기전용·파일 제외 */}
            {filter === 'deleted' && pageItems.map(q => (
              <div key={q.id} style={{ padding:'12px 16px', background:'#fafafa', border:'1px solid #e5e7eb', borderRadius:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:700, fontSize:14, color:'#6b7280' }}>{q.quote_no}</span>
                  <span style={{ padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:600, ...BADGE[q.status] }}>
                    {BADGE_LABEL[q.status]}
                  </span>
                  <span style={{ padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600, background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5' }}>삭제됨</span>
                </div>
                <div style={{ fontSize:13, color:'#374151', marginBottom:3 }}>
                  {q.name} ({q.company||'개인'}) &nbsp;·&nbsp; {METHODS[q.method]?.label||q.method} / {q.material} / {q.color} &nbsp;·&nbsp; {q.qty}개 &nbsp;·&nbsp; {krw(q.final_price||q.auto_price)}
                </div>
                <div style={{ fontSize:11, color:'#9ca3af' }}>
                  접수 {fmtStageTime(q.created_at)} &nbsp;·&nbsp; 삭제 {fmtStageTime(q.deleted_at)} &nbsp;·&nbsp; 파일 제거됨
                </div>
                {q.admin_note && <div style={{ fontSize:11, color:'#b45309', marginTop:3 }}>사유: {q.admin_note}</div>}
              </div>
            ))}

            {searched.length > visibleCount && (
              <button onClick={()=>setVisibleCount(v=>v+30)}
                style={{ marginTop:6, padding:'10px 0', borderRadius:10, border:'1.5px solid #d1d5db', background:'#fff',
                  fontSize:13, fontWeight:600, cursor:'pointer', color:'#374151' }}>
                더 보기 ({searched.length - visibleCount}건 남음)
              </button>
            )}
          </div>
        </>
      )}

      {/* ── 설정 탭 ── */}
      {tab === 'settings' && (
        <div>
          {!editSettings ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>설정을 불러오는 중...</div>
          ) : (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div>
                  <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>출력 방식별 옵션 설정</h2>
                  <p style={{ fontSize:13, color:'#6b7280', marginTop:4 }}>
                    소재별 단가계수·밀도·색상, 품질별 보정값을 직접 추가/삭제합니다.
                  </p>
                </div>
                <button onClick={saveSettings} disabled={savingSettings} style={{
                  padding:'10px 24px', background: savingSettings?'#9ca3af':'#2563eb', color:'#fff',
                  border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor: savingSettings?'wait':'pointer'
                }}>
                  {savingSettings ? '저장 중...' : '저장'}
                </button>
              </div>

              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', marginBottom:20, fontSize:13, color:'#1e40af' }}>
                ℹ저장 즉시 고객 견적 페이지에 반영됩니다. 비활성화된 방식은 고객에게 표시되지 않습니다.
              </div>

              {(['FDM','SLA','SLS','MJF'] as const).map(method => (
                <MethodSettingCard
                  key={method}
                  method={method}
                  cfg={editSettings[method]}
                  onChange={updateMethodCfg}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children, style }: { title:string; children:React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background:'#f9fafb', borderRadius:12, padding:18, marginBottom:12, ...style }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>{title}</div>
      {children}
    </div>
  )
}

function Info({ label, value, bold }: { label:string; value:string; bold?: boolean }) {
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight: bold?700:500 }}>{value}</div>
    </div>
  )
}
