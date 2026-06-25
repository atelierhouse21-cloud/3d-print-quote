export const METHODS: Record<string, { label: string; sub: string; price: number; minD: number; maxD: number }> = {
  FDM: { label: 'FDM',       sub: '일반 필라멘트',  price: 2500, minD: 1, maxD: 3 },
  SLA: { label: 'SLA / DLP', sub: '광경화 레진',    price: 4500, minD: 2, maxD: 5 },
  SLS: { label: 'SLS',       sub: '나일론 파우더',  price: 7000, minD: 3, maxD: 7 },
  MJF: { label: 'MJF',       sub: 'HP 멀티젯 퓨전', price: 9500, minD: 3, maxD: 7 },
}

export const MATS: Record<string, string[]> = {
  FDM: ['PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'PLA+'],
  SLA: ['Standard Resin', 'ABS-Like Resin', 'Flexible Resin', 'Castable Resin'],
  SLS: ['PA12 (Nylon)', 'PA11', 'TPU'],
  MJF: ['PA12 (Nylon)', 'PA12GB', 'TPU'],
}

export const COLS: Record<string, string[]> = {
  FDM: ['White', 'Black', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Custom'],
  SLA: ['Clear', 'White', 'Black', 'Gray', 'Custom Pigment'],
  SLS: ['Natural (White)', 'Black', 'Custom Dye'],
  MJF: ['Natural Gray', 'Black'],
}

export const QUAL: Record<string, { v: string; m: number }[]> = {
  FDM: [{ v: 'Draft (0.3mm)', m: 0.7 }, { v: 'Standard (0.2mm)', m: 1.0 }, { v: 'Fine (0.1mm)', m: 1.5 }, { v: 'Ultra (0.05mm)', m: 2.2 }],
  SLA: [{ v: 'Standard (0.1mm)', m: 1.0 }, { v: 'Fine (0.05mm)', m: 1.8 }],
  SLS: [{ v: 'Standard (0.1mm)', m: 1.0 }],
  MJF: [{ v: 'Standard (0.08mm)', m: 1.0 }, { v: 'Fine (0.04mm)', m: 1.5 }],
}

export function calcPrice(method: string, vol: number, qm: number, qty: number, infill: number): number {
  const base = METHODS[method].price * vol * qm
  const fill = method === 'FDM' ? 0.55 + (infill / 100) * 0.45 : 1
  const disc = qty >= 10 ? 0.85 : qty >= 5 ? 0.92 : 1
  return Math.round((base * fill * disc * qty) / 1000) * 1000
}

export function calcDays(method: string, qty: number): string {
  const m = METHODS[method]
  const x = qty > 5 ? 2 : qty > 2 ? 1 : 0
  return `${m.minD + x} ~ ${m.maxD + x}일`
}

export function krw(n: number | null | undefined): string {
  if (!n) return '-'
  return '₩' + Math.round(n).toLocaleString('ko-KR')
}

export type Quote = {
  id: string
  quote_no: string
  name: string
  email: string
  company?: string
  phone?: string
  file_name?: string
  file_path?: string
  vol_cm3?: number
  size_x?: number
  size_y?: number
  size_z?: number
  method: string
  material: string
  color: string
  quality: string
  qty: number
  infill?: number
  note?: string
  auto_price?: number
  admin_price?: number
  admin_days?: string
  admin_note?: string
  final_price?: number
  final_days?: string
  tracking_number?: string
  shipping_company?: string
  issue_note?: string
  stage_times?: Record<string, string>
  deleted_at?: string | null
  as_origin?: {
    quote_no?: string; shipping_company?: string; tracking_number?: string
    final_price?: number; final_days?: string; shipped_at?: string
  } | null
  status: 'pending' | 'approved' | 'rejected' | 'payment_confirmed' | 'printing' | 'post_processing' | 'shipping_ready' | 'shipped' | 'issue_reported'
  created_at: string
}

// ═══════════════════════════════════════════════════════════════
// v2 옵션 모델 (소재별 밀도·색상 / 품질별 보정값 / 방식별 단가계수)
// ═══════════════════════════════════════════════════════════════
export type MaterialCfg = { name: string; density: number; colors: string[] }
export type QualityCfg  = { name: string; factor: number }
export type MethodCfg   = { enabled: boolean; coefficient: number; materials: MaterialCfg[]; qualities: QualityCfg[] }
export type PrintOptions = Record<string, MethodCfg>

// 방식별 기본 단가 계수 (관리자 설정 값) — 관리자가 조정 가능
export const DEFAULT_COEFF: Record<string, number> = { FDM: 2000, SLA: 3600, SLS: 5600, MJF: 7600 }

// 소재별 기본 밀도(g/cm³ 근사) — 목록에 없으면 1.0
export const DEFAULT_DENSITY: Record<string, number> = {
  'PLA': 1.24, 'PLA+': 1.25, 'PETG': 1.27, 'ABS': 1.04, 'TPU': 1.21, 'ASA': 1.07,
  'Standard Resin': 1.15, 'ABS-Like Resin': 1.15, 'Flexible Resin': 1.10, 'Castable Resin': 1.10,
  'PA12 (Nylon)': 1.01, 'PA11': 1.03, 'PA12GB': 1.30,
}

// 국내 택배사 목록
export const COURIERS: string[] = [
  'CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배',
  '경동택배', '대신택배', '일양로지스', 'GS Postbox 택배', 'CU 편의점택배',
  '쿠팡 로지스틱스', '직접 수령',
]

// 방식 1개의 기본 설정 생성
export function defaultMethodCfg(method: string): MethodCfg {
  const materials: MaterialCfg[] = (MATS[method] || []).map(name => ({
    name, density: DEFAULT_DENSITY[name] ?? 1.0, colors: [...(COLS[method] || [])],
  }))
  const qualities: QualityCfg[] = (QUAL[method] || []).map(q => ({ name: q.v, factor: q.m }))
  return { enabled: true, coefficient: DEFAULT_COEFF[method] ?? 1000, materials, qualities }
}

// 전체 기본 설정
export function defaultSettings(): PrintOptions {
  const r: PrintOptions = {}
  for (const m of Object.keys(METHODS)) r[m] = defaultMethodCfg(m)
  return r
}

// 저장된 설정(구·신버전)을 신버전 형태로 정규화
export function normalizeSettings(data: any): PrintOptions {
  const ALL = Object.keys(METHODS)
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return defaultSettings()

  // 아주 구버전: { methods:[], qualities:[] }
  if (Array.isArray(data.methods) || Array.isArray(data.qualities)) {
    const enabled: string[] = data.methods || ALL
    const r: PrintOptions = {}
    for (const m of ALL) { const d = defaultMethodCfg(m); d.enabled = enabled.includes(m); r[m] = d }
    return r
  }

  const r: PrintOptions = {}
  for (const m of ALL) {
    const cur = data[m]
    if (!cur || typeof cur !== 'object') { r[m] = defaultMethodCfg(m); continue }

    const matsAreObjects  = Array.isArray(cur.materials) && cur.materials.length > 0 && typeof cur.materials[0] === 'object'
    const qualsAreObjects = Array.isArray(cur.qualities) && cur.qualities.length > 0 && typeof cur.qualities[0] === 'object'

    if (matsAreObjects && qualsAreObjects) {
      // 이미 신버전
      r[m] = {
        enabled: cur.enabled !== false,
        coefficient: typeof cur.coefficient === 'number' ? cur.coefficient : (DEFAULT_COEFF[m] ?? 1000),
        materials: cur.materials.map((x: any) => ({
          name: String(x.name),
          density: Number(x.density) || 1.0,
          colors: Array.isArray(x.colors) ? x.colors.map(String) : [],
        })),
        qualities: cur.qualities.map((x: any) => ({ name: String(x.name), factor: Number(x.factor) || 1.0 })),
      }
    } else {
      // 구버전(colors[], materials[], qualities[]) → 신버전 변환
      const oldColors: string[] = Array.isArray(cur.colors) ? cur.colors : (COLS[m] || [])
      const oldMats: string[]   = Array.isArray(cur.materials) ? cur.materials : (MATS[m] || [])
      const oldQuals: string[]  = Array.isArray(cur.qualities) ? cur.qualities : (QUAL[m] || []).map(q => q.v)
      r[m] = {
        enabled: cur.enabled !== false,
        coefficient: typeof cur.coefficient === 'number' ? cur.coefficient : (DEFAULT_COEFF[m] ?? 1000),
        materials: oldMats.map(name => ({ name, density: DEFAULT_DENSITY[name] ?? 1.0, colors: [...oldColors] })),
        qualities: oldQuals.map(name => {
          const f = (QUAL[m] || []).find(q => q.v === name)
          return { name, factor: f ? f.m : 1.0 }
        }),
      }
    }
  }
  return r
}

// v2 가격식: 부피 × 밀도 × 단가계수 × 수량 × 품질보정값 (100원 단위 반올림)
export function calcPriceV2(vol: number, density: number, coefficient: number, qty: number, qualityFactor: number): number {
  const p = vol * density * coefficient * qty * qualityFactor
  if (!isFinite(p) || p <= 0) return 0
  return Math.round(p / 100) * 100
}
