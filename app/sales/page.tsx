import SalesClient from './SalesClient'

export const metadata = { title: 'Sales – TraceFlow' }

export default function SalesPage() {
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <SalesClient />
    </div>
  )
}
