'use client'
import { useState, useRef, useEffect } from 'react'
import { METHODS, MATS, COLS, QUAL, calcPrice, calcDays, krw } from '@/lib/constants'

// ── STL 파서 ──────────────────────────────────────────
function isBinarySTL(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const n = view.getUint32(80, true)
  return buffer.byteLength === 84 + n * 50
}
function parseBinarySTL(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer)
  const n = view.getUint32(80, true)
  const v = new Float32Array(n * 9)
  let o = 84
  for (let i = 0; i < n; i++) {
    o += 12
    for (let j = 0; j < 9; j++) { v[i*9+j] = view.getFloat32(o, true); o += 4 }
    o += 2
  }
  return v
}
function parseASCIISTL(text: string): Float32Array {
  const v: number[] = []
  const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) v.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  return new Float32Array(v)
}
function parseSTL(buffer: ArrayBuffer): Float32Array {
  const h = new TextDecoder().decode(buffer.slice(0, 5))
  if (h === 'solid' && !isBinarySTL(buffer)) return parseASCIISTL(new TextDecoder().decode(buffer))
  return parseBinarySTL(buffer)
}
function calcVolume(v: Float32Array): number {
  let vol = 0
  for (let i = 0; i < v.length; i += 9)
    vol += (v[i]*(v[i+4]*v[i+8]-v[i+7]*v[i+5]) - v[i+1]*(v[i+3]*v[i+8]-v[i+6]*v[i+5]) + v[i+2]*(v[i+3]*v[i+7]-v[i+6]*v[i+4])) / 6
  return parseFloat((Math.abs(vol)/1000).toFixed(2))
}
function calcBBox(v: Float32Array) {
  let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity
  for (let i = 0; i < v.length; i+=3) {
    if(v[i]<x0)x0=v[i]; if(v[i]>x1)x1=v[i]
    if(v[i+1]<y0)y0=v[i+1]; if(v[i+1]>y1)y1=v[i+1]
    if(v[i+2]<z0)z0=v[i+2]; if(v[i+2]>z1)z1=v[i+2]
  }
  return { x:parseFloat((x1-x0).toFixed(1)), y:parseFloat((y1-y0).toFixed(1)), z:parseFloat((z1-z0).toFixed(1)), cx:(x0+x1)/2, cy:(y0+y1)/2, cz:(z0+z1)/2 }
}

