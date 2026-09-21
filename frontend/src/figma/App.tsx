import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  attachmentFileUrl,
  checkDocuments,
  fetchAttachmentBytes,
  fetchAttachmentPlainText,
  fetchAttachmentSheets,
  fetchAttachmentText,
  fetchEmails,
  FIELD_LABELS,
  type ApiAttachments,
  type ApiAutoReply,
  type ApiEmailRecord,
  type ApiResult,
  type ApiSheet,
  type AttachmentRole,
} from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | 'live-check'
  | 'overview'
  | 'inbox'
  | 'inbox-detail'
  | 'others-detail'
  | 'verification'
  | 'verification-detail'
  | 'manual-review'
  | 'final-decision'
  | 'resend'
  | 'documents'

type NavItem = 'overview' | 'inbox' | 'verification' | 'resend' | 'documents' | 'live'
type VerifTab = 'all' | 'match' | 'mismatch' | 'review'
type MatchReplyFilter = 'all' | 'reply' | 'unreply'
type FieldResult = 'match' | 'mismatch' | 'review'
type DocResult = 'match' | 'mismatch' | 'review'
type ManualDecision = 'match' | 'resend' | 'keep-review'
type Classification = 'ignore' | 'check' | 'need-review'
type ReviewMode = 'classify' | 'direct-verify' | 'flag-review'

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
  body?: string
  fields: VerifField[]
  // The SI / BL files of a sample email. Undefined for a saved live check,
  // whose uploaded files are never kept.
  attachments?: ApiAttachments
  autoReply?: ApiAutoReply
}

// ─── Email pool ───────────────────────────────────────────────────────────────
// The emails come from the backend (GET /api/emails) plus any live checks the
// employee chose to save in this browser. Screens read them through useEmails().

const EmailsContext = createContext<Email[]>([])

function useEmails(): Email[] {
  return useContext(EmailsContext)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function effectiveResult(email: Email, decisions: Map<string, ManualDecision>): DocResult | 'resend' {
  const d = decisions.get(email.id)
  if (!d) return email.docResult
  if (d === 'match') return 'match'
  if (d === 'resend') return 'resend'
  return 'review'
}

function receivedSortKey(received: string): number {
  if (received.startsWith('Today')) {
    const timePart = received.replace('Today, ', '')
    return 9999 * 1440 + parseTimeMinutes(timePart)
  }
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

// The system's own answer, in words a person can act on. It ignores manual
// decisions on purpose: those are shown in their own banner.
function getVerdict(email: Email): { title: string; detail: string; style: string } {
  if (email.docResult === 'match') {
    return {
      title: 'MATCH',
      detail: email.fields.length > 0
        ? 'All 7 fields agree between the Shipping Instruction and the Bill of Lading. No action needed.'
        : 'There are no documents to compare.',
      style: 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]',
    }
  }
  if (email.docResult === 'mismatch') {
    const names = email.fields.filter(f => f.result === 'mismatch').map(f => f.field)
    return {
      title: 'MISMATCH',
      detail: `${names.length} field${names.length > 1 ? 's' : ''} differ between the Shipping Instruction and the Bill of Lading: ${names.join(', ')}.`,
      style: 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]',
    }
  }
  return {
    title: 'NEEDS REVIEW',
    detail: email.reviewDetail ?? 'The system could not decide on its own. A person needs to check the documents.',
    style: 'bg-[#FFFBEB] border-[#FDE68A] text-[#D97706]',
  }
}

