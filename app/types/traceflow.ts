export type Product = {
  id: string
  user_id: string
  name: string
  sku: string
  description?: string
  created_at: string
}

export type RawMaterial = {
  id: string
  user_id: string
  name: string
  unit: string
  quantity_in_stock: number
  reorder_level: number
  supplier_id?: string
  created_at: string
}

export type Supplier = {
  id: string
  user_id: string
  name: string
  contact_email?: string
  contact_phone?: string
  created_at: string
}

export type ProductionOrder = {
  id: string
  user_id: string
  product_id: string
  quantity: number
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  started_at?: string
  completed_at?: string
  created_at: string
}

export type BomUsage = {
  id: string
  production_order_id: string
  raw_material_id: string
  quantity_used: number
  created_at: string
}

export type BomEntry = {
  id: string
  user_id: string
  production_order_id: string
  material_name: string
  lot_number?: string | null
  quantity: number
  unit: string
  created_at: string
}

export type QcResult = {
  id: string
  production_order_id: string
  passed: boolean
  notes?: string
  inspected_at: string
  created_at: string
}

export type Sale = {
  id: string
  user_id: string
  product_id?: string
  product_name?: string
  quantity: number
  unit_price?: number
  total_price: number
  customer_name?: string
  status?: string
  sold_at: string
  created_at: string
}
