#!/usr/bin/env python3

import math
import re
from dataclasses import dataclass, field
from typing import Callable, Optional


# ============================================================
# CATEGORY NAMES
# ============================================================

BL_COMPARISON = "BL_COMPARISON"
SI_REQUEST = "SI_REQUEST"
INVOICE_QUERY = "INVOICE_QUERY"
GENERAL = "GENERAL"
SPAM = "SPAM"

CATEGORIES = (
    BL_COMPARISON,
    SI_REQUEST,
    INVOICE_QUERY,
    GENERAL,
    SPAM,
)

CONFIDENCE_THRESHOLD = 0.60
_GENERAL_PRIOR = 0.5


# ============================================================
# RESULT OBJECT
# ============================================================

@dataclass
class Classification:
    category: str
    confidence: float
    scores: dict
    reasons: list = field(default_factory=list)
    subject_hint: Optional[str] = None
    uncertain: bool = False
    source: str = "rules"

    @property
    def subject_disagrees(self) -> bool:
        return (
            self.subject_hint is not None
            and self.subject_hint != self.category
        )


# ============================================================
# HELPERS
# ============================================================

def _text(value):
    if value is None:
        return ""
    return str(value)


def _normalise(text):
    text = _text(text)
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")
    return text.strip()


def clean_body(body: str) -> str:
    """
    Keep the useful part of the email thread.
    """

    body = _normalise(body)

    if not body:
        return ""

    lines = []

    for line in body.splitlines():
        stripped = line.strip()

        # quoted email/thread
        if re.match(r"^from:\s", stripped, re.I):
            break

        if re.match(r"^_{5,}$", stripped):
            break

        # common sign-offs
        if re.match(
            r"^(best regards|warm regards|kind regards|"
            r"regards|thanks|thank you)[,!.]?$",
            stripped,
            re.I,
        ):
            break

        # warning blocks are normally not useful for classification
        if stripped.upper().startswith("WARNING:"):
            continue

        lines.append(line)

    return "\n".join(lines).strip()


# ============================================================
# ATTACHMENT ROLE DETECTION
# ============================================================

def attachment_roles(attachments) -> set:
    """
    Detect SI / BL from attachment names.

    Supports examples such as:
        xxx_SI.pdf
        xxx_BL.pdf
        SI_xxx.pdf
        BL_xxx.pdf
        xxx_SI_001.xlsx
        xxx_BL_001.xlsx
    """

    roles = set()

    for attachment in attachments or []:
        name = _text(attachment).lower()

        # Remove path
        name = name.replace("\\", "/").split("/")[-1]

        # SI
        if re.search(
            r"(?:^|[_\-\s])si(?:[_\-\s.]|$)",
            name,
            re.I,
        ):
            roles.add("SI")

        # BL
        if re.search(
            r"(?:^|[_\-\s])bl(?:[_\-\s.]|$)",
            name,
            re.I,
        ):
            roles.add("BL")

    return roles


# ============================================================
# BODY CUES
# ============================================================

