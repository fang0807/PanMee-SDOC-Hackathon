#!/usr/bin/env python3
"""SmartDoc full regression checker.

Safe by default:
- Auto Reply is forced to dry-run mode.
- Gmail Receiver network polling is disabled.
- Synthetic Gmail ingestion uses a temporary directory.
- Real Gmail/SMTP credentials are never required.

Usage:
    python verify_all.py
    python verify_all.py --quick       # skip frontend build + 520-email score
    python verify_all.py --docker      # also build the root Dockerfile
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


RESULTS: list[CheckResult] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append(CheckResult(name, ok, detail.strip()))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail.strip()}" if detail.strip() else ""))


def run(cmd: list[str], cwd: Path = ROOT, env: dict | None = None, timeout: int = 120) -> subprocess.CompletedProcess:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        env=merged,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
    )


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def json_request(url: str, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def check_conflict_markers() -> None:
    bad = []
    exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml", ".toml", ".css", ".html"}
    skip_parts = {"node_modules", "dist", ".git", "runtime", "runtime_gmail"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in exts or any(part in skip_parts for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if re.search(r"(?m)^(<<<<<<<|>>>>>>>)", text):
            bad.append(str(path.relative_to(ROOT)))
    record("No unresolved Git conflict markers", not bad, ", ".join(bad[:8]))


def check_python_compile() -> None:
    cp = run([sys.executable, "-m", "compileall", "-q", "backend", "plugins"], timeout=120)
    record("Python backend/plugins compile", cp.returncode == 0, cp.stdout[-1200:])


def check_package_layout() -> None:
    plugins_init = (ROOT / "plugins/__init__.py").read_text(encoding="utf-8", errors="ignore")
    semantic_init = (BACKEND / "semantic_layer/__init__.py").read_text(encoding="utf-8", errors="ignore")
    bad_plugins_root = bool(re.search(r"from\s+\.plugin\s+import", plugins_init))
    semantic_base_ok = (BACKEND / "semantic_layer/adapters/base.py").exists()
    legacy_shim_ok = (BACKEND / "semantic_layer/base.py").exists()
    ok = not bad_plugins_root and semantic_base_ok and legacy_shim_ok
    detail = f"plugins_root_lightweight={not bad_plugins_root}, adapter_base={semantic_base_ok}, compatibility_shim={legacy_shim_ok}"
    record("Python package/import layout", ok, detail)


def check_plugin_tests() -> None:
    env = {"PYTHONPATH": str(ROOT), "PYTHONIOENCODING": "utf-8"}
    cp = run([sys.executable, "-m", "unittest", "discover", "-s", "plugins/autoreply_plugin/tests", "-v"], env=env, timeout=120)
    record("Auto Reply plugin unit tests", cp.returncode == 0 and "OK" in cp.stdout, cp.stdout[-900:])


def check_ui_dataset() -> None:
    data = json.loads((BACKEND / "ui_data.json").read_text(encoding="utf-8"))
    probe = run(
        [sys.executable, "-c", "import main; print(main.DRAFT_BL_REQUEST_RE.pattern)"],
        cwd=BACKEND,
        env={"PYTHONPATH": str(BACKEND), "PYTHONIOENCODING": "utf-8"},
        timeout=60,
    )
    if probe.returncode != 0:
        record("BL request workflow refinement", False, "Could not import pipeline: " + probe.stdout[-800:])
        return
    pattern = probe.stdout.strip().splitlines()[-1]
    request_re = re.compile(pattern, re.IGNORECASE)

    requests = [r for r in data if r.get("workflowType") == "BL_REQUEST"]
    false_requests = [
        r["id"] for r in requests
        if not request_re.search(r.get("body") or "")
    ]
    valid_subtypes = {"BL Draft Request", "BL Confirmation Request", "BL Amendment Request"}
    bad_subtypes = [r["id"] for r in requests if r.get("workflowSubtype") not in valid_subtypes]
    known_missing = {
        r["id"]: r for r in data if r.get("id") in {"email_506", "email_508", "email_510"}
    }
    known_ok = all(
        r.get("workflowType") == "BL_COMPARISON"
        and r.get("status") == "NEEDS_REVIEW"
        and r.get("reviewReason") == "missing_attachment"
        for r in known_missing.values()
    ) and len(known_missing) == 3

    ok = not false_requests and not bad_subtypes and known_ok
    counts = {}
    for r in requests:
        counts[r.get("workflowSubtype")] = counts.get(r.get("workflowSubtype"), 0) + 1
    record(
        "BL request correction + subtypes",
        ok,
        f"requests={len(requests)}, subtypes={counts}, false_requests={false_requests[:5]}",
    )

    review = [r for r in data if r.get("workflowType") == "BL_COMPARISON" and r.get("status") == "NEEDS_REVIEW"]
    record("Backend has BL comparison review records", bool(review), f"count={len(review)}")


def check_frontend_workflow_wiring() -> None:
    app = (FRONTEND / "src/figma/App.tsx").read_text(encoding="utf-8")
    api = (FRONTEND / "src/figma/api.ts").read_text(encoding="utf-8")
    required = {
        "Inbox + Documents search bars": "Search BL Comparison emails" in app and "Search other documents" in app,
        "BL request subtype filters": all(x in app for x in ["BL Draft Request", "BL Confirmation Request", "BL Amendment Request"]),
        "Inbox/Verification shared review rule": "A NEEDS_REVIEW email intentionally appears in BOTH" in app and "effectiveResult(e, manualDecisions) === 'review'" in app,
        "Gmail Inbox auto-refresh": "window.setInterval(() => load(false), 10000)" in app,
        "Gmail workflow fields accepted by frontend": "workflowType?: string" in api and "workflowSubtype?: string" in api,
        "Resend Gmail Compose path": "mail.google.com" in app,
        "Auto Reply sent state": "ALREADY_SENT" in app and "SENT" in app,
    }
    failed = [name for name, ok in required.items() if not ok]
    record("Frontend workflow wiring", not failed, "missing: " + ", ".join(failed) if failed else f"{len(required)} checks")


def check_receiver_synthetic() -> None:
    script = r"""
