// Client for the FastAPI backend (backend/api.py).

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export interface ApiField {
  field: string
  si: string
  bl: string
  result: 'match' | 'mismatch' | 'review'
  reason: string
}

export interface ApiAutoReply {
  ok: boolean
  email_id?: string
  status?: string | null
  action: 'SENT' | 'PREVIEW_ONLY' | 'REVIEW_REQUIRED' | 'SKIPPED' | 'ERROR' | string
  recipient?: string
  subject?: string
  body?: string
  path?: string
  reason?: string
}

export interface ApiResult {
  email_id: string
  category: string
  status: 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'
  has_defect: boolean
  defect_fields: string[]
  review_reason: string | null
  fields: ApiField[]
  auto_reply?: ApiAutoReply
}

// One sample-inbox email with its pipeline result (GET /api/emails).
export interface ApiEmailRecord {
  id: string
  subject: string
  sender: string
  senderName: string
  body: string
  received: string
  docType: string
  category: string
  status: 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'
  defectFields: string[]
  reviewReason: string | null
  fields: ApiField[]
}

export interface CheckRequest {
  subject: string
  body: string
  sender: string
  si: File
  bl: File
}

// Labels for the field names the API returns (the official submission names).
export const FIELD_LABELS: Record<string, string> = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify Party',
  port_of_loading: 'Port of Loading',
  port_of_discharge: 'Port of Discharge',
  container_count: 'Container Count',
  gross_weight_kg: 'Gross Weight (kg)',
}

async function errorMessage(response: Response): Promise<string> {
  let message = `The server returned an error (${response.status}).`

  try {
    const payload = await response.json()
    if (typeof payload.detail === 'string') message = payload.detail
  } catch {
    // Keep the generic message when the body is not JSON.
  }

  return message
}

export async function fetchEmails(): Promise<ApiEmailRecord[]> {
  let response: Response

  try {
    response = await fetch(`${API_URL}/api/emails`)
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (!response.ok) throw new Error(await errorMessage(response))

  return response.json()
}

export async function checkDocuments(request: CheckRequest): Promise<ApiResult> {
  const form = new FormData()
  form.append('subject', request.subject)
  form.append('body', request.body)
  form.append('sender', request.sender)
  form.append('si', request.si)
  form.append('bl', request.bl)

  let response: Response

  try {
    response = await fetch(`${API_URL}/api/process`, { method: 'POST', body: form })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (!response.ok) throw new Error(await errorMessage(response))

  return response.json()
}
