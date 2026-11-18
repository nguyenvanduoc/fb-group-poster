"""Lưu trữ dữ liệu của tool bằng file JSON trong thư mục data/."""
import json
import re
import threading
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
PROFILE_DIR = DATA_DIR / "browser_profile"   # phiên đăng nhập Facebook (cookie)
UPLOAD_DIR = DATA_DIR / "uploads"            # ảnh người dùng tải lên
SHOT_DIR = DATA_DIR / "screenshots"          # ảnh chụp màn hình khi lỗi
HISTORY_FILE = DATA_DIR / "history.jsonl"    # nhật ký đăng bài, mỗi dòng 1 bản ghi

for d in (DATA_DIR, PROFILE_DIR, UPLOAD_DIR, SHOT_DIR):
    d.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()

DEFAULT_SETTINGS = {
    "mode": "semi",        # "auto" = tự bấm Đăng, "semi" = bạn tự bấm Đăng
    "min_delay": 8,        # phút
    "max_delay": 20,       # phút
    "daily_limit": 15,     # số bài tối đa / ngày
    "start_hour": 8,       # chỉ chạy từ giờ này...
    "end_hour": 22,        # ...đến trước giờ này (start == end => chạy cả ngày)
}

# Giới hạn an toàn: không cho cấu hình quá dày
MIN_AUTO_DELAY = 3
MAX_DAILY_LIMIT = 30

GROUP_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.|m\.|web\.|mbasic\.)?facebook\.com/groups/([^/?#\s]+)", re.I
)


def _read(name: str, default):
    path = DATA_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write(name: str, value) -> None:
    path = DATA_DIR / name
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)  # ghi file tạm rồi đổi tên => không bị hỏng file nếu tắt ngang


# ---------- Link nhóm ----------
def normalize_group_url(url: str) -> str | None:
    """Chuẩn hoá link nhóm về dạng https://www.facebook.com/groups/<id>/ ; sai định dạng => None."""
    m = GROUP_URL_RE.match(url.strip())
    if not m:
        return None
    return f"https://www.facebook.com/groups/{m.group(1)}/"


def parse_group_urls(raw: list[str]) -> tuple[list[str], list[str]]:
    """Trả về (danh sách link hợp lệ đã bỏ trùng, danh sách link sai)."""
    valid, invalid, seen = [], [], set()
    for line in raw:
        line = line.strip()
        if not line:
            continue
        url = normalize_group_url(line)
        if url is None:
            invalid.append(line)
        elif url not in seen:
            seen.add(url)
            valid.append(url)
    return valid, invalid


# ---------- Danh sách nhóm ----------
def get_group_lists() -> dict[str, list[str]]:
    with _lock:
        return _read("groups.json", {})


def save_group_list(name: str, urls: list[str]) -> None:
    with _lock:
        data = _read("groups.json", {})
        data[name] = urls
        _write("groups.json", data)


def delete_group_list(name: str) -> None:
    with _lock:
        data = _read("groups.json", {})
        data.pop(name, None)
        _write("groups.json", data)


# ---------- Mẫu bài đăng ----------
def get_templates() -> dict[str, dict]:
    with _lock:
        return _read("templates.json", {})


def save_template(name: str, text: str, images: list[str]) -> None:
    with _lock:
        data = _read("templates.json", {})
        data[name] = {"text": text, "images": images}
        _write("templates.json", data)


def delete_template(name: str) -> None:
    with _lock:
        data = _read("templates.json", {})
        data.pop(name, None)
        _write("templates.json", data)


# ---------- Cấu hình ----------
def validate_settings(s: dict) -> dict:
    """Ép kiểu + kẹp giá trị vào khoảng an toàn."""
    out = {**DEFAULT_SETTINGS, **{k: v for k, v in s.items() if k in DEFAULT_SETTINGS}}
    out["mode"] = "auto" if out["mode"] == "auto" else "semi"
    floor = MIN_AUTO_DELAY if out["mode"] == "auto" else 0
    out["min_delay"] = max(floor, float(out["min_delay"]))
    out["max_delay"] = max(out["min_delay"], float(out["max_delay"]))
    out["daily_limit"] = min(MAX_DAILY_LIMIT, max(1, int(out["daily_limit"])))
    out["start_hour"] = min(23, max(0, int(out["start_hour"])))
    out["end_hour"] = min(24, max(0, int(out["end_hour"])))
    return out


def get_settings() -> dict:
    with _lock:
        return validate_settings(_read("settings.json", {}))


def save_settings(s: dict) -> dict:
    s = validate_settings(s)
    with _lock:
        _write("settings.json", s)
    return s


# ---------- Bộ đếm số bài trong ngày ----------
def get_today_count() -> int:
    with _lock:
        st = _read("state.json", {})
        return st.get("count", 0) if st.get("date") == date.today().isoformat() else 0


def increment_today_count() -> int:
    with _lock:
        st = _read("state.json", {})
        today = date.today().isoformat()
        count = (st.get("count", 0) if st.get("date") == today else 0) + 1
        _write("state.json", {"date": today, "count": count})
        return count


# ---------- Nhật ký ----------
def append_history(record: dict) -> None:
    record = {"time": datetime.now().isoformat(timespec="seconds"), **record}
    with _lock, HISTORY_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_history(limit: int = 200) -> list[dict]:
    if not HISTORY_FILE.exists():
        return []
    with _lock:
        lines = HISTORY_FILE.read_text(encoding="utf-8").splitlines()
    out = []
    for line in reversed(lines[-limit:]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return out