function VerdictBanner({ email }: { email: Email }) {
  const verdict = getVerdict(email)
  return (
    <div role="status" aria-label={`System result: ${verdict.title}`} className={`mb-5 rounded-xl border px-7 py-5 ${verdict.style}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-70 mb-1">System result</div>
      <div className="text-[24px] font-bold tracking-[-0.02em] leading-tight">{verdict.title}</div>
      <div className="text-[13px] mt-1 text-[#374151]">{verdict.detail}</div>
    </div>
  )
}

function getVerifSummary(email: Email): string {
  if (email.docResult === 'match') return email.fields.length > 0 ? 'All 7 fields verified' : 'No documents to compare'
  if (email.docResult === 'mismatch') {
    const m = email.fields.filter(f => f.result === 'mismatch').length
    return `${m} field${m > 1 ? 's' : ''} mismatched`
  }
  if (email.classification === 'need-review') return 'Fail to Identify Type'
  return 'Fail to Compare SI and BL'
}

function otherDisplayName(classifyType: string | undefined): string {
  if (!classifyType) return 'Other'
  if (classifyType === 'Invoice Query') return 'Invoice'
  return classifyType
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
    <button onClick={onClick} className="btn-micro flex items-center gap-1.5 text-[12px] text-[#6B7280] hover:text-[#111827] transition-colors mb-6">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 7H4M7 10L4 7l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M5 3.5V2.5h3v1M5.5 6v3.5M7.5 6v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3.5l.5 7h6l.5-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Category filter bar (shared between Inbox Others + Documents Other section) ─

type OtherCatFilter = 'all' | 'Spam' | 'General' | 'Invoice' | 'SI Request'
const OTHER_CAT_LABELS: OtherCatFilter[] = ['all', 'Spam', 'General', 'Invoice', 'SI Request']

function OtherCategoryBar({ active, onChange, counts }: {
  active: OtherCatFilter
  onChange: (cat: OtherCatFilter) => void
  counts: Record<OtherCatFilter, number>
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {OTHER_CAT_LABELS.map(cat => {
        const isActive = active === cat
        return (
          <button key={cat} onClick={() => onChange(cat)}
            className="btn-micro flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
            style={isActive ? {
              background: '#111827',
              color: '#FFFFFF',
              boxShadow: '0 2px 6px rgba(0,0,0,0.16), 0 1px 2px rgba(0,0,0,0.10)',
              transform: 'scale(1.04)',
            } : {
              background: '#FFFFFF',
              color: '#6B7280',
              border: '1px solid #E8E6E1',
            }}>
            {cat === 'all' ? 'All' : cat}
            <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${
              isActive ? 'bg-white/20 text-white' : 'bg-[#F3F4F6] text-[#9CA3AF]'
            }`}>{counts[cat]}</span>
          </button>
        )
      })}
    </div>
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

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ count, onYes, onNo }: { count: number; onYes: () => void; onNo: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-[380px] mx-4">
        <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center mx-auto mb-5">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 5h12M7 5V3.5h4V5M7.5 8v5M10.5 8v5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 5l.7 9h8.6l.7-9" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="text-[17px] font-semibold text-[#111827] text-center mb-2">Are you sure you want to delete?</div>
        <p className="text-[13px] text-[#6B7280] text-center mb-7 leading-[1.6]">
          {count === 1 ? 'This document' : `${count} documents`} will be permanently removed and cannot be recovered.
        </p>
        <div className="flex gap-3">
          <button onClick={onNo} className="btn-micro flex-1 border border-[#E8E6E1] text-[#374151] px-4 py-2.5 rounded-lg text-[13px] font-medium hover:bg-[#F9F8F6] transition-colors">No</button>
          <button onClick={onYes} className="btn-micro flex-1 bg-[#DC2626] hover:bg-[#B91C1C] text-white px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors">Yes, Delete</button>
        </div>
      </div>
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
    <aside className="w-[212px] flex-shrink-0 flex flex-col border-r border-[#E8E6E1]" style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '2px 0 12px rgba(37,99,235,0.04), 1px 0 4px rgba(0,0,0,0.04)' }}>
      <div className="px-5 h-14 flex items-center border-b border-[#F0EEE9]">
        <div className="flex items-center gap-2.5">
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: 'linear-gradient(145deg, #3B82F6 0%, #1D4ED8 55%, #1740AA 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 4px rgba(29,78,216,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden="true">
              <path d="M5.6 1.6 C5.6 0.9 4.8 0.7 3.9 0.7 L2.1 0.7 C0.9 0.7 0.7 1.4 0.7 2.5 L0.7 4.8 C0.7 6.3 1.7 7 3.1 7 L4 7 C5.3 7 5.6 7.8 5.6 9.2 L5.6 11.2 C5.6 12.6 4.7 13.3 3.5 13.3 L0.7 13.3"
                stroke="white" strokeWidth="1.32" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7.2 0.7 L7.2 13.3 M7.2 0.7 L9.1 0.7 Q13.6 0.7 13.6 7 Q13.6 13.3 9.1 13.3 L7.2 13.3"
                stroke="white" strokeWidth="1.32" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15.4 0.7 L18.3 13.3 M21.2 0.7 L18.3 13.3"
                stroke="white" strokeWidth="1.32" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-[13.5px] font-semibold text-[#111827] tracking-[-0.01em]">SDV</span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <NavBtn active={activeNav === 'overview'} onClick={() => go('overview', 'overview')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>}
          label="Overview" />
        <NavBtn active={activeNav === 'inbox'} onClick={() => go('inbox', 'inbox')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1.5 5L7.5 9l6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" /></svg>}
          label="Inbox" badge={inboxBadge > 0 ? inboxBadge : undefined} />
        <NavBtn active={activeNav === 'documents'} onClick={() => go('documents', 'documents')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="2.5" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 1.5h9a1 1 0 011 1V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          label="Documents" />
        <NavBtn active={activeNav === 'verification'} onClick={() => goVerif('all')}
          icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 7.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          label="Verification" />
        <div className="ml-6 space-y-0.5">
          {([
            { tab: 'match' as VerifTab, label: 'Match', dot: 'bg-[#16A34A]' },
            { tab: 'mismatch' as VerifTab, label: 'Mismatch', dot: 'bg-[#DC2626]' },
            { tab: 'review' as VerifTab, label: 'Review', dot: 'bg-[#D97706]' },
          ]).map(s => (
            <button key={s.tab} onClick={() => goVerif(s.tab)}
              className={`btn-micro w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all text-left ${
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
        <div className="pt-3 mt-3 border-t border-[#F0EEE9]">
          <NavBtn active={activeNav === 'live'} onClick={() => go('live', 'live-check')}
            icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 10V2M4.5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 10v2.5A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
            label="Live check" />
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
      className={`btn-micro w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 text-left ${
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

function TopBar({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="h-14 border-b border-[#E8E6E1] bg-white px-8 flex items-center justify-between flex-shrink-0">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[14px] font-semibold text-[#111827] tracking-[-0.01em]">{title}</h1>
        {subtitle && <span className="text-[12px] text-[#9CA3AF]">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <div className="flex items-center gap-1.5 text-[11.5px] text-[#6B7280] bg-[#F9F8F6] border border-[#E8E6E1] rounded-lg px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
          Global Trade Workspace
        </div>
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

// ─── NavDashCard ──────────────────────────────────────────────────────────────

function NavDashCard({ label, value, sub, onClick }: {
  label: string; value: string; sub: string; onClick: () => void
}) {
  const cardRef = React.useRef<HTMLDivElement>(null)

  function applyStyle(transform: string, shadow: string, transition: string) {
    const card = cardRef.current
    if (!card) return
    card.style.transform = transform
    card.style.boxShadow = shadow
    card.style.transition = transition
  }

  function handleMouseMove(e: React.MouseEvent) {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    card.style.transform = `perspective(700px) rotateY(${x * 7}deg) rotateX(${-y * 5}deg) scale(1.026)`
    card.style.boxShadow = '0 8px 28px rgba(37,99,235,0.11), 0 2px 8px rgba(0,0,0,0.07)'
    card.style.transition = 'box-shadow 120ms ease-out'
  }

  function handleMouseLeave() {
    applyStyle('perspective(700px) rotateY(0deg) rotateX(0deg) scale(1)', '', 'transform 420ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 350ms ease-out')
  }

  function handleClick() {
    applyStyle('perspective(700px) scale(0.96)', '', 'transform 80ms ease-out')
    setTimeout(onClick, 85)
  }

  return (
    <div ref={cardRef} onClick={handleClick} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer', willChange: 'transform', borderRadius: 12, userSelect: 'none' }}
      className="bg-white border border-[#E8E6E1] p-6 flex flex-col">
      <div className="text-[32px] font-bold text-[#111827] tracking-[-0.04em] leading-none mb-2">{value}</div>
      <div className="text-[12px] text-[#374151] font-medium mb-0.5">{label}</div>
      <div className="text-[11px] text-[#9CA3AF]">{sub}</div>
      <div className="mt-auto pt-4 flex justify-end">
        <span className="text-[#D1D5DB]"><Chevron size={12} /></span>
      </div>
    </div>
  )
}

// ─── Ambient gradient ─────────────────────────────────────────────────────────

function AmbientGradient() {
  const blob1 = React.useRef<HTMLDivElement>(null)
  const blob2 = React.useRef<HTMLDivElement>(null)
  const blob3 = React.useRef<HTMLDivElement>(null)
  const mouse   = React.useRef({ x: 0.5, y: 0.5 })
  const mSmooth = React.useRef({ x: 0.5, y: 0.5 })
  const raf     = React.useRef(0)

  React.useEffect(() => {
    const isTouch = window.matchMedia('(pointer: coarse)').matches
    const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } }
    if (!isTouch) window.addEventListener('mousemove', onMove, { passive: true })
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const sway = (t: number, p1: number, p2: number, ph1: number, ph2: number, w: number, range: number) =>
      (Math.sin(t / p1 + ph1) * w + Math.sin(t / p2 + ph2) * (1 - w)) * range
    const tick = () => {
      const t = performance.now() / 1000
      mSmooth.current.x = lerp(mSmooth.current.x, mouse.current.x, 0.035)
      mSmooth.current.y = lerp(mSmooth.current.y, mouse.current.y, 0.035)
      const mx = mSmooth.current.x - 0.5; const my = mSmooth.current.y - 0.5
      if (blob1.current) blob1.current.style.transform = `translate(${sway(t,19.3,31.7,0,1.24,0.60,85)+mx*60}px,${sway(t,14.1,23.9,0.83,2.61,0.55,68)+my*48}px)`
      if (blob2.current) blob2.current.style.transform = `translate(${sway(t,23.7,38.3,1.57,3.92,0.50,70)+mx*-44}px,${sway(t,17.9,28.1,2.34,0.71,0.58,55)+my*36}px)`
      if (blob3.current) blob3.current.style.transform = `translate(${sway(t,29.1,43.7,3.14,1.87,0.46,55)+mx*32}px,${sway(t,22.3,36.1,0.42,4.33,0.52,44)+my*26}px)`
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf.current) }
  }, [])

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(140deg, rgba(37,99,235,0.07) 0%, transparent 48%, rgba(79,70,229,0.05) 100%)' }} />
      <div ref={blob1} style={{ position: 'absolute', width: 580, height: 580, top: '-60px', left: '-30px', background: 'radial-gradient(ellipse 60% 60% at 40% 40%, rgba(37,99,235,0.26) 0%, rgba(37,99,235,0.12) 35%, rgba(37,99,235,0.03) 60%, transparent 78%)', willChange: 'transform' }} />
      <div ref={blob2} style={{ position: 'absolute', width: 500, height: 500, top: '80px', right: '-50px', background: 'radial-gradient(ellipse 58% 58% at 58% 42%, rgba(79,70,229,0.22) 0%, rgba(79,70,229,0.09) 38%, rgba(79,70,229,0.02) 62%, transparent 78%)', willChange: 'transform' }} />
      <div ref={blob3} style={{ position: 'absolute', width: 440, height: 440, bottom: '-20px', left: '-10px', background: 'radial-gradient(ellipse 58% 58% at 42% 58%, rgba(59,130,246,0.20) 0%, rgba(59,130,246,0.08) 40%, rgba(59,130,246,0.02) 63%, transparent 78%)', willChange: 'transform' }} />
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewScreen({ setScreen, setActiveNav, setVerifTab, verifiedEmails, manualDecisions, onSelectEmail, deletedEmails }: {
  setScreen: (s: Screen) => void; setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
  verifiedEmails: Set<string>; manualDecisions: Map<string, ManualDecision>; onSelectEmail: (id: string) => void
  deletedEmails: Set<string>
}) {
  const allEmails = useEmails()
  const visible = allEmails.filter(e => !deletedEmails.has(e.id))
  const verified = visible.filter(e => verifiedEmails.has(e.id))
  const matchCount    = verified.filter(e => effectiveResult(e, manualDecisions) === 'match').length
  const mismatchCount = verified.filter(e => effectiveResult(e, manualDecisions) === 'mismatch').length
  const reviewCount   = verified.filter(e => effectiveResult(e, manualDecisions) === 'review').length
  const resendCount   = verified.filter(e => manualDecisions.get(e.id) === 'resend').length
  const total = verified.length
  const vPct = total ? (matchCount / total) * 100 : 0
  const rPct = total ? (reviewCount / total) * 100 : 0
  const mPct = total ? (mismatchCount / total) * 100 : 0
  const recent = visible.filter(e => verifiedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received)).slice(0, 6)

  function goVerif(tab: VerifTab) { setActiveNav('verification'); setVerifTab(tab); setScreen('verification') }
  function goResend() { setActiveNav('resend'); setScreen('resend') }
  function goDocs() { setActiveNav('documents'); setScreen('documents') }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F9F8F6] relative">
      <AmbientGradient />
      <TopBar title="Overview" subtitle="18 November 2024" />
      <div className="px-10 py-10 max-w-[1100px] relative" style={{ zIndex: 1 }}>
        <section className="mb-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF] mb-4">AI Document Verification</p>
          <h2 className="text-[38px] font-bold text-[#111827] tracking-[-0.035em] leading-[1.1] mb-5 max-w-[520px]">Shipping document<br />verification</h2>
          <p className="text-[14px] text-[#6B7280] leading-[1.7] max-w-[420px] mb-6">Compare Shipping Instructions against Bills of Lading. SDOC Verify surfaces discrepancies instantly.</p>
          <button onClick={() => { setActiveNav('inbox'); setScreen('inbox') }}
            className="btn-micro inline-flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
            Go to Inbox
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5h8M7 3l3.5 3.5L7 10" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </section>

        <section className="mb-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-4">Dashboard — click to navigate</p>
          <div className="grid grid-cols-5 gap-4">
            <NavDashCard label="Documents received" value={String(visible.length)} sub="total" onClick={goDocs} />
            <NavDashCard label="Match" value={String(matchCount)} sub={total ? `${vPct.toFixed(0)}%` : '—'} onClick={() => goVerif('match')} />
            <NavDashCard label="Needs review" value={String(reviewCount)} sub={total ? `${rPct.toFixed(0)}%` : '—'} onClick={() => goVerif('review')} />
            <NavDashCard label="Mismatches" value={String(mismatchCount)} sub={total ? `${mPct.toFixed(0)}%` : '—'} onClick={() => goVerif('mismatch')} />
            <NavDashCard label="Resend queue" value={String(resendCount)} sub="pending correction" onClick={goResend} />
          </div>
        </section>

        <div className="w-full h-px bg-[#E8E6E1] mb-14" />

        <div className="grid grid-cols-[1fr_340px] gap-10">
          <section>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[13px] font-semibold text-[#111827]">Recent Activity</h3>
              <button onClick={() => goVerif('all')} className="btn-micro text-[12px] text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1 transition-colors">View all <Chevron /></button>
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
                        className={`email-row-micro w-full flex items-center gap-4 px-5 py-3.5 text-left group ${i < recent.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
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
                  { label: 'Match', count: matchCount, pct: vPct, dot: 'bg-[#16A34A]', tc: 'text-[#16A34A]', tab: 'match' as VerifTab },
                  { label: 'Needs Review', count: reviewCount, pct: rPct, dot: 'bg-[#D97706]', tc: 'text-[#D97706]', tab: 'review' as VerifTab },
                  { label: 'Mismatch', count: mismatchCount, pct: mPct, dot: 'bg-[#DC2626]', tc: 'text-[#DC2626]', tab: 'mismatch' as VerifTab },
                ].map(row => (
                  <button key={row.label} onClick={() => goVerif(row.tab)} className="btn-micro w-full flex items-center gap-3 hover:opacity-80 transition-opacity">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${row.dot}`} />
                    <span className="text-[12.5px] text-[#374151] flex-1 text-left">{row.label}</span>
                    <span className={`text-[13px] font-semibold tabular-nums ${row.tc}`}>{row.count}</span>
                    <span className="text-[11px] text-[#9CA3AF] w-9 text-right tabular-nums">{row.pct.toFixed(0)}%</span>
                  </button>
                ))}
              </div>
              {resendCount > 0 && (
                <div className="mt-5 pt-5 border-t border-[#F0EEE9]">
                  <button onClick={goResend} className="btn-micro w-full flex items-center gap-3 p-3.5 rounded-lg bg-[#F9F8F6] border border-[#E8E6E1] hover:bg-[#F3F4F6] transition-colors">
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
const OTHER_CATEGORIES = ['Spam', 'General', 'Invoice', 'SI Request'] as const

function normalizeCat(classifyType: string | undefined): OtherCatFilter {
  if (!classifyType) return 'General'
  if (classifyType === 'Invoice Query') return 'Invoice'
  if (OTHER_CAT_LABELS.slice(1).includes(classifyType as OtherCatFilter)) return classifyType as OtherCatFilter
  return 'General'
}

function InboxScreen({ classifiedEmails, verifiedEmails, readEmails, reclassifications, deletedEmails, onClassify, onClassifySingle, onVerify, onVerifyAll, setScreen, onSelectEmail, onSelectOthers, onSelectReview }: {
  classifiedEmails: Set<string>; verifiedEmails: Set<string>; readEmails: Set<string>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  deletedEmails: Set<string>
  onClassify: () => void; onClassifySingle: (id: string) => void
  onVerify: (id: string) => void; onVerifyAll: () => void
  setScreen: (s: Screen) => void
  onSelectEmail: (id: string) => void; onSelectOthers: (id: string) => void; onSelectReview: (id: string) => void
}) {
  const allEmails = useEmails()
  const [activeInboxTab, setActiveInboxTab] = useState<InboxTab>('new')
  const [othersCatFilter, setOthersCatFilter] = useState<OtherCatFilter>('all')

  const effClass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification, classifyType: e.classifyType }

  const newIncoming  = allEmails.filter(e => !classifiedEmails.has(e.id) && !deletedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const othersActive = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'ignore' && !readEmails.has(e.id) && !deletedEmails.has(e.id))
  const blComparison = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'check' && !verifiedEmails.has(e.id) && !deletedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const classifyRev  = allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'need-review' && !deletedEmails.has(e.id))

  // Category counts for Others filter bar
  const otherCatCounts: Record<OtherCatFilter, number> = { all: othersActive.length, Spam: 0, General: 0, Invoice: 0, 'SI Request': 0 }
  othersActive.forEach(e => { const cat = normalizeCat(effClass(e).classifyType); otherCatCounts[cat] = (otherCatCounts[cat] ?? 0) + 1 })

  const visibleOthers = othersCatFilter === 'all' ? othersActive : othersActive.filter(e => normalizeCat(effClass(e).classifyType) === othersCatFilter)

  const inboxTabs: { id: InboxTab; label: string; count: number; active: string }[] = [
    { id: 'new',    label: 'New Incoming',  count: newIncoming.length,  active: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]' },
    { id: 'bl',     label: 'BL Comparison', count: blComparison.length, active: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]' },
    { id: 'others', label: 'Others',        count: othersActive.length, active: 'bg-[#F9F8F6] text-[#374151] border-[#E8E6E1]' },
    { id: 'review', label: 'Review',        count: classifyRev.length,  active: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]' },
  ]

  return (
    <div className="page-ambient flex-1 overflow-y-auto">
      <TopBar title="Inbox" subtitle="Document workflow" />
      <div className="px-8 pt-5 pb-0 border-b border-[#E8E6E1] bg-white">
        <div className="flex items-center gap-2 max-w-[900px]">
          {inboxTabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveInboxTab(tab.id)}
              className={`btn-micro flex items-center gap-2 px-4 py-2 rounded-t-lg border border-b-0 text-[13px] font-medium transition-all -mb-px ${
                activeInboxTab === tab.id ? tab.active : 'bg-white border-transparent text-[#6B7280] hover:text-[#374151] hover:bg-[#F9F8F6]'
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
                ? <button onClick={onClassify} className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3.5h10M2.5 6h7M4 8.5h4" stroke="#2563EB" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    Classify All
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
                    <div key={email.id} className={`email-row-micro flex items-center gap-4 px-5 py-4 ${i < newIncoming.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                      <div className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer group"
                        onClick={() => { onSelectEmail(email.id); setScreen('inbox-detail') }}>
                        <span className="w-2 h-2 rounded-full bg-[#2563EB] flex-shrink-0" />
                        <div className="w-8 h-8 rounded-full bg-[#F3F4F6] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#6B7280]">{email.senderName.slice(0,2).toUpperCase()}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                          <div className="text-[12px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                        </div>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded flex-shrink-0">New</span>
                      </div>
                      <button onClick={e => { e.stopPropagation(); onClassifySingle(email.id) }}
                        className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0">
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 3h9M2 5.5h7M3 8h5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" /></svg>
                        Classify
                      </button>
                      <span className="text-[#D1D5DB] cursor-pointer flex-shrink-0" onClick={() => { onSelectEmail(email.id); setScreen('inbox-detail') }}><Chevron /></span>
                    </div>
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
                ? <button onClick={onVerifyAll} className="btn-micro text-[12px] font-medium text-[#6B7280] bg-white border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3 py-1.5 rounded-lg transition-colors">Verify All</button>
                : null}
            />
            {blComparison.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No BL Comparison emails awaiting verification</span></div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {blComparison.map((email, i) => (
                    <div key={email.id} className={`email-row-micro flex items-center gap-4 px-5 py-4 ${i < blComparison.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
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
                        className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Verify
                      </button>
                    </div>
                  ))}
                </div>
            }
          </section>
        )}

        {/* OTHERS — compact category filter bar */}
        {activeInboxTab === 'others' && (
          <section>
            <SectionHdr label="Others" count={othersActive.length} />
            <div className="mb-4">
              <OtherCategoryBar active={othersCatFilter} onChange={setOthersCatFilter} counts={otherCatCounts} />
            </div>
            {othersActive.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No emails in Others queue</span></div>
              : visibleOthers.length === 0
                ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No {othersCatFilter} emails</span></div>
                : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                    {visibleOthers.map((email, i) => (
                      <button key={email.id} onClick={() => { onSelectOthers(email.id); setScreen('others-detail') }}
                        className={`email-row-micro w-full flex items-center gap-4 px-5 py-3.5 text-left group ${i < visibleOthers.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                        <div className="w-7 h-7 rounded-full bg-[#F3F4F6] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#9CA3AF]">{email.senderName.slice(0,2).toUpperCase()}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-[#374151] truncate group-hover:text-[#111827] transition-colors">{email.subject}</div>
                          <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                        </div>
                        {othersCatFilter === 'all' && (
                          <span className="text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] px-2 py-0.5 rounded flex-shrink-0">
                            {otherDisplayName(effClass(email).classifyType)}
                          </span>
                        )}
                        <span className="text-[#D1D5DB] group-hover:text-[#9CA3AF] transition-colors"><Chevron /></span>
                      </button>
                    ))}
                  </div>
            }
          </section>
        )}

        {/* REVIEW */}
        {activeInboxTab === 'review' && (
          <section>
            <SectionHdr label="Review" count={classifyRev.length} />
            {classifyRev.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No emails requiring classification review</span></div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {classifyRev.map((email, i) => (
                    <button key={email.id} onClick={() => { onSelectReview(email.id); setScreen('manual-review') }}
                      className={`email-row-micro w-full flex items-center gap-4 px-5 py-4 text-left group ${i < classifyRev.length - 1 ? 'border-b border-[#F0EEE9]' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-[#FEF3C7] flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-[#D97706]">{email.senderName.slice(0,2).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[#374151] truncate">{email.subject}</div>
                        <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D97706] bg-[#FFFBEB] px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />Review</span>
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
  const allEmails = useEmails()
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  const isClassified = classifiedEmails.has(email.id)
  const isBL = email.classification === 'check'

  function handleVerify() {
    onVerify(email!.id)
    // navigation is handled by onVerify (goes to manual-review)
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
            <div className="text-[13px] text-[#374151] leading-[1.75]">
              <p className="whitespace-pre-wrap break-words">{email.body || 'This email has no message text.'}</p>
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
              <button onClick={handleVerify} className="btn-micro flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
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

function OthersDetailScreen({ emailId, onMarkRead, setScreen, readEmails }: {
  emailId: string | null; onMarkRead: (id: string) => void; setScreen: (s: Screen) => void
  readEmails: Set<string>
}) {
  const allEmails = useEmails()
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Email" subtitle={otherDisplayName(email.classifyType)} />
      <div className="px-8 py-7 max-w-[780px]">
        <BackBtn onClick={() => setScreen('inbox')} label="Back to Inbox" />
        <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
          <div className="px-7 py-6 border-b border-[#F0EEE9]">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] bg-[#F3F4F6] px-2 py-0.5 rounded">{otherDisplayName(email.classifyType)}</span>
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
            <div className="text-[13px] text-[#374151] leading-[1.75]">
              <p className="whitespace-pre-wrap break-words">{email.body || 'This email has no message text.'}</p>
            </div>
          </div>
          <div className="px-7 py-5 flex justify-between items-center">
            <div className="text-[12px] text-[#9CA3AF]">This email does not require SI/BL verification.</div>
            {!readEmails.has(email.id) && (
              <button onClick={() => { onMarkRead(email.id); setScreen('inbox') }}
                className="btn-micro flex items-center gap-2 bg-[#F9F8F6] border border-[#E8E6E1] hover:bg-[#F3F4F6] text-[#374151] text-[13px] font-medium px-4 py-2 rounded-lg transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-6.5" stroke="#374151" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Mark as Read
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Search atoms ─────────────────────────────────────────────────────────────

function SearchBar({ value, onChange, placeholder, variant = 'section' }: {
  value: string; onChange: (v: string) => void; placeholder: string; variant?: 'global' | 'section'
}) {
  return (
    <div className="relative flex items-center w-full">
      <span className="absolute left-3 text-[#9CA3AF] pointer-events-none flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      </span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full pl-9 pr-8 bg-white border border-[#E8E6E1] rounded-lg text-[13px] text-[#374151] placeholder-[#9CA3AF] outline-none focus:border-[#93C5FD] focus:ring-2 focus:ring-[#EFF6FF] transition-all ${variant === 'global' ? 'h-10' : 'h-9'}`} />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2.5 text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  )
}

function emailMatchesQuery(email: Email, q: string): boolean {
  const lq = q.toLowerCase()
  return email.subject.toLowerCase().includes(lq) || email.senderName.toLowerCase().includes(lq) || email.sender.toLowerCase().includes(lq) || email.id.toLowerCase().includes(lq) || (email.docType ?? '').toLowerCase().includes(lq)
}

// ─── Verification ─────────────────────────────────────────────────────────────

function VerificationScreen({ verifiedEmails, classifiedEmails, reclassifications, manualDecisions, deletedEmails, repliedEmails, activeTab, setActiveTab, setScreen, onSelectEmail, onSelectReview, onSelectKeepReview, onDeleteEmails, onReply, onReplyAll }: {
  verifiedEmails: Set<string>; classifiedEmails: Set<string>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  manualDecisions: Map<string, ManualDecision>; deletedEmails: Set<string>; repliedEmails: Set<string>
  activeTab: VerifTab; setActiveTab: (t: VerifTab) => void
  setScreen: (s: Screen) => void; onSelectEmail: (id: string) => void; onSelectReview: (id: string) => void
  onSelectKeepReview: (id: string) => void
  onDeleteEmails: (ids: string[]) => void; onReply: (id: string) => void; onReplyAll: () => void
}) {
  const allEmails = useEmails()
  const [sectionQuery, setSectionQuery] = useState('')
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [matchReplyFilter, setMatchReplyFilter] = useState<MatchReplyFilter>('all')

  React.useEffect(() => { setSectionQuery(''); setMatchReplyFilter('all') }, [activeTab])
  React.useEffect(() => { if (!deleteMode) setSelectedForDelete(new Set()) }, [deleteMode])
  const effClass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification }

  const verified = allEmails.filter(e => verifiedEmails.has(e.id) && !deletedEmails.has(e.id))
  const reviewEmails = [
    ...verified.filter(e => effectiveResult(e, manualDecisions) === 'review'),
    ...allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'need-review' && !verifiedEmails.has(e.id) && !deletedEmails.has(e.id)),
  ].sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))

  const matchEmails = verified.filter(e => effectiveResult(e, manualDecisions) === 'match')
  const mismatchEmails = verified.filter(e => effectiveResult(e, manualDecisions) === 'mismatch').sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const allVerifEmails = [...verified, ...allEmails.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'need-review' && !verifiedEmails.has(e.id) && !deletedEmails.has(e.id))]
    .sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))

  // Match reply ordering: unreplied first (latest→oldest), then replied (latest→oldest)
  const unrepliedMatch = matchEmails.filter(e => !repliedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const repliedMatch   = matchEmails.filter(e =>  repliedEmails.has(e.id)).sort((a, b) => receivedSortKey(b.received) - receivedSortKey(a.received))
  const matchAllOrdered = [...unrepliedMatch, ...repliedMatch]

  let baseFiltered: Email[]
  if (activeTab === 'all')      baseFiltered = allVerifEmails
  else if (activeTab === 'match') {
    if (matchReplyFilter === 'reply')   baseFiltered = repliedMatch
    else if (matchReplyFilter === 'unreply') baseFiltered = unrepliedMatch
    else baseFiltered = matchAllOrdered
  }
  else if (activeTab === 'mismatch') baseFiltered = mismatchEmails
  else baseFiltered = reviewEmails

  const filtered = sectionQuery.trim() ? baseFiltered.filter(e => emailMatchesQuery(e, sectionQuery)) : baseFiltered

  const counts = {
    all: allVerifEmails.length,
    match: matchEmails.length,
    mismatch: mismatchEmails.length,
    review: reviewEmails.length,
  }

  const tabDefs: { id: VerifTab; label: string; active: string }[] = [
    { id: 'all',      label: 'All',      active: 'bg-[#111827] text-white border-[#111827]' },
    { id: 'match',    label: 'Match',    active: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]' },
    { id: 'mismatch', label: 'Mismatch', active: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]' },
    { id: 'review',   label: 'Review',   active: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]' },
  ]

  const sectionPlaceholders: Record<VerifTab, string> = {
    all: 'Search all verification emails...', match: 'Search matched emails...', mismatch: 'Search mismatched emails...', review: 'Search emails to review...',
  }

  function toggleSelect(id: string) {
    setSelectedForDelete(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function confirmDelete() {
    onDeleteEmails([...selectedForDelete]); setDeleteMode(false); setShowDeleteConfirm(false)
  }

  const deleteBtn = (
    <div className="flex items-center gap-2">
      {deleteMode && (
        <>
          <button onClick={() => setSelectedForDelete(new Set(filtered.map(e => e.id)))} className="btn-micro text-[12px] font-medium text-[#6B7280] border border-[#E8E6E1] bg-white hover:bg-[#F9F8F6] px-3 py-1.5 rounded-lg transition-colors">Select All</button>
          <button onClick={() => setDeleteMode(false)} className="btn-micro text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors px-2 py-1.5">Cancel</button>
        </>
      )}
      <button onClick={() => { if (deleteMode && selectedForDelete.size > 0) setShowDeleteConfirm(true); else setDeleteMode(true) }}
        className={`btn-micro flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${deleteMode ? 'bg-[#374151] text-white border-[#374151] hover:bg-[#111827]' : 'text-[#6B7280] bg-[#F3F4F6] border-[#E8E6E1] hover:bg-[#E8E6E1]'}`}>
        <TrashIcon />
        {deleteMode && selectedForDelete.size > 0 ? `Delete (${selectedForDelete.size})` : 'Delete'}
      </button>
    </div>
  )

  return (
    <div className="page-ambient flex-1 overflow-y-auto">
      {showDeleteConfirm && <DeleteConfirmModal count={selectedForDelete.size} onYes={confirmDelete} onNo={() => setShowDeleteConfirm(false)} />}
      <TopBar title="Verification" subtitle="Processed results" actions={deleteBtn} />
      <div className="px-8 py-7">

        {/* Tab bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {tabDefs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`btn-micro flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-medium transition-all ${activeTab === tab.id ? tab.active : 'bg-white border-[#E8E6E1] text-[#6B7280] hover:bg-[#F9F8F6]'}`}>
              {tab.label}
              <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${activeTab === tab.id ? 'bg-white/20' : 'bg-[#F3F4F6]'}`}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>

        {/* Match Reply/Unreply sub-filter */}
        {activeTab === 'match' && !deleteMode && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1.5">
              {(['all', 'unreply', 'reply'] as MatchReplyFilter[]).map(f => {
                const isActive = matchReplyFilter === f
                const label = f === 'all' ? 'All' : f === 'reply' ? 'Replied' : 'Unreplied'
                const cnt = f === 'all' ? matchEmails.length : f === 'reply' ? repliedMatch.length : unrepliedMatch.length
                return (
                  <button key={f} onClick={() => setMatchReplyFilter(f)}
                    className="btn-micro flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                    style={isActive ? { background: '#111827', color: '#FFF', boxShadow: '0 2px 6px rgba(0,0,0,0.16)', transform: 'scale(1.04)' } : { background: '#FFF', color: '#6B7280', border: '1px solid #E8E6E1' }}>
                    {label}
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>{cnt}</span>
                  </button>
                )
              })}
            </div>
            {unrepliedMatch.length > 0 && (
              <button onClick={onReplyAll} className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4.5l4-3v2c4.5.5 5.5 3.5 5.5 6-1.5-2.5-3-3-5.5-3v2L1 4.5z" stroke="#2563EB" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                Reply All
              </button>
            )}
          </div>
        )}

        <div className="mb-4">
          <SearchBar value={sectionQuery} onChange={setSectionQuery} placeholder={sectionPlaceholders[activeTab]} variant="section" />
        </div>

        {filtered.length === 0
          ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-12 text-center text-[13px] text-[#9CA3AF]">
              {sectionQuery.trim() ? `No emails found for "${sectionQuery}"` : activeTab === 'all' ? 'No verified documents yet.' : activeTab === 'match' ? 'No matched emails.' : activeTab === 'mismatch' ? 'No mismatches found.' : 'No documents requiring review.'}
            </div>
          : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
              <div className={`grid text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide px-6 py-3 border-b border-[#F0EEE9] bg-[#FAFAF9] ${deleteMode ? 'grid-cols-[32px_1fr_100px_140px_160px_110px_32px]' : 'grid-cols-[1fr_100px_140px_160px_110px_32px]'}`}>
                {deleteMode && <span />}
                <span>Document</span><span>Type</span><span>Received</span><span>Result</span><span>Auto Reply</span><span />
              </div>
              {filtered.map((email, i) => {
                const eff = effectiveResult(email, manualDecisions)
                const disp: DocResult = eff === 'resend' ? email.docResult : eff as DocResult
                const reason = getReviewReason(email)
                const isClassifyReviewOnly = email.classification === 'need-review' && !verifiedEmails.has(email.id)
                const isSelected = selectedForDelete.has(email.id)
                const isMatch = eff === 'match'
                const isReplied = repliedEmails.has(email.id)

                return (
                  <div key={email.id}
                    onClick={() => {
                      if (deleteMode) { toggleSelect(email.id); return }
                      const isKeepReview = manualDecisions.get(email.id) === 'keep-review'
                      if (isClassifyReviewOnly) { onSelectReview(email.id); setScreen('manual-review') }
                      else if (isKeepReview) { onSelectKeepReview(email.id); setScreen('manual-review') }
                      else { onSelectEmail(email.id); setScreen('verification-detail') }
                    }}
                    className={`email-row-micro w-full grid items-center px-6 py-4 cursor-pointer group transition-all ${
                      deleteMode ? 'grid-cols-[32px_1fr_100px_140px_160px_110px_32px]' : 'grid-cols-[1fr_100px_140px_160px_110px_32px]'
                    } ${i < filtered.length - 1 ? 'border-b border-[#F0EEE9]' : ''} ${isSelected ? 'bg-[#EFF6FF]' : ''} ${isReplied && isMatch ? 'opacity-60' : ''}`}>
                    {deleteMode && (
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'border-[#2563EB] bg-[#2563EB]' : 'border-[#D1D5DB]'}`}>
                        {isSelected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </span>
                    )}
                    <div className="min-w-0 pr-4 flex items-start gap-2">
                      {isReplied && isMatch && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5 text-[#16A34A]"><path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
                        {reason
                          ? <div className="text-[11.5px] text-[#D97706] mt-0.5">{reason}</div>
                          : <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{getVerifSummary(email)}</div>
                        }
                        {disp === 'review' && email.reviewDetail && (
                          <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{email.reviewDetail}</div>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded self-start mt-0.5">{email.docType}</span>
                    <span className="text-[12px] text-[#9CA3AF]">{email.received}</span>
                    <div className="flex items-center gap-2 justify-end">
                      {isMatch && !isReplied && !deleteMode && (
                        <button onClick={e => { e.stopPropagation(); onReply(email.id) }}
                          className="btn-micro flex items-center gap-1 text-[11px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-2 py-1 rounded-lg transition-colors flex-shrink-0">
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 3.5l3-2v1.5c3.5.4 4.5 2.5 4.5 5C7 6.5 5.5 6 4 6v1.5L1 3.5z" stroke="#2563EB" strokeWidth="1.1" strokeLinejoin="round" /></svg>
                          Reply
                        </button>
                      )}
                      <Badge result={disp} />
                    </div>
                    <span className="text-[11.5px] text-[#9CA3AF]">
                      {email.autoReply?.action === 'SENT'
                        ? <span className="inline-flex items-center gap-1 text-[#16A34A] font-medium">
                            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Sent
                          </span>
                        : email.autoReply?.action === 'PREVIEW_ONLY'
                          ? 'Preview'
                          : email.autoReply?.action === 'ERROR'
                            ? <span className="text-[#DC2626]">Error</span>
                            : email.autoReply?.action === 'REVIEW_REQUIRED'
                              ? 'Review'
                              : '—'}
                    </span>
                    <span className="text-[#D1D5DB] group-hover:text-[#2563EB] transition-colors justify-self-end"><Chevron /></span>
                  </div>
                )
              })}
            </div>
        }
      </div>
    </div>
  )
}

// ─── Verification Detail ──────────────────────────────────────────────────────

function VerificationDetailScreen({ emailId, manualDecisions, reclassifications, setScreen, onFlagReview, onDecision, setActiveNav, setVerifTab }: {
  emailId: string | null; manualDecisions: Map<string, ManualDecision>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  setScreen: (s: Screen) => void; onFlagReview: (id: string) => void
  onDecision: (id: string, d: ManualDecision) => void
  setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
}) {
  const allEmails = useEmails()
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null

  const effClassification = (reclassifications.get(email.id) ?? { classification: email.classification }).classification
  const eff = effectiveResult(email, manualDecisions)
  const decision = manualDecisions.get(email.id)
  const disp: DocResult = eff === 'resend' ? email.docResult : eff as DocResult

  // No-attachment BL comparison: email reclassified as BL check but has no fields to compare
  const isNoAttachment = effClassification === 'check' && email.fields.length === 0

  if (isNoAttachment) {
    return (
      <div className="flex-1 overflow-y-auto">
        <TopBar title="Verification Result" subtitle={email.received} />
        <div className="px-8 py-7 max-w-[860px]">
          <BackBtn onClick={() => setScreen('verification')} label="Back to Verification" />
          <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden mb-5">
            <div className="px-7 py-6 border-b border-[#F0EEE9]">
              <h2 className="text-[17px] font-semibold text-[#111827] mb-1">{email.subject}</h2>
              <div className="text-[12px] text-[#9CA3AF]">{email.senderName} · {email.received}</div>
            </div>
            <div className="px-7 py-6 bg-[#FEF9F9] border-b border-[#F0EEE9]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7.5" stroke="#DC2626" strokeWidth="1.4" /><path d="M9 5.5v4M9 11.5v1" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-[#DC2626] mb-1">System Unable to Verify</div>
                  <div className="text-[14px] font-semibold text-[#111827] mb-1">No attachment to verify</div>
                  <p className="text-[13px] text-[#6B7280] leading-[1.6]">The system could not locate a verifiable SI and BL attachment for this email. This may occur when both documents are combined into a single file that the AI could not parse, or when no attachment is present.</p>
                </div>
              </div>
            </div>
            <div className="px-7 py-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-3">Manual Action Required</div>
              <p className="text-[12.5px] text-[#6B7280] mb-5 leading-[1.6]">Please manually inspect the attachment and choose one of the following actions based on your review:</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => { onDecision(email.id, 'resend'); setActiveNav('resend'); setScreen('resend') }}
                  className="btn-micro flex items-center gap-2 border border-[#E8E6E1] bg-[#F9F8F6] hover:bg-[#F3F4F6] text-[#374151] text-[13px] font-medium px-4 py-2.5 rounded-lg transition-colors">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 6.5h9M7 3.5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Resend
                </button>
                <button onClick={() => { onDecision(email.id, 'keep-review'); setVerifTab('review'); setActiveNav('verification'); setScreen('verification') }}
                  className="btn-micro flex items-center gap-2 border border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7] text-[#D97706] text-[13px] font-medium px-4 py-2.5 rounded-lg transition-colors">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 4v3M6.5 9v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  Keep Review
                </button>
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-3 leading-[1.5]">No attachment is present, so manual Match is not available. Use Keep Review to revisit later.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

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
          <div className={`mb-5 flex items-center gap-3 px-5 py-3.5 rounded-xl border text-[13px] font-medium ${decision === 'match' ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]' : 'bg-[#F3F4F6] border-[#E8E6E1] text-[#6B7280]'}`}>
            Manual review complete · {decision === 'match' ? 'Marked as Match' : 'Marked for Resend'}
          </div>
        )}
        {decision === 'keep-review' && (
          <div className="mb-5 flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-[#FFFBEB] border-[#FDE68A] text-[13px] font-medium text-[#D97706]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#D97706" strokeWidth="1.3" /><path d="M7 4.5v3M7 9.5v.5" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" /></svg>
            Previously kept in Review — still requires human attention
          </div>
        )}
        <VerdictBanner email={email} />
        <div className="bg-white border border-[#E8E6E1] rounded-xl px-7 py-6 mb-5 flex items-center gap-5">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${disp === 'match' ? 'bg-[#F0FDF4] border border-[#BBF7D0]' : disp === 'mismatch' ? 'bg-[#FEF2F2] border border-[#FECACA]' : 'bg-[#FFFBEB] border border-[#FDE68A]'}`}>
            {disp === 'match'    && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 10l4.5 4.5 8.5-8.5" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            {disp === 'mismatch' && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 6v6M10 14v1" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            {disp === 'review'   && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 6v6M10 14v1" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round" /></svg>}
          </div>
          <div className="flex-1">
            <div className="text-[17px] font-semibold text-[#111827] tracking-[-0.01em] mb-0.5">{email.subject}</div>
            <div className="text-[13px] text-[#6B7280]">{getVerifSummary(email)}</div>
            {reason && <div className="mt-0.5 text-[12px] text-[#D97706]">Reason: {reason}</div>}
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
              className="btn-micro flex items-center gap-2 bg-[#D97706] hover:bg-[#B45309] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
              Flag for Review
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v7H2z" stroke="white" strokeWidth="1.3" strokeLinejoin="round" /><path d="M2 9v3" stroke="white" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Attachment preview ───────────────────────────────────────────────────────
// Shows the SI / BL file exactly as it arrived (Original tab) and what the
// pipeline read from it (Extracted text tab). Nothing has to be downloaded.

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp'])

const ATTACHMENT_CARDS: { role: AttachmentRole; label: string }[] = [
  { role: 'SI', label: 'Shipping Instruction' },
  { role: 'BL', label: 'Bill of Lading' },
]

// Loads something once per key and reports loading / error / value.
function useLoaded<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: '' })

  useEffect(() => {
    let cancelled = false
    load()
      .then(value => { if (!cancelled) setState({ key, value }) })
      .catch(err => { if (!cancelled) setState({ key, error: err instanceof Error ? err.message : 'Could not load the preview.' }) })
    return () => { cancelled = true }
    // `key` identifies the file, so `load` only needs to run when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const done = state.key === key
  return { loading: !done, value: done ? state.value : undefined, error: done ? state.error : undefined }
}

function PreviewMessage({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div className={`h-full min-h-[160px] flex items-center justify-center px-6 text-center text-[13px] ${tone === 'error' ? 'text-[#DC2626]' : 'text-[#9CA3AF]'}`}>
      {children}
    </div>
  )
}

function TextOriginal({ emailId, role }: { emailId: string; role: AttachmentRole }) {
  const { loading, value, error } = useLoaded(`${emailId}/${role}`, () => fetchAttachmentPlainText(emailId, role))
  if (loading) return <PreviewMessage>Loading…</PreviewMessage>
  if (error) return <PreviewMessage tone="error">{error}</PreviewMessage>
  return <pre className="px-6 py-5 text-[12.5px] leading-[1.6] text-[#111827] font-mono whitespace-pre-wrap break-words">{value}</pre>
}

function SheetOriginal({ emailId, role }: { emailId: string; role: AttachmentRole }) {
  const { loading, value, error } = useLoaded<ApiSheet[]>(`${emailId}/${role}`, () => fetchAttachmentSheets(emailId, role))
  if (loading) return <PreviewMessage>Loading…</PreviewMessage>
  if (error) return <PreviewMessage tone="error">{error}</PreviewMessage>
  if (!value || value.length === 0) return <PreviewMessage>This Excel file has no sheets.</PreviewMessage>
  return (
    <div className="px-6 py-5 space-y-6">
      {value.map(sheet => (
        <div key={sheet.name}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-2">Sheet · {sheet.name}</div>
          {sheet.rows.length === 0
            ? <div className="text-[12px] text-[#9CA3AF]">This sheet is empty.</div>
            : (
              <div className="overflow-x-auto border border-[#E8E6E1] rounded-lg">
                <table className="text-[12px] text-[#374151] border-collapse w-full">
                  <tbody>
                    {sheet.rows.map((row, r) => (
                      <tr key={r} className="border-b border-[#F0EEE9] last:border-b-0">
                        {row.map((cell, c) => <td key={c} className="px-3 py-1.5 border-r border-[#F0EEE9] last:border-r-0 align-top whitespace-pre-wrap">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {sheet.truncated && <div className="mt-2 text-[11.5px] text-[#9CA3AF]">Only the first rows are shown. Download the original to see the rest.</div>}
        </div>
      ))}
    </div>
  )
}

function DocxOriginal({ emailId, role }: { emailId: string; role: AttachmentRole }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ done: boolean; error?: string }>({ done: false })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // The renderer is only loaded when a Word file is opened.
        const [bytes, { renderAsync }] = await Promise.all([fetchAttachmentBytes(emailId, role), import('docx-preview')])
        if (cancelled || !host.current) return
        host.current.innerHTML = ''
        await renderAsync(bytes, host.current)
        if (!cancelled) setStatus({ done: true })
      } catch (err) {
        if (!cancelled) setStatus({ done: true, error: err instanceof Error ? err.message : 'This Word file could not be displayed.' })
      }
    })()
    return () => { cancelled = true }
  }, [emailId, role])

  return (
    <>
      {!status.done && <PreviewMessage>Loading…</PreviewMessage>}
      {status.error && <PreviewMessage tone="error">{status.error} Try the Extracted text tab.</PreviewMessage>}
      <div ref={host} className={status.error ? 'hidden' : ''} />
    </>
  )
}

function ExtractedText({ emailId, role }: { emailId: string; role: AttachmentRole }) {
  const { loading, value, error } = useLoaded(`${emailId}/${role}`, () => fetchAttachmentText(emailId, role))
  if (loading) return <PreviewMessage>Loading…</PreviewMessage>
  if (error) return <PreviewMessage tone="error">{error}</PreviewMessage>
  if (!value) return null
  if (value.unreadable) return <PreviewMessage>The system could not read any text from this file.</PreviewMessage>
  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-2 mb-3 text-[11.5px] text-[#9CA3AF]">
        What the system read from this file
        {value.ocr && <span className="px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#D97706] font-medium">Read with OCR — may contain errors</span>}
      </div>
      <pre className="text-[12.5px] leading-[1.6] text-[#111827] font-mono whitespace-pre-wrap break-words">{value.text}</pre>
    </div>
  )
}

function OriginalView({ emailId, role, extension }: { emailId: string; role: AttachmentRole; extension: string }) {
  if (extension === 'pdf') {
    return <iframe title={`${role} attachment`} src={attachmentFileUrl(emailId, role)} className="w-full h-full min-h-[60vh] border-0" />
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return <div className="p-6"><img alt={`${role} attachment`} src={attachmentFileUrl(emailId, role)} className="max-w-full mx-auto" /></div>
  }
  if (extension === 'txt') return <TextOriginal emailId={emailId} role={role} />
  if (extension === 'xlsx' || extension === 'xlsm') return <SheetOriginal emailId={emailId} role={role} />
  if (extension === 'docx') return <DocxOriginal emailId={emailId} role={role} />
  return <PreviewMessage>This file type cannot be shown in the page. Use Download original, or the Extracted text tab.</PreviewMessage>
}

function AttachmentPreview({ emailId, role, label, file, onClose }: {
  emailId: string; role: AttachmentRole; label: string
  file: { filename: string; extension: string }; onClose: () => void
}) {
  const [tab, setTab] = useState<'original' | 'text'>('original')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${label} preview`}
        className="bg-white rounded-xl shadow-xl w-full max-w-[920px] h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#F0EEE9] flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</div>
            <div className="text-[13px] font-medium text-[#111827] truncate">{file.filename}</div>
          </div>
          <a href={attachmentFileUrl(emailId, role, true)}
            className="text-[12px] text-[#2563EB] font-medium hover:underline flex-shrink-0">Download original</a>
          <button onClick={onClose} autoFocus aria-label="Close preview"
            className="w-7 h-7 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center justify-center flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="px-6 border-b border-[#F0EEE9] flex gap-5">
          {([['original', 'Original'], ['text', 'Extracted text']] as const).map(([id, name]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`py-2.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors ${tab === id ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#9CA3AF] hover:text-[#374151]'}`}>
              {name}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto bg-white">
          {tab === 'original'
            ? <OriginalView emailId={emailId} role={role} extension={file.extension} />
            : <ExtractedText emailId={emailId} role={role} />}
        </div>
      </div>
    </div>
  )
}

// ─── Manual Review Workspace ──────────────────────────────────────────────────

type ClassifyStep = 'main' | 'pick-type' | 'other-category' | 'bl-action'

function ManualReviewScreen({ emailId, setScreen, backTo, reviewMode = 'classify', onClassifyOther, onClassifyBL }: {
  emailId: string | null; setScreen: (s: Screen) => void; backTo?: Screen
  reviewMode?: ReviewMode
  onClassifyOther?: (id: string, category: string) => void
  onClassifyBL?: (id: string, verifyNow: boolean) => void
}) {
  const allEmails = useEmails()
  const [classifyStep, setClassifyStep] = useState<ClassifyStep>('main')
  const [selectedOtherCat, setSelectedOtherCat] = useState<string | null>(null)
  const [previewRole, setPreviewRole] = useState<AttachmentRole | null>(null)

  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null
  const isClassifyReview = reviewMode === 'classify'
  const reason = getReviewReason(email)
  const problemFields = email.fields.filter(f => f.result !== 'match')
  const resolvedBackTo = backTo ?? (isClassifyReview ? 'inbox' : 'verification-detail')
  const previewFile = previewRole ? email.attachments?.[previewRole] : undefined

  // ── Direct-verify mode ──────────────────────────────────────────────────────
  if (reviewMode === 'direct-verify') {
    const hasAttachment = email.fields.length > 0
    return (
      <div className="flex-1 overflow-y-auto">
        <TopBar title="Manual Review" subtitle="Inspect attachment and decide" />
        <div className="px-8 py-7 max-w-[860px]">
          <BackBtn onClick={() => setScreen(resolvedBackTo)} label="Back" />
          <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden mb-6">
            <div className="px-5 py-3.5 border-b border-[#F0EEE9] bg-[#FAFAF9]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Email Under Review</div>
            </div>
            <div className="px-6 py-5">
              <div className="mb-4"><div className="text-[17px] font-semibold text-[#111827] mb-1">{email.subject}</div><div className="text-[12px] text-[#9CA3AF]">{email.senderName} · {email.sender} · {email.received}</div></div>
              <div className="mt-5 pt-5 border-t border-[#F0EEE9]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-3">Attachment</div>
                {hasAttachment ? (
                  <div className="border border-[#E8E6E1] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F0EEE9] hover:bg-[#FAFAF9] cursor-pointer">
                      <div className="w-8 h-8 rounded-md bg-[#EFF6FF] flex items-center justify-center text-[9px] font-bold text-[#2563EB]">SI</div>
                      <div className="flex-1"><div className="text-[12px] font-medium text-[#111827]">Shipping_Instruction_{email.id}.pdf</div><div className="text-[11px] text-[#9CA3AF]">Contains SI · 184 KB · PDF</div></div>
                      <button className="btn-micro text-[11px] text-[#2563EB] border border-[#BFDBFE] px-2 py-1 rounded-lg hover:bg-[#EFF6FF] transition-colors">Open</button>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAF9] cursor-pointer">
                      <div className="w-8 h-8 rounded-md bg-[#EFF6FF] flex items-center justify-center text-[9px] font-bold text-[#2563EB]">BL</div>
                      <div className="flex-1"><div className="text-[12px] font-medium text-[#111827]">Bill_of_Lading_{email.id}.pdf</div><div className="text-[11px] text-[#9CA3AF]">Contains BL · 211 KB · PDF</div></div>
                      <button className="btn-micro text-[11px] text-[#2563EB] border border-[#BFDBFE] px-2 py-1 rounded-lg hover:bg-[#EFF6FF] transition-colors">Open</button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-[#E8E6E1] rounded-xl px-5 py-5 flex items-center gap-3 bg-[#FAFAF9]">
                    <div className="w-8 h-8 rounded-full bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.5 10.5h9" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    </div>
                    <div><div className="text-[13px] font-medium text-[#374151]">No attachment to verify</div><div className="text-[11.5px] text-[#9CA3AF] mt-0.5">No verifiable attachment was found for this email.</div></div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setScreen('final-decision')}
              className="btn-micro flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-6 py-2.5 rounded-lg transition-colors">
              Done Review
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Manual Review Workspace" subtitle={reason} />
      {previewRole && previewFile && (
        <AttachmentPreview key={previewRole} emailId={email.id} role={previewRole} file={previewFile}
          label={ATTACHMENT_CARDS.find(c => c.role === previewRole)?.label ?? previewRole}
          onClose={() => setPreviewRole(null)} />
      )}
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
                <p className="mb-2">The attached documents and email content do not match any known classification pattern.</p>
                <p>Please manually inspect this email and determine the appropriate workflow.</p>
              </div>
              {/* Unified attachment panel */}
              <div className="mt-5 pt-5 border-t border-[#F0EEE9]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-3">Attachment</div>
                <div className="border border-[#E8E6E1] rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAF9] cursor-pointer border-b border-[#F0EEE9] last:border-b-0">
                    <div className="w-8 h-8 rounded-md bg-[#F3F4F6] flex items-center justify-center text-[10px] font-bold text-[#6B7280]">?</div>
                    <div className="flex-1">
                      <div className="text-[12px] font-medium text-[#111827]">Attachment_{email.id}.pdf</div>
                      <div className="text-[11px] text-[#9CA3AF]">Unknown type · PDF</div>
                    </div>
                    <button className="btn-micro text-[11px] text-[#2563EB] border border-[#BFDBFE] px-2 py-1 rounded-lg hover:bg-[#EFF6FF] transition-colors">Open</button>
                  </div>
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
                    <p className="whitespace-pre-wrap break-words">{email.body || 'This email has no message text.'}</p>
                  </div>
                </div>
              </div>
              {/* Unified attachment panel — Figma (3) layout, wired to real files */}
              <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#F0EEE9] bg-[#FAFAF9] flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Attachment</div>
                </div>
                <div className="px-5 py-4">
                  <div className="border border-[#E8E6E1] rounded-xl overflow-hidden mb-3">
                    {ATTACHMENT_CARDS.map((doc, index) => {
                      const file = email.attachments?.[doc.role]
                      const subtitle = file
                        ? `${doc.label} · ${file.extension.toUpperCase()}`
                        : email.attachments === undefined
                          ? 'Files are not kept for live checks'
                          : `No ${doc.role} attachment in this email`
                      return (
                        <div key={doc.role}
                          className={`flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAF9] ${index < ATTACHMENT_CARDS.length - 1 ? 'border-b border-[#F0EEE9]' : ''} ${file ? 'cursor-pointer' : ''}`}
                          onClick={() => { if (file) setPreviewRole(doc.role) }}>
                          <div className="w-8 h-8 rounded-md bg-[#EFF6FF] flex items-center justify-center text-[9px] font-bold text-[#2563EB]">{doc.role}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium text-[#111827] truncate">{file?.filename ?? doc.label}</div>
                            <div className="text-[11px] text-[#9CA3AF]">{subtitle}</div>
                          </div>
                          <button disabled={!file} onClick={e => { e.stopPropagation(); if (file) setPreviewRole(doc.role) }}
                            className={`btn-micro text-[11px] border px-2 py-1 rounded-lg transition-colors ${file ? 'text-[#2563EB] border-[#BFDBFE] hover:bg-[#EFF6FF]' : 'text-[#9CA3AF] border-[#E8E6E1] cursor-default'}`}>Open</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
            {problemFields.length > 0 && (
              <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-[#F0EEE9] bg-[#FAFAF9]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Fields Requiring Attention · Fail to Compare SI and BL</div>
                </div>
                <div className="divide-y divide-[#F0EEE9]">
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
              </div>
            )}
          </>
        )}

        {isClassifyReview ? (
          <>
            {classifyStep === 'main' && (
              <div className="flex justify-end">
                <button onClick={() => setClassifyStep('pick-type')}
                  className="btn-micro flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-6 py-2.5 rounded-lg transition-colors">
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
                    <button key={opt.label} onClick={() => setClassifyStep(opt.label === 'Other' ? 'other-category' : 'bl-action')}
                      className="btn-micro w-full flex items-start gap-4 p-4 rounded-xl border border-[#E8E6E1] text-left hover:border-[#2563EB] hover:bg-[#F5F7FF] transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors">
                        {opt.label === 'Other'
                          ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="#6B7280" strokeWidth="1.3" /></svg>
                          : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 4h11v7.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4z" stroke="#6B7280" strokeWidth="1.3" /><path d="M1.5 4l5.5 4.5L12.5 4" stroke="#6B7280" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                        }
                      </div>
                      <div><div className="text-[13.5px] font-semibold text-[#111827] mb-0.5">{opt.label}</div><div className="text-[12px] text-[#6B7280]">{opt.desc}</div></div>
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
                  {(['Spam', 'Invoice Query', 'SI Request', 'General'] as const).map(cat => (
                    <button key={cat} onClick={() => setSelectedOtherCat(cat)}
                      className={`btn-micro w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-[13px] transition-all ${selectedOtherCat === cat ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E8E6E1] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9F8F6]'}`}>
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedOtherCat === cat ? 'border-[#2563EB]' : 'border-[#D1D5DB]'}`}>
                        {selectedOtherCat === cat && <span className="w-2 h-2 rounded-full bg-[#2563EB]" />}
                      </span>
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <button onClick={() => { setClassifyStep('pick-type'); setSelectedOtherCat(null) }} className="text-[12px] text-[#9CA3AF] hover:text-[#374151] transition-colors">← Back</button>
                  <button disabled={!selectedOtherCat} onClick={() => selectedOtherCat && onClassifyOther?.(email.id, selectedOtherCat)}
                    className="btn-micro flex items-center gap-2 bg-[#111827] disabled:opacity-40 hover:bg-[#374151] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
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
                    { action: 'now', label: 'Verify Now', desc: 'Immediately attempt SI vs BL verification on this email.' },
                    { action: 'queue', label: 'Put into BL Comparison', desc: 'Queue this email for verification later via Inbox → BL Comparison.' },
                  ].map(opt => (
                    <button key={opt.action} onClick={() => onClassifyBL?.(email.id, opt.action === 'now')}
                      className="btn-micro w-full flex items-start gap-4 p-4 rounded-xl border border-[#E8E6E1] text-left hover:border-[#16A34A] hover:bg-[#F0FDF4] transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] group-hover:bg-[#DCFCE7] flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors">
                        {opt.action === 'now'
                          ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-5.5" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h9M8 4l3 3-3 3" stroke="#6B7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </div>
                      <div><div className="text-[13.5px] font-semibold text-[#111827] mb-0.5">{opt.label}</div><div className="text-[12px] text-[#6B7280]">{opt.desc}</div></div>
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
              className="btn-micro flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-6 py-2.5 rounded-lg transition-colors">
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

function FinalDecisionScreen({ emailId, setScreen, setActiveNav, setVerifTab, onDecision, reviewMode = 'flag-review' }: {
  emailId: string | null; setScreen: (s: Screen) => void
  setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
  onDecision: (id: string, d: ManualDecision) => void; reviewMode?: ReviewMode
}) {
  const allEmails = useEmails()
  const email = emailId ? allEmails.find(e => e.id === emailId) : null
  if (!email) return null

  function decide(d: ManualDecision) {
    onDecision(email!.id, d)
    if (d === 'match') { setVerifTab('match'); setActiveNav('verification'); setScreen('verification') }
    else if (d === 'resend') { setActiveNav('resend'); setScreen('resend') }
    else { setVerifTab('review'); setActiveNav('verification'); setScreen('verification') }
  }

  const hasAttachment = email.fields.length > 0
  const showMatch = reviewMode !== 'direct-verify' || hasAttachment

  const allOptions: { decision: ManualDecision; label: string; desc: string; style: string }[] = [
    { decision: 'match',       label: 'Match',          desc: 'You have manually verified and confirmed SI and BL information matches.', style: 'border-[#BBF7D0] text-[#16A34A] bg-[#F0FDF4] hover:bg-[#DCFCE7]' },
    { decision: 'resend',      label: 'Resend',         desc: 'The email/document needs correction and should be sent back for revision.',  style: 'border-[#E8E6E1] text-[#111827] hover:border-[#D1D5DB] hover:bg-[#F9F8F6]' },
    { decision: 'keep-review', label: 'Keep as Review', desc: 'You cannot confidently resolve this case. It remains in the Review queue.', style: 'border-[#FDE68A] text-[#D97706] bg-[#FFFBEB] hover:bg-[#FEF3C7]' },
  ]
  const options = showMatch ? allOptions : allOptions.filter(o => o.decision !== 'match')

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
              className={`btn-micro w-full flex items-start gap-4 p-5 rounded-xl border text-left transition-all ${opt.style}`}>
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

function fallbackResendDraft(email: Email) {
  const mismatches = email.fields.filter(f => f.result === 'mismatch')
  const issueLines = mismatches.length > 0
    ? mismatches.map(f => `- ${f.field}: SI = ${f.si || '(blank)'}; BL = ${f.bl || '(blank)'}`).join('\n')
    : '- Please review the SI and draft BL details.'

  return {
    recipient: email.sender,
    subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
    body: [
      'Dear Client,',
      '',
      'Thank you for your submission. During verification, we identified differences that require your attention.',
      '',
      'The following item(s) do not match between the SI and the draft BL:',
      issueLines,
      '',
      'Please review the information and provide the corrected details or documents.',
      '',
      'Best regards,',
      'SmartDoc Verification Team',
    ].join('\n'),
  }
}

function gmailComposeUrl(email: Email): string {
  const backendDraft = email.autoReply?.action === 'REVIEW_REQUIRED' ? email.autoReply : undefined
  const fallback = fallbackResendDraft(email)
  const recipient = backendDraft?.recipient || fallback.recipient
  const subject = backendDraft?.subject || fallback.subject
  const body = backendDraft?.body || fallback.body

  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: recipient,
    su: subject,
    body,
  })

  return `https://mail.google.com/mail/?${params.toString()}`
}

function ResendScreen({ manualDecisions, resentEmails, deletedEmails, setScreen, onSelectEmail, onResend }: {
  manualDecisions: Map<string, ManualDecision>; resentEmails: Set<string>; deletedEmails: Set<string>
  setScreen: (s: Screen) => void; onSelectEmail: (id: string) => void; onResend: (id: string) => void
}) {
  const allEmails = useEmails()
  const [query, setQuery] = useState('')
  const resendEmails = allEmails.filter(e => manualDecisions.get(e.id) === 'resend' && !resentEmails.has(e.id) && !deletedEmails.has(e.id))
  const listEmails = query.trim() ? resendEmails.filter(e => emailMatchesQuery(e, query)) : resendEmails

  return (
    <div className="page-ambient flex-1 overflow-y-auto">
      <TopBar title="Resend" subtitle="Emails requiring correction" />
      <div className="px-8 py-7">
        <div className="bg-white border border-[#E8E6E1] rounded-xl px-7 py-6 mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-2">Resend Queue</div>
          <div className="text-[32px] font-bold text-[#111827] tracking-[-0.04em] leading-none mb-1">{resendEmails.length}</div>
          <div className="text-[13px] text-[#6B7280]">{resendEmails.length === 0 ? 'No emails in the resend queue' : `email${resendEmails.length > 1 ? 's' : ''} manually reviewed and marked for correction`}</div>
        </div>
        {resendEmails.length > 0 && (
          <div className="mb-5">
            <SearchBar value={query} onChange={setQuery} placeholder="Search emails, shipment ID, sender..." variant="global" />
          </div>
        )}
        {resendEmails.length === 0
          ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-12 text-center">
              <div className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9h12M10 5l4 4-4 4" stroke="#9CA3AF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="text-[14px] font-medium text-[#111827] mb-1">Resend queue is empty</div>
              <div className="text-[13px] text-[#9CA3AF]">Emails marked for resend after manual review will appear here.</div>
            </div>
          : listEmails.length === 0
            ? <div className="bg-white border border-[#E8E6E1] rounded-xl p-12 text-center text-[13px] text-[#9CA3AF]">No emails found for "{query}"</div>
            : <div className="space-y-4">
                {listEmails.map(email => {
                  const pf = email.fields.find(f => f.result !== 'match')
                  return (
                    <div key={email.id} className="email-card-micro bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
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
                        <button onClick={() => { onSelectEmail(email.id); setScreen('verification-detail') }} className="btn-micro text-[12.5px] text-[#6B7280] border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3.5 py-1.5 rounded-lg font-medium">Open Email</button>
                        <button onClick={() => { onSelectEmail(email.id); setScreen('manual-review') }} className="btn-micro text-[12.5px] text-[#6B7280] border border-[#E8E6E1] hover:bg-[#F9F8F6] px-3.5 py-1.5 rounded-lg font-medium">View Documents</button>
                        <button onClick={() => {
                          window.open(gmailComposeUrl(email), '_blank', 'noopener,noreferrer')
                          onResend(email.id)
                        }} className="btn-micro ml-auto flex items-center gap-2 bg-[#111827] hover:bg-[#374151] text-white text-[12.5px] font-medium px-4 py-1.5 rounded-lg transition-colors">
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

// ─── Live check (calls the backend API) ───────────────────────────────────────

const REVIEW_REASONS: Record<string, string> = {
  missing_attachment: 'An SI or BL attachment is missing.',
  unreadable: 'One of the documents could not be read, for example a scanned image.',
  wrong_doc_type: 'One of the attachments is not the expected document type.',
  missing_value: 'A required field is missing or blank in one of the documents.',
}

const CATEGORY_LABELS: Record<string, string> = {
  SI_REQUEST: 'SI Request',
  INVOICE_QUERY: 'Invoice Query',
  GENERAL: 'General',
  SPAM: 'Spam',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "21 Sep, 3:32 PM", the format receivedSortKey understands.
function formatReceived(date: Date): string {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

function docResultFor(status: ApiResult['status']): DocResult {
  return status === 'OK' ? 'match' : status === 'MISMATCH' ? 'mismatch' : 'review'
}

function reviewDetailFor(reason: string | null): string | undefined {
  return reason ? REVIEW_REASONS[reason] ?? reason : undefined
}

function labelFields(fields: ApiResult['fields']): VerifField[] {
  return fields.map(f => ({ ...f, field: FIELD_LABELS[f.field] ?? f.field }))
}

// A live check result in the shape the result components read. It stays on
// the Live check page unless the employee chooses Save to Verification.
function toEmail(result: ApiResult, subject: string, sender: string, body: string): Email {
  return {
    id: result.email_id,
    subject,
    senderName: sender || 'Live upload',
    sender: sender || '',
    received: formatReceived(new Date()),
    docType: 'SI + BL',
    docResult: docResultFor(result.status),
    reviewDetail: reviewDetailFor(result.review_reason),
    classification: 'check',
    classifyType: 'BL Comparison',
    body,
    fields: labelFields(result.fields),
    autoReply: result.auto_reply,
  }
}

// A sample-inbox email from GET /api/emails.
function fromRecord(record: ApiEmailRecord): Email {
  const isBL = record.category === 'BL_COMPARISON'

  return {
    id: record.id,
    subject: record.subject,
    senderName: record.senderName,
    sender: record.sender,
    received: record.received,
    docType: record.docType,
    docResult: docResultFor(record.status),
    reviewDetail: reviewDetailFor(record.reviewReason),
    classification: isBL ? 'check' : 'ignore',
    classifyType: isBL ? 'BL Comparison' : CATEGORY_LABELS[record.category] ?? record.docType,
    body: record.body,
    fields: labelFields(record.fields),
    attachments: record.attachments ?? {},
  }
}

// Live checks the employee chose to save are kept in this browser's
// localStorage. There is no database: they are private to this browser and are
// lost if the user clears site data. The uploaded files are never kept.
const LIVE_STORAGE_KEY = 'smartdoc.liveChecks'
const LIVE_STORAGE_LIMIT = 50

function loadLiveEmails(): Email[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIVE_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(e => e && typeof e.id === 'string' && Array.isArray(e.fields))
  } catch {
    return []
  }
}

// Returns false when the browser refuses (storage full or blocked).
function saveLiveEmail(email: Email): boolean {
  try {
    const saved = [email, ...loadLiveEmails()].slice(0, LIVE_STORAGE_LIMIT)
    window.localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div>
      <span className="block text-[12px] font-medium text-[#374151] mb-1.5">{label}</span>
      <label className="flex items-center gap-3 bg-white border border-dashed border-[#D1D5DB] hover:border-[#2563EB] rounded-lg px-4 py-3 cursor-pointer transition-colors">
        <input type="file" className="hidden" accept=".txt,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.tif,.tiff,.bmp"
          onChange={e => onChange(e.target.files?.[0] ?? null)} />
        <span className="text-[12px] font-medium text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-1.5 rounded-md flex-shrink-0">Choose file</span>
        <span className={`text-[12.5px] truncate ${file ? 'text-[#111827]' : 'text-[#9CA3AF]'}`}>{file ? file.name : 'No file selected'}</span>
      </label>
    </div>
  )
}

// A check is shown here first. Nothing is kept unless the employee chooses
// Save to Verification (browser only); Run next test starts over.
function LiveCheckScreen({ onSave, onView }: {
  onSave: (email: Email) => boolean
  onView: (id: string, tab: VerifTab) => void
}) {
  const [si, setSi] = useState<File | null>(null)
  const [bl, setBl] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Email | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Changing the key on the pickers clears their hidden file inputs too, so the
  // same file can be chosen again for the next test.
  const [resetKey, setResetKey] = useState(0)

  async function submit() {
    if (!si || !bl) return
    setLoading(true)
    setSlow(false)
    setError(null)
    setResult(null)
    setSaved(false)
    setSaveError(null)
    // Free hosting sleeps when idle, so the first request can take a while.
    const timer = setTimeout(() => setSlow(true), 6000)

    try {
      const liveSubject = `${si.name} vs ${bl.name}`
      const liveBody = `Uploaded on the Live check page.\nShipping Instruction: ${si.name}\nBill of Lading: ${bl.name}`

      setResult(toEmail(
        await checkDocuments({ subject: liveSubject, body: liveBody, sender: '', si, bl }),
        liveSubject,
        '',
        liveBody,
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      clearTimeout(timer)
      setLoading(false)
      setSlow(false)
    }
  }

  function save() {
    if (!result || saved) return
    if (onSave(result)) {
      setSaved(true)
      setSaveError(null)
    } else {
      setSaveError('Could not save in this browser (storage is full or blocked). The result was not saved.')
    }
  }

  function runNextTest() {
    setSi(null)
    setBl(null)
    setError(null)
    setResult(null)
    setSaved(false)
    setSaveError(null)
    setResetKey(k => k + 1)
  }


  return (
    <div className="flex-1 overflow-y-auto">
      <TopBar title="Live check" subtitle="Upload an SI and a BL" />
      <div className="px-8 py-7 max-w-[940px]">
        <p className="text-[13px] text-[#6B7280] leading-[1.6] mb-6 max-w-[720px]">
          Upload a Shipping Instruction and a Bill of Lading. The system compares the two documents field by field and tells you whether they match. No email details are required. Nothing is kept unless you choose Save to Verification, and the uploaded files are never kept.
        </p>
        <div className="bg-white border border-[#E8E6E1] rounded-xl px-6 py-6 space-y-5 max-w-[720px]">
          <div className="grid grid-cols-2 gap-4">
            <FilePicker key={`si-${resetKey}`} label="Shipping Instruction (SI)" file={si} onChange={setSi} />
            <FilePicker key={`bl-${resetKey}`} label="Bill of Lading (BL)" file={bl} onChange={setBl} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11.5px] text-[#9CA3AF]">Accepted: txt, pdf, docx, xlsx and images, up to 10 MB each.</span>
            <button onClick={submit} disabled={!si || !bl || loading}
              className="flex-shrink-0 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#BFDBFE] disabled:cursor-not-allowed text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
              {loading ? 'Checking…' : 'Run check'}
            </button>
          </div>
        </div>
        {loading && slow && (
          <div className="mt-4 px-5 py-3.5 rounded-xl border bg-[#EFF6FF] border-[#BFDBFE] text-[12.5px] text-[#2563EB]">
            The server is waking up. The first check after a quiet period can take up to a minute.
          </div>
        )}
        {error && (
          <div className="mt-4 px-5 py-3.5 rounded-xl border bg-[#FEF2F2] border-[#FECACA] text-[12.5px] text-[#DC2626] max-w-[720px]">{error}</div>
        )}
        {result && (
          <div className="mt-7">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-2">Checked · {result.subject}</div>
            <VerdictBanner email={result} />
            <div className="flex flex-wrap items-center gap-3">
              {saved ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#16A34A]">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Saved to Verification
                  </span>
                  <button onClick={() => onView(result.id, result.docResult)}
                    className="text-[13px] text-[#2563EB] font-medium hover:underline">View in Verification</button>
                </>
              ) : (
                <button onClick={save}
                  className="bg-[#111827] hover:bg-[#374151] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
                  Save to Verification
                </button>
              )}
              <button onClick={runNextTest}
                className="text-[13px] font-medium text-[#374151] border border-[#E8E6E1] hover:bg-[#F9F8F6] px-5 py-2.5 rounded-lg transition-colors">
                Run next test
              </button>
            </div>
            {saveError && <div className="mt-3 text-[12px] text-[#DC2626]">{saveError}</div>}
            <p className="mt-3 mb-6 text-[11.5px] text-[#9CA3AF]">
              {saved
                ? 'Saved in this browser only. The uploaded files are not kept.'
                : 'Not saved yet. Save to Verification keeps this result in this browser only; the uploaded files are never kept.'}
            </p>
            {result.fields.length > 0 && <FieldDetailTable fields={result.fields} />}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Documents ────────────────────────────────────────────────────────────────

function DocVerifyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }}
      className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Verify
    </button>
  )
}

function DocumentsScreen({ classifiedEmails, verifiedEmails, readEmails, reclassifications, manualDecisions, deletedEmails, setScreen, setActiveNav, setVerifTab, onSelectEmail, onSelectOthers, onSelectReview, onVerify, onClassifySingle, onDeleteEmails }: {
  classifiedEmails: Set<string>; verifiedEmails: Set<string>; readEmails: Set<string>
  reclassifications: Map<string, { classification: Classification; classifyType?: string }>
  manualDecisions: Map<string, ManualDecision>; deletedEmails: Set<string>
  setScreen: (s: Screen) => void; setActiveNav: (n: NavItem) => void; setVerifTab: (t: VerifTab) => void
  onSelectEmail: (id: string) => void; onSelectOthers: (id: string) => void; onSelectReview: (id: string) => void
  onVerify: (id: string) => void; onClassifySingle: (id: string) => void; onDeleteEmails: (ids: string[]) => void
}) {
  const allEmails = useEmails()
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [otherDocFilter, setOtherDocFilter] = useState<OtherCatFilter>('all')
  const [docSection, setDocSection] = useState<'bl' | 'other'>('bl')

  React.useEffect(() => { if (!deleteMode) setSelectedForDelete(new Set()) }, [deleteMode])

  const effClass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification, classifyType: e.classifyType }
  const visible = allEmails.filter(e => !deletedEmails.has(e.id))

  // Priority rank: Review=0, Unread=1, Read=2, then latest→oldest within each group
  function blSortPriority(e: Email): number {
    if (effectiveResult(e, manualDecisions) === 'review') return 0
    if (!readEmails.has(e.id)) return 1
    return 2
  }
  function otherSortPriority(e: Email): number {
    if (effClass(e).classification === 'need-review') return 0
    if (!readEmails.has(e.id)) return 1
    return 2
  }
  function docSort(pa: number, pb: number, a: Email, b: Email): number {
    if (pa !== pb) return pa - pb
    return receivedSortKey(b.received) - receivedSortKey(a.received)
  }

  // Section 1: BL Comparison — only CLASSIFIED emails with check classification (unclassified go to Other)
  const blSection = visible
    .filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'check')
    .sort((a, b) => docSort(blSortPriority(a), blSortPriority(b), a, b))

  // Section 2: Other — unclassified + classified as 'ignore' or 'need-review' (non-BL)
  const otherSection = visible
    .filter(e => {
      const ec = effClass(e)
      return ec.classification === 'ignore' || ec.classification === 'need-review' || !classifiedEmails.has(e.id)
    })
    .sort((a, b) => docSort(otherSortPriority(a), otherSortPriority(b), a, b))

  // Other category counts
  const otherCatCounts: Record<OtherCatFilter, number> = { all: otherSection.length, Spam: 0, General: 0, Invoice: 0, 'SI Request': 0 }
  otherSection.forEach(e => {
    if (classifiedEmails.has(e.id) && effClass(e).classification === 'ignore') {
      const cat = normalizeCat(effClass(e).classifyType)
      otherCatCounts[cat] = (otherCatCounts[cat] ?? 0) + 1
    }
  })

  const visibleOtherSection = otherDocFilter === 'all'
    ? otherSection
    : otherSection.filter(e => classifiedEmails.has(e.id) && effClass(e).classification === 'ignore' && normalizeCat(effClass(e).classifyType) === otherDocFilter)

  function getBLStatus(e: Email): { label: string; badge: string; dot: string } {
    if (!verifiedEmails.has(e.id) && !classifiedEmails.has(e.id)) return { label: 'New', badge: 'bg-[#EFF6FF] text-[#2563EB]', dot: 'bg-[#2563EB]' }
    if (!verifiedEmails.has(e.id)) return { label: 'Unverified', badge: 'bg-[#EFF6FF] text-[#6B7280]', dot: 'bg-[#3B82F6]' }
    const eff = effectiveResult(e, manualDecisions)
    if (eff === 'resend') return { label: 'Resend', badge: 'bg-[#F3F4F6] text-[#6B7280]', dot: 'bg-[#9CA3AF]' }
    return { label: resultStyles[eff as DocResult].label, badge: resultStyles[eff as DocResult].badge, dot: resultStyles[eff as DocResult].dot }
  }

  function getOtherStatus(e: Email): { label: string; badge: string; dot: string } {
    if (!classifiedEmails.has(e.id)) return { label: 'New', badge: 'bg-[#EFF6FF] text-[#2563EB]', dot: 'bg-[#2563EB]' }
    const ec = effClass(e)
    if (ec.classification === 'need-review') return { label: 'Review', badge: 'bg-[#FFFBEB] text-[#D97706]', dot: 'bg-[#D97706]' }
    return { label: otherDisplayName(ec.classifyType), badge: 'bg-[#F3F4F6] text-[#6B7280]', dot: 'bg-[#9CA3AF]' }
  }

  function handleBLClick(e: Email) {
    if (deleteMode) { toggleSelect(e.id); return }
    onSelectEmail(e.id)
    if (!verifiedEmails.has(e.id)) { setScreen('inbox-detail') }
    else { setActiveNav('verification'); setVerifTab(effectiveResult(e, manualDecisions) === 'mismatch' ? 'mismatch' : effectiveResult(e, manualDecisions) === 'review' ? 'review' : 'match'); setScreen('verification-detail') }
  }

  function handleOtherClick(e: Email) {
    if (deleteMode) { toggleSelect(e.id); return }
    const ec = effClass(e)
    if (!classifiedEmails.has(e.id)) { onSelectEmail(e.id); setScreen('inbox-detail') }
    else if (ec.classification === 'need-review') { onSelectReview(e.id); setScreen('manual-review') }
    else { onSelectOthers(e.id); setScreen('others-detail') }
  }

  function toggleSelect(id: string) {
    setSelectedForDelete(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function confirmDelete() {
    onDeleteEmails([...selectedForDelete]); setDeleteMode(false); setShowDeleteConfirm(false)
  }

  const allVisible = [...blSection, ...otherSection]

  const deleteBtn = (
    <div className="flex items-center gap-2">
      {deleteMode && (
        <>
          <button onClick={() => setSelectedForDelete(new Set(allVisible.map(e => e.id)))}
            className="btn-micro text-[12px] font-medium text-[#6B7280] border border-[#E8E6E1] bg-white hover:bg-[#F9F8F6] px-3 py-1.5 rounded-lg transition-colors">Select All</button>
          <button onClick={() => setDeleteMode(false)}
            className="btn-micro text-[12px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors px-2 py-1.5">Cancel</button>
        </>
      )}
      <button onClick={() => { if (deleteMode && selectedForDelete.size > 0) setShowDeleteConfirm(true); else setDeleteMode(true) }}
        className={`btn-micro flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${deleteMode ? 'bg-[#374151] text-white border-[#374151] hover:bg-[#111827]' : 'text-[#6B7280] bg-[#F3F4F6] border-[#E8E6E1] hover:bg-[#E8E6E1]'}`}>
        <TrashIcon />
        {deleteMode && selectedForDelete.size > 0 ? `Delete (${selectedForDelete.size})` : 'Delete'}
      </button>
    </div>
  )

  function EmailRow({ email, status, onClick, action, isSelected, muted }: {
    email: Email; status: { label: string; badge: string; dot: string }; onClick: () => void
    action?: React.ReactNode; isSelected: boolean; muted?: boolean
  }) {
    const isUnreadOther = effClass(email).classification === 'ignore' && classifiedEmails.has(email.id) && !readEmails.has(email.id)
    return (
      <div onClick={onClick} className={`email-row-micro cursor-pointer group flex items-center gap-4 px-5 py-4 ${isSelected ? 'bg-[#EFF6FF]' : ''} ${muted ? 'opacity-60' : ''}`}>
        {deleteMode && (
          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'border-[#2563EB] bg-[#2563EB]' : 'border-[#D1D5DB]'}`}>
            {isSelected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
        )}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isUnreadOther ? <span className="w-2 h-2 rounded-full bg-[#2563EB]" /> : <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[#111827] truncate group-hover:text-[#2563EB] transition-colors">{email.subject}</div>
          <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{email.senderName} · {email.received}</div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${status.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
        </span>
        {action && !deleteMode && action}
        <span className="text-[#D1D5DB] group-hover:text-[#2563EB] transition-colors"><Chevron /></span>
      </div>
    )
  }

  return (
    <div className="page-ambient flex-1 overflow-y-auto">
      {showDeleteConfirm && <DeleteConfirmModal count={selectedForDelete.size} onYes={confirmDelete} onNo={() => setShowDeleteConfirm(false)} />}
      <TopBar title="Documents" subtitle="Central archive" actions={deleteBtn} />
      <div className="px-8 py-7 max-w-[960px]">

        {/* Section tab navigation */}
        <div className="flex items-center gap-2 mb-7">
          {(['bl', 'other'] as const).map(sec => {
            const isActive = docSection === sec
            const label = sec === 'bl' ? 'BL Comparison' : 'Other'
            const count = sec === 'bl' ? blSection.length : otherSection.length
            return (
              <button key={sec} onClick={() => setDocSection(sec)}
                className="btn-micro flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={isActive ? {
                  background: '#111827',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)',
                  transform: 'scale(1.04)',
                } : {
                  background: '#FFFFFF',
                  color: '#6B7280',
                  border: '1px solid #E8E6E1',
                }}>
                {label}
                <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Section 1: BL Comparison */}
        {docSection === 'bl' && <section>
          <SectionHdr label="BL Comparison" count={blSection.length} />
          {blSection.length === 0
            ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No BL Comparison documents</span></div>
            : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                {blSection.map((email, i) => {
                  const status = getBLStatus(email)
                  const isBLPending = classifiedEmails.has(email.id) && !verifiedEmails.has(email.id)
                  const action = isBLPending ? (
                    <DocVerifyBtn onClick={() => {
                      onVerify(email.id)
                      setActiveNav('verification')
                      setVerifTab(email.docResult === 'mismatch' ? 'mismatch' : email.docResult === 'review' ? 'review' : 'match')
                      setScreen('verification-detail')
                    }} />
                  ) : !classifiedEmails.has(email.id) ? (
                    <button onClick={e => { e.stopPropagation(); onClassifySingle(email.id) }}
                      className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 3h9M2 5.5h7M3 8h5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" /></svg>
                      Classify
                    </button>
                  ) : undefined
                  return (
                    <div key={email.id} className={i < blSection.length - 1 ? 'border-b border-[#F0EEE9]' : ''}>
                      <EmailRow email={email} status={status} onClick={() => handleBLClick(email)} action={action} isSelected={selectedForDelete.has(email.id)} />
                    </div>
                  )
                })}
              </div>
          }
        </section>}

        {/* Section 2: Other */}
        {docSection === 'other' && <section>
          <SectionHdr label="Other" count={otherSection.length} />
          <div className="mb-4">
            <OtherCategoryBar active={otherDocFilter} onChange={setOtherDocFilter} counts={otherCatCounts} />
          </div>
          {otherSection.length === 0
            ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No other documents</span></div>
            : visibleOtherSection.length === 0
              ? <div className="bg-white border border-[#E8E6E1] rounded-xl px-5 py-4"><span className="text-[12.5px] text-[#9CA3AF]">No {otherDocFilter} emails</span></div>
              : <div className="bg-white border border-[#E8E6E1] rounded-xl overflow-hidden">
                  {visibleOtherSection.map((email, i) => {
                    const status = getOtherStatus(email)
                    const isNew = !classifiedEmails.has(email.id)
                    const action = isNew ? (
                      <button onClick={e => { e.stopPropagation(); onClassifySingle(email.id) }}
                        className="btn-micro flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 3h9M2 5.5h7M3 8h5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" /></svg>
                        Classify
                      </button>
                    ) : undefined
                    return (
                      <div key={email.id} className={i < visibleOtherSection.length - 1 ? 'border-b border-[#F0EEE9]' : ''}>
                        <EmailRow email={email} status={status} onClick={() => handleOtherClick(email)} action={action} isSelected={selectedForDelete.has(email.id)} />
                      </div>
                    )
                  })}
                </div>
          }
        </section>}
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Workspace({ initialEmails }: { initialEmails: Email[] }) {
  const [allEmails, setAllEmails]   = useState<Email[]>(initialEmails)
  const [screen, setScreen]         = useState<Screen>('overview')
  const [activeNav, setActiveNav]   = useState<NavItem>('overview')
  const [verifTab, setVerifTab]     = useState<VerifTab>('all')
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [reviewEmailId, setReviewEmailId]     = useState<string | null>(null)
  const [reviewBackTo, setReviewBackTo]       = useState<Screen>('inbox')
  const [reviewMode, setReviewMode]           = useState<ReviewMode>('classify')

  // The pipeline has already classified every email and compared every SI + BL pair.
  const [classifiedEmails, setClassifiedEmails] = useState<Set<string>>(new Set(initialEmails.map(e => e.id)))
  const [verifiedEmails, setVerifiedEmails]     = useState<Set<string>>(new Set(initialEmails.filter(e => e.classification === 'check').map(e => e.id)))
  const [readEmails, setReadEmails]             = useState<Set<string>>(new Set())
  const [manualDecisions, setManualDecisions]   = useState<Map<string, ManualDecision>>(new Map())
  const [resentEmails, setResentEmails]           = useState<Set<string>>(new Set())
  const [reclassifications, setReclassifications] = useState<Map<string, { classification: Classification; classifyType?: string }>>(new Map())
  const [deletedEmails, setDeletedEmails]       = useState<Set<string>>(new Set())
  const [repliedEmails, setRepliedEmails]       = useState<Set<string>>(new Set())

  function handleSetScreen(s: Screen) {
    setScreen(s)
    if (s === 'overview') setActiveNav('overview')
    else if (s === 'inbox' || s === 'inbox-detail' || s === 'others-detail') setActiveNav('inbox')
    else if (s === 'verification' || s === 'verification-detail' || s === 'manual-review' || s === 'final-decision') setActiveNav('verification')
    else if (s === 'resend') setActiveNav('resend')
    else if (s === 'documents') setActiveNav('documents')
    else if (s === 'live-check') setActiveNav('live')
  }

  // A live check the employee chose to save: kept in this browser, then listed
  // like any other verified email. Returns false if the browser refused.
  function handleSaveLive(email: Email): boolean {
    if (!saveLiveEmail(email)) return false
    setAllEmails(prev => [email, ...prev])
    setClassifiedEmails(prev => new Set([...prev, email.id]))
    setVerifiedEmails(prev => new Set([...prev, email.id]))
    return true
  }

  function handleViewSaved(id: string, tab: VerifTab) {
    setSelectedEmailId(id)
    setVerifTab(tab)
    setActiveNav('verification')
    setScreen('verification-detail')
  }

  function handleClassify() {
    const ids = allEmails.filter(e => !classifiedEmails.has(e.id) && !deletedEmails.has(e.id)).map(e => e.id)
    setClassifiedEmails(prev => new Set([...prev, ...ids]))
  }

  function handleClassifySingle(id: string) {
    setClassifiedEmails(prev => new Set([...prev, id]))
  }

  function handleVerify(id: string, from: 'inbox' | 'documents' = 'inbox') {
    const email = allEmails.find(e => e.id === id)!
    // Emails originally "Fail to Identify Type" (need-review) that were manually classified
    // as BL Comparison must go to Manual Review — we cannot run automatic comparison.
    const wasFailToIdentify = email.classification === 'need-review'
    if (wasFailToIdentify) {
      setReviewEmailId(id)
      setSelectedEmailId(id)
      setReviewBackTo(from === 'documents' ? 'documents' : 'inbox')
      setReviewMode('direct-verify')
      setScreen('manual-review')
      setActiveNav('verification')
    } else {
      // Normal system-classified BL Comparison → run automatic SI-vs-BL comparison
      setVerifiedEmails(prev => new Set([...prev, id]))
      setSelectedEmailId(id)
      setVerifTab(email.docResult === 'review' ? 'review' : email.docResult === 'mismatch' ? 'mismatch' : 'match')
      setActiveNav('verification')
      setScreen('verification-detail')
    }
  }

  function handleVerifyAll() {
    const effR = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification }
    const ids = allEmails.filter(e => classifiedEmails.has(e.id) && effR(e).classification === 'check' && !verifiedEmails.has(e.id) && !deletedEmails.has(e.id)).map(e => e.id)
    if (ids.length > 0) setVerifiedEmails(prev => new Set([...prev, ...ids]))
  }

  function handleDecision(id: string, d: ManualDecision) {
    setVerifiedEmails(prev => new Set([...prev, id]))
    setManualDecisions(prev => new Map([...prev, [id, d]]))
  }

  function handleResend(id: string) {
    setResentEmails(prev => new Set([...prev, id]))
  }

  function handleClassifyOther(id: string, category: string) {
    setReclassifications(prev => new Map([...prev, [id, { classification: 'ignore', classifyType: category }]]))
    setActiveNav('inbox'); setScreen('inbox')
  }

  function handleClassifyBL(id: string, verifyNow: boolean) {
    setClassifiedEmails(prev => new Set([...prev, id]))
    setReclassifications(prev => new Map([...prev, [id, { classification: 'check' }]]))
    if (verifyNow) {
      // Always Manual Review: this email was originally Fail to Identify Type,
      // so automatic comparison is not appropriate regardless of state updates.
      setReviewEmailId(id)
      setSelectedEmailId(id)
      setReviewBackTo('inbox')
      setReviewMode('direct-verify')
      setScreen('manual-review')
      setActiveNav('verification')
    } else {
      setActiveNav('inbox'); setScreen('inbox')
    }
  }

  function handleDeleteEmails(ids: string[]) {
    setDeletedEmails(prev => new Set([...prev, ...ids]))
  }

  function handleReply(id: string) {
    setRepliedEmails(prev => new Set([...prev, id]))
  }

  function handleSelectKeepReview(id: string, backTo: Screen = 'verification') {
    setReviewEmailId(id)
    setSelectedEmailId(id)
    setReviewBackTo(backTo)
    setReviewMode('direct-verify')
    setScreen('manual-review')
    setActiveNav('verification')
  }

  function handleReplyAll() {
    const effR = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification }
    const matchIds = allEmails
      .filter(e => verifiedEmails.has(e.id) && !deletedEmails.has(e.id) && effectiveResult(e, manualDecisions) === 'match' && !repliedEmails.has(e.id))
      .map(e => e.id)
    setRepliedEmails(prev => new Set([...prev, ...matchIds]))
  }

  const effReclass = (e: Email) => reclassifications.get(e.id) ?? { classification: e.classification, classifyType: e.classifyType }
  const newIncoming  = allEmails.filter(e => !classifiedEmails.has(e.id) && !deletedEmails.has(e.id)).length
  const blPending    = allEmails.filter(e => classifiedEmails.has(e.id) && effReclass(e).classification === 'check' && !verifiedEmails.has(e.id) && !deletedEmails.has(e.id)).length
  const classifyRev  = allEmails.filter(e => classifiedEmails.has(e.id) && effReclass(e).classification === 'need-review' && !deletedEmails.has(e.id)).length
  const inboxBadge   = newIncoming + blPending + classifyRev

  return (
    <EmailsContext.Provider value={allEmails}>
    <div className="flex h-screen bg-[#F9F8F6] overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar activeNav={activeNav} activeVerifTab={verifTab}
        setActiveNav={setActiveNav} setScreen={handleSetScreen}
        setVerifTab={setVerifTab} inboxBadge={inboxBadge} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {screen === 'overview' && (
          <OverviewScreen setScreen={handleSetScreen} setActiveNav={setActiveNav} setVerifTab={setVerifTab}
            verifiedEmails={verifiedEmails} manualDecisions={manualDecisions} onSelectEmail={setSelectedEmailId}
            deletedEmails={deletedEmails} />
        )}
        {screen === 'inbox' && (
          <InboxScreen classifiedEmails={classifiedEmails} verifiedEmails={verifiedEmails} readEmails={readEmails}
            reclassifications={reclassifications} deletedEmails={deletedEmails}
            onClassify={handleClassify} onClassifySingle={handleClassifySingle}
            onVerify={handleVerify} onVerifyAll={handleVerifyAll}
            setScreen={handleSetScreen} onSelectEmail={setSelectedEmailId}
            onSelectOthers={setSelectedEmailId}
            onSelectReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('inbox'); setReviewMode('classify') }} />
        )}
        {screen === 'inbox-detail' && (
          <InboxDetailScreen emailId={selectedEmailId} classifiedEmails={classifiedEmails}
            onVerify={handleVerify} setScreen={handleSetScreen}
            setActiveNav={setActiveNav} setVerifTab={setVerifTab} />
        )}
        {screen === 'others-detail' && (
          <OthersDetailScreen emailId={selectedEmailId}
            onMarkRead={(id) => setReadEmails(prev => new Set([...prev, id]))}
            setScreen={handleSetScreen} readEmails={readEmails} />
        )}
        {screen === 'documents' && (
          <DocumentsScreen classifiedEmails={classifiedEmails} verifiedEmails={verifiedEmails} readEmails={readEmails}
            reclassifications={reclassifications} manualDecisions={manualDecisions} deletedEmails={deletedEmails}
            setScreen={handleSetScreen} setActiveNav={setActiveNav} setVerifTab={setVerifTab}
            onSelectEmail={setSelectedEmailId} onSelectOthers={setSelectedEmailId}
            onSelectReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('documents'); setReviewMode('classify') }}
            onVerify={(id) => handleVerify(id, 'documents')} onClassifySingle={handleClassifySingle}
            onDeleteEmails={handleDeleteEmails} />
        )}
        {screen === 'verification' && (
          <VerificationScreen verifiedEmails={verifiedEmails} classifiedEmails={classifiedEmails}
            reclassifications={reclassifications} manualDecisions={manualDecisions}
            deletedEmails={deletedEmails} repliedEmails={repliedEmails}
            activeTab={verifTab} setActiveTab={setVerifTab}
            setScreen={handleSetScreen} onSelectEmail={setSelectedEmailId}
            onSelectReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('verification'); setReviewMode('classify') }}
            onSelectKeepReview={(id) => handleSelectKeepReview(id, 'verification')}
            onDeleteEmails={handleDeleteEmails} onReply={handleReply} onReplyAll={handleReplyAll} />
        )}
        {screen === 'verification-detail' && (
          <VerificationDetailScreen emailId={selectedEmailId} manualDecisions={manualDecisions}
            reclassifications={reclassifications} setScreen={handleSetScreen}
            onFlagReview={(id) => { setReviewEmailId(id); setSelectedEmailId(id); setReviewBackTo('verification-detail'); setReviewMode('flag-review') }}
            onDecision={handleDecision} setActiveNav={setActiveNav} setVerifTab={setVerifTab} />
        )}
        {screen === 'manual-review' && (
          <ManualReviewScreen emailId={reviewEmailId ?? selectedEmailId} setScreen={handleSetScreen} backTo={reviewBackTo}
            reviewMode={reviewMode} onClassifyOther={handleClassifyOther} onClassifyBL={handleClassifyBL} />
        )}
        {screen === 'final-decision' && (
          <FinalDecisionScreen emailId={reviewEmailId ?? selectedEmailId}
            setScreen={handleSetScreen} setActiveNav={setActiveNav}
            setVerifTab={setVerifTab} onDecision={handleDecision} reviewMode={reviewMode} />
        )}
        {screen === 'resend' && (
          <ResendScreen manualDecisions={manualDecisions} resentEmails={resentEmails} deletedEmails={deletedEmails}
            setScreen={handleSetScreen} onSelectEmail={setSelectedEmailId} onResend={handleResend} />
        )}
        {screen === 'live-check' && <LiveCheckScreen onSave={handleSaveLive} onView={handleViewSaved} />}
      </main>
    </div>
    </EmailsContext.Provider>
  )
}

// ─── Loading the emails ───────────────────────────────────────────────────────

function StatusScreen({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#F9F8F6] px-6" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="bg-white border border-[#E8E6E1] rounded-xl px-8 py-7 max-w-[420px] text-center">
        <div className="text-[15px] font-semibold text-[#111827] mb-2">{title}</div>
        <p className="text-[13px] text-[#6B7280] leading-[1.6]">{message}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

export default function App() {
  const [records, setRecords] = useState<ApiEmailRecord[] | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [slow, setSlow]       = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Free hosting sleeps when idle, so the first request can take a while.
    const timer = setTimeout(() => setSlow(true), 6000)

    fetchEmails()
      .then(loaded => { if (!cancelled) setRecords(loaded) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Something went wrong.') })
      .finally(() => clearTimeout(timer))

    return () => { cancelled = true; clearTimeout(timer) }
  }, [attempt])

  function retry() {
    setError(null)
    setSlow(false)
    setAttempt(n => n + 1)
  }

  if (error) {
    return (
      <StatusScreen title="Could not load the emails" message={error}
        action={<button onClick={retry} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">Try again</button>} />
    )
  }

  if (!records) {
    return (
      <StatusScreen title="Loading emails…"
        message={slow ? 'The server is waking up. The first load after a quiet period can take up to a minute.' : 'Fetching the pipeline results.'} />
    )
  }

  return <Workspace initialEmails={[...loadLiveEmails(), ...records.map(fromRecord)]} />
}
