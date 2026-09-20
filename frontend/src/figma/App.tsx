import React, { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | 'overview'
  | 'inbox'
  | 'inbox-detail'
  | 'others-detail'
  | 'verification'
  | 'verification-detail'
  | 'manual-review'
  | 'final-decision'
  | 'resend'

type NavItem = 'overview' | 'inbox' | 'verification' | 'resend'
type VerifTab = 'match' | 'mismatch' | 'review'
type FieldResult = 'match' | 'mismatch' | 'review'
type DocResult = 'match' | 'mismatch' | 'review'
type ManualDecision = 'match' | 'resend' | 'keep-review'
type Classification = 'ignore' | 'check' | 'need-review'

interface VerifField {
  field: string
  si: string
  bl: string
  result: FieldResult
  reason: string
}

interface Email {
  id: string
  subject: string
  senderName: string
  sender: string
  received: string
  docType: string
  docResult: DocResult
  reviewDetail?: string
  classification: Classification
  classifyType?: string
  fields: VerifField[]
}

// ─── Email pool ───────────────────────────────────────────────────────────────

const allEmails: Email[] = [
  {
    id: 'email_001',
    subject: 'Shipping Instruction + BL — Ref. CSC-2024-3310',
    senderName: 'COSCO Shipping',
    sender: 'trade@cosco-shipping.com',
    received: 'Today, 12:30 PM',
    docType: 'SI + BL',
    docResult: 'review',
    reviewDetail: 'Unable to identify Shipper — BL field is partially corrupted',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'COSCO Excellence Corp.', bl: 'Unable to identify', result: 'review', reason: 'The BL document is partially corrupted — shipper field is unreadable.' },
      { field: 'Consignee', si: 'Nordic Cargo AB', bl: 'Nordic Cargo AB', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Nordic Cargo AB', bl: 'Nordic Cargo AB', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Tianjin, China (CNTXG)', bl: 'Tianjin, China (CNTXG)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Gothenburg, Sweden (SEGOT)', bl: 'Gothenburg, Sweden (SEGOT)', result: 'match', reason: '' },
      { field: 'Container Count', si: '2 × 20GP', bl: '2 × 20GP', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '14,200 kg', bl: '14,200 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_002',
    subject: 'SI & BL Documents — Pacific Import PO #44821',
    senderName: 'Pacific Imports Pte.',
    sender: 'logistics@pacific-imports.sg',
    received: 'Today, 10:05 AM',
    docType: 'SI + BL',
    docResult: 'match',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Pacific Imports Pte. Ltd.', bl: 'Pacific Imports Pte. Ltd.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Euro Trade GmbH', bl: 'Euro Trade GmbH', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Euro Trade GmbH', bl: 'Euro Trade GmbH', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Singapore (SGSIN)', bl: 'Singapore (SGSIN)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Hamburg, Germany (DEHAM)', bl: 'Hamburg, Germany (DEHAM)', result: 'match', reason: '' },
      { field: 'Container Count', si: '1 × 40HC', bl: '1 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '22,800 kg', bl: '22,800 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_003',
    subject: 'BL Submission — Hapag Export HLL-0228',
    senderName: 'Hapag-Lloyd AG',
    sender: 'export@hapag-lloyd.com',
    received: 'Today, 08:47 AM',
    docType: 'SI + BL',
    docResult: 'mismatch',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Hapag Logistics GmbH', bl: 'Hapag Logistics GmbH', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Orient Pacific Co. Ltd.', bl: 'Orient Pacific Co. Ltd.', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Orient Pacific Co. Ltd.', bl: 'Orient Pacific Co. Ltd.', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Hamburg, Germany (DEHAM)', bl: 'Hamburg, Germany (DEHAM)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Dubai, UAE (AEDXB)', bl: 'Abu Dhabi, UAE (AEAUH)', result: 'mismatch', reason: 'Port of discharge differs — SI states Dubai (AEDXB) but BL states Abu Dhabi (AEAUH). Carrier confirmation required.' },
      { field: 'Container Count', si: '3 × 40HC', bl: '3 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '9,600 kg', bl: '9,600 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_010',
    subject: 'Invoice #INV-2024-8821 — Pacific Logistics',
    senderName: 'Pacific Logistics Ltd.',
    sender: 'billing@pacific-logistics.sg',
    received: 'Today, 11:22 AM',
    docType: 'Invoice',
    docResult: 'match',
    classification: 'ignore',
    classifyType: 'Invoice Query',
    fields: [],
  },
  {
    id: 'email_011',
    subject: 'RE: Updated Shipping Terms & Conditions',
    senderName: 'OOCL Trade Team',
    sender: 'trade@oocl.com',
    received: 'Today, 09:55 AM',
    docType: 'General',
    docResult: 'match',
    classification: 'ignore',
    classifyType: 'General',
    fields: [],
  },
  {
    id: 'email_012',
    subject: 'Fwd: Documents for Your Reference',
    senderName: 'info@unknown-sender.net',
    sender: 'info@unknown-sender.net',
    received: 'Today, 07:30 AM',
    docType: 'Unknown',
    docResult: 'review',
    classification: 'need-review',
    classifyType: 'Unknown',
    fields: [],
  },
  {
    id: 'email_004',
    subject: 'Shipping Instruction — MAERSK #4821',
    senderName: 'Maersk Trading Co.',
    sender: 'ops@maersktrading.com',
    received: '18 Nov, 10:42 AM',
    docType: 'SI + BL',
    docResult: 'match',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Maersk Trading Co. Ltd.', bl: 'Maersk Trading Co. Ltd.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Pacific Imports Pte. Ltd.', bl: 'Pacific Imports Pte. Ltd.', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Pacific Imports Pte. Ltd.', bl: 'Pacific Imports Pte. Ltd.', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Shanghai, China (CNSHA)', bl: 'Shanghai, China (CNSHA)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Singapore (SGSIN)', bl: 'Singapore (SGSIN)', result: 'match', reason: '' },
      { field: 'Container Count', si: '3 × 40HC', bl: '3 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '18,240 kg', bl: '18,240 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_005',
    subject: 'Bill of Lading — MSC #9281',
    senderName: 'MSC Shipping',
    sender: 'trade@mscshipping.com',
    received: '18 Nov, 09:31 AM',
    docType: 'SI + BL',
    docResult: 'review',
    reviewDetail: 'Unable to identify Notify Party — field missing or illegible on BL',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Global Freight Solutions Ltd.', bl: 'Global Freight Solutions Ltd.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Oceanic Distribution Pte.', bl: 'Oceanic Distribution Pte.', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Oceanic Distribution Pte.', bl: 'Unable to identify', result: 'review', reason: 'The notify party field on the BL is missing or illegible. Human verification is required.' },
      { field: 'Port of Loading', si: 'Busan, South Korea (KRPUS)', bl: 'Busan, South Korea (KRPUS)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Rotterdam, Netherlands (NLRTM)', bl: 'Rotterdam, Netherlands (NLRTM)', result: 'match', reason: '' },
      { field: 'Container Count', si: '2 × 40HC', bl: '2 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '24,500 kg', bl: '24,500 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_006',
    subject: 'Shipping Instruction — CMA CGM #4819',
    senderName: 'CMA CGM',
    sender: 'docs@cma-cgm.com',
    received: '17 Nov, 08:56 AM',
    docType: 'SI + BL',
    docResult: 'match',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Asia Pacific Exports Co.', bl: 'Asia Pacific Exports Co.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Euro Trade Importers GmbH', bl: 'Euro Trade Importers GmbH', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Euro Trade Importers GmbH', bl: 'Euro Trade Importers GmbH', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Guangzhou, China (CNGZH)', bl: 'Guangzhou, China (CNGZH)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Hamburg, Germany (DEHAM)', bl: 'Hamburg, Germany (DEHAM)', result: 'match', reason: '' },
      { field: 'Container Count', si: '4 × 20GP', bl: '4 × 20GP', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '31,200 kg', bl: '31,200 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_007',
    subject: 'Bill of Lading — COSCO #3310',
    senderName: 'COSCO Freight',
    sender: 'docs@cosco-freight.com',
    received: '17 Nov, 08:12 AM',
    docType: 'SI + BL',
    docResult: 'mismatch',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Sunrise Industrial Corp.', bl: 'Sunrise Industrial Corp.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Nordic Cargo AB', bl: 'Nordic Cargo AB', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Nordic Cargo AB', bl: 'Nordic Cargo AB', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Tianjin, China (CNTXG)', bl: 'Tianjin, China (CNTXG)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Gothenburg, Sweden (SEGOT)', bl: 'Gothenburg, Sweden (SEGOT)', result: 'match', reason: '' },
      { field: 'Container Count', si: '2 × 20GP', bl: '2 × 20GP', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '12,500 kg', bl: '13,200 kg', result: 'mismatch', reason: 'Gross weight differs by 700 kg (+5.6%). The BL declares 13,200 kg against the SI\'s 12,500 kg.' },
    ],
  },
  {
    id: 'email_008',
    subject: 'SI + BL — Evergreen #7741',
    senderName: 'Evergreen Marine',
    sender: 'docs@evergreen-marine.tw',
    received: '16 Nov',
    docType: 'SI + BL',
    docResult: 'match',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Jade Commodities Ltd.', bl: 'Jade Commodities Ltd.', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Delta Trade LLC', bl: 'Delta Trade LLC', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Delta Trade LLC', bl: 'Delta Trade LLC', result: 'match', reason: '' },
      { field: 'Port of Loading', si: 'Kaohsiung, Taiwan (TWKHH)', bl: 'Kaohsiung, Taiwan (TWKHH)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Los Angeles, USA (USLAX)', bl: 'Los Angeles, USA (USLAX)', result: 'match', reason: '' },
      { field: 'Container Count', si: '2 × 40HC', bl: '2 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '14,800 kg', bl: '14,800 kg', result: 'match', reason: '' },
    ],
  },
  {
    id: 'email_009',
    subject: 'SI Documents — Hapag #0228',
    senderName: 'Hapag-Lloyd AG',
    sender: 'ops@hapag-lloyd.com',
    received: '16 Nov',
    docType: 'SI + BL',
    docResult: 'review',
    reviewDetail: 'Unable to identify Notify Party & Port of Discharge — scanning artefacts on BL',
    classification: 'check',
    classifyType: 'BL Comparison',
    fields: [
      { field: 'Shipper', si: 'Hapag Logistics GmbH', bl: 'Hapag Logistics GmbH', result: 'match', reason: '' },
      { field: 'Consignee', si: 'Orient Pacific Co. Ltd.', bl: 'Orient Pacific Co. Ltd.', result: 'match', reason: '' },
      { field: 'Notify Party', si: 'Orient Pacific Co. Ltd.', bl: 'Unable to identify', result: 'review', reason: 'Notify party field is present in SI but cannot be reliably read from the BL scan.' },
      { field: 'Port of Loading', si: 'Hamburg, Germany (DEHAM)', bl: 'Hamburg, Germany (DEHAM)', result: 'match', reason: '' },
      { field: 'Port of Discharge', si: 'Dubai, UAE (AEDXB)', bl: 'Unable to identify', result: 'review', reason: 'Port of discharge is illegible on the BL due to a scanning artefact.' },
      { field: 'Container Count', si: '1 × 40HC', bl: '1 × 40HC', result: 'match', reason: '' },
      { field: 'Gross Weight (kg)', si: '9,600 kg', bl: '9,600 kg', result: 'match', reason: '' },
    ],
  },
]

const INITIALLY_CLASSIFIED = new Set(['email_004', 'email_005', 'email_006', 'email_007', 'email_008', 'email_009'])
const INITIALLY_VERIFIED   = new Set(['email_004', 'email_005', 'email_006', 'email_007', 'email_008', 'email_009'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function effectiveResult(email: Email, decisions: Map<string, ManualDecision>): DocResult | 'resend' {
  const d = decisions.get(email.id)
  if (!d) return email.docResult
  if (d === 'match') return 'match'
  if (d === 'resend') return 'resend'
  return 'review'
}

// Returns a numeric sort key — higher = more recent (for descending sort)
function receivedSortKey(received: string): number {
  if (received.startsWith('Today')) {
    // "Today, HH:MM AM/PM" → treat as day 9999 + parsed minutes
    const timePart = received.replace('Today, ', '')
    return 9999 * 1440 + parseTimeMinutes(timePart)
  }
  // "DD Mon" or "DD Mon, HH:MM AM/PM"
  const months: Record<string, number> = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }
  const dateMatch = received.match(/(\d+)\s+(\w+)(?:,\s*(.+))?/)
  if (!dateMatch) return 0
  const day = parseInt(dateMatch[1], 10)
  const month = months[dateMatch[2]] ?? 0
  const mins = dateMatch[3] ? parseTimeMinutes(dateMatch[3]) : 0
  return month * 31 * 1440 + day * 1440 + mins
}

function parseTimeMinutes(time: string): number {
  const m = time.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function getReviewReason(email: Email): string {
  if (email.classification === 'need-review') return 'Fail to Identify Type'
  if (email.docResult === 'review') return 'Fail to Compare SI and BL'
  return ''
}

function getVerifSummary(email: Email): string {
  if (email.docResult === 'match') return 'All 7 fields verified'
  if (email.docResult === 'mismatch') {
    const m = email.fields.filter(f => f.result === 'mismatch').length
    return `${m} field${m > 1 ? 's' : ''} mismatched`
  }
  if (email.classification === 'need-review') return 'Fail to Identify Type'
  return 'Fail to Compare SI and BL'
}

// ─── Design atoms ─────────────────────────────────────────────────────────────

const resultStyles: Record<DocResult, { badge: string; dot: string; label: string }> = {
  match:    { badge: 'bg-[#F0FDF4] text-[#16A34A]', dot: 'bg-[#16A34A]', label: 'Match' },
  mismatch: { badge: 'bg-[#FEF2F2] text-[#DC2626]', dot: 'bg-[#DC2626]', label: 'Mismatch' },
  review:   { badge: 'bg-[#FFFBEB] text-[#D97706]', dot: 'bg-[#D97706]', label: 'Review' },
}

function Badge({ result }: { result: DocResult }) {
  const s = resultStyles[result]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  )
}

function FieldResultChip({ result }: { result: FieldResult }) {
  if (result === 'match') return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#16A34A]">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6.5" fill="#DCFCE7" /><path d="M3.5 6.5l2 2 4-4" stroke="#16A34A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Match
    </span>
  )
  if (result === 'mismatch') return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#DC2626]">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6.5" fill="#FEE2E2" /><path d="M4.5 4.5l4 4M8.5 4.5l-4 4" stroke="#DC2626" strokeWidth="1.4" strokeLinecap="round" /></svg>
      Mismatch
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#D97706]">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6.5" fill="#FEF3C7" /><path d="M6.5 4v3M6.5 9v.5" stroke="#D97706" strokeWidth="1.4" strokeLinecap="round" /></svg>
      Review
    </span>
  )
}

function Chevron({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <path d="M4.5 2.5l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackBtn({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-[12px] text-[#6B7280] hover:text-[#111827] transition-colors mb-6">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 7H4M7 10L4 7l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  )
}

// ─── 7-field table ────────────────────────────────────────────────────────────

function FieldDetailTable({ fields }: { fields: VerifField[] }) {
  const rowBg: Record<FieldResult, string> = { match: '', mismatch: 'bg-[#FEF9F9]', review: 'bg-[#FFFCF5]' }
  const blCls: Record<FieldResult, string> = { match: 'text-[#374151]', mismatch: 'text-[#DC2626] font-medium', review: 'text-[#D97706] font-medium italic' }
  return (
    <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1.2fr_1.6fr_1.6fr_100px] text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide px-6 py-3 border-b border-[#F0EEE9] bg-[#FAFAF9]">
        <span>Field</span><span>Shipping Instruction</span><span>Bill of Lading</span><span className="text-right">Result</span>
      </div>
      {fields.map((row, i) => (
        <div key={row.field}>
          <div className={`grid grid-cols-[1.2fr_1.6fr_1.6fr_100px] items-start px-6 py-3.5 ${row.result === 'match' && i < fields.length - 1 ? 'border-b border-[#F0EEE9]' : ''} ${rowBg[row.result]}`}>
            <span className="text-[13px] font-medium text-[#374151] pt-0.5">{row.field}</span>
            <span className="text-[13px] text-[#374151] pr-4">{row.si}</span>
            <span className={`text-[13px] pr-4 ${blCls[row.result]}`}>{row.bl}</span>
            <div className="flex justify-end pt-0.5"><FieldResultChip result={row.result} /></div>
          </div>
          {row.result !== 'match' && row.reason && (
            <div className={`px-6 pb-3.5 ${rowBg[row.result]} ${i < fields.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
              <p className={`text-[11.5px] leading-[1.6] ${row.result === 'mismatch' ? 'text-[#DC2626]' : 'text-[#D97706]'} opacity-80`}>{row.reason}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ activeNav, activeVerifTab, setActiveNav, setScreen, setVerifTab, inboxBadge }: {
  activeNav: NavItem; activeVerifTab: VerifTab
  setActiveNav: (n: NavItem) => void; setScreen: (s: Screen) => void
  setVerifTab: (t: VerifTab) => void; inboxBadge: number
}) {
  function go(nav: NavItem, screen: Screen) { setActiveNav(nav); setScreen(screen) }
  function goVerif(tab: VerifTab) { setActiveNav('verification'); setVerifTab(tab); setScreen('verification') }

  return (
    <aside className="w-[212px] flex-shrink-0 flex flex-col border-r border-[#E8E6E1] bg-white">
      <div className="px-5 h-14 flex items-center border-b border-[#F0EEE9]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#1D4ED8] flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M2 7h7M2 10h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /><circle cx="11.5" cy="9.5" r="1.5" stroke="white" strokeWidth="1.2" /></svg>
          </div>
          <span className="text-[13.5px] font-semibold text-[#111827] tracking-[-0.01em]">SDOC Verify</span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <NavBtn active={activeNav === 'overview'} onClick={() => go('overview', 'overview')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>}
          label="Overview" />
        <NavBtn active={activeNav === 'inbox'} onClick={() => go('inbox', 'inbox')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1.5 5L7.5 9l6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>}
          label="Inbox" badge={inboxBadge > 0 ? inboxBadge : undefined} />
        <NavBtn active={activeNav === 'verification'} onClick={() => go('verification', 'verification')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 7.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          label="Verification" />
        <div className="ml-6 space-y-0.5">
          {([
            { tab: 'match' as VerifTab, label: 'Match', dot: 'bg-[#16A34A]' },
            { tab: 'mismatch' as VerifTab, label: 'Mismatch', dot: 'bg-[#DC2626]' },
            { tab: 'review' as VerifTab, label: 'Review', dot: 'bg-[#D97706]' },
          ]).map(s => (
            <button key={s.tab} onClick={() => goVerif(s.tab)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left ${
                activeNav === 'verification' && activeVerifTab === s.tab ? 'text-[#2563EB] bg-[#EFF6FF]' : 'text-[#6B7280] hover:bg-[#F9F8F6] hover:text-[#374151]'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />{s.label}
            </button>
          ))}
        </div>
        <div className="pt-0.5">
          <NavBtn active={activeNav === 'resend'} onClick={() => go('resend', 'resend')}
            icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 7.5h9M8 4.5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 3H2.5A1.5 1.5 0 001 4.5v6A1.5 1.5 0 002.5 12H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
            label="Resend" />
        </div>
      </nav>
      <div className="px-4 py-4 border-t border-[#F0EEE9]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#E8E6E1] flex items-center justify-center text-[10px] font-semibold text-[#6B7280]">JL</div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-[#111827] truncate">Jane Liu</div>
            <div className="text-[11px] text-[#9CA3AF] truncate">Trade Operations</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavBtn({ active, onClick, icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 text-left ${
        active ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#6B7280] hover:bg-[#F9F8F6] hover:text-[#374151]'
      }`}>
      <span className={active ? 'text-[#2563EB]' : 'text-[#9CA3AF]'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="w-4 h-4 rounded-full bg-[#2563EB] text-white text-[10px] font-semibold flex items-center justify-center leading-none">{badge}</span>
      )}
    </button>
  )
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="h-14 border-b border-[#E8E6E1] bg-white px-8 flex items-center justify-between flex-shrink-0">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[14px] font-semibold text-[#111827] tracking-[-0.01em]">{title}</h1>
        {subtitle && <span className="text-[12px] text-[#9CA3AF]">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#6B7280] bg-[#F9F8F6] border border-[#E8E6E1] rounded-lg px-3 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
        Global Trade Workspace
      </div>
    </header>
  )
}

function SectionHdr({ label, count, action }: { label: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#374151]">{label}</span>
        {count !== undefined && (
          <span className="text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] px-1.5 py-0.5 rounded">{count}</span>
        )}
      </div>
      {action}
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewScreen({ setScreen, setActiveNav, setVerifTab, verifiedEmails, manualDecisions, onSelectEmail }: {
  setScreen: (s: Screen) => void; setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
  verifiedEmails: Set<string>; manualDecisions: Map<string, ManualDecision>; onSelectEmail: (id: string) => void
}) {
  const verified = allEmails.filter(e => verifiedEmails.has(e.id))
  const matchCount    = verified.filter(e => effectiveResult(e, manualDecisions) === 'match').length
  const mismatchCount = verified.filter(e => effectiveResult(e, manualDecisions) === 'mismatch').length
  const reviewCount   = verified.filter(e => effectiveResult(e, manualDecisions) === 'review').length
  const resendCount   = verified.filter(e => manualDecisions.get(e.id) === 'resend').length
  const total = verified.length
  const vPct = total ? (matchCount / total) * 100 : 0
  const rPct = total ? (reviewCount / total) * 100 : 0
  const mPct = total ? (mismatchCount / total) * 100 : 0
  const recent = allEmails.filter(e => verifiedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received)).slice(0, 6)

  function goVerif(tab: VerifTab) { setActiveNav('verification'); setVerifTab(tab); setScreen('verification') }
  function goResend() { setActiveNav('resend'); setScreen('resend') }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F9F8F6]">
      <TopBar title="Overview" subtitle="18 November 2024" />
      <div className="px-10 py-10 max-w-[1100px]">
        <section className="mb-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF] mb-4">AI Document Verification</p>
          <h2 className="text-[38px] font-bold text-[#111827] tracking-[-0.035em] leading-[1.1] mb-5 max-w-[520px]">Shipping document<br />verification</h2>
          <p className="text-[14px] text-[#6B7280] leading-[1.7] max-w-[420px] mb-6">Compare Shipping Instructions against Bills of Lading. SDOC Verify surfaces discrepancies instantly.</p>
          <button onClick={() => { setActiveNav('inbox'); setScreen('inbox') }}
            className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
            Go to Inbox
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5h8M7 3l3.5 3.5L7 10" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </section>

        <section className="mb-14">
          <div className="grid grid-cols-5 divide-x divide-[#E8E6E1]">
            {[
              { label: 'Documents received', value: String(allEmails.length), sub: 'total' },
              { label: 'Verified', value: String(matchCount), sub: total ? `${vPct.toFixed(0)}%` : '—' },
              { label: 'Needs review', value: String(reviewCount), sub: total ? `${rPct.toFixed(0)}%` : '—' },
              { label: 'Mismatches', value: String(mismatchCount), sub: total ? `${mPct.toFixed(0)}%` : '—' },
              { label: 'Resend queue', value: String(resendCount), sub: 'pending correction' },
            ].map(s => (
              <div key={s.label} className="px-6 first:pl-0 last:pr-0">
                <div className="text-[32px] font-bold text-[#111827] tracking-[-0.04em] leading-none mb-2">{s.value}</div>
                <div className="text-[12px] text-[#374151] font-medium mb-0.5">{s.label}</div>
                <div className="text-[11px] text-[#9CA3AF]">{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="w-full h-px bg-[#E8E6E1] mb-14" />

        <div className="grid grid-cols-[1fr_340px] gap-10">
          <section>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[13px] font-semibold text-[#111827]">Recent Activity</h3>
              <button onClick={() => goVerif('match')} className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1 transition-colors">View all <Chevron /></button>
            </div>
            {recent.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-10 text-center text-[13px] text-[#9CA3AF]">No verified documents yet.</div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {recent.map((email, i) => {
                    const eff = effectiveResult(email, manualDecisions)
                    const disp: DocResult = eff === 'resend' ? email.docResult : eff as DocResult
                    return (
                      <button key={email.id}
                        onClick={() => { onSelectEmail(email.id); setActiveNav('verification'); setScreen('verification-detail') }}
                        className={`w-full flex items-center gap-4 px-5 py-3.5 text-left group hover:bg-[#F5F7FF] transition-colors ${i < recent.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${resultStyles[disp].dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                          <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.docType} · {email.received}</div>
                        </div>
                        {eff === 'resend'
                          ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280]"><span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />Resent</span>
                          : <Badge result={disp} />}
                        <span className="text-[#D1D5DB] group-hover:text-[#2563EB] transition-colors"><Chevron /></span>
                      </button>
                    )
                  })}
                </div>
            }
          </section>
          <section>
            <div className="mb-5">
              <h3 className="text-[13px] font-semibold text-[#111827]">Verification Summary</h3>
              <p className="text-[12px] text-[#9CA3AF] mt-1">{total} processed this month</p>
            </div>
            <div className="bg-white border border-[#E8E6E1] rounded-xl p-6">
              <div className="flex rounded-full overflow-hidden h-2 mb-6 gap-px">
                <div className="bg-[#16A34A]" style={{ width: `${vPct}%` }} />
                <div className="bg-[#D97706]" style={{ width: `${rPct}%` }} />
                <div className="bg-[#DC2626]" style={{ width: `${mPct}%` }} />
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Verified', count: matchCount, pct: vPct, dot: 'bg-[#16A34A]', tc: 'text-[#16A34A]', tab: 'match' as VerifTab },
                  { label: 'Needs Review', count: reviewCount, pct: rPct, dot: 'bg-[#D97706]', tc: 'text-[#D97706]', tab: 'review' as VerifTab },
                  { label: 'Mismatch', count: mismatchCount, pct: mPct, dot: 'bg-[#DC2626]', tc: 'text-[#DC2626]', tab: 'mismatch' as VerifTab },
                ].map(row => (
                  <button key={row.label} onClick={() => goVerif(row.tab)} className="w-full flex items-center gap-3 hover:opacity-70 transition-opacity">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${row.dot}`} />
                    <span className="text-[12.5px] text-[#374151] flex-1 text-left">{row.label}</span>
                    <span className={`text-[13px] font-semibold tabular-nums ${row.tc}`}>{row.count}</span>
                    <span className="text-[11px] text-[#9CA3AF] w-9 text-right tabular-nums">{row.pct.toFixed(0)}%</span>
                  </button>
                ))}
              </div>
              {resendCount > 0 && (
                <div className="mt-5 pt-5 border-t border-[#F0EEE9]">
                  <button onClick={goResend} className="w-full flex items-center gap-3 p-3.5 rounded-lg bg-[#F9F8F6] border border-[#E8E6E1] hover:bg-[#F3F4F6] transition-colors">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h9M8 4l3 3-3 3" stroke="#6B7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <div className="flex-1 text-left">
                      <div className="text-[12px] font-medium text-[#374151]">{resendCount} email{resendCount > 1 ? 's' : ''} in Resend queue</div>
                      <div className="text-[11px] text-[#9CA3AF]">Requires correction and resending</div>
                    </div>
                    <Chevron />
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

type InboxTab = 'new' | 'bl' | 'others' | 'review'

function InboxScreen({ classifiedEmails, verifiedEmails, readEmails, reclassifications, onClassify, onVerify, onVerifyAll, setScreen, onSelectEmail, onSelectOthers, onSelectReview }: {
  classifiedEmails: Set<string>; verifiedEmails: Set<string>; readEmails: Set<string>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  onClassify: () => void; onVerify: (id: string) => void; onVerifyAll: () => void
  setScreen: (s: Screen) => void
  onSelectEmail: (id: string) => void
  onSelectOthers: (id: string) => void
  onSelectReview: (id: string) => void
}) {
  const [activeInboxTab, setActiveInboxTab] = useState<InboxTab>('new')

  const effClass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification, classifyType: e.classifyType }

  const newIncoming   = allEmails.filter(e => !classifiedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const othersActive  = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'ignore' && !readEmails.has(e.id))
  const blComparison  = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'check' && !verifiedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const classifyRev   = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'need-review')

  const otherGroups: Record<string, Email[]> = {}
  othersActive.forEach(e => {
    const key = effClass(e).classifyType ?? 'Other'
    if (!otherGroups[key]) otherGroups[key] = []
    otherGroups[key].push(e)
  })

  const inboxTabs: { id: InboxTab; label: string; count: number; active: string }[] = [
    { id: 'new',    label: 'New Incoming',  count: newIncoming.length,  active: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]' },
    { id: 'bl',     label: 'BL Comparison', count: blComparison.length, active: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]' },
    { id: 'others', label: 'Others',        count: othersActive.length, active: 'bg-[#F9F8F6] text-[#374151] border-[#E8E6E1]' },
    { id: 'review', label: 'Review',        count: classifyRev.length,  active: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]' },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Inbox" subtitle="Document workflow" />

      {/* Tab navigation */}
      <div className="px-8 pt-5 pb-0 border-b border-[#E8E6E1] bg-white">
        <div className="flex items-center gap-2 max-w-[900px]">
          {inboxTabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveInboxTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg border border-b-0 text-[13px] font-medium transition-all -mb-px ${
                activeInboxTab === tab.id
                  ? tab.active
                  : 'bg-white border-transparent text-[#6B7280] hover:text-[#374151] hover:bg-[#F9F8F6]'
              }`}>
              {tab.label}
              <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${activeInboxTab === tab.id ? 'bg-white/60' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-7 max-w-[900px]">

        {/* NEW INCOMING */}
        {activeInboxTab === 'new' && (
          <section>
            <SectionHdr label="New Incoming" count={newIncoming.length}
              action={newIncoming.length > 0
                ? <button onClick={onClassify} className="flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3.5h10M2.5 6h7M4 8.5h4" stroke="#2563EB" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    Classify
                  </button>
                : null}
            />
            {newIncoming.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4 flex items-center gap-3">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3.5 3.5 4.5-5" stroke="#16A34A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="text-[12.5px] text-[#9CA3AF]">No new incoming emails — all classified</span>
                </div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {newIncoming.map((email, i) => (
                    <button key={email.id} onClick={() => { onSelectEmail(email.id); setScreen('inbox-detail') }}
                      className={`w-full flex items-center gap-4 px-5 py-4 text-left group hover:bg-[#FAFAF9] transition-colors ${i < newIncoming.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                      <span className="w-2 h-2 rounded-full bg-[#2563EB] flex-shrink-0" />
                      <div className="w-8 h-8 rounded-full bg-[#F3F4F6] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#6B7280]">{email.senderName.slice(0,2).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                        <div className="text-[12px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded flex-shrink-0">New</span>
                      <span className="text-[#D1D5DB] group-hover:text-[#9CA3AF] transition-colors"><Chevron /></span>
                    </button>
                  ))}
                </div>
            }
          </section>
        )}

        {/* BL COMPARISON */}
        {activeInboxTab === 'bl' && (
          <section>
            <SectionHdr label="BL Comparison" count={blComparison.length}
              action={blComparison.length > 0
                ? <button onClick={onVerifyAll} className="text-[12px] font-medium text-[#6B7280] bg-white border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3 py-1.5 rounded-lg transition-colors">Verify All</button>
                : null}
            />
            {blComparison.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No BL Comparison emails awaiting verification</span></div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {blComparison.map((email, i) => (
                    <div key={email.id} className={`flex items-center gap-4 px-5 py-4 ${i < blComparison.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                      <button onClick={() => { onSelectEmail(email.id); setScreen('inbox-detail') }}
                        className="flex-1 min-w-0 flex items-center gap-4 text-left group">
                        <div className="w-8 h-8 rounded-full bg-[#F3F4F6] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#6B7280]">{email.senderName.slice(0,2).toUpperCase()}</div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                          <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                        </div>
                      </button>
                      <span className="text-[11px] font-medium text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded flex-shrink-0">{email.classifyType}</span>
                      <button onClick={() => onVerify(email.id)}
                        className="flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Verify
                      </button>
                    </div>
                  ))}
                </div>
            }
          </section>
        )}

        {/* OTHERS */}
        {activeInboxTab === 'others' && (
          <section>
            <SectionHdr label="Others" count={othersActive.length} />
            {othersActive.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No emails in Others queue</span></div>
              : <div className="space-y-3">
                  {Object.entries(otherGroups).map(([type, emails]) => (
                    <div key={type} className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                      <div className="px-5 py-2.5 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                        <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{type}</span>
                      </div>
                      {emails.map((email, i) => (
                        <button key={email.id} onClick={() => { onSelectOthers(email.id); setScreen('others-detail') }}
                          className={`w-full flex items-center gap-4 px-5 py-3.5 text-left group hover:bg-[#FAFAF9] transition-colors ${i < emails.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                          <div className="w-7 h-7 rounded-full bg-[#F3F4F6] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#9CA3AF]">{email.senderName.slice(0,2).toUpperCase()}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-[#374151] truncate group-hover:text-[#111827] transition-colors">{email.subject}</div>
                            <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                          </div>
                          <span className="text-[#D1D5DB] group-hover:text-[#9CA3AF] transition-colors"><Chevron /></span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
            }
          </section>
        )}

        {/* REVIEW (Classification — Fail to Identify Type only) */}
        {activeInboxTab === 'review' && (
          <section>
            <SectionHdr label="Review" count={classifyRev.length} />
            {classifyRev.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No emails requiring classification review</span></div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {classifyRev.map((email, i) => (
                    <button key={email.id} onClick={() => { onSelectReview(email.id); setScreen('manual-review') }}
                      className={`w-full flex items-center gap-4 px-5 py-4 text-left group hover:bg-[#FFFCF5] transition-colors ${i < classifyRev.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-[#FEF3C7] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#D97706]">{email.senderName.slice(0,2).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[#374151] truncate">{email.subject}</div>
                        <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D97706] bg-[#FFFBEB] px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />Review
                        </span>
                        <span className="text-[10.5px] text-[#D97706] opacity-70">Fail to Identify Type</span>
                      </div>
                      <span className="text-[#D1D5DB] group-hover:text-[#D97706] transition-colors"><Chevron /></span>
                    </button>
                  ))}
                </div>
            }
          </section>
        )}

      </div>
    </div>
  )
}

// ─── Inbox Detail ─────────────────────────────────────────────────────────────

function InboxDetailScreen({ emailId, classifiedEmails, onVerify, setScreen, setActiveNav, setVerifTab }: {
  emailId: string | null; classifiedEmails: Set<string>
  onVerify: (id: string) => void; setScreen: (s: Screen) => void
  setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
}) {
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  const isClassified = classifiedEmails.has(email.id)
  const isBL = email.classification === 'check'

  function handleVerify() {
    onVerify(email!.id)
    setVerifTab(email!.docResult === 'review' ? 'review' : email!.docResult === 'mismatch' ? 'mismatch' : 'match')
    setActiveNav('verification')
    setScreen('verification-detail')
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Email Detail" />
      <div className="px-8 py-7 max-w-[860px]">
        <BackBtn onClick={() => setScreen('inbox')} label="Back to Inbox" />
        <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
          <div className="px-7 py-6 border-b border-[#F0EEE9]">
            <h2 className="text-[17px] font-semibold text-[#111827] tracking-[-0.015em] mb-4">{email.subject}</h2>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#EFF6FF] flex items-center justify-center text-[12px] font-semibold text-[#2563EB]">{email.senderName.slice(0,2).toUpperCase()}</div>
                <div><div className="text-[13px] font-medium text-[#111827]">{email.senderName}</div><div className="text-[12px] text-[#9CA3AF]">{email.sender}</div></div>
              </div>
              <div className="text-right"><div className="text-[12px] text-[#9CA3AF]">Received</div><div className="text-[12px] font-medium text-[#374151]">{email.received}</div></div>
            </div>
          </div>
          <div className="px-7 py-6 border-b border-[#F0EEE9]">
            <div className="text-[13px] text-[#374151] leading-[1.75] space-y-3">
              <p>Dear Trade Operations Team,</p>
              <p>Please find attached the {email.docType} documents for the above-referenced shipment. Kindly review and confirm all shipping details are accurate prior to cargo release.</p>
              <p>Best regards,<br />{email.senderName}</p>
            </div>
          </div>
          {isBL && (
            <div className="px-7 py-5 border-b border-[#F0EEE9]">
              <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-3">Attached Documents</div>
              <div className="flex gap-3">
                {[{ type: 'SI', size: '184 KB' }, { type: 'BL', size: '211 KB' }].map(doc => (
                  <div key={doc.type} className="flex items-center gap-3 border border-[#E8E6E1] rounded-lg px-4 py-3 hover:bg-[#FAFAF9] cursor-pointer">
                    <div className="w-8 h-8 rounded-md bg-[#EFF6FF] flex items-center justify-center text-[10px] font-bold text-[#2563EB]">{doc.type}</div>
                    <div><div className="text-[12px] font-medium text-[#111827]">{doc.type === 'SI' ? 'Shipping_Instruction' : 'Bill_of_Lading'}_{email.id}.pdf</div><div className="text-[11px] text-[#9CA3AF]">{doc.size} · PDF</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="px-7 py-5 flex items-center justify-between">
            {isClassified && isBL
              ? <div className="flex items-center gap-2 text-[12px] text-[#9CA3AF]"><span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />Classified as BL Comparison — ready to verify</div>
              : <div className="flex items-center gap-2 text-[12px] text-[#9CA3AF]"><span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />New incoming — not yet classified</div>
            }
            {isClassified && isBL && (
              <button onClick={handleVerify} className="flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
                Verify
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Others Detail ────────────────────────────────────────────────────────────

function OthersDetailScreen({ emailId, onMarkRead, setScreen }: {
  emailId: string | null; onMarkRead: (id: string) => void; setScreen: (s: Screen) => void
}) {
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Email" subtitle={email.classifyType} />
      <div className="px-8 py-7 max-w-[780px]">
        <BackBtn onClick={() => setScreen('inbox')} label="Back to Inbox" />
        <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
          <div className="px-7 py-6 border-b border-[#F0EEE9]">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] bg-[#F3F4F6] px-2 py-0.5 rounded">{email.classifyType}</span>
            </div>
            <h2 className="text-[17px] font-semibold text-[#111827] mb-4">{email.subject}</h2>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[12px] font-semibold text-[#6B7280]">{email.senderName.slice(0,2).toUpperCase()}</div>
                <div><div className="text-[13px] font-medium text-[#111827]">{email.senderName}</div><div className="text-[12px] text-[#9CA3AF]">{email.sender}</div></div>
              </div>
              <div className="text-right"><div className="text-[12px] text-[#9CA3AF]">Received</div><div className="text-[12px] font-medium text-[#374151]">{email.received}</div></div>
            </div>
          </div>
          <div className="px-7 py-6 border-b border-[#F0EEE9]">
            <div className="text-[13px] text-[#374151] leading-[1.75] space-y-3">
              <p>Dear Trade Team,</p>
              <p>This is a {email.classifyType?.toLowerCase() ?? 'general'} communication from {email.senderName}. Please review at your convenience. No SI/BL verification action is required for this email.</p>
              <p>Best regards,<br />{email.senderName}</p>
            </div>
          </div>
          <div className="px-7 py-5 flex justify-between items-center">
            <div className="text-[12px] text-[#9CA3AF]">This email does not require SI/BL verification.</div>
            <button onClick={() => { onMarkRead(email.id); setScreen('inbox') }}
              className="flex items-center gap-2 bg-[#F9F8F6] border border-[#E8E6E1] hover:bg-[#F3F4F6] text-[#374151] text-[13px] font-medium px-4 py-2 rounded-lg transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-6.5" stroke="#374151" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Mark as Read
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Verification ─────────────────────────────────────────────────────────────

function VerificationScreen({ verifiedEmails, classifiedEmails, reclassifications, manualDecisions, activeTab, setActiveTab, setScreen, onSelectEmail, onSelectReview }: {
  verifiedEmails: Set<string>; classifiedEmails: Set<string>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  manualDecisions: Map<string, ManualDecision>
  activeTab: VerifTab; setActiveTab: (t: VerifTab) => void
  setScreen: (s: Screen) => void; onSelectEmail: (id: string) => void
  onSelectReview: (id: string) => void
}) {
  const verified = allEmails.filter(e => verifiedEmails.has(e.id))
  const effClass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification }

  const reviewEmails = [
    ...verified.filter(e => effectiveResult(e, manualDecisions) === 'review'),
    ...allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'need-review' && !verifiedEmails.has(e.id)),
  ].sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))

  const filtered = activeTab === 'review'
    ? reviewEmails
    : verified.filter(e => effectiveResult(e, manualDecisions) === activeTab)

  const counts = {
    match: verified.filter(e => effectiveResult(e, manualDecisions) === 'match').length,
    mismatch: verified.filter(e => effectiveResult(e, manualDecisions) === 'mismatch').length,
    review: reviewEmails.length,
  }
  const tabs: { id: VerifTab; label: string; active: string }[] = [
    { id: 'match',    label: 'Match',    active: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]' },
    { id: 'mismatch', label: 'Mismatch', active: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]' },
    { id: 'review',   label: 'Review',   active: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]' },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Verification" subtitle="Processed results" />
      <div className="px-8 py-7">
        <div className="flex items-center gap-2 mb-6">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-medium transition-all ${
                activeTab === tab.id ? tab.active : 'bg-white border-[#E8E6E1] text-[#6B7280] hover:bg-[#F9F8F6]'
              }`}>
              {tab.label}
              <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${activeTab === tab.id ? 'bg-white/60' : 'bg-[#F3F4F6]'}`}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0
          ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-12 text-center text-[13px] text-[#9CA3AF]">
              {activeTab === 'match' ? 'No verified matches yet.' : activeTab === 'mismatch' ? 'No mismatches found.' : 'No documents requiring review.'}
            </div>
          : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_100px_140px_160px_32px] text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide px-6 py-3 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                <span>Document</span><span>Type</span><span>Received</span><span>Result</span><span />
              </div>
              {filtered.map((email, i) => {
                const eff = effectiveResult(email, manualDecisions)
                const disp: DocResult = eff === 'resend' ? email.docResult : eff as DocResult
                const reason = getReviewReason(email)
                const isClassifyReviewOnly = email.classification === 'need-review' && !verifiedEmails.has(email.id)
                return (
                  <button key={email.id} onClick={() => {
                    if (isClassifyReviewOnly) { onSelectReview(email.id); setScreen('manual-review') }
                    else { onSelectEmail(email.id); setScreen('verification-detail') }
                  }}
                    className={`w-full grid grid-cols-[1fr_100px_140px_160px_32px] items-center px-6 py-4 text-left group hover:bg-[#F5F7FF] transition-colors ${i < filtered.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                    <div className="min-w-0 pr-4">
                      <div className="text-[13px] font-medium text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                      {reason
                        ? <div className="text-[11.5px] text-[#D97706] mt-0.5">{reason}</div>
                        : <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{getVerifSummary(email)}</div>
                      }
                      {disp === 'review' && email.reviewDetail && (
                        <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{email.reviewDetail}</div>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded self-start mt-0.5">{email.docType}</span>
                    <span className="text-[12px] text-[#9CA3AF]">{email.received}</span>
                    <Badge result={disp} />
                    <span className="text-[#D1D5DB] group-hover:text-[#2563EB] transition-colors justify-self-end"><Chevron /></span>
                  </button>
                )
              })}
            </div>
        }
      </div>
    </div>
  )
}

// ─── Verification Detail ──────────────────────────────────────────────────────

function VerificationDetailScreen({ emailId, manualDecisions, setScreen, onFlagReview }: {
  emailId: string | null; manualDecisions: Map<string, ManualDecision>
  setScreen: (s: Screen) => void; onFlagReview: (id: string) => void
}) {
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  const eff = effectiveResult(email, manualDecisions)
  const decision = manualDecisions.get(email.id)
  const disp: DocResult = eff === 'resend' ? email.docResult : eff as DocResult
  const matchedCount    = email.fields.filter(f => f.result === 'match').length
  const mismatchedCount = email.fields.filter(f => f.result === 'mismatch').length
  const reviewCount     = email.fields.filter(f => f.result === 'review').length
  const showReviewButton = eff === 'review' || eff === 'mismatch'
  const reason = getReviewReason(email)

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Verification Result" subtitle={email.received} />
      <div className="px-8 py-7">
        <BackBtn onClick={() => setScreen('verification')} label="Back to Verification" />
        {decision && decision !== 'keep-review' && (
          <div className={`mb-5 flex items-center gap-3 px-5 py-3.5 rounded-xl border text-[13px] font-medium ${
            decision === 'match' ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]' : 'bg-[#F3F4F6] border-[#E8E6E1] text-[#6B7280]'
          }`}>
            Manual review complete ·{' '}
            {decision === 'match' ? 'Marked as Match' : 'Marked for Resend'}
          </div>
        )}
        {decision === 'keep-review' && (
          <div className="mb-5 flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-[#FFFBEB] border-[#FDE68A] text-[13px] font-medium text-[#D97706]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#D97706" strokeWidth="1.3" /><path d="M7 4.5v3M7 9.5v.5" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" /></svg>
            Previously kept in Review — still requires human attention
          </div>
        )}
        <div className="bg-white border border-[#E8E6E1] rounded-xl px-7 py-6 mb-5 flex items-center gap-5">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
            disp === 'match' ? 'bg-[#F0FDF4] border border-[#BBF7D0]' :
            disp === 'mismatch' ? 'bg-[#FEF2F2] border border-[#FECACA]' : 'bg-[#FFFBEB] border border-[#FDE68A]'
          }`}>
            {disp === 'match'    && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 10l4.5 4.5 8.5-8.5" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            {disp === 'mismatch' && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 6v6M10 14v1" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            {disp === 'review'   && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 6v6M10 14v1" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round" /></svg>}
          </div>
          <div className="flex-1">
            <div className="text-[17px] font-semibold text-[#111827] tracking-[-0.01em] mb-0.5">{email.subject}</div>
            <div className="text-[13px] text-[#6B7280]">{getVerifSummary(email)}</div>
            {reason && <div className="mt-0.5 text-[12px] text-[#D97706]">Reason: {reason}</div>}
            {disp === 'review' && email.reviewDetail && <div className="mt-0.5 text-[11.5px] text-[#9CA3AF]">{email.reviewDetail}</div>}
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-[11px] text-[#9CA3AF] uppercase tracking-wide mb-1">Processed</div>
            <div className="text-[12px] font-medium text-[#374151]">{email.received}</div>
          </div>
        </div>
        {email.fields.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Fields Matched', value: `${matchedCount} / 7`, color: 'text-[#16A34A]' },
                { label: 'Mismatched', value: String(mismatchedCount), color: mismatchedCount > 0 ? 'text-[#DC2626]' : 'text-[#111827]' },
                { label: 'Needs Review', value: String(reviewCount), color: reviewCount > 0 ? 'text-[#D97706]' : 'text-[#111827]' },
              ].map(s => (
                <div key={s.label} className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4 text-center">
                  <div className={`text-[22px] font-bold tracking-[-0.02em] mb-1 ${s.color}`}>{s.value}</div>
                  <div className="text-[12px] text-[#9CA3AF]">{s.label}</div>
                </div>
              ))}
            </div>
            <FieldDetailTable fields={email.fields} />
          </>
        )}
        {showReviewButton && (
          <div className="mt-5 flex justify-end">
            <button onClick={() => { onFlagReview(email.id); setScreen('manual-review') }}
              className="flex items-center gap-2 bg-[#D97706] hover:bg-[#B45309] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
              Flag for Review
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v7H2z" stroke="white" strokeWidth="1.3" strokeLinejoin="round" /><path d="M2 9v3" stroke="white" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manual Review Workspace ──────────────────────────────────────────────────

type ClassifyStep = 'main' | 'pick-type' | 'other-category' | 'bl-action'

function ManualReviewScreen({ emailId, setScreen, backTo, onClassifyOther, onClassifyBL }: {
  emailId: string | null; setScreen: (s: Screen) => void; backTo?: Screen
  onClassifyOther?: (id: string, category: string) => void
  onClassifyBL?: (id: string, verifyNow: boolean) => void
}) {
  const [classifyStep, setClassifyStep] = useState<ClassifyStep>('main')
  const [selectedOtherCat, setSelectedOtherCat] = useState<string | null>(null)

  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  const isClassifyReview = email.classification === 'need-review'
  const reason = getReviewReason(email)
  const problemFields = email.fields.filter(f => f.result !== 'match')
  const resolvedBackTo = backTo ?? (isClassifyReview ? 'inbox' : 'verification-detail')

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Manual Review Workspace" subtitle={reason} />
      <div className="px-8 py-7 max-w-[940px]">
        <BackBtn onClick={() => setScreen(resolvedBackTo)} label="Back" />
        <div className="mb-6 px-5 py-3.5 rounded-xl border bg-[#FFFBEB] border-[#FDE68A] flex items-center gap-3">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#D97706" strokeWidth="1.3" /><path d="M7 4.5v3M7 9.5v.5" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" /></svg>
          <span className="text-[13px] font-medium text-[#D97706]">{reason}</span>
          {!isClassifyReview && email.reviewDetail && <span className="text-[12px] text-[#D97706] opacity-70">· {email.reviewDetail}</span>}
        </div>

        {isClassifyReview ? (
          <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden mb-6">
            <div className="px-5 py-3.5 border-b border-[#F0EEE9] bg-[#FAFAF9]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Original Email — Classification Review</div>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-6 mb-5">
                <div><div className="text-[11px] text-[#9CA3AF] mb-1">From</div><div className="text-[13px] font-medium text-[#111827]">{email.senderName}</div><div className="text-[12px] text-[#9CA3AF]">{email.sender}</div></div>
                <div><div className="text-[11px] text-[#9CA3AF] mb-1">Received</div><div className="text-[13px] text-[#374151]">{email.received}</div></div>
              </div>
              <div className="mb-5"><div className="text-[11px] text-[#9CA3AF] mb-1">Subject</div><div className="text-[13px] font-medium text-[#111827]">{email.subject}</div></div>
              <div className="text-[12.5px] text-[#6B7280] leading-[1.7] border-t border-[#F0EEE9] pt-5">
                <p className="mb-2">This email was received from {email.senderName}. The AI classification system could not identify the email type with sufficient confidence.</p>
                <p className="mb-2">The attached documents and email content do not match any known classification pattern (BL Comparison, Invoice Query, SI Request, General, Spam).</p>
                <p>Please manually inspect this email and determine the appropriate workflow for this communication.</p>
              </div>
              <div className="mt-5 pt-5 border-t border-[#F0EEE9]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-3">Attachments</div>
                <div className="flex items-center gap-3 border border-[#E8E6E1] rounded-lg px-4 py-3 hover:bg-[#FAFAF9] cursor-pointer max-w-xs">
                  <div className="w-8 h-8 rounded-md bg-[#F3F4F6] flex items-center justify-center text-[10px] font-bold text-[#6B7280]">?</div>
                  <div><div className="text-[12px] font-medium text-[#111827]">Attachment_{email.id}.pdf</div><div className="text-[11px] text-[#9CA3AF]">Unknown type · PDF</div></div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Original Email</div>
                </div>
                <div className="px-5 py-4">
                  <div className="mb-3"><div className="text-[11px] text-[#9CA3AF] mb-0.5">From</div><div className="text-[13px] font-medium text-[#111827]">{email.senderName}</div><div className="text-[12px] text-[#9CA3AF]">{email.sender}</div></div>
                  <div className="mb-3"><div className="text-[11px] text-[#9CA3AF] mb-0.5">Subject</div><div className="text-[13px] text-[#374151]">{email.subject}</div></div>
                  <div className="mb-4"><div className="text-[11px] text-[#9CA3AF] mb-0.5">Received</div><div className="text-[12px] text-[#374151]">{email.received}</div></div>
                  <div className="text-[12.5px] text-[#6B7280] leading-[1.7] border-t border-[#F0EEE9] pt-4">
                    <p className="mb-2">Dear Trade Operations Team,</p>
                    <p>Please find attached the {email.docType} documents. Kindly verify the documents and confirm all shipping details.</p>
                    <p className="mt-2">Best regards, {email.senderName}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                {[{ type: 'SI', label: 'Shipping Instruction' }, { type: 'BL', label: 'Bill of Lading' }].map(doc => (
                  <div key={doc.type} className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#F0EEE9] bg-[#FAFAF9] flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{doc.label}</div>
                      <button className="text-[12px] text-[#2563EB] font-medium flex items-center gap-1">Open <Chevron size={11} /></button>
                    </div>
                    <div className="px-5 py-4">
                      <div className="h-24 bg-[#F9F8F6] border border-dashed border-[#E8E6E1] rounded-lg flex flex-col items-center justify-center gap-1.5 mb-2">
                        <div className="w-7 h-7 rounded-md bg-[#EFF6FF] flex items-center justify-center text-[10px] font-bold text-[#2563EB]">{doc.type}</div>
                        <span className="text-[11px] text-[#9CA3AF]">Document Preview</span>
                      </div>
                      <div className="text-[11.5px] text-[#9CA3AF]">{doc.type}-{email.id.toUpperCase()} · PDF</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Fields Requiring Attention · Fail to Compare SI and BL</div>
              </div>
              {problemFields.length === 0
                ? <div className="px-6 py-4 text-[13px] text-[#9CA3AF]">No field-level issues found.</div>
                : <div className="divide-y divide-[#F0EEE9]">
                    {problemFields.map(f => (
                      <div key={f.field} className={`px-6 py-5 ${f.result === 'mismatch' ? 'bg-[#FEF9F9]' : 'bg-[#FFFCF5]'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#374151]">{f.field}</span>
                          <FieldResultChip result={f.result} />
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-2">
                          <div><div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">Shipping Instruction</div><div className="text-[13px] text-[#374151]">{f.si}</div></div>
                          <div><div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">Bill of Lading</div><div className={`text-[13px] font-medium ${f.result === 'mismatch' ? 'text-[#DC2626]' : 'text-[#D97706] italic'}`}>{f.bl}</div></div>
                        </div>
                        {f.reason && <div className={`text-[11.5px] leading-[1.55] ${f.result === 'mismatch' ? 'text-[#DC2626]' : 'text-[#D97706]'} opacity-80`}>{f.reason}</div>}
                      </div>
                    ))}
                  </div>
              }
            </div>
          </>
        )}

        {isClassifyReview ? (
          <>
            {classifyStep === 'main' && (
              <div className="flex justify-end">
                <button onClick={() => setClassifyStep('pick-type')}
                  className="flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-6 py-2.5 rounded-lg transition-colors">
                  Classify Email
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3.5h12M2.5 7h9M4 10.5h6" stroke="white" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
              </div>
            )}

            {classifyStep === 'pick-type' && (
              <div className="bg-white border border-[#E8E6E1] rounded-xl p-6">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">Classify Email</div>
                <h3 className="text-[15px] font-semibold text-[#111827] mb-5">What type of email is this?</h3>
                <div className="space-y-3 mb-5">
                  {[
                    { label: 'Other', desc: 'Spam, General, Invoice Query, or SI Request — does not require SI/BL verification.' },
                    { label: 'BL Comparison', desc: 'Requires Shipping Instruction and Bill of Lading verification.' },
                  ].map(opt => (
                    <button key={opt.label}
                      onClick={() => setClassifyStep(opt.label === 'Other' ? 'other-category' : 'bl-action')}
                      className="w-full flex items-start gap-4 p-4 rounded-xl border border-[#E8E6E1] text-left hover:border-[#2563EB] hover:bg-[#F5F7FF] transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors">
                        {opt.label === 'Other'
                          ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="#6B7280" strokeWidth="1.3" /><path d="M4 7h6M4 4.5h6M4 9.5h3" stroke="#6B7280" strokeWidth="1.3" strokeLinecap="round" /></svg>
                          : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 4h11v7.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4z" stroke="#6B7280" strokeWidth="1.3" /><path d="M1.5 4l5.5 4.5L12.5 4" stroke="#6B7280" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                        }
                      </div>
                      <div>
                        <div className="text-[13.5px] font-semibold text-[#111827] mb-0.5">{opt.label}</div>
                        <div className="text-[12px] text-[#6B7280]">{opt.desc}</div>
                      </div>
                      <Chevron />
                    </button>
                  ))}
                </div>
                <button onClick={() => setClassifyStep('main')} className="text-[12px] text-[#9CA3AF] hover:text-[#374151] transition-colors">← Back</button>
              </div>
            )}

            {classifyStep === 'other-category' && (
              <div className="bg-white border border-[#E8E6E1] rounded-xl p-6">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">Other Email</div>
                <h3 className="text-[15px] font-semibold text-[#111827] mb-5">What type of Other email is this?</h3>
                <div className="space-y-2 mb-6">
                  {['Spam', 'Invoice Query', 'SI Request', 'General'].map(cat => (
                    <button key={cat} onClick={() => setSelectedOtherCat(cat)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-[13px] transition-all ${selectedOtherCat === cat ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E8E6E1] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9F8F6]'}`}>
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedOtherCat === cat ? 'border-[#2563EB]' : 'border-[#D1D5DB]'}`}>
                        {selectedOtherCat === cat && <span className="w-2 h-2 rounded-full bg-[#2563EB]" />}
                      </span>
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <button onClick={() => { setClassifyStep('pick-type'); setSelectedOtherCat(null) }} className="text-[12px] text-[#9CA3AF] hover:text-[#374151] transition-colors">← Back</button>
                  <button disabled={!selectedOtherCat}
                    onClick={() => selectedOtherCat && onClassifyOther?.(email.id, selectedOtherCat)}
                    className="flex items-center gap-2 bg-[#111827] disabled:opacity-40 hover:bg-[#374151] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
                    Confirm — Move to Others
                  </button>
                </div>
              </div>
            )}

            {classifyStep === 'bl-action' && (
              <div className="bg-white border border-[#E8E6E1] rounded-xl p-6">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">BL Comparison</div>
                <h3 className="text-[15px] font-semibold text-[#111827] mb-1">This email requires SI and BL verification.</h3>
                <p className="text-[12.5px] text-[#6B7280] mb-5">Choose how you want to proceed:</p>
                <div className="space-y-3 mb-5">
                  {[
                    { action: 'now', label: 'Verify Now', desc: 'Immediately run SI vs BL verification on this email.' },
                    { action: 'queue', label: 'Put into BL Comparison', desc: 'Queue this email for verification later via Inbox → BL Comparison.' },
                  ].map(opt => (
                    <button key={opt.action}
                      onClick={() => onClassifyBL?.(email.id, opt.action === 'now')}
                      className="w-full flex items-start gap-4 p-4 rounded-xl border border-[#E8E6E1] text-left hover:border-[#16A34A] hover:bg-[#F0FDF4] transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] group-hover:bg-[#DCFCE7] flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors">
                        {opt.action === 'now'
                          ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-5.5" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h9M8 4l3 3-3 3" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        }
                      </div>
                      <div>
                        <div className="text-[13.5px] font-semibold text-[#111827] mb-0.5">{opt.label}</div>
                        <div className="text-[12px] text-[#6B7280]">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setClassifyStep('pick-type')} className="text-[12px] text-[#9CA3AF] hover:text-[#374151] transition-colors">← Back</button>
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-end">
            <button onClick={() => setScreen('final-decision')}
              className="flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-6 py-2.5 rounded-lg transition-colors">
              Done Review
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Final Decision ───────────────────────────────────────────────────────────

function FinalDecisionScreen({ emailId, setScreen, setActiveNav, setVerifTab, onDecision }: {
  emailId: string | null; setScreen: (s: Screen) => void
  setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
  onDecision: (id: string, d: ManualDecision) => void
}) {
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null

  function decide(d: ManualDecision) {
    onDecision(email!.id, d)
    if (d === 'match') { setVerifTab('match'); setActiveNav('verification'); setScreen('verification') }
    else if (d === 'resend') { setActiveNav('resend'); setScreen('resend') }
    else { setVerifTab('review'); setActiveNav('verification'); setScreen('verification') }
  }

  const options: { decision: ManualDecision; label: string; desc: string; style: string }[] = [
    { decision: 'match',       label: 'Match',          desc: 'You have manually verified and consider this email resolved as matching.', style: 'border-[#BBF7D0] text-[#16A34A] bg-[#F0FDF4] hover:bg-[#DCFCE7]' },
    { decision: 'resend',      label: 'Resend',         desc: 'The email/document needs correction and should be sent back for revision.',  style: 'border-[#E8E6E1] text-[#111827] hover:border-[#D1D5DB] hover:bg-[#F9F8F6]' },
    { decision: 'keep-review', label: 'Keep as Review', desc: 'You cannot confidently resolve this case. It remains in the Review queue.', style: 'border-[#FDE68A] text-[#D97706] bg-[#FFFBEB] hover:bg-[#FEF3C7]' },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Review Decision" />
      <div className="px-8 py-7 max-w-[640px]">
        <BackBtn onClick={() => setScreen('manual-review')} label="Back to Manual Review" />
        <div className="bg-white border border-[#E8E6E1] rounded-xl p-8 mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Manual Review Complete</div>
          <h2 className="text-[20px] font-bold text-[#111827] tracking-[-0.02em] mb-1">What should happen to this email?</h2>
          <p className="text-[13px] text-[#6B7280]">{email.subject}</p>
        </div>
        <div className="space-y-3">
          {options.map(opt => (
            <button key={opt.decision} onClick={() => decide(opt.decision)}
              className={`w-full flex items-start gap-4 p-5 rounded-xl border text-left transition-all ${opt.style}`}>
              <div className="w-8 h-8 rounded-lg border border-current/20 bg-current/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                {opt.decision === 'match'       && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                {opt.decision === 'resend'      && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h9M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                {opt.decision === 'keep-review' && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M7 4.5v3M7 9v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
              </div>
              <div>
                <div className="text-[14px] font-semibold mb-1">{opt.label}</div>
                <div className="text-[12.5px] opacity-70 leading-[1.5]">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Resend ───────────────────────────────────────────────────────────────────

function ResendScreen({ manualDecisions, setScreen, onSelectEmail }: {
  manualDecisions: Map<string, ManualDecision>; setScreen: (s: Screen) => void; onSelectEmail: (id: string) => void
}) {
  const resendEmails = allEmails.filter(e => manualDecisions.get(e.id) === 'resend')
  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Resend" subtitle="Emails requiring correction" />
      <div className="px-8 py-7">
        <div className="bg-white border border-[#E8E6E1] rounded-xl px-7 py-6 mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-2">Resend Queue</div>
          <div className="text-[32px] font-bold text-[#111827] tracking-[-0.04em] leading-none mb-1">{resendEmails.length}</div>
          <div className="text-[13px] text-[#6B7280]">{resendEmails.length === 0 ? 'No emails in the resend queue' : `email${resendEmails.length > 1 ? 's' : ''} manually reviewed and marked for correction`}</div>
        </div>
        {resendEmails.length === 0
          ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-12 text-center">
              <div className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9h12M10 5l4 4-4 4" stroke="#9CA3AF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="text-[14px] font-medium text-[#111827] mb-1">Resend queue is empty</div>
              <div className="text-[13px] text-[#9CA3AF]">Emails marked for resend after manual review will appear here.</div>
            </div>
          : <div className="space-y-4">
              {resendEmails.map(email => {
                const pf = email.fields.find(f => f.result !== 'match')
                return (
                  <div key={email.id} className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-[#F0EEE9]">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[14px] font-semibold text-[#111827] mb-1">{email.subject}</div>
                          <div className="text-[12px] text-[#9CA3AF]">{email.senderName} · {email.received} · {email.docType}</div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280] flex-shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />Ready to Resend
                        </span>
                      </div>
                    </div>
                    {pf && (
                      <div className="px-6 py-4 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">Issue</div>
                        <div className="flex items-center gap-8 flex-wrap">
                          <div><div className="text-[11px] text-[#9CA3AF] mb-0.5">Field</div><div className="text-[13px] font-medium text-[#374151]">{pf.field}</div></div>
                          <div><div className="text-[11px] text-[#9CA3AF] mb-0.5">SI</div><div className="text-[13px] text-[#374151]">{pf.si}</div></div>
                          <div className="text-[#D1D5DB]">→</div>
                          <div><div className="text-[11px] text-[#9CA3AF] mb-0.5">BL</div><div className={`text-[13px] font-medium ${pf.result === 'mismatch' ? 'text-[#DC2626]' : 'text-[#D97706]'}`}>{pf.bl}</div></div>
                          <div><div className="text-[11px] text-[#9CA3AF] mb-0.5">Reviewed by</div><div className="text-[13px] text-[#374151]">Jane Liu</div></div>
                        </div>
                      </div>
                    )}
                    <div className="px-6 py-4 flex items-center gap-3">
                      <button onClick={() => { onSelectEmail(email.id); setScreen('verification-detail') }}
                        className="text-[12.5px] text-[#6B7280] border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3.5 py-1.5 rounded-lg font-medium">Open Email</button>
                      <button onClick={() => { onSelectEmail(email.id); setScreen('manual-review') }}
                        className="text-[12.5px] text-[#6B7280] border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3.5 py-1.5 rounded-lg font-medium">View Documents</button>
                      <button className="ml-auto flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[12.5px] font-medium px-4 py-1.5 rounded-lg transition-colors">
                        Resend
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5h8M7 3.5l3 3-3 3" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
        }
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]         = useState<Screen>('overview')
  const [activeNav, setActiveNav]   = useState<NavItem>('overview')
  const [verifTab, setVerifTab]     = useState<VerifTab>('match')
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [reviewEmailId, setReviewEmailId]     = useState<string | null>(null)
  const [reviewBackTo, setReviewBackTo]       = useState<Screen>('inbox')

  const [classifiedEmails, setClassifiedEmails] = useState<Set<string>>(new Set(INITIALLY_CLASSIFIED))
  const [verifiedEmails, setVerifiedEmails]     = useState<Set<string>>(new Set(INITIALLY_VERIFIED))
  const [readEmails, setReadEmails]             = useState<Set<string>>(new Set())
  const [manualDecisions, setManualDecisions]   = useState<Map<string, ManualDecision>>(new Map())
  const [reclassifications, setReclassifications] = useState<Map<string, { classification: Classification; classifyType?: string }>>(new Map())

  function handleSetScreen(s: Screen) {
    setScreen(s)
    if (s === 'overview') setActiveNav('overview')
    else if (s === 'inbox' || s === 'inbox-detail' || s === 'others-detail') setActiveNav('inbox')
    else if (s === 'verification' || s === 'verification-detail' || s === 'manual-review' || s === 'final-decision') setActiveNav('verification')
    else if (s === 'resend') setActiveNav('resend')
  }

  function handleClassify() {
    const ids = allEmails.filter(e => !classifiedEmails.has(e.id)).map(e => e.id)
    setClassifiedEmails(prev => new Set([...prev, ...ids]))
  }

  function handleVerify(id: string) {
    setVerifiedEmails(prev => new Set([...prev, id]))
    const email = allEmails.find(e => e.id === id)
    if (email) {
      setSelectedEmailId(id)
      setVerifTab(email.docResult === 'review' ? 'review' : email.docResult === 'mismatch' ? 'mismatch' : 'match')
      setActiveNav('verification')
      setScreen('verification-detail')
    }
  }

  function handleVerifyAll() {
    const effR = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification }
    const ids = allEmails
      .filter(e => classifiedEmails.has(e.id) && effR(e).classification === 'check' && !verifiedEmails.has(e.id))
      .map(e => e.id)
    if (ids.length > 0) setVerifiedEmails(prev => new Set([...prev, ...ids]))
  }

  function handleDecision(id: string, d: ManualDecision) {
    setManualDecisions(prev => new Map([...prev, [id, d]]))
  }

  function handleClassifyOther(id: string, category: string) {
    setReclassifications(prev => new Map([...prev, [id, { classification: 'ignore', classifyType: category }]]))
    setActiveNav('inbox')
    setScreen('inbox')
  }

  function handleClassifyBL(id: string, verifyNow: boolean) {
    setReclassifications(prev => new Map([...prev, [id, { classification: 'check' }]]))
    if (verifyNow) {
      setVerifiedEmails(prev => new Set([...prev, id]))
      const email = allEmails.find(e => e.id === id)!
      setSelectedEmailId(id)
      setVerifTab(email.docResult === 'review' ? 'review' : email.docResult === 'mismatch' ? 'mismatch' : 'match')
      setActiveNav('verification')
      setScreen('verification-detail')
    } else {
      setActiveNav('inbox')
      setScreen('inbox')
    }
  }

  const effReclass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification, classifyType: e.classifyType }
  const newIncoming  = allEmails.filter(e => !classifiedEmails.has(e.id)).length
  const blPending    = allEmails.filter(e => classifiedEmails.has(e.id) && effReclass(e).classification === 'check' && !verifiedEmails.has(e.id)).length
  const classifyRev  = allEmails.filter(e => classifiedEmails.has(e.id) && effReclass(e).classification === 'need-review').length
  const inboxBadge   = newIncoming + blPending + classifyRev

  return (
    <div className="flex h-screen bg-[#F9F8F6] overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar activeNav={activeNav} activeVerifTab={verifTab}
        setActiveNav={setActiveNav} setScreen={handleSetScreen}
        setVerifTab={setVerifTab} inboxBadge={inboxBadge} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {screen === 'overview' && (
          <OverviewScreen setScreen={handleSetScreen} setActiveNav={setActiveNav} setVerifTab={setVerifTab}
            verifiedEmails={verifiedEmails} manualDecisions={manualDecisions} onSelectEmail={setSelectedEmailId} />
        )}
        {screen === 'inbox' && (
          <InboxScreen
            classifiedEmails={classifiedEmails} verifiedEmails={verifiedEmails} readEmails={readEmails}
            reclassifications={reclassifications}
            onClassify={handleClassify} onVerify={handleVerify} onVerifyAll={handleVerifyAll}
            setScreen={handleSetScreen}
            onSelectEmail={setSelectedEmailId}
            onSelectOthers={setSelectedEmailId}
            onSelectReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('inbox') }}
          />
        )}
        {screen === 'inbox-detail' && (
          <InboxDetailScreen emailId={selectedEmailId} classifiedEmails={classifiedEmails}
            onVerify={handleVerify} setScreen={handleSetScreen}
            setActiveNav={setActiveNav} setVerifTab={setVerifTab} />
        )}
        {screen === 'others-detail' && (
          <OthersDetailScreen emailId={selectedEmailId}
            onMarkRead={(id) => setReadEmails(prev => new Set([...prev, id]))}
            setScreen={handleSetScreen} />
        )}
        {screen === 'verification' && (
          <VerificationScreen verifiedEmails={verifiedEmails} classifiedEmails={classifiedEmails} reclassifications={reclassifications} manualDecisions={manualDecisions}
            activeTab={verifTab} setActiveTab={setVerifTab}
            setScreen={handleSetScreen} onSelectEmail={setSelectedEmailId}
            onSelectReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('verification') }} />
        )}
        {screen === 'verification-detail' && (
          <VerificationDetailScreen emailId={selectedEmailId} manualDecisions={manualDecisions}
            setScreen={handleSetScreen}
            onFlagReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('verification-detail') }} />
        )}
        {screen === 'manual-review' && (
          <ManualReviewScreen emailId={reviewEmailId ?? selectedEmailId} setScreen={handleSetScreen} backTo={reviewBackTo}
            onClassifyOther={handleClassifyOther} onClassifyBL={handleClassifyBL} />
        )}
        {screen === 'final-decision' && (
          <FinalDecisionScreen emailId={reviewEmailId ?? selectedEmailId}
            setScreen={handleSetScreen} setActiveNav={setActiveNav}
            setVerifTab={setVerifTab} onDecision={handleDecision} />
        )}
        {screen === 'resend' && (
          <ResendScreen manualDecisions={manualDecisions} setScreen={handleSetScreen} onSelectEmail={setSelectedEmailId} />
        )}
      </main>
    </div>
  )
}