_BODY_CUES = {

    # --------------------------------------------------------
    # BL COMPARISON
    # --------------------------------------------------------

    BL_COMPARISON: [

        (
            "explicit compare SI and draft BL",
            r"\b(compare|check|verify|confirm|review)\b"
            r".{0,80}"
            r"\b(si|shipping instructions?|shipping instruction)\b"
            r".{0,80}"
            r"\b(draft\s+)?bl\b",
            6,
        ),

        (
            "draft BL against SI",
            r"\b(draft\s+)?bl\b"
            r".{0,60}"
            r"\bagainst\b"
            r".{0,40}"
            r"\b(si|shipping instructions?|shipping instruction)\b",
            6,
        ),

        (
            "SI against draft BL",
            r"\b(si|shipping instructions?|shipping instruction)\b"
            r".{0,60}"
            r"\bagainst\b"
            r".{0,40}"
            r"\b(draft\s+)?bl\b",
            6,
        ),

        (
            "SI and BL together",
            r"\b(si|shipping instructions?|shipping instruction)\b"
            r".{0,20}"
            r"\b(and|&)\b"
            r".{0,20}"
            r"\b(draft\s+)?bl\b",
            5,
        ),

        (
            "document comparison",
            r"\bdocument\s+(comparison|checking|check)\b",
            5,
        ),

        (
            "compare documents",
            r"\b(compare|check)\s+(the\s+)?documents?\b",
            5,
        ),

        (
            "check draft BL",
            r"\b(check|verify|review|confirm)\b"
            r".{0,30}"
            r"\bdraft\s+(bl|bill\s+of\s+lading)\b",
            5,
        ),

        (
            "BL amendment",
            r"\b(amend|amendment|correction|correct|revise|revision)\b"
            r".{0,30}"
            r"\b(bl|bill\s+of\s+lading)\b",
            5,
        ),

        (
            "BL correction",
            r"\b(bl|bill\s+of\s+lading)\b"
            r".{0,30}"
            r"\b(correction|corrections|amendment|amend)\b",
            5,
        ),

        (
            "draft BL missing",
            r"\bdraft\s+bl\b"
            r".{0,40}"
            r"\b(missing|not received|not available|still pending)\b",
            5,
        ),

        (
            "BL file problem",
            r"\b(bl|bill\s+of\s+lading)\b"
            r".{0,40}"
            r"\b(file|attachment)\b"
            r".{0,40}"
            r"\b(won't open|cannot open|can't open|unable to open)\b",
            5,
        ),
    ],

    # --------------------------------------------------------
    # SI REQUEST
    # --------------------------------------------------------

    SI_REQUEST: [

        (
            "please find shipping instruction",
            r"\bplease\s+find\s+(the\s+)?"
            r"(shipping\s+instructions?|si)\s+for\b",
            7,
        ),

        (
            "shipping instruction for reference",
            r"\bshipping\s+instructions?\s+for\s+[a-z0-9]",
            6,
        ),

        (
            "request shipping instruction",
            r"\b(request|requesting)\b"
            r".{0,30}"
            r"\b(shipping\s+instructions?|si)\b",
            6,
        ),

        (
            "need shipping instruction",
            r"\b(need|needed|require|required)\b"
            r".{0,30}"
            r"\b(shipping\s+instructions?|si)\b",
            6,
        ),

        (
            "send SI",
            r"\bplease\s+(send|provide|share|forward)\b"
            r".{0,25}"
            r"\b(si|shipping\s+instructions?)\b",
            6,
        ),

        (
            "provide SI",
            r"\b(provide|send|share|forward|submit)\b"
            r".{0,25}"
            r"\b(si|shipping\s+instructions?)\b",
            4,
        ),

        (
            "SI request wording",
            r"\b(si|shipping\s+instruction)\b"
            r".{0,30}"
            r"\b(request|needed|required|please)\b",
            4,
        ),

        (
            "draft BL after SI",
            r"\brevert\s+with\s+(the\s+)?draft\s+bl\b"
            r".{0,40}"
            r"\b(once|when)\s+available\b",
            3,
        ),
    ],

    # --------------------------------------------------------
    # INVOICE QUERY
    # --------------------------------------------------------

    INVOICE_QUERY: [

        (
            "invoice",
            r"\binvoices?\b",
            3,
        ),

        (
            "invoice number",
            r"\binvoice\s+(no|number|#)\b",
            4,
        ),

        (
            "billing",
            r"\bbilling\b",
            3,
        ),

        (
            "payment",
            r"\b(payment|paid|payable|payment\s+status|"
            r"payment\s+confirmation)\b",
            3,
        ),

        (
            "charges",
            r"\b(charges?|chargeable|local\s+charges)\b",
            3,
        ),

        (
            "freight",
            r"\bfreight(?:\s+charges?)?\b",
            3,
        ),

        (
            "D&D",
            r"\b(d\s*&\s*d|d&d|demurrage|detention)\b",
            3,
        ),

        (
            "THC",
            r"\bthc\b",
            3,
        ),

        (
            "credit note",
            r"\bcredit\s+note\b",
            4,
        ),

        (
            "GR PGI",
            r"\b(gr|pgi)\b",
            2,
        ),

        (
            "invoice cancellation",
            r"\b(cancel|cancellation|reverse)\b"
            r".{0,30}"
            r"\b(invoice|pgi|billing)\b",
            4,
        ),

        (
            "invoice query",
            r"\b(check|confirm|clarify|advise)\b"
            r".{0,35}"
            r"\b(invoice|charges?|payment|billing)\b",
            4,
        ),
    ],

    # --------------------------------------------------------
    # GENERAL
    # --------------------------------------------------------

    GENERAL: [

        (
            "automated notification",
            r"\bautomated\s+notification\b",
            8,
        ),

        (
            "no action required",
            r"\bno\s+action\s+required\b",
            8,
        ),

        (
            "RPA notification",
            r"\brpa\s+(bot|notification)\b",
            8,
        ),

        (
            "system notification",
            r"\bsystem\s+(notification|generated|message)\b",
            6,
        ),

        (
            "berthing report",
            r"\bberthing\s+report\b",
            6,
        ),

        (
            "vessel update",
            r"\b(vessel|vessel\s+schedule)\b"
            r".{0,40}"
            r"\b(update|updated|status)\b",
            5,
        ),

        (
            "berthed",
            r"\bberthed\b",
            5,
        ),

        (
            "loading completed",
            r"\bloading\s+(has\s+been\s+)?completed\b",
            5,
        ),

        (
            "operation update",
            r"\b(update|status|summary)\b"
            r".{0,30}"
            r"\b(operation|operations|shipment|shipping)\b",
            4,
        ),

        (
            "outstanding list",
            r"\b(list\s+of\s+)?outstanding\s+"
            r"(items?|documents?|matters?)\b",
            5,
        ),

        (
            "documents to follow",
            r"\bdocuments?\s+to\s+follow\b",
            5,
        ),

        (
            "reminder",
            r"^\s*reminder\b",
            4,
        ),

        (
            "office notice",
            r"\b(office\s+resumes?|public\s+holiday|"
            r"office\s+closed)\b",
            6,
        ),

        (
            "seasonal notice",
            r"\b(new\s+year|christmas|holiday\s+notice)\b",
            5,
        ),

        (
            "acknowledgement",
            r"\b(acknowledged|well\s+received|"
            r"duly\s+noted|noted\s+with\s+thanks)\b",
            4,
        ),

        (
            "thank you received",
            r"\b(thank\s+you|thanks)\b"
            r".{0,50}"
            r"\b(received|noted|acknowledged)\b",
            4,
        ),

        (
            "general follow-up",
            r"\b(follow\s*-?\s*up|followup)\b"
            r".{0,40}"
            r"\b(update|status|matter|request)\b",
            3,
        ),
    ],

    # --------------------------------------------------------
    # SPAM
    # --------------------------------------------------------

    SPAM: [

        (
            "account verification",
            r"\b(verify\s+your\s+account|"
            r"confirm\s+your\s+account)\b",
            8,
        ),

        (
            "mailbox storage lure",
            r"\b(mailbox|storage)\b"
            r".{0,40}"
            r"\b(exceeded|limit|full|deactivation)\b",
            8,
        ),

        (
            "account deactivation",
            r"\b(account|mailbox|email)\b"
            r".{0,30}"
            r"\b(deactivation|suspended|disabled)\b",
            7,
        ),

        (
            "prize",
            r"\b(congratulations|you\s+have\s+won|"
            r"claim\s+your\s+prize)\b",
            8,
        ),

        (
            "gift card",
            r"\bgift\s+card\b",
            7,
        ),

        (
            "free iPhone",
            r"\bfree\s+(iphone|phone)\b",
            8,
        ),

        (
            "giveaway",
            r"\b(giveaway|monthly\s+draw|"
            r"selected\s+in\s+our)\b",
            7,
        ),

        (
            "advance fee",
            r"\b(bank\s+officer|business\s+proposal|"
            r"bank\s+details)\b",
            8,
        ),

        (
            "customs scam",
            r"\bunpaid\s+customs\b",
            8,
        ),

        (
            "sales pitch",
            r"\b(limited\s+time\s+offer|"
            r"buy\s+now|exclusive\s+offer)\b",
            7,
        ),

        (
            "discount lure",
            r"\b\d+\s*%\s*off\b",
            7,
        ),

        (
            "guaranteed return",
            r"\bguaranteed\s+\d+%\b",
            8,
        ),

        (
            "bitcoin crypto",
            r"\b(bitcoin|cryptocurrency|"
            r"crypto\s+investment)\b",
            8,
        ),

        (
            "suspicious link",
            r"https?://\S+",
            2,
        ),
    ],
}


