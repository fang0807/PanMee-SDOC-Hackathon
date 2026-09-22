from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


RUNTIME_TARGETS = [
    Path('backend/runtime_gmail/inbox'),
    Path('backend/runtime_gmail/attachments'),
    Path('backend/runtime_gmail/records'),
    Path('backend/runtime_gmail/raw'),
    Path('plugins/autoreply_plugin/runtime/preview'),
    Path('plugins/autoreply_plugin/runtime/pending_review'),
    Path('plugins/autoreply_plugin/runtime/sent'),
]
FILE_TARGETS = [
    Path('backend/runtime_gmail/state.json'),
]


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / 'backend').is_dir() and (candidate / 'frontend').is_dir():
            return candidate
    raise SystemExit('Could not find SmartDoc repo root (expected backend/ and frontend/).')


def count_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.rglob('*') if p.is_file())


def clear_dir(path: Path, dry_run: bool) -> int:
    count = count_files(path)
    if dry_run:
        return count
    if path.exists():
        for child in path.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    path.mkdir(parents=True, exist_ok=True)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Reset SmartDoc runtime data while keeping bundled sample emails intact.'
    )
    parser.add_argument('--yes', action='store_true', help='Do not ask for confirmation.')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be deleted without deleting it.')
    args = parser.parse_args()

    root = find_repo_root(Path.cwd())
    print('SmartDoc data reset')
    print(f'Repo: {root}')
    print('\nThis keeps:')
    print('  - bundled sample/benchmark emails')
    print('  - source code and attachments that belong to the bundled dataset')
    print('\nThis clears:')
    print('  - Gmail Receiver imported runtime emails/attachments/raw messages')
    print('  - Gmail Receiver processed-message state')
    print('  - Auto Reply preview / pending_review / sent runtime records')
    print('\nBrowser Live Check data is separate and must be cleared in the browser.')

    total = 0
    for rel in RUNTIME_TARGETS:
        total += count_files(root / rel)
    for rel in FILE_TARGETS:
        if (root / rel).is_file():
            total += 1

    print(f'\nRuntime files found: {total}')

    if args.dry_run:
        for rel in RUNTIME_TARGETS:
            n = count_files(root / rel)
            print(f'[DRY] {rel}: {n} file(s)')
        for rel in FILE_TARGETS:
            print(f'[DRY] {rel}: {"exists" if (root / rel).exists() else "missing"}')
        return 0

    if not args.yes:
        answer = input('\nType RESET to continue: ').strip()
        if answer != 'RESET':
            print('Cancelled.')
            return 1

    removed = 0
    for rel in RUNTIME_TARGETS:
        n = clear_dir(root / rel, dry_run=False)
        removed += n
        print(f'[OK] Cleared {rel} ({n} file(s))')

    for rel in FILE_TARGETS:
        path = root / rel
        if path.exists():
            path.unlink()
            removed += 1
            print(f'[OK] Removed {rel}')
        else:
            print(f'[OK] {rel} already clean')

    # Recreate Gmail runtime structure so the receiver can start immediately.
    for rel in [
        Path('backend/runtime_gmail/inbox'),
        Path('backend/runtime_gmail/attachments'),
        Path('backend/runtime_gmail/records'),
        Path('backend/runtime_gmail/raw'),
    ]:
        (root / rel).mkdir(parents=True, exist_ok=True)

    print(f'\nDone. Removed {removed} runtime file(s).')
    print('\nFinal browser step:')
    print("  Open http://localhost:5173, press F12 -> Console, run:")
    print("  localStorage.removeItem('smartdoc.liveChecks'); location.reload();")
    print('\nThen restart backend/frontend if they were running.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
