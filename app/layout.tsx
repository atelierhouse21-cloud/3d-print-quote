import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '3D 프린팅 견적 요청',
  description: 'FDM · SLA/DLP · SLS · MJF 3D 프린팅 견적을 빠르게 받아보세요.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', sans-serif; background: #f4f5f7; color: #1a1a1a; font-size: 14px; line-height: 1.6; }
          input, select, textarea, button { font-family: inherit; }
          input[type=text], input[type=email], input[type=tel], input[type=number], input[type=password], select, textarea {
            width: 100%; padding: 10px 12px; border: 1.5px solid #d1d5db; border-radius: 8px;
            font-size: 14px; background: #fff; color: #1a1a1a; outline: none; transition: border-color .15s;
          }
          input:focus, select:focus, textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
          textarea { resize: vertical; min-height: 80px; }
          a { color: inherit; text-decoration: none; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
