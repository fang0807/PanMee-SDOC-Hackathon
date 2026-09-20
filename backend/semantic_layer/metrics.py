import json
from pathlib import Path
from typing import Any, Dict, Optional


class SemanticMetrics:
    """
    Lightweight metrics recorder for the Semantic Layer.

    It records usage and reliability signals only.
    It does not make or override any classification, extraction,
    comparison, review, or trace decisions.
    """

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.reset()

    def reset(self):
        self.data: Dict[str, Any] = {
            "emails_processed": 0,
            "classification": {
                "rule_only": 0,
                "semantic_calls": 0,
                "semantic_accepted": 0,
                "semantic_rejected": 0,
                "semantic_failures": 0,
            },
            "extraction": {
                "documents_sent_to_semantic": 0,
                "fields_requested": 0,
                "fields_recovered": 0,
                "fields_unresolved": 0,
                "semantic_failures": 0,
            },
            "review": {
                "pending": 0,
                "resolved": 0,
            },
            "trace": {
                "records": 0,
            },
            "llm_usage": {
                "requests": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0.0,
            },
        }

    @staticmethod
    def _non_negative_int(value):
        try:
            value = int(value)
        except (TypeError, ValueError):
            return 0
        return max(0, value)

    @staticmethod
    def _non_negative_float(value):
        try:
            value = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, value)

    def record_email(self, count=1):
        self.data["emails_processed"] += self._non_negative_int(count)

    def record_classification(self, decision):
        classification = self.data["classification"]

        if decision == "rule_only":
            classification["rule_only"] += 1
            return

        if decision in {
            "semantic_accepted",
            "semantic_rejected",
            "semantic_failed",
        }:
            classification["semantic_calls"] += 1

        if decision == "semantic_accepted":
            classification["semantic_accepted"] += 1
        elif decision == "semantic_rejected":
            classification["semantic_rejected"] += 1
        elif decision == "semantic_failed":
            classification["semantic_failures"] += 1

    def record_extraction(
        self,
        *,
        requested_fields=None,
        recovered_fields=None,
        unresolved_fields=None,
        failed=False,
    ):
        extraction = self.data["extraction"]

        requested = list(requested_fields or [])
        recovered = list(recovered_fields or [])
        unresolved = list(unresolved_fields or [])

        if requested or failed:
            extraction["documents_sent_to_semantic"] += 1

        extraction["fields_requested"] += len(requested)
        extraction["fields_recovered"] += len(recovered)
        extraction["fields_unresolved"] += len(unresolved)

        if failed:
            extraction["semantic_failures"] += 1

    def record_review(self, *, pending=0, resolved=0):
        self.data["review"]["pending"] = self._non_negative_int(pending)
        self.data["review"]["resolved"] = self._non_negative_int(resolved)

    def record_trace(self, records):
        self.data["trace"]["records"] = self._non_negative_int(records)

    def record_llm_usage(
        self,
        *,
        input_tokens=0,
        output_tokens=0,
        input_cost_per_million=None,
        output_cost_per_million=None,
    ):
        usage = self.data["llm_usage"]

        input_tokens = self._non_negative_int(input_tokens)
        output_tokens = self._non_negative_int(output_tokens)
        total_tokens = input_tokens + output_tokens

        usage["requests"] += 1
        usage["input_tokens"] += input_tokens
        usage["output_tokens"] += output_tokens
        usage["total_tokens"] += total_tokens

        # Pricing is deliberately configurable rather than hard-coded.
        if (
            input_cost_per_million is not None
            and output_cost_per_million is not None
        ):
            input_rate = self._non_negative_float(
                input_cost_per_million
            )
            output_rate = self._non_negative_float(
                output_cost_per_million
            )

            cost = (
                input_tokens / 1_000_000 * input_rate
                + output_tokens / 1_000_000 * output_rate
            )

            usage["estimated_cost_usd"] += cost

    def summary(self):
        classification = self.data["classification"]
        extraction = self.data["extraction"]

        semantic_classification_calls = classification[
            "semantic_calls"
        ]

        semantic_classification_success = (
            classification["semantic_accepted"]
            + classification["semantic_rejected"]
        )

        classification_success_rate = (
            semantic_classification_success
            / semantic_classification_calls
            if semantic_classification_calls
            else 1.0
        )

        requested = extraction["fields_requested"]
        recovered = extraction["fields_recovered"]

        field_recovery_rate = (
            recovered / requested
            if requested
            else 1.0
        )

        return {
            **self.data,
            "derived": {
                "classification_semantic_success_rate":
                    round(classification_success_rate, 4),
                "field_recovery_rate":
                    round(field_recovery_rate, 4),
                "rule_handled_ratio":
                    round(
                        classification["rule_only"]
                        / self.data["emails_processed"],
                        4,
                    )
                    if self.data["emails_processed"]
                    else 0.0,
            },
        }

    def save(self, path: Optional[str] = None):
        target = Path(path) if path else self.path

        if target is None:
            raise ValueError(
                "No metrics output path configured"
            )

        target.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        target.write_text(
            json.dumps(
                self.summary(),
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        return target

    def print_report(self):
        report = self.summary()

        c = report["classification"]
        e = report["extraction"]
        r = report["review"]
        t = report["trace"]
        u = report["llm_usage"]
        d = report["derived"]

        print("=" * 62)
        print("  SEMANTIC METRICS")
        print("=" * 62)
        print(f"  Emails processed              : {report['emails_processed']}")
        print()
        print("  Classification")
        print(f"  Rule-only                     : {c['rule_only']}")
        print(f"  Semantic calls                : {c['semantic_calls']}")
        print(f"  Semantic accepted             : {c['semantic_accepted']}")
        print(f"  Semantic rejected             : {c['semantic_rejected']}")
        print(f"  Semantic failures             : {c['semantic_failures']}")
        print()
        print("  Extraction")
        print(f"  Documents sent to semantic    : {e['documents_sent_to_semantic']}")
        print(f"  Fields requested              : {e['fields_requested']}")
        print(f"  Fields recovered              : {e['fields_recovered']}")
        print(f"  Fields unresolved             : {e['fields_unresolved']}")
        print(f"  Extraction failures           : {e['semantic_failures']}")
        print()
        print("  Human Review")
        print(f"  Pending                       : {r['pending']}")
        print(f"  Resolved                      : {r['resolved']}")
        print()
        print("  Decision Trace")
        print(f"  Trace records                 : {t['records']}")
        print()
        print("  LLM Usage")
        print(f"  Requests                      : {u['requests']}")
        print(f"  Input tokens                  : {u['input_tokens']}")
        print(f"  Output tokens                 : {u['output_tokens']}")
        print(f"  Total tokens                  : {u['total_tokens']}")
        print(
            f"  Estimated cost (USD)          : "
            f"{u['estimated_cost_usd']:.6f}"
        )
        print()
        print("  Derived")
        print(
            f"  Rule-handled ratio            : "
            f"{d['rule_handled_ratio']:.1%}"
        )
        print(
            f"  Semantic success rate         : "
            f"{d['classification_semantic_success_rate']:.1%}"
        )
        print(
            f"  Field recovery rate           : "
            f"{d['field_recovery_rate']:.1%}"
        )
        print("=" * 62)
