"""Chrome 웹 스토어 업로드용 ZIP을 만듭니다.

사용법 (프로젝트 루트에서):  python scripts/package.py

확장 프로그램 실행에 필요한 파일만 허용 목록(INCLUDE)으로 골라 담으므로
CHROMEWEBSTORE.md, store-assets/, scripts/, .claude/ 같은 개발용 파일은 들어가지 않습니다.
새 폴더나 파일을 확장 프로그램에 추가하면 INCLUDE에도 추가해 주세요.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ["manifest.json", "icons", "popup"]
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def collect() -> list[Path]:
    files = []
    for entry in INCLUDE:
        path = ROOT / entry
        if not path.exists():
            sys.exit(f"없는 경로: {entry}")
        if path.is_file():
            files.append(path)
        else:
            files += sorted(p for p in path.rglob("*") if p.is_file())
    return [f for f in files if f.name not in SKIP_NAMES and f.suffix != ".map"]


def check_manifest() -> dict:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        sys.exit("manifest_version이 3이 아닙니다.")
    if len(manifest.get("description", "")) > 132:
        sys.exit("manifest description이 132자를 넘습니다.")
    for size, rel in manifest.get("icons", {}).items():
        if not (ROOT / rel).exists():
            sys.exit(f"아이콘 파일이 없습니다: {rel}")
    return manifest


def main() -> None:
    manifest = check_manifest()
    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"simple-memo-v{manifest['version']}.zip"
    out.unlink(missing_ok=True)

    files = collect()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            # 압축 파일 안의 경로는 항상 / 로 구분 (Windows 역슬래시 방지)
            zf.write(f, f.relative_to(ROOT).as_posix())

    print(f"만듦: {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.1f} KB, 파일 {len(files)}개)")
    for f in files:
        print("  ", f.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    main()