# ============================================================
# SUBJECT CUES
# ============================================================

_SUBJECT_CUES = {

    BL_COMPARISON: [
        (
            "subject explicit BL checking",
            r"\b(confirm\s+docs?|check\s+draft\s+bl|"
            r"compare\s+docs?|compare\s+bl)\b",
            2,
        ),
        (
            "subject BL amendment",
            r"\b(amend|amendment|correction|revision)\b"
            r".{0,20}"
            r"\bbl\b",
            2,
        ),
    ],

    SI_REQUEST: [
        (
            "subject SI request",
            r"\b(request\s+(for\s+)?si|"
            r"si\s+needed|"
            r"cust\s+si|"
            r"request\s+si)\b",
            3,
        ),
        (
            "subject shipping instruction",
            r"\bshipping\s+instructions?\b",
            2,
        ),
    ],

    INVOICE_QUERY: [
        (
            "subject invoice",
            r"\binvoice\b",
            2,
        ),
        (
            "subject charges",
            r"\b(charges?|billing|payment|freight)\b",
            1.5,
        ),
    ],

    GENERAL: [
        (
            "subject operational update",
            r"\b(berthing|update\s+summary|"
            r"delivery\s+planning)\b",
            2,
        ),
        (
            "subject office notice",
            r"\b(new\s+year|public\s+holiday|"
            r"office\s+resumes?)\b",
            2,
        ),
        (
            "subject reminder/update",
            r"\b(reminder|follow\s*-?\s*up|status\s+update)\b",
            1.5,
        ),
    ],

    SPAM: [
        (
            "subject spam wording",
            r"\b(bitcoin|crypto|winner|congratulations|"
            r"exclusive\s+offer|free\s+iphone|"
            r"urgent:?\s+your\s+email)\b",
            5,
        ),
    ],
}


