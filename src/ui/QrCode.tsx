import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** A QR code as crisp SVG: black modules on white, with the standard 4-module quiet zone. */
export function QrCode({ text, size }: { text: string; size: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
    return { path, count }
  }, [text])
  return (
    <svg className="qr" width={size} height={size} viewBox={`-4 -4 ${count + 8} ${count + 8}`} shapeRendering="crispEdges" aria-hidden="true">
      <rect x={-4} y={-4} width={count + 8} height={count + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
