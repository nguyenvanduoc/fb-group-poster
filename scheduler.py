"""Job đăng bài lần lượt vào nhiều nhóm: giãn cách, giới hạn/ngày, khung giờ."""
import asyncio
import random
from datetime import datetime, timedelta

import storage
from browser import BrowserManager
from poster import Controls, StopRequested, post_to_group, screenshot

STATUS_LABEL = {
    "waiting": "Chờ",
    "running": "Đang đăng",
    "posted": "Đã đăng",
    "manual_posted": "Đã đăng (thủ công)",
    "skipped": "Bỏ qua",
    "error": "Lỗi",
    "cancelled": "Đã huỷ",
}


class JobRunner:
    def __init__(self, bm: BrowserManager) -> None:
        self.bm = bm
        self.controls = Controls()
        self._future = None
        self.state: dict = self._empty_state()

    @staticmethod
    def _empty_state() -> dict:
        return {"running": False, "paused": False, "message": "", "next_at": None,
                "current": None, "mode": None, "items": []}

    @property
    def running(self) -> bool:
        return self._future is not None and not self._future.done()

    def snapshot(self) -> dict:
        s = dict(self.state)
        s["running"] = self.running
        s["paused"] = self.controls.pause.is_set()
        s["items"] = [dict(i, label=STATUS_LABEL.get(i["status"], i["status"])) for i in s["items"]]
        return s

    # ---------------- điều khiển từ giao diện ----------------
    def start(self, groups: list[str], text: str, images: list[str], settings: dict) -> None:
        if self.running:
            raise RuntimeError("Đang có job chạy")
        self.controls = Controls()
        self.state = self._empty_state()
        self.state["mode"] = settings["mode"]
        self.state["items"] = [{"url": u, "status": "waiting", "message": "", "time": None}
                               for u in groups]
        self._future = self.bm.submit(self._run(text, images, settings))

    def pause(self) -> None:
        self.controls.pause.set()

    def resume(self) -> None:
        self.controls.pause.clear()

    def stop(self) -> None:
        self.controls.stop.set()
        self.controls.pause.clear()

    def skip(self) -> None:
        self.controls.skip.set()

    # ---------------- logic chạy nền (trên loop trình duyệt) ----------------
    def _msg(self, text: str) -> None:
        self.state["message"] = text

    async def _sleep(self, seconds: float) -> None:
        """Ngủ nhưng vẫn phản hồi ngay khi bấm Dừng / Tạm dừng / Bỏ qua chờ."""
        end = asyncio.get_running_loop().time() + seconds
        self.controls.skip.clear()
        while True:
            await self.controls.checkpoint()
            if self.controls.skip.is_set():          # bấm "Bỏ qua" lúc đang chờ => đăng luôn
                self.controls.skip.clear()
                return
            remaining = end - asyncio.get_running_loop().time()
            if remaining <= 0:
                return
            await asyncio.sleep(min(1.0, remaining))

    @staticmethod
    def _in_window(s: dict, now: datetime) -> bool:
        start, end = s["start_hour"], s["end_hour"]
        if start == end:
            return True
        if start < end:
            return start <= now.hour < end
        return now.hour >= start or now.hour < end   # khung qua đêm, vd 20h -> 2h

    async def _wait_window(self, s: dict) -> None:
        while not self._in_window(s, datetime.now()):
            self._msg(f"Ngoài khung giờ {s['start_hour']}h–{s['end_hour']}h, đang chờ…")
            self.state["next_at"] = None
            await asyncio.sleep(1)
            await self.controls.checkpoint()

    async def _run(self, text: str, images: list[str], s: dict) -> None:
        items = self.state["items"]
        page = None
        try:
            if not await self.bm.check_login():
                raise RuntimeError("Chưa đăng nhập Facebook. Hãy làm Bước 1 trước.")
            page = await self.bm.get_page()

            for idx, item in enumerate(items):
                await self.controls.checkpoint()
                await self._wait_window(s)

                if storage.get_today_count() >= s["daily_limit"]:
                    self._msg(f"Đã đạt giới hạn {s['daily_limit']} bài/ngày. Dừng job.")
                    for rest in items[idx:]:
                        rest.update(status="cancelled", message="Đạt giới hạn ngày")
                    return

                self.state["current"] = item["url"]
                self.state["next_at"] = None
                item["status"] = "running"
                self._msg(f"Đang đăng nhóm {idx + 1}/{len(items)}")
                try:
                    page = await self.bm.get_page()
                    status, note = await post_to_group(page, item["url"], text, images, s["mode"], self.controls)
                    item.update(status=status, message=note)
                    if status in ("posted", "manual_posted"):
                        storage.increment_today_count()
                except StopRequested:
                    raise
                except Exception as e:
                    shot = await screenshot(page, f"loi_nhom_{idx + 1}") if page else None
                    item.update(status="error", message=str(e).splitlines()[0][:300]
                                + (f" (ảnh lỗi: {shot})" if shot else ""))
                item["time"] = datetime.now().strftime("%H:%M:%S")
                storage.append_history({"url": item["url"], "status": item["status"],
                                        "message": item["message"], "mode": s["mode"]})

                # Giãn cách trước nhóm tiếp theo (bỏ qua nếu là nhóm cuối hoặc nhóm bị skip/lỗi sớm)
                if idx < len(items) - 1:
                    delay = random.uniform(s["min_delay"], s["max_delay"]) * 60
                    if item["status"] == "skipped":
                        delay = 0
                    nxt = datetime.now() + timedelta(seconds=delay)
                    self.state["next_at"] = nxt.isoformat(timespec="seconds")
                    self.state["current"] = None
                    self._msg(f"Chờ {delay / 60:.1f} phút, nhóm tiếp theo lúc {nxt:%H:%M:%S}")
                    await self._sleep(delay)

            done = sum(i["status"] in ("posted", "manual_posted") for i in items)
            self._msg(f"Hoàn tất: {done}/{len(items)} nhóm đã đăng.")
        except StopRequested:
            for it in items:
                if it["status"] in ("waiting", "running"):
                    it.update(status="cancelled", message="Bạn đã bấm Dừng")
            self._msg("Đã dừng theo yêu cầu.")
        except Exception as e:
            for it in items:
                if it["status"] in ("waiting", "running"):
                    it.update(status="cancelled", message="Job dừng do lỗi")
            self._msg(f"Lỗi: {e}")
        finally:
            self.state["current"] = None
            self.state["next_at"] = None