# ============================================================
# SI FIELD DETECTION
# ============================================================

_SI_FIELD_PATTERNS = [
    r"^\s*shipper\s*:",
    r"^\s*consignee\s*:",
    r"^\s*notify(?:\s+party)?\s*:",
    r"^\s*(pol|port\s+of\s+loading)\s*:",
    r"^\s*(pod|port\s+of\s+discharge)\s*:",
    r"^\s*description\s+of\s+goods\s*:",
    r"^\s*gross\s+w(?:eight|t)?\s*:",
    r"^\s*container(?:\s+count)?\s*:",
]


def count_si_fields(body: str) -> int:
    count = 0

    for line in body.splitlines():
        line = line.strip()

        for pattern in _SI_FIELD_PATTERNS:
            if re.search(pattern, line, re.I):
                count += 1
                break

    return count


# ============================================================
# SCORING
# ============================================================

def _score(cues, text, scores, reasons):
    for category, items in cues.items():
        for name, pattern, weight in items:

            try:
                matched = re.search(
                    pattern,
                    text,
                    re.I | re.M,
                )
            except re.error:
                matched = None

            if matched:
                scores[category] += weight
                reasons.append(
                    f"{category} +{weight:g}: {name}"
                )


# ============================================================
# RULE CLASSIFICATION
# ============================================================

