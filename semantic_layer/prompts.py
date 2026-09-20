import json

CATEGORIES = [
    "BL_COMPARISON",
    "SI_REQUEST",
    "INVOICE_QUERY",
    "GENERAL",
    "SPAM",
]

FIELDS = [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
]


def classification_prompt(
    email,
    rule_result,
):
    return f"""You are a shipping-document email classifier.

Choose exactly one category:
{', '.join(CATEGORIES)}

Use the meaning of the email, not only keywords.

Return JSON only in exactly this shape:
{{
  "category": "BL_COMPARISON",
  "confidence": 0.95,
  "reason": "short explanation"
}}

confidence must be between 0 and 1.

Existing rule result:
{json.dumps(rule_result, ensure_ascii=False)}

Email:
Subject: {email.get('subject', '')}

Body:
{email.get('body', '')}
"""


def extraction_prompt(
    text,
    missing_fields,
):
    requested = ", ".join(
        missing_fields
    )

    field_template_parts = []

    for field in missing_fields:
        field_template_parts.append(
            '    "' + field + '": {\n'
            '      "value": null,\n'
            '      "confidence": 0.0,\n'
            '      "unit": null,\n'
            '      "reason": "short explanation"\n'
            '    }'
        )

    field_template = ",\n".join(
        field_template_parts
    )

    return f"""You extract structured fields from a shipping document.

Extract ONLY these requested fields:
{requested}

Understand semantic aliases and natural-language equivalents.

Examples of equivalent meanings:
- shipper: shipper, consignor, exporter, sender
- consignee: consignee, consigned to, receiver
- notify_party: notify party, party to notify
- port_of_loading: port of loading, loading port, origin port,
  place where cargo is loaded
- port_of_discharge: port of discharge, discharge port,
  final discharge location, place where cargo is discharged
- container_count: container count, container quantity,
  number of containers
- gross_weight: gross weight, gross mass, total gross mass

Important rules:
1. Do not invent values.
2. Use only information supported by the document.
3. If a requested field is absent, use null and confidence 0.
4. confidence must be between 0 and 1.
5. For gross_weight, keep the numeric value in "value" and,
   when available, put KG/KGS/MT/etc. in "unit".
6. For container_count, return the count as the value.
7. Return JSON only.
8. The top-level JSON object MUST contain exactly one key:
   "fields".
9. Every requested field MUST appear inside "fields".

Return exactly this structure:
{{
  "fields": {{
{field_template}
  }}
}}

Document text:
{text}
"""
