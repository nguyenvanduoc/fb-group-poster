"""Quản lý trình duyệt Chromium (Playwright) chạy trong 1 luồng riêng.

Vì sao chạy luồng riêng?
- Trên Windows, Playwright cần ProactorEventLoop để mở tiến trình trình duyệt.
  Web server (uvicorn) có thể dùng loại event loop khác => lỗi NotImplementedError.
- Mọi lệnh Playwright phải chạy trên CÙNG một event loop. Ta tạo 1 loop riêng
  trong 1 luồng riêng, web server gửi việc sang đó qua `call()`.
"""
import asyncio
import os
import sys
import threading

from playwright.async_api import BrowserContext, Page, async_playwright

from storage import PROFILE_DIR

FB_HOME = "https://www.facebook.com/"


class BrowserManager:
    def __init__(self) -> None:
        if sys.platform == "win32":
            self.loop = asyncio.ProactorEventLoop()
        else:
            self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="browser-loop")
        self._thread.start()
        self._pw = None
        self.context: BrowserContext | None = None
        self.logged_in: bool | None = None  # None = chưa kiểm tra
        self._hooked: set[int] = set()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    # ---- cầu nối: web server (loop A) -> loop trình duyệt (loop B) ----
    async def call(self, coro):
        """Chạy coroutine trên loop trình duyệt và chờ kết quả từ loop của web server."""
        fut = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return await asyncio.wrap_future(fut)

    def submit(self, coro):
        """Chạy coroutine trên loop trình duyệt, không chờ (dùng cho job chạy nền)."""
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    # ---- các hàm dưới đây CHỈ được chạy trên loop trình duyệt ----
    @property
    def is_open(self) -> bool:
        return self.context is not None

    async def ensure_context(self) -> BrowserContext:
        """Mở Chromium với profile lưu trên ổ đĩa (nếu chưa mở)."""
        if self.context is not None:
            return self.context
        if self._pw is None:
            self._pw = await async_playwright().start()
        self.context = await self._pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=os.environ.get("FB_HEADLESS") == "1",
            executable_path=os.environ.get("CHROME_PATH") or None,
            viewport=None,                 # dùng đúng kích thước cửa sổ thật
            args=["--start-maximized"],
            locale="vi-VN",
        )
        # Người dùng tự đóng cửa sổ trình duyệt => đánh dấu là đã đóng
        self.context.on("close", lambda _ctx: self._on_closed())
        return self.context

    def _on_closed(self) -> None:
        self.context = None

    async def get_page(self) -> Page:
        """Lấy tab đang mở (hoặc mở tab mới) để làm việc."""
        ctx = await self.ensure_context()
        live = [p for p in ctx.pages if not p.is_closed()]
        page = live[0] if live else await ctx.new_page()
        if id(page) not in self._hooked:
            # Khi rời trang mà bài viết còn dang dở, trình duyệt hỏi "Rời khỏi trang?".
            # Mặc định Playwright bấm "Huỷ" => kẹt trang. Ta tự bấm "Rời đi".
            page.on("dialog", lambda d: asyncio.ensure_future(
                d.accept() if d.type == "beforeunload" else d.dismiss()))
            self._hooked.add(id(page))
        return page

    async def open_login(self) -> None:
        """Mở facebook.com để bạn tự đăng nhập (kể cả nhập mã 2FA)."""
        page = await self.get_page()
        await page.goto(FB_HOME, wait_until="domcontentloaded")
        await page.bring_to_front()

    async def check_login(self) -> bool:
        """Đã đăng nhập khi có cookie `c_user` (chứa ID tài khoản Facebook)."""
        ctx = await self.ensure_context()
        cookies = await ctx.cookies(FB_HOME)
        self.logged_in = any(c["name"] == "c_user" and c["value"] for c in cookies)
        return self.logged_in

    async def close(self) -> None:
        if self.context is not None:
            await self.context.close()
            self.context = None


browser = BrowserManager()