def rule_classify(email: dict) -> Classification:

    subject = _normalise(
        email.get("subject", "")
    )

    body = clean_body(
        email.get("body", "")
    )

    full_text = (
        subject
        + "\n"
        + body
    )

    attachments = (
        email.get("attachments")
        or []
    )

    roles = attachment_roles(
        attachments
    )

    scores = {
        category: 0.0
        for category in CATEGORIES
    }

    reasons = []

    # --------------------------------------------------------
    # 1. ATTACHMENT STRUCTURE
    # --------------------------------------------------------

    if roles == {"SI", "BL"}:
        scores[BL_COMPARISON] += 7
        reasons.append(
            "BL_COMPARISON +7: SI and BL attachments"
        )

    elif "BL" in roles:
        scores[BL_COMPARISON] += 4
        reasons.append(
            "BL_COMPARISON +4: BL attachment"
        )

    elif "SI" in roles:
        scores[SI_REQUEST] += 3
        reasons.append(
            "SI_REQUEST +3: SI attachment"
        )

    # --------------------------------------------------------
    # 2. INLINE SI STRUCTURE
    # --------------------------------------------------------

    field_count = count_si_fields(
        body
    )

    if field_count >= 5:
        scores[SI_REQUEST] += 7
        reasons.append(
            f"SI_REQUEST +7: inline SI structure "
            f"({field_count} fields)"
        )

    elif field_count >= 3:
        scores[SI_REQUEST] += 5
        reasons.append(
            f"SI_REQUEST +5: inline SI structure "
            f"({field_count} fields)"
        )

    elif field_count == 2:
        scores[SI_REQUEST] += 2
        reasons.append(
            "SI_REQUEST +2: partial SI structure"
        )

    # --------------------------------------------------------
    # 3. BODY CUES
    # --------------------------------------------------------

    _score(
        _BODY_CUES,
        body,
        scores,
        reasons,
    )

    # --------------------------------------------------------
    # 4. SUBJECT CUES
    # --------------------------------------------------------

    subject_scores = {
        category: 0.0
        for category in CATEGORIES
    }

    subject_reasons = []

    _score(
        _SUBJECT_CUES,
        subject,
        subject_scores,
        subject_reasons,
    )

    for category, value in subject_scores.items():
        scores[category] += value

    reasons.extend(
        subject_reasons
    )

    # --------------------------------------------------------
    # 5. CANONICAL SI EMAIL
    #
    # Very important for this dataset.
    #
    # These emails commonly contain:
    #
    # "Please find Shipping instruction for ..."
    #
    # and later:
    #
    # "Please revert with draft BL once available."
    #
    # The latter MUST NOT turn the email into BL_COMPARISON.
    # --------------------------------------------------------

    si_template = bool(
        re.search(
            r"\bplease\s+find\s+(the\s+)?"
            r"(shipping\s+instructions?|si)"
            r"\s+for\b",
            body,
            re.I,
        )
    )

    if si_template:
        scores[SI_REQUEST] += 6
        reasons.append(
            "SI_REQUEST +6: canonical SI template"
        )

    # --------------------------------------------------------
    # 6. STRONG SI SUBJECTS
    # --------------------------------------------------------

    si_subject = bool(
        re.search(
            r"(^|[\s:_-])"
            r"(si\s+needed|"
            r"request\s+si|"
            r"request\s+for\s+si|"
            r"cust\s+si|"
            r"si\s*-)"
            r"([\s:_-]|$)",
            subject,
            re.I,
        )
    )

    if si_subject:
        scores[SI_REQUEST] += 3
        reasons.append(
            "SI_REQUEST +3: strong SI subject"
        )

    # --------------------------------------------------------
    # 7. STRONG GENERAL
    # --------------------------------------------------------

    strong_general = bool(
        re.search(
            r"\b(automated\s+notification|"
            r"no\s+action\s+required|"
            r"rpa\s+(bot|notification)|"
            r"berthing\s+report)\b",
            body,
            re.I,
        )
    )

    if strong_general:
        scores[GENERAL] += 3
        reasons.append(
            "GENERAL +3: strong system/operation signal"
        )

    # --------------------------------------------------------
    # 8. SI PROTECTION
    #
    # A genuine SI request often contains:
    #
    # "Please revert with draft BL once available."
    #
    # That is NOT a comparison request.
    # --------------------------------------------------------

    if si_template or si_subject:

        real_bl_comparison = bool(
            re.search(
                r"\b(compare|check|verify|confirm|"
                r"against|amend|amendment|"
                r"correction|correct|review)\b"
                r".{0,60}"
                r"\b(draft\s+)?bl\b",
                body,
                re.I,
            )
        )

        real_bl_comparison_reverse = bool(
            re.search(
                r"\b(draft\s+)?bl\b"
                r".{0,60}"
                r"\b(compare|check|verify|confirm|"
                r"against|amend|amendment|"
                r"correction|review)\b",
                body,
                re.I,
            )
        )

        real_bl_signal = (
            real_bl_comparison
            or real_bl_comparison_reverse
        )

        if not real_bl_signal:
            old_score = scores[BL_COMPARISON]

            scores[BL_COMPARISON] = min(
                scores[BL_COMPARISON],
                2.0,
            )

            reasons.append(
                f"BL_COMPARISON capped from "
                f"{old_score:g}: SI request has no "
                f"explicit comparison signal"
            )

    # --------------------------------------------------------
    # 9. GENERAL VS INVOICE
    # --------------------------------------------------------

    if strong_general:

        invoice_action = bool(
            re.search(
                r"\b(check|confirm|clarify|advise|"
                r"send|provide|issue|cancel|reverse|"
                r"payment\s+status)\b"
                r".{0,40}"
                r"\b(invoice|charges?|payment|billing)\b",
                body,
                re.I,
            )
        )

        if not invoice_action:
            scores[INVOICE_QUERY] = min(
                scores[INVOICE_QUERY],
                2.0,
            )

    # --------------------------------------------------------
    # 10. SPAM OVERRIDE
    #
    # Strong spam signals should dominate ordinary words.
    # --------------------------------------------------------

    strong_spam = bool(
        re.search(
            r"\b(verify\s+your\s+account|"
            r"confirm\s+your\s+account|"
            r"you\s+have\s+won|"
            r"claim\s+your\s+prize|"
            r"free\s+iphone|"
            r"bitcoin|"
            r"cryptocurrency|"
            r"guaranteed\s+\d+%|"
            r"gift\s+card)\b",
            full_text,
            re.I,
        )
    )

    if strong_spam:
        scores[SPAM] += 3
        reasons.append(
            "SPAM +3: strong spam override"
        )

    # --------------------------------------------------------
    # 11. DEFAULT GENERAL
    # --------------------------------------------------------

    if not any(scores.values()):
        scores[GENERAL] = _GENERAL_PRIOR
        reasons.append(
            f"GENERAL +{_GENERAL_PRIOR:g}: no cue"
        )

    # --------------------------------------------------------
    # 12. WINNER
    # --------------------------------------------------------

    ranked = sorted(
        scores.items(),
        key=lambda item: item[1],
        reverse=True,
    )

    top, top_score = ranked[0]
    _, second_score = ranked[1]

    margin = top_score - second_score

    if margin > 0:
        confidence = (
            1.0
            - math.exp(-margin / 2.0)
        )
    else:
        confidence = 0.0

    subject_hint = None

    if any(subject_scores.values()):
        subject_hint = max(
            subject_scores,
            key=subject_scores.get,
        )

    return Classification(
        category=top,
        confidence=round(
            confidence,
            3,
        ),
        scores=scores,
        reasons=reasons,
        subject_hint=subject_hint,
        uncertain=(
            confidence
            < CONFIDENCE_THRESHOLD
        ),
        source="rules",
    )


