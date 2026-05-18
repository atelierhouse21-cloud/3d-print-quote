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
  status: 'pending' | 'approved' | 'rejected' | 'payment_confirmed' | 'printing' | 'post_processing' | 'shipping_ready' | 'shipped'
  created_at: string
}