import json, tempfile, threading
from email.message import EmailMessage
from pathlib import Path
from gmail_receiver import GmailInboxStore, ingest_rfc822

backend = Path.cwd()
si = (backend / 'attachments/email_034_SI.txt').read_bytes()
bl = (backend / 'attachments/email_034_BL.txt').read_bytes()
with tempfile.TemporaryDirectory(prefix='smartdoc_receiver_test_') as tmp:
    store = GmailInboxStore(tmp)
    lock = threading.Lock()
    match = EmailMessage()
    match['From'] = 'Client Example <client@example.com>'
    match['To'] = 'receiver@example.com'
    match['Subject'] = 'Please check SI and draft BL'
    match['Message-ID'] = '<regression-match@example.com>'
    match.set_content('Attached are the SI and draft BL. Please compare and confirm.')
    match.add_attachment(si, maintype='text', subtype='plain', filename='Shipping Instruction.txt')
    match.add_attachment(bl, maintype='text', subtype='plain', filename='Draft BL.txt')
    rec = ingest_rfc822(match.as_bytes(), '9001', store, lock)
    duplicate = ingest_rfc822(match.as_bytes(), '9001', store, lock)

    request = EmailMessage()
    request['From'] = 'buyer@example.com'
    request['To'] = 'receiver@example.com'
    request['Subject'] = 'TO CONFIRM DOCS _ booking 123'
    request['Message-ID'] = '<regression-request@example.com>'
    request.set_content('Please assist to send the draft BL for checking asap. Thank you.')
    req = ingest_rfc822(request.as_bytes(), '9002', store, lock)

    missing = EmailMessage()
    missing['From'] = 'buyer2@example.com'
    missing['To'] = 'receiver@example.com'
    missing['Subject'] = 'Check SI and draft BL'
    missing['Message-ID'] = '<regression-missing@example.com>'
    missing.set_content('Attached are the SI and draft BL. Please compare and confirm.')
    miss = ingest_rfc822(missing.as_bytes(), '9003', store, lock)

    ok = bool(
        rec and duplicate and req and miss
        and rec.get('status') == 'OK'
        and rec.get('workflowType') == 'BL_COMPARISON'
        and rec.get('attachments', {}).get('SI')
        and rec.get('attachments', {}).get('BL')
        and duplicate.get('id') == rec.get('id')
        and req.get('workflowType') == 'BL_REQUEST'
        and req.get('workflowSubtype') == 'BL Confirmation Request'
        and miss.get('status') == 'NEEDS_REVIEW'
        and miss.get('reviewReason') == 'missing_attachment'
        and len(store.list_records()) == 3
    )
    print(json.dumps({'ok': ok, 'stored': len(store.list_records())}))
