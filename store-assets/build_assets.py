"""Chrome 웹 스토어용 스크린샷과 프로모션 타일을 다시 만듭니다.

사용법 (프로젝트 루트에서):  python store-assets/build_assets.py

로컬 웹 서버를 잠시 띄우고, 설치된 Chrome을 헤드리스 모드로 실행해
store-assets/src/shot.html 의 각 장면을 정확한 크기의 PNG로 저장합니다.
"""
import functools
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store-assets"
PORT = 5179

SHOTS = [
    # (장면, 파일명, 가로, 세로, 다크 모드)
    ("main", "screenshot-1-main.png", 1280, 800, False),
    ("search", "screenshot-2-search.png", 1280, 800, False),
    ("fullview", "screenshot-3-fullview.png", 1280, 800, True),
    ("promo", "promo-small-440x280.png", 440, 280, False),
]

CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if path and Path(path).exists():
            return path
    sys.exit("Chrome을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정해 주세요.")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # 요청 로그 숨김
        pass


def start_server() -> http.server.ThreadingHTTPServer:
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    chrome = find_chrome()
    server = start_server()
    try:
        for scene, filename, width, height, dark in SHOTS:
            out_file = OUT / filename
            with tempfile.TemporaryDirectory() as profile:
                args = [
                    chrome,
                    "--headless=new",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--no-first-run",
                    "--no-default-browser-check",
                    f"--user-data-dir={profile}",
                    f"--window-size={width},{height}",
                    "--virtual-time-budget=3000",
                    f"--screenshot={out_file}",
                ]
                if dark:
                    args.append("--force-dark-mode")
                args.append(f"http://127.0.0.1:{PORT}/store-assets/src/shot.html?scene={scene}")
                subprocess.run(args, check=True, capture_output=True, timeout=60)
            print(f"만듦: {out_file.relative_to(ROOT)}")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
