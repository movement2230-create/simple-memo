"""메일 할 일 확장 프로그램의 설치용 ZIP을 만듭니다.

사용법 (저장소 루트에서):  python mail-todo/package.py

확장 프로그램 실행에 필요한 파일만 허용 목록(INCLUDE)으로 골라 담으므로
tests/, docs/, README.md 같은 개발용 파일은 들어가지 않습니다.
ZIP 안에서 manifest.json이 맨 위에 있어서, 압축을 푼 폴더를 그대로
chrome://extensions(또는 edge://extensions)의 "압축해제된 확장 프로그램을 로드합니다"로 고르면 됩니다.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INCLUDE = ["manifest.json", "icons", "src", "pages"]
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def collect() -> list[Path]:
    files = []
    for entry in INCLUDE:
        path = ROOT / entry
        if not path.exists():
            sys.exit(f"없는 경로: {entry}")
        files += [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
    return [f for f in files if f.name not in SKIP_NAMES and f.suffix != ".map"]


def check(files: list[Path]) -> dict:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        sys.exit("manifest_version이 3이 아닙니다.")
    if len(manifest.get("description", "")) > 132:
        sys.exit("manifest description이 132자를 넘습니다.")

    included = {f.relative_to(ROOT).as_posix() for f in files}
    needed = set(manifest.get("icons", {}).values())
    needed |= set(manifest.get("action", {}).get("default_icon", {}).values())
    for page in (manifest["action"].get("default_popup"), manifest.get("side_panel", {}).get("default_path")):
        if page:
            needed.add(page)
    needed.add(manifest["background"]["service_worker"])
    needed.add("src/content.js")  # 사이트를 켤 때 등록하는 스크립트
    # HTML의 <script src>, <link href>와 JS의 import 경로도 확인
    for f in files:
        text = f.read_text(encoding="utf-8") if f.suffix in {".html", ".js"} else ""
        refs = re.findall(r'(?:src|href)="([^"#:]+)"', text) if f.suffix == ".html" else re.findall(r"from '(\.[^']+)'", text)
        for ref in refs:
            needed.add((f.parent / ref).resolve().relative_to(ROOT).as_posix())
    missing = sorted(n for n in needed if n not in included)
    if missing:
        sys.exit(f"ZIP에 빠진 파일: {', '.join(missing)}")
    return manifest


def main() -> None:
    files = collect()
    manifest = check(files)
    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"mail-todo-v{manifest['version']}.zip"
    out.unlink(missing_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            # ZIP 안의 경로는 항상 / 로 구분 (Windows 역슬래시 방지)
            zf.write(f, f.relative_to(ROOT).as_posix())
    print(f"만듦: {out.relative_to(ROOT.parent)} ({out.stat().st_size / 1024:.1f} KB, 파일 {len(files)}개)")
    for f in files:
        print("  ", f.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    main()
