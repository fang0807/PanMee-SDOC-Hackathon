// Client for the FastAPI backend (backend/api.py).

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export interface ApiField {
  field: string
  si: string
  bl: string
  result: 'match' | 'mismatch' | 'review'
  reason: string
}

export interface ApiResult {
  email_id: string
  category: string
  status: 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'
  has_defect: boolean
  defect_fields: string[]
  review_reason: string | null
  fields: ApiField[]
}

export type AttachmentRole = 'SI' | 'BL'

// The SI / BL files a sample email came with. A role is absent when that
// attachment is missing.
export type ApiAttachments = Partial<Record<AttachmentRole, { filename: string; extension: string }>>

export interface ApiAttachmentText {
  filename: string
  extension: string
  text: string
  ocr: boolean
  unreadable: boolean
}

export interface ApiSheet {
  name: string
  rows: string[][]
  truncated: boolean
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
  attachments: ApiAttachments
}

export interface CheckRequest {
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

function attachmentUrl(emailId: string, role: AttachmentRole, part: string): string {
  return `${API_URL}/api/emails/${encodeURIComponent(emailId)}/attachments/${role}/${part}`
}

// The original file: shown in the page by default, saved when download is true.
export function attachmentFileUrl(emailId: string, role: AttachmentRole, download = false): string {
  return attachmentUrl(emailId, role, 'file') + (download ? '?download=true' : '')
}

async function getAttachment(url: string): Promise<Response> {
  let response: Response

  try {
    response = await fetch(url)
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (!response.ok) throw new Error(await errorMessage(response))

  return response
}

// What the pipeline read from the file (OCR text for a scan).
export async function fetchAttachmentText(emailId: string, role: AttachmentRole): Promise<ApiAttachmentText> {
  return (await getAttachment(attachmentUrl(emailId, role, 'text'))).json()
}

// The cells of an Excel attachment, one table per sheet.
export async function fetchAttachmentSheets(emailId: string, role: AttachmentRole): Promise<ApiSheet[]> {
  return (await (await getAttachment(attachmentUrl(emailId, role, 'sheet'))).json()).sheets
}

// The original file as bytes (used to draw Word documents in the page).
export async function fetchAttachmentBytes(emailId: string, role: AttachmentRole): Promise<ArrayBuffer> {
  return (await getAttachment(attachmentFileUrl(emailId, role))).arrayBuffer()
}

// The original file as text (used for .txt attachments).
export async function fetchAttachmentPlainText(emailId: string, role: AttachmentRole): Promise<string> {
  return (await getAttachment(attachmentFileUrl(emailId, role))).text()
}

export async function checkDocuments(request: CheckRequest): Promise<ApiResult> {
  const form = new FormData()
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
