import { RETENTION_MONTHS } from '@/lib/constants'

export const metadata = { title: '개인정보처리방침 — 아틀리에 하우스' }

export default function PrivacyPage() {
  const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 20px 80px', color: '#1f2937', lineHeight: 1.8, fontSize: 14 }
  const h1: React.CSSProperties = { fontSize: 22, fontWeight: 700, marginBottom: 8 }
  const h2: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: '28px 0 8px' }
  const p: React.CSSProperties = { margin: '0 0 8px', color: '#374151' }
  const li: React.CSSProperties = { margin: '0 0 4px' }
  return (
    <div style={wrap}>
      <h1 style={h1}>개인정보처리방침</h1>
      <p style={{ color: '#6b7280', marginBottom: 4 }}>아틀리에 하우스 3D 프린팅 견적 시스템(이하 &quot;서비스&quot;)</p>
      <p style={{ color: '#9ca3af', fontSize: 12 }}>본 방침은 표준 양식을 바탕으로 작성된 예시이며, 실제 운영 정보(상호·연락처·대표자 등)에 맞게 보완하시기 바랍니다.</p>

      <h2 style={h2}>1. 수집하는 개인정보 항목</h2>
      <p style={p}>서비스는 견적 요청 처리를 위해 다음 정보를 수집합니다.</p>
      <ul>
        <li style={li}>필수: 이름, 이메일, 연락처(휴대폰), 수령(배송) 주소, 업로드한 3D 모델 파일 및 견적 정보</li>
        <li style={li}>선택: 업체명</li>
        <li style={li}>광고·마케팅 활용에 동의하신 경우: 이름, 작업 내용(사진)</li>
      </ul>

      <h2 style={h2}>2. 개인정보의 수집·이용 목적</h2>
      <ul>
        <li style={li}>3D 프린팅 견적 상담 및 산정</li>
        <li style={li}>제작 및 출력물 배송, 견적 진행 단계 안내(이메일·문자)</li>
        <li style={li}>(마케팅 동의 시) 신제품·할인·이벤트 등 광고성 정보 안내 및 작업 내용의 자사 광고·홍보 활용</li>
      </ul>

      <h2 style={h2}>3. 보유 및 이용 기간</h2>
      <p style={p}>
        견적 요청일로부터 {RETENTION_MONTHS}개월 동안 보유·이용하며, 기간 경과 또는 처리 목적 달성 시 지체 없이 파기합니다.
        다만 전자상거래 등에서의 소비자보호에 관한 법률 등 관계 법령에서 일정 기간 보존을 요구하는 경우 해당 기간 동안 보관합니다.
      </p>

      <h2 style={h2}>4. 개인정보의 제3자 제공 및 처리 위탁</h2>
      <p style={p}>서비스는 원활한 처리를 위해 아래와 같이 업무를 위탁할 수 있으며, 목적 외 용도로 제공하지 않습니다.</p>
      <ul>
        <li style={li}>이메일 발송: 이메일 발송 대행 서비스</li>
        <li style={li}>출력물 배송: 배송(택배) 사업자</li>
        <li style={li}>데이터 보관: 클라우드 인프라 제공자</li>
      </ul>

      <h2 style={h2}>5. 개인정보의 파기</h2>
      <p style={p}>보유기간이 경과하거나 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구·재생되지 않도록 안전하게 삭제합니다.</p>

      <h2 style={h2}>6. 정보주체의 권리</h2>
      <p style={p}>이용자는 언제든지 본인의 개인정보에 대한 열람·정정·삭제·처리정지 및 동의 철회를 요청할 수 있으며, 아래 문의처로 요청하실 수 있습니다.</p>

      <h2 style={h2}>7. 동의 거부 권리 및 불이익</h2>
      <p style={p}>필수 항목 수집·이용에 대한 동의를 거부할 수 있으나, 이 경우 견적 서비스 이용이 제한될 수 있습니다. 마케팅 활용 동의(선택)는 거부하셔도 견적 서비스 이용에 제한이 없습니다.</p>

      <h2 style={h2}>8. 문의처</h2>
      <p style={p}>개인정보 관련 문의 및 권리 행사: 운영자 이메일(서비스 운영 정보에 맞게 기입)</p>

      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 28 }}>본 방침의 시행일 및 변경 이력은 운영 상황에 맞게 관리하시기 바랍니다.</p>
    </div>
  )
}
