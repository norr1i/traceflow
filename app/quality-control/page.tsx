import QualityControlClient from './QualityControlClient'

export const metadata = { title: 'Quality Control – TraceFlow' }

export default function QualityControlPage() {
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <QualityControlClient />
    </div>
  )
}