// ── STL 뷰어 (소형) ──────────────────────────────────
type STLInfo = { x:number; y:number; z:number; volume:number }
function STLViewer({ file, onAnalyzed, height=240 }: { file:File; onAnalyzed:(i:STLInfo)=>void; height?:number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<STLInfo|null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [tick, setTick] = useState(0)
  const dragging = useRef(false)
  const lastX = useRef(0); const lastY = useRef(0)
  const lastPinchDist = useRef(0); const touching = useRef(false)
  const vertsRef = useRef<Float32Array|null>(null)
  const bboxRef = useRef<ReturnType<typeof calcBBox>|null>(null)
  const rotY = useRef(0.4); const rotX = useRef(-0.3); const zoom = useRef(1.0)

  useEffect(() => {
    if (!file) return
    setLoading(true); setErr(false)
    file.arrayBuffer().then(buf => {
      try {
        const v = parseSTL(buf)
        const bbox = calcBBox(v)
        const volume = calcVolume(v)
        const si: STLInfo = { x:bbox.x, y:bbox.y, z:bbox.z, volume }
        setInfo(si); onAnalyzed(si)
        vertsRef.current = v; bboxRef.current = bbox
        rotY.current=0.4; rotX.current=-0.3; zoom.current=1.0
        setLoading(false)
      } catch { setErr(true); setLoading(false) }
    }).catch(() => { setErr(true); setLoading(false) })
  }, [file])

  useEffect(() => { if (!loading) draw() }, [loading, tick])

  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const wheelH = (e: WheelEvent) => {
      e.preventDefault()
      zoom.current *= e.deltaY > 0 ? 0.9 : 1.1
      zoom.current = Math.max(0.2, Math.min(5.0, zoom.current))
      setTick(t=>t+1)
    }
    const touchH = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault() }
    el.addEventListener('wheel', wheelH, { passive:false })
    el.addEventListener('touchmove', touchH, { passive:false })
    return () => { el.removeEventListener('wheel', wheelH); el.removeEventListener('touchmove', touchH) }
  }, [])

  function draw() {
    const canvas = canvasRef.current; const verts = vertsRef.current; const bbox = bboxRef.current
    if (!canvas||!verts||!bbox) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W=canvas.width, H=canvas.height
    ctx.clearRect(0,0,W,H); ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,0,W,H)
    const baseScale = Math.min(W,H)*0.95/Math.max(bbox.x||1,bbox.y||1,bbox.z||1)
    const scale=baseScale*zoom.current
    const cx=bbox.cx,cy=bbox.cy,cz=bbox.cz
    const cry=Math.cos(rotY.current),sry=Math.sin(rotY.current)
    const crx=Math.cos(rotX.current),srx=Math.sin(rotX.current)
    const transform=(x:number,y:number,z:number)=>{
      const x1=cry*x+sry*z, z1=-sry*x+cry*z
      const y2=crx*y-srx*z1, z2=srx*y+crx*z1
      return {px:x1+W/2,py:-y2+H/2,pz:z2}
    }
    type Tri={depth:number;pts:{px:number;py:number}[];wnx:number;wny:number;wnz:number}
    const tris:Tri[]=[]
    for(let i=0;i<verts.length;i+=9){
      const ax2=verts[i+3]-verts[i],ay2=verts[i+4]-verts[i+1],az2=verts[i+5]-verts[i+2]
      const bx2=verts[i+6]-verts[i],by2=verts[i+7]-verts[i+1],bz2=verts[i+8]-verts[i+2]
      const wnx=ay2*bz2-az2*by2,wny=az2*bx2-ax2*bz2,wnz=ax2*by2-ay2*bx2
      const nl=Math.sqrt(wnx*wnx+wny*wny+wnz*wnz)||1
      const p0=transform((verts[i]-cx)*scale,(verts[i+1]-cy)*scale,(verts[i+2]-cz)*scale)
      const p1=transform((verts[i+3]-cx)*scale,(verts[i+4]-cy)*scale,(verts[i+5]-cz)*scale)
      const p2=transform((verts[i+6]-cx)*scale,(verts[i+7]-cy)*scale,(verts[i+8]-cz)*scale)
      const e1x=p1.px-p0.px,e1y=p1.py-p0.py,e2x=p2.px-p0.px,e2y=p2.py-p0.py
      if(e1x*e2y-e1y*e2x>=0) continue
      tris.push({depth:(p0.pz+p1.pz+p2.pz)/3,pts:[p0,p1,p2],wnx:wnx/nl,wny:wny/nl,wnz:wnz/nl})
    }
    tris.sort((a,b)=>a.depth-b.depth)
    const L1={x:0.6,y:0.9,z:0.5},l1l=Math.sqrt(0.6**2+0.9**2+0.5**2)
    const L2={x:-0.4,y:0.5,z:-0.3},l2l=Math.sqrt(0.4**2+0.5**2+0.3**2)
    for(const t of tris){
      const d1=Math.max(0,t.wnx*L1.x/l1l+t.wny*L1.y/l1l+t.wnz*L1.z/l1l)
      const d2=Math.max(0,t.wnx*L2.x/l2l+t.wny*L2.y/l2l+t.wnz*L2.z/l2l)
      const bright=Math.min(1,0.30+d1*0.55+d2*0.18)
      const v=Math.round(105+bright*(238-105))
      const [q0,q1,q2]=t.pts
      const tcx=(q0.px+q1.px+q2.px)/3,tcy=(q0.py+q1.py+q2.py)/3
      const ep=t.pts.map(p=>({px:tcx+(p.px-tcx)*1.008+(p.px-tcx>0?0.5:-0.5),py:tcy+(p.py-tcy)*1.008+(p.py-tcy>0?0.5:-0.5)}))
      ctx.beginPath(); ctx.moveTo(ep[0].px,ep[0].py); ctx.lineTo(ep[1].px,ep[1].py); ctx.lineTo(ep[2].px,ep[2].py)
      ctx.closePath(); ctx.fillStyle=`rgb(${v},${v},${v})`; ctx.fill()
    }
  }

  const onMD=(e:React.MouseEvent)=>{dragging.current=true;lastX.current=e.clientX;lastY.current=e.clientY}
  const onMM=(e:React.MouseEvent)=>{
    if(!dragging.current)return
    rotY.current+=(e.clientX-lastX.current)*0.008; rotX.current+=(e.clientY-lastY.current)*0.008
    rotX.current=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX.current))
    lastX.current=e.clientX; lastY.current=e.clientY; setTick(t=>t+1)
  }
  const onMU=()=>{dragging.current=false}
  const onTS=(e:React.TouchEvent)=>{
    if(e.touches.length===1){touching.current=true;lastX.current=e.touches[0].clientX;lastY.current=e.touches[0].clientY}
    else if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;lastPinchDist.current=Math.sqrt(dx*dx+dy*dy)}
  }
  const onTM=(e:React.TouchEvent)=>{
    if(e.touches.length===1&&touching.current){
      rotY.current+=(e.touches[0].clientX-lastX.current)*0.01; rotX.current+=(e.touches[0].clientY-lastY.current)*0.01
      rotX.current=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX.current))
      lastX.current=e.touches[0].clientX; lastY.current=e.touches[0].clientY; setTick(t=>t+1)
    } else if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY
      const dist=Math.sqrt(dx*dx+dy*dy)
      if(lastPinchDist.current>0){zoom.current*=dist/lastPinchDist.current;zoom.current=Math.max(0.2,Math.min(5,zoom.current));setTick(t=>t+1)}
      lastPinchDist.current=dist
    }
  }
  const onTE=()=>{touching.current=false;lastPinchDist.current=0}

  return (
    <div style={{borderRadius:10,overflow:'hidden',border:'1.5px solid #e5e7eb'}}>
      <div ref={viewerRef} style={{position:'relative',background:'#f5f5f5',height,cursor:dragging.current?'grabbing':'grab',touchAction:'none'}}
        onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
        onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}>
        {loading&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'#6b7280'}}>
          <div style={{fontSize:24}}>⏳</div><div style={{fontSize:12}}>분석 중...</div>
        </div>}
        {err&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'#9ca3af'}}>
          <div style={{fontSize:24}}>📄</div><div style={{fontSize:12}}>미리보기 불가</div>
        </div>}
        <canvas ref={canvasRef} width={500} height={height} style={{width:'100%',height:'100%',display:loading||err?'none':'block'}}/>
        {!loading&&!err&&<div style={{position:'absolute',bottom:6,right:8,fontSize:10,color:'#9ca3af',background:'rgba(255,255,255,0.85)',padding:'2px 7px',borderRadius:5,pointerEvents:'none'}}>
          드래그·회전 | 휠·핀치·확대
        </div>}
      </div>
      {info&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderTop:'1px solid #e5e7eb',background:'#fff'}}>
          {[['X',info.x+'mm'],['Y',info.y+'mm'],['Z',info.z+'mm'],['부피',info.volume+'㎤']].map(([l,v],i)=>(
            <div key={l} style={{padding:'7px 8px',textAlign:'center',borderRight:i<3?'1px solid #e5e7eb':'none'}}>
              <div style={{fontSize:9,color:'#9ca3af',fontWeight:700,textTransform:'uppercase' as const,marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 타입 정의 ─────────────────────────────────────────
type FileItem = {
  id: string
  file: File
  vol: number | null
  sizeX: number | null; sizeY: number | null; sizeZ: number | null
  method: string; material: string; color: string; quality: string; qm: number
  qty: number; infill: number
}
type CustomerForm = { name:string; email:string; company:string; phone:string; note:string }

const newFileItem = (file: File): FileItem => ({
  id: Math.random().toString(36).slice(2),
  file, vol:null, sizeX:null, sizeY:null, sizeZ:null,
  method:'FDM', material:'PLA', color:'White', quality:'Standard (0.2mm)', qm:1.0, qty:1, infill:20,
})

const S: Record<string,React.CSSProperties> = {
  wrap: {maxWidth:820,margin:'0 auto',padding:'20px 16px 60px'},
  card: {background:'#fff',borderRadius:16,border:'1px solid #e5e7eb',overflow:'hidden'},
  body: {padding:'24px 24px'},
  grp:  {display:'flex',flexDirection:'column',gap:5},
  lbl:  {fontSize:11,fontWeight:700,color:'#374151',textTransform:'uppercase',letterSpacing:'.4px'} as React.CSSProperties,
  inp:  {padding:'9px 11px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:13,fontFamily:'inherit',outline:'none'},
  btn:  {padding:'10px 22px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',border:'none',display:'inline-flex',alignItems:'center',gap:6},
  sBtn: {background:'#fff',color:'#374151',border:'1.5px solid #d1d5db',padding:'9px 20px',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'},
}

// ── 파일 아이템 카드 ──────────────────────────────────
function FileItemCard({ item, idx, onChange, onRemove }: {
  item: FileItem; idx: number
  onChange: (id:string, key:keyof FileItem, val:any)=>void
  onRemove: (id:string)=>void
}) {
  const updMethod = (m:string) => {
    onChange(item.id,'method',m); onChange(item.id,'material',MATS[m][0])
    onChange(item.id,'color',COLS[m][0]); onChange(item.id,'quality',QUAL[m][0].v); onChange(item.id,'qm',QUAL[m][0].m)
  }
  const isSTL = item.file.name.split('.').pop()?.toLowerCase() === 'stl'
  const price = item.vol ? calcPrice(item.method,item.vol,item.qm,item.qty,item.infill) : 0

  return (
    <div style={{border:'1.5px solid #e5e7eb',borderRadius:14,overflow:'hidden',marginBottom:16,background:'#fff'}}>
      {/* 카드 헤더 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{background:'#2563eb',color:'#fff',borderRadius:'50%',width:22,height:22,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{idx+1}</span>
          <span style={{fontWeight:600,fontSize:13,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.file.name}</span>
        </div>
        <button onClick={()=>onRemove(item.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,lineHeight:1,padding:'0 4px'}}>✕</button>
      </div>

      {/* 본문: 미리보기(좌) + 설정(우) */}
      <div style={{display:'grid',gridTemplateColumns:isSTL?'1fr 1fr':'1fr',gap:0}}>
        {/* 좌: STL 미리보기 */}
        {isSTL && (
          <div style={{padding:14,borderRight:'1px solid #e5e7eb'}}>
            <STLViewer height={220} file={item.file} onAnalyzed={info=>{
              onChange(item.id,'vol',info.volume)
              onChange(item.id,'sizeX',info.x); onChange(item.id,'sizeY',info.y); onChange(item.id,'sizeZ',info.z)
            }}/>
          </div>
        )}

        {/* 우: 출력 설정 */}
        <div style={{padding:14}}>
          {/* 출력 방식 */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#374151',textTransform:'uppercase' as const,letterSpacing:'.4px',marginBottom:6}}>출력 방식</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {Object.entries(METHODS).map(([k,m])=>(
                <button key={k} onClick={()=>updMethod(k)} style={{
                  border:item.method===k?'2px solid #2563eb':'1px solid #e5e7eb',
                  borderRadius:7,padding:'6px 8px',cursor:'pointer',textAlign:'left',
                  background:item.method===k?'#eff6ff':'#fafafa',transition:'all .12s'}}>
                  <div style={{fontSize:12,fontWeight:700,color:item.method===k?'#2563eb':'#1a1a1a'}}>{m.label}</div>
                  <div style={{fontSize:10,color:item.method===k?'#3b82f6':'#9ca3af',marginTop:1}}>{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 소재 / 색상 / 품질 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
            <div style={S.grp}>
              <label style={S.lbl}>소재</label>
              <select value={item.material} onChange={e=>onChange(item.id,'material',e.target.value)} style={{...S.inp,fontSize:12}}>
                {MATS[item.method].map(v=><option key={v}>{v}</option>)}
              </select>
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>색상</label>
              <select value={item.color} onChange={e=>onChange(item.id,'color',e.target.value)} style={{...S.inp,fontSize:12}}>
                {COLS[item.method].map(v=><option key={v}>{v}</option>)}
              </select>
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>품질</label>
              <select value={item.quality} onChange={e=>{
                const q=QUAL[item.method].find(x=>x.v===e.target.value)
                onChange(item.id,'quality',e.target.value); onChange(item.id,'qm',q?.m||1.0)
              }} style={{...S.inp,fontSize:12}}>
                {QUAL[item.method].map(q=><option key={q.v}>{q.v}</option>)}
              </select>
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>수량</label>
              <input type="number" min={1} max={9999} value={item.qty}
                onChange={e=>onChange(item.id,'qty',Math.max(1,parseInt(e.target.value)||1))}
                style={{...S.inp,fontSize:12}}/>
            </div>
          </div>

          {/* FDM 충전율 */}
          {item.method==='FDM'&&(
            <div style={{marginBottom:10}}>
              <label style={{...S.lbl,display:'block',marginBottom:5}}>
                충전율: <span style={{color:'#2563eb',fontWeight:700}}>{item.infill}%</span>
                <span style={{fontWeight:400,color:'#9ca3af',marginLeft:6,fontSize:10}}>{item.infill<=20?'경량':item.infill<=50?'일반':item.infill<=80?'강도':'솔리드'}</span>
              </label>
              <input type="range" min={10} max={100} step={5} value={item.infill}
                onChange={e=>onChange(item.id,'infill',parseInt(e.target.value))}
                style={{width:'100%',accentColor:'#2563eb'}}/>
            </div>
          )}

          {/* 예상 금액 */}
          <div style={{background:'#f0fdf4',borderRadius:8,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:11,color:'#6b7280'}}>예상 금액 (VAT 별도)</span>
            <span style={{fontSize:15,fontWeight:800,color:'#15803d'}}>{item.vol?krw(price):'담당자 산출'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────
export default function Home() {
  const [step, setStep] = useState(1)
  const [done, setDone] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
  const [customer, setCustomer] = useState<CustomerForm>({name:'',email:'',company:'',phone:'',note:''})
  const [items, setItems] = useState<FileItem[]>([])
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const updC = (k:keyof CustomerForm, v:string) => setCustomer(p=>({...p,[k]:v}))

  const handleFile = (f:File|null) => {
    if (!f) return
    setItems(p=>[...p, newFileItem(f)])
  }

  const updateItem = (id:string, key:keyof FileItem, val:any) => {
    setItems(p=>p.map(it=>it.id===id?{...it,[key]:val}:it))
  }
  const removeItem = (id:string) => setItems(p=>p.filter(it=>it.id!==id))

  const totalPrice = items.reduce((sum,it)=>sum+(it.vol?calcPrice(it.method,it.vol,it.qm,it.qty,it.infill):0),0)

  const submit = async () => {
    setLoading(true)
    try {
      // 첫 번째 파일 기준으로 API 전송 (다중 파일은 추후 확장)
      const primary = items[0]
      const fd = new FormData()
      fd.append('name',customer.name); fd.append('email',customer.email)
      fd.append('company',customer.company); fd.append('phone',customer.phone)
      fd.append('note',customer.note)
      fd.append('method',primary.method); fd.append('material',primary.material)
      fd.append('color',primary.color); fd.append('quality',primary.quality)
      fd.append('qty',String(primary.qty)); fd.append('infill',String(primary.infill))
      fd.append('qm',String(primary.qm)); fd.append('vol',String(primary.vol||0))
      fd.append('sizeX',String(primary.sizeX||0)); fd.append('sizeY',String(primary.sizeY||0)); fd.append('sizeZ',String(primary.sizeZ||0))
      // 추가 파일 정보를 note에 포함
      if (items.length > 1) {
        const extraInfo = items.slice(1).map((it,i)=>`[파일${i+2}: ${it.file.name}, ${it.method}, ${it.material}, ${it.qty}개]`).join(' ')
        fd.append('note', customer.note + (customer.note?'\n':'') + '추가파일: ' + extraInfo)
      }
      fd.append('file',primary.file)
      const res = await fetch('/api/quotes',{method:'POST',body:fd})
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setDone(json.quote_no)
    } catch(e:any) { alert('오류: '+e.message) }
    finally { setLoading(false) }
  }

  const STEP_LABELS = ['고객 정보','파일 업로드 & 출력 설정','견적 확인']

  if (done) return (
    <div style={S.wrap}><Logo/>
      <div style={S.card}><div style={{...S.body,textAlign:'center',padding:'52px 28px'}}>
        <div style={{fontSize:64,marginBottom:20}}>🎉</div>
        <h2 style={{fontSize:22,fontWeight:700,marginBottom:10}}>견적 요청이 접수되었습니다!</h2>
        <p style={{color:'#6b7280',lineHeight:1.8,marginBottom:28}}>
          <b>{customer.email}</b>으로 접수 확인 메일을 발송했습니다.<br/>
          담당자 검토 후 <b>1~2 영업일 이내</b> 최종 견적을 안내드립니다.<br/>
          <span style={{fontSize:13,color:'#9ca3af'}}>견적 번호: {done}</span>
        </p>
        <button style={S.sBtn} onClick={()=>{setDone(null);setStep(1);setCustomer({name:'',email:'',company:'',phone:'',note:''});setItems([])}}>새 견적 요청</button>
      </div></div>
    </div>
  )

  return (
    <div style={S.wrap}><Logo/>
      <div style={S.card}>
        {/* 진행 단계 */}
        <div style={{display:'flex',alignItems:'center',padding:'16px 24px',background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
          {STEP_LABELS.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',flex:i<STEP_LABELS.length-1?1:undefined}}>
              <div style={{display:'flex',alignItems:'center',gap:7,flexShrink:0}}>
                <div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,
                  background:step>i+1?'#16a34a':step===i+1?'#2563eb':'#fff',
                  border:`2px solid ${step>i+1?'#16a34a':step===i+1?'#2563eb':'#d1d5db'}`,
                  color:step>i+1||step===i+1?'#fff':'#9ca3af'}}>
                  {step>i+1?'✓':i+1}
                </div>
                <span style={{fontSize:12,whiteSpace:'nowrap',color:step===i+1?'#1a1a1a':'#9ca3af',fontWeight:step===i+1?600:400}}>{s}</span>
              </div>
              {i<STEP_LABELS.length-1&&<div style={{flex:1,height:1,background:'#d1d5db',margin:'0 8px'}}/>}
            </div>
          ))}
        </div>

        <div style={S.body}>

          {/* ── STEP 1: 고객 정보 ── */}
          {step===1&&<>
            <p style={{color:'#6b7280',marginBottom:20,fontSize:13}}>견적 요청자 정보를 입력해 주세요.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
              <div style={S.grp}><label style={S.lbl}>이름 *</label><input type="text" value={customer.name} onChange={e=>updC('name',e.target.value)} placeholder="홍길동" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>이메일 *</label><input type="email" value={customer.email} onChange={e=>updC('email',e.target.value)} placeholder="example@mail.com" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>회사 / 기관</label><input type="text" value={customer.company} onChange={e=>updC('company',e.target.value)} placeholder="(주)회사명 또는 개인" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>연락처</label><input type="tel" value={customer.phone} onChange={e=>updC('phone',e.target.value)} placeholder="010-0000-0000" style={S.inp}/></div>

            </div>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button style={{...S.btn,background:'#2563eb',color:'#fff'}}
                onClick={()=>{if(!customer.name.trim()||!customer.email.trim()){alert('이름과 이메일은 필수입니다.');return}setStep(2)}}>
                다음 단계 →
              </button>
            </div>
          </>}

          {/* ── STEP 2: 파일 업로드 & 출력 설정 ── */}
          {step===2&&<>
            <p style={{color:'#6b7280',marginBottom:16,fontSize:13}}>출력할 파일을 업로드하고 각 파일의 출력 설정을 선택해 주세요. 파일은 여러 개 추가 가능합니다.</p>

            {/* 파일 업로드 존 */}
            <input ref={fileRef} type="file" accept="application/octet-stream,.stl,.obj,.3mf,.step,.stp,.iges" style={{display:'none'}} onChange={e=>{handleFile(e.target.files?.[0]||null);if(fileRef.current)fileRef.current.value=''}}/>
            <div
              onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0])}}
              style={{border:`2px dashed ${drag?'#2563eb':'#d1d5db'}`,borderRadius:12,padding:'20px',
                background:drag?'#eff6ff':'#f9fafb',transition:'all .15s',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:3}}>📂 파일을 이 영역에 드래그 하거나</div>
                  <div style={{fontSize:12,color:'#6b7280'}}>STL · OBJ · 3MF · STEP · IGES 지원</div>
                </div>
                <button onClick={()=>fileRef.current?.click()}
                  style={{...S.btn,background:'#2563eb',color:'#fff',flexShrink:0,fontSize:13}}>
                  + 파일 선택
                </button>
              </div>
            </div>

            {/* 요청 사항 */}
            <div style={{...S.grp,marginBottom:16}}>
              <label style={S.lbl}>요청 사항</label>
              <textarea value={customer.note} onChange={e=>updC('note',e.target.value)}
                placeholder="납기 요청, 표면 처리, 후처리, 특이 사항 등을 입력하세요"
                style={{...S.inp,minHeight:70,resize:'vertical'}}/>
            </div>

            {items.length===0&&(
              <div style={{textAlign:'center',padding:'32px 0',color:'#9ca3af',fontSize:13}}>
                업로드된 파일이 없습니다. 위에서 파일을 추가해 주세요.
              </div>
            )}

            {/* 파일 아이템 목록 */}
            {items.map((item,idx)=>(
              <FileItemCard key={item.id} item={item} idx={idx} onChange={updateItem} onRemove={removeItem}/>
            ))}

            {items.length>0&&(
              <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
                <button style={S.sBtn} onClick={()=>setStep(1)}>← 이전</button>
                <button style={{...S.btn,background:'#2563eb',color:'#fff'}} onClick={()=>setStep(3)}>견적 확인 →</button>
              </div>
            )}
            {items.length===0&&(
              <div style={{display:'flex',justifyContent:'flex-start',marginTop:8}}>
                <button style={S.sBtn} onClick={()=>setStep(1)}>← 이전</button>
              </div>
            )}
          </>}

          {/* ── STEP 3: 견적 확인 ── */}
          {step===3&&<>
            <p style={{color:'#6b7280',marginBottom:16,fontSize:13}}>아래 내용을 확인하고 견적 요청을 제출해 주세요.</p>

            {/* 고객 정보 요약 */}
            <div style={{background:'#f9fafb',borderRadius:10,padding:'12px 16px',marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase' as const,letterSpacing:'.4px',marginBottom:8}}>고객 정보</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[['이름',customer.name],['이메일',customer.email],['회사',customer.company||'-'],['연락처',customer.phone||'-']].map(([l,v])=>(
                  <div key={l}><span style={{fontSize:11,color:'#9ca3af'}}>{l}: </span><span style={{fontSize:13,fontWeight:600}}>{v}</span></div>
                ))}
              </div>
              {customer.note&&<div style={{marginTop:6,fontSize:12,color:'#6b7280'}}>요청사항: {customer.note}</div>}
            </div>

            {/* 파일별 요약 */}
            {items.map((item,idx)=>(
              <div key={item.id} style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7}}>
                    <span style={{background:'#2563eb',color:'#fff',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{idx+1}</span>
                    <span style={{fontWeight:600,fontSize:13}}>{item.file.name}</span>
                  </div>
                  <span style={{fontSize:15,fontWeight:800,color:'#15803d'}}>{item.vol?krw(calcPrice(item.method,item.vol,item.qm,item.qty,item.infill)):'담당자 산출'}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
                  {[['방식',METHODS[item.method].label],['소재',item.material],['색상',item.color],['수량',item.qty+'개'],
                    ['품질',item.quality],...(item.method==='FDM'?[['충전율',item.infill+'%']]:[] as [string,string][]),
                    ...(item.sizeX!=null?[['크기',`${item.sizeX}×${item.sizeY}×${item.sizeZ}mm`]]:[] as [string,string][]),
                    ...(item.vol!=null?[['부피',item.vol+'㎤']]:[] as [string,string][]),
                  ].map(([l,v])=>(
                    <div key={l} style={{background:'#f9fafb',borderRadius:6,padding:'6px 8px'}}>
                      <div style={{fontSize:10,color:'#9ca3af',marginBottom:1,fontWeight:600,textTransform:'uppercase' as const}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:600}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>예상 납기: <b>{calcDays(item.method,item.qty)}</b> (영업일 기준)</div>
              </div>
            ))}

            {/* 합계 */}
            {items.length>1&&(
              <div style={{background:'#eff6ff',borderRadius:10,padding:'12px 16px',marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:600,fontSize:14}}>전체 예상 합계 (VAT 별도)</span>
                <span style={{fontSize:20,fontWeight:800,color:'#2563eb'}}>{krw(totalPrice)}</span>
              </div>
            )}

            <div style={{display:'flex',gap:10,padding:'11px 14px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:10,fontSize:13,color:'#92400e',marginBottom:20,alignItems:'flex-start'}}>
              <span>⚠️</span><span>위 금액은 자동 계산 예상 견적입니다. 담당자 검토 후 <b>확정 견적을 이메일로 안내</b>드립니다.</span>
            </div>

            <div style={{display:'flex',justifyContent:'space-between'}}>
              <button style={S.sBtn} onClick={()=>setStep(2)}>← 이전</button>
              <button style={{...S.btn,background:loading?'#9ca3af':'#16a34a',color:'#fff',cursor:loading?'wait':'pointer'}} onClick={submit} disabled={loading}>
                {loading?'제출 중...':'✓ 견적 요청 제출'}
              </button>
            </div>
          </>}

        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,letterSpacing:-.5}}>🖨️ 3D 프린팅 견적 시스템</div>
        <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>FDM · SLA/DLP · SLS · MJF — 자동 견적 + 담당자 확인</div>
      </div>
    </div>
  )
}