# ============================================================
# PUBLIC CLASSIFY
# ============================================================

def classify(
    email: dict,
    llm: Optional[
        Callable[
            [dict, Classification],
            Optional[str]
        ]
    ] = None,
    threshold: float = CONFIDENCE_THRESHOLD,
) -> Classification:

    result = rule_classify(
        email
    )

    result.uncertain = (
        result.confidence
        < threshold
    )

    if result.uncertain and llm is not None:

        try:
            answer = llm(
                email,
                result,
            )

        except Exception as exc:
            result.reasons.append(
                "llm fallback failed "
                f"({type(exc).__name__}); "
                "kept rules result"
            )
            return result

        if answer in CATEGORIES:
            result.reasons.append(
                f"llm overrode rules: "
                f"{result.category} -> {answer}"
            )

            result.category = answer
            result.source = "llm"

        else:
            result.reasons.append(
                "llm abstained or invalid; "
                "kept rules result"
            )

    return result


# ============================================================
# COMPATIBILITY WITH main.py
#
# main.py expects:
#
# document_comparison
# new_si_request
# invoice_query
# general
# spam
# ============================================================

def classify_email(email):

    result = classify(
        email
    )

    mapping = {
        BL_COMPARISON: "document_comparison",
        SI_REQUEST: "new_si_request",
        INVOICE_QUERY: "invoice_query",
        GENERAL: "general",
        SPAM: "spam",
    }

    return mapping.get(
        result.category,
        "general",
    )


# ============================================================
# CLASSIFY ENTIRE INBOX
# ============================================================

def classify_inbox(inbox):

    return {
        email["email_id"]: classify(email)
        for email in inbox
    }


# ============================================================
# DIRECT EXECUTION
# ============================================================

if __name__ == "__main__":

    import sys
    from collections import Counter
    from pathlib import Path

    bundle = Path(
        __file__
    ).resolve().parent

    sys.path.insert(
        0,
        str(bundle),
    )

    from loader import Inbox

    inbox = Inbox(
        sys.argv[1]
        if len(sys.argv) > 1
        else str(bundle)
    )

    emails = inbox.emails()

    results = {
        email["email_id"]: classify(email)
        for email in emails
    }

    print(
        f"{len(results)} emails"
    )

    print()
    print("CATEGORY COUNTS")

    for category, count in Counter(
        result.category
        for result in results.values()
    ).most_common():

        print(
            f"  {category:<16}{count:>4}"
        )

    print()

    uncertain = [
        email_id
        for email_id, result in results.items()
        if result.uncertain
    ]

    conflicts = [
        email_id
        for email_id, result in results.items()
        if result.subject_disagrees
    ]

    print(
        f"uncertain: {len(uncertain)}"
    )

    print(
        f"subject conflicts: {len(conflicts)}"
    )