"""
    cp = run(
        [sys.executable, '-c', script],
        cwd=BACKEND,
        env={'PYTHONPATH': str(BACKEND), 'GMAIL_RECEIVER_ENABLED': '0', 'AUTOREPLY_LIVE_SEND': '0', 'PYTHONIOENCODING': 'utf-8'},
        timeout=120,
    )
    if cp.returncode != 0:
        record('Synthetic Gmail Receiver ingestion/classification/dedup', False, cp.stdout[-1000:])
        return
    try:
        result = json.loads(cp.stdout.strip().splitlines()[-1])
        record('Synthetic Gmail Receiver ingestion/classification/dedup', bool(result.get('ok')), f"stored={result.get('stored')}")
    except Exception as exc:
        record('Synthetic Gmail Receiver ingestion/classification/dedup', False, f'{exc}: {cp.stdout[-700:]}')


def check_backend_http() -> None:
    port = free_port()
    with tempfile.TemporaryDirectory(prefix="smartdoc_http_test_") as tmp:
        env = {
            "AUTOREPLY_LIVE_SEND": "0",
            "AUTOREPLY_DATA_DIR": str(Path(tmp) / "autoreply"),
            "GMAIL_RECEIVER_ENABLED": "0",
            "GMAIL_RECEIVER_DATA_DIR": str(Path(tmp) / "gmail"),
            "PYTHONIOENCODING": "utf-8",
        }
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=str(BACKEND), env={**os.environ, **env}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            base = f"http://127.0.0.1:{port}"
            ready = False
            for _ in range(60):
                try:
                    if json_request(base + "/health")[0] == 200:
                        ready = True
                        break
                except Exception:
                    time.sleep(0.2)
            if not ready:
                raise RuntimeError("backend did not become ready")

            _, emails = json_request(base + "/api/emails")
            _, receiver = json_request(base + "/api/gmail-receiver/status")
            _, txt = json_request(base + "/api/emails/email_034/attachments/SI/text")
            _, verify = json_request(base + "/api/emails/email_034/verify", method="POST")

            request_blocked = False
            request_id = next((r["id"] for r in emails if r.get("workflowType") == "BL_REQUEST"), None)
            if request_id:
                try:
                    json_request(base + f"/api/emails/{request_id}/verify", method="POST")
                except urllib.error.HTTPError as exc:
                    request_blocked = exc.code == 400

            review_count = sum(1 for r in emails if r.get("workflowType") == "BL_COMPARISON" and r.get("status") == "NEEDS_REVIEW")
            ok = (
                len(emails) >= 520
                and receiver.get("enabled") is False
                and bool(txt.get("text"))
                and verify.get("status") == "OK"
                and verify.get("auto_reply", {}).get("action") in {"PREVIEW_ONLY", "ALREADY_SENT"}
                and request_blocked
                and review_count > 0
            )
            record("FastAPI health/emails/attachments/verify/receiver endpoints", ok, f"emails={len(emails)}, review={review_count}, verify={verify.get('auto_reply', {}).get('action')}")
        except Exception as exc:
            record("FastAPI health/emails/attachments/verify/receiver endpoints", False, str(exc))
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


def check_frontend_build() -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    cp = run([npm, "run", "build"], cwd=FRONTEND, timeout=180)
    record("Frontend production build", cp.returncode == 0 and "built in" in cp.stdout.lower(), cp.stdout[-1400:])


def check_full_score() -> None:
    cp = run([sys.executable, "main.py"], cwd=BACKEND, env={"PYTHONIOENCODING": "utf-8"}, timeout=180)
    match = re.search(r"FINAL SCORE\s+([0-9.]+)", cp.stdout)
    score = match.group(1) if match else "missing"
    record("520-email pipeline final score", cp.returncode == 0 and score == "1.0000", f"FINAL SCORE={score}")


def check_docker() -> None:
    if not shutil.which("docker"):
        record("Docker build", False, "docker command not found")
        return
    cp = run(["docker", "build", "-t", "smartdoc-regression-test", "."], timeout=300)
    record("Docker build", cp.returncode == 0, cp.stdout[-1400:])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="Skip frontend build and full 520-email score")
    parser.add_argument("--docker", action="store_true", help="Also run docker build")
    args = parser.parse_args()

    # Force safe test behavior for this process and child imports.
    os.environ["AUTOREPLY_LIVE_SEND"] = "0"
    os.environ["GMAIL_RECEIVER_ENABLED"] = "0"

    print("SmartDoc regression checker")
    print(f"Repo: {ROOT}")
    print("Safe mode: real SMTP send OFF; Gmail network polling OFF\n")

    checks: list[Callable[[], None]] = [
        check_conflict_markers,
        check_python_compile,
        check_package_layout,
        check_plugin_tests,
        check_ui_dataset,
        check_frontend_workflow_wiring,
        check_receiver_synthetic,
        check_backend_http,
    ]
    if not args.quick:
        checks += [check_frontend_build, check_full_score]
    if args.docker:
        checks += [check_docker]

    for check in checks:
        try:
            check()
        except Exception as exc:
            record(check.__name__.replace("check_", "").replace("_", " ").title(), False, f"{type(exc).__name__}: {exc}")

    passed = sum(r.ok for r in RESULTS)
    failed = len(RESULTS) - passed
    print("\n" + "=" * 64)
    print(f"PASS: {passed}    FAIL: {failed}")
    if failed:
        print("RESULT: REGRESSION CHECK FAILED")
        print("Fix the failing items before push/deploy/demo.")
        return 1
    print("RESULT: AUTOMATED CHECKS PASSED")
    print("Manual final checks: real Gmail IMAP login, real SMTP delivery, and Gmail Compose UI.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
