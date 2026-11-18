"""Web server (FastAPI). Chạy: python main.py  rồi mở http://127.0.0.1:8000"""
import uuid
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import storage
from browser import browser
from scheduler import JobRunner

app = FastAPI(title="FB Group Poster")
job = JobRunner(browser)

STATIC_DIR = Path(__file__).resolve().parent / "static"
ALLOWED_IMG = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_IMAGES = 10


# ======================= Mô hình dữ liệu gửi lên =======================
class GroupListIn(BaseModel):
    name: str
    urls: list[str]


class ParseIn(BaseModel):
    text: str


class TemplateIn(BaseModel):
    name: str
    text: str
    images: list[str] = []


class SettingsIn(BaseModel):
    mode: str
    min_delay: float
    max_delay: float
    daily_limit: int
    start_hour: int
    end_hour: int


class JobIn(BaseModel):
    groups: list[str]
    text: str
    images: list[str] = []


def _image_paths(names: list[str]) -> list[str]:
    paths = []
    for n in names:
        p = (storage.UPLOAD_DIR / Path(n).name)   # Path(n).name chặn kiểu "../../file"
        if not p.is_file():
            raise HTTPException(400, f"Không tìm thấy ảnh {n}")
        paths.append(str(p))
    return paths


# ======================= Bước 1: Đăng nhập =======================
@app.post("/api/login/open")
async def login_open():
    await browser.call(browser.open_login())
    return {"ok": True}


@app.post("/api/login/check")
async def login_check():
    return {"logged_in": await browser.call(browser.check_login())}


@app.post("/api/browser/close")
async def browser_close():
    if job.running:
        raise HTTPException(409, "Đang có job chạy, hãy Dừng trước")
    await browser.call(browser.close())
    return {"ok": True}


# ======================= Bước 2: Nhóm =======================
@app.post("/api/groups/parse")
async def groups_parse(body: ParseIn):
    valid, invalid = storage.parse_group_urls(body.text.splitlines())
    return {"valid": valid, "invalid": invalid}


@app.get("/api/groups")
async def groups_get():
    return storage.get_group_lists()


@app.post("/api/groups")
async def groups_save(body: GroupListIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Thiếu tên danh sách")
    valid, _ = storage.parse_group_urls(body.urls)
    storage.save_group_list(name, valid)
    return {"ok": True, "count": len(valid)}


@app.delete("/api/groups/{name}")
async def groups_delete(name: str):
    storage.delete_group_list(name)
    return {"ok": True}


# ======================= Nội dung bài đăng =======================
@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    saved = []
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_IMG:
            raise HTTPException(400, f"{f.filename}: chỉ nhận ảnh {', '.join(sorted(ALLOWED_IMG))}")
        name = f"{uuid.uuid4().hex[:12]}{ext}"
        (storage.UPLOAD_DIR / name).write_bytes(await f.read())
        saved.append(name)
    return {"files": saved}


@app.get("/api/templates")
async def templates_get():
    return storage.get_templates()


@app.post("/api/templates")
async def templates_save(body: TemplateIn):
    if not body.name.strip():
        raise HTTPException(400, "Thiếu tên mẫu")
    storage.save_template(body.name.strip(), body.text, body.images)
    return {"ok": True}


@app.delete("/api/templates/{name}")
async def templates_delete(name: str):
    storage.delete_template(name)
    return {"ok": True}


# ======================= Bước 3: Cấu hình =======================
@app.get("/api/settings")
async def settings_get():
    return storage.get_settings()


@app.post("/api/settings")
async def settings_save(body: SettingsIn):
    return storage.save_settings(body.model_dump())


# ======================= Chạy job =======================
@app.post("/api/job/start")
async def job_start(body: JobIn):
    groups, invalid = storage.parse_group_urls(body.groups)
    if invalid:
        raise HTTPException(400, f"Link nhóm không hợp lệ: {invalid[0]}")
    if not groups:
        raise HTTPException(400, "Chưa chọn nhóm nào")
    if not body.text.strip() and not body.images:
        raise HTTPException(400, "Bài đăng đang trống")
    if len(body.images) > MAX_IMAGES:
        raise HTTPException(400, f"Tối đa {MAX_IMAGES} ảnh")
    settings = storage.get_settings()
    remaining = settings["daily_limit"] - storage.get_today_count()
    if remaining <= 0:
        raise HTTPException(400, "Hôm nay đã đạt giới hạn số bài. Tăng giới hạn hoặc để mai chạy.")
    try:
        job.start(groups, body.text, _image_paths(body.images), settings)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "count": len(groups)}


@app.post("/api/job/{action}")
async def job_control(action: str):
    actions = {"pause": job.pause, "resume": job.resume, "stop": job.stop, "skip": job.skip}
    if action not in actions:
        raise HTTPException(404, "Không có lệnh này")
    actions[action]()
    return {"ok": True}


@app.get("/api/status")
async def status():
    s = storage.get_settings()
    return {
        "browser_open": browser.is_open,
        "logged_in": browser.logged_in if browser.is_open else None,
        "today_count": storage.get_today_count(),
        "daily_limit": s["daily_limit"],
        "job": job.snapshot(),
    }


@app.get("/api/history")
async def history():
    return storage.read_history()


# ======================= File tĩnh =======================
app.mount("/uploads", StaticFiles(directory=storage.UPLOAD_DIR), name="uploads")
app.mount("/screenshots", StaticFiles(directory=storage.SHOT_DIR), name="screenshots")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import os
    host, port = "127.0.0.1", int(os.environ.get("PORT", 8000))
    if os.environ.get("NO_BROWSER") != "1":
        # Mở trang web sau 1.5 giây, đợi server khởi động xong
        import threading
        threading.Timer(1.5, webbrowser.open, args=[f"http://{host}:{port}"]).start()
    print(f"Tool đang chạy tại http://{host}:{port}  (Ctrl+C để tắt)")
    # Chỉ nghe trên 127.0.0.1: máy khác trong mạng LAN không truy cập được tool
    uvicorn.run(app, host=host, port=port, log_level="warning")
