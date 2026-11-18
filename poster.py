"""Thao tác đăng 1 bài vào 1 nhóm Facebook.

Lưu ý: Facebook thay đổi giao diện thường xuyên. Nếu tool không tìm thấy ô
"Bạn viết gì đi..." hoặc nút "Đăng", hãy sửa các biểu thức trong phần SELECTOR.
"""
import asyncio
import random
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime

from playwright.async_api import Locator, Page
from playwright.async_api import TimeoutError as PWTimeout

from storage import SHOT_DIR

# ======================= SELECTOR (sửa ở đây khi FB đổi giao diện) =======================
# Ô mở khung soạn bài trong trang nhóm
COMPOSER_TRIGGER = re.compile(
    r"(Bạn viết gì đi|Viết gì đó|Viết nội dung|Write something|What's on your mind)", re.I
)
# Ô nhập nội dung bên trong hộp thoại
TEXTBOX_CSS = 'div[role="textbox"][contenteditable="true"]'
# Nút thêm ảnh trong hộp thoại
PHOTO_BUTTON = re.compile(r"(Ảnh\/video|Photo\/video)", re.I)  # phải viết \/ vì Playwright chuyển regex sang JS
# Nút Đăng
POST_BUTTON = re.compile(r"^\s*(Đăng|Post)\s*$", re.I)
# =========================================================================================

SEMI_WAIT_SECONDS = 15 * 60   # chế độ bán tự động: chờ bạn bấm Đăng tối đa 15 phút


class StopRequested(Exception):
    pass


@dataclass
class Controls:
    """Các "công tắc" để giao diện web điều khiển job đang chạy (an toàn giữa các luồng)."""
    stop: threading.Event = field(default_factory=threading.Event)
    pause: threading.Event = field(default_factory=threading.Event)
    skip: threading.Event = field(default_factory=threading.Event)

    async def checkpoint(self) -> None:
        """Gọi giữa các bước: dừng nếu bị yêu cầu dừng, chờ nếu đang tạm dừng."""
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.5)
        if self.stop.is_set():
            raise StopRequested()


async def human_pause(lo: float = 0.8, hi: float = 2.0) -> None:
    """Nghỉ ngẫu nhiên giữa các thao tác cho giống người thao tác thật."""
    await asyncio.sleep(random.uniform(lo, hi))


async def _type_text(page: Page, box: Locator, text: str) -> None:
    await box.click()
    lines = text.replace("\r\n", "\n").split("\n")
    for i, line in enumerate(lines):
        if line:
            # insert_text chèn nguyên chuỗi, hỗ trợ tiếng Việt có dấu và emoji/icon
            await page.keyboard.insert_text(line)
        if i < len(lines) - 1:
            await page.keyboard.press("Enter")  # xuống dòng
        await asyncio.sleep(random.uniform(0.05, 0.25))


async def _attach_images(page: Page, dialog: Locator, images: list[str]) -> None:
    file_input = dialog.locator('input[type="file"]')
    if await file_input.count() == 0:
        # Chưa có ô chọn file => bấm nút "Ảnh/video" để hiện ra
        await dialog.get_by_role("button", name=PHOTO_BUTTON).first.click()
        await human_pause(1.0, 2.0)
    if await file_input.count() == 0:
        raise RuntimeError("Không tìm thấy ô tải ảnh trong hộp thoại đăng bài")
    # Gán file trực tiếp vào <input type=file>, không cần mở hộp thoại chọn file của Windows
    await file_input.first.set_input_files(images)


async def _wait_post_enabled(button: Locator, controls: Controls, timeout: float = 90) -> None:
    """Chờ nút Đăng hết bị khoá (ảnh đang tải lên thì nút bị aria-disabled)."""
    for _ in range(int(timeout * 2)):
        await controls.checkpoint()
        if await button.get_attribute("aria-disabled") != "true":
            return
        await asyncio.sleep(0.5)
    raise RuntimeError("Nút Đăng vẫn bị khoá sau 90 giây (ảnh tải lên quá lâu?)")


async def _wait_dialog_closed(dialog: Locator, controls: Controls, timeout: float) -> bool:
    """Chờ hộp thoại đăng bài đóng lại. True = đã đóng, False = bị bỏ qua (skip)."""
    for _ in range(int(timeout * 2)):
        await controls.checkpoint()
        if controls.skip.is_set():
            return False
        if not await dialog.is_visible():
            return True
        await asyncio.sleep(0.5)
    raise RuntimeError(f"Hộp thoại không đóng sau {int(timeout)} giây")


async def screenshot(page: Page, tag: str) -> str | None:
    name = f"{datetime.now():%Y%m%d_%H%M%S}_{tag}.png"
    try:
        await page.screenshot(path=str(SHOT_DIR / name), full_page=False)
        return name
    except Exception:
        return None


async def post_to_group(
    page: Page, url: str, text: str, images: list[str], mode: str, controls: Controls
) -> tuple[str, str]:
    """Đăng bài vào 1 nhóm. Trả về (trạng thái, ghi chú).

    trạng thái: "posted" | "manual_posted" | "skipped"
    Lỗi => ném Exception (job sẽ ghi log + chụp màn hình).
    """
    controls.skip.clear()
    await page.goto(url, wait_until="domcontentloaded")
    await page.bring_to_front()
    await human_pause(2.5, 5.0)
    await controls.checkpoint()

    if "/login" in page.url or "checkpoint" in page.url:
        raise RuntimeError("Facebook yêu cầu đăng nhập/xác minh, hãy đăng nhập lại ở Bước 1")

    # 1) Mở khung soạn bài
    trigger = page.get_by_text(COMPOSER_TRIGGER).first
    try:
        await trigger.wait_for(state="visible", timeout=20_000)
    except PWTimeout:
        raise RuntimeError("Không thấy ô 'Bạn viết gì đi...' (chưa vào nhóm, nhóm cấm đăng, hoặc FB đổi giao diện)")
    await trigger.scroll_into_view_if_needed()
    await human_pause()
    await trigger.click()

    # 2) Tìm hộp thoại có ô nhập nội dung
    dialog = page.locator('div[role="dialog"]').filter(has=page.locator(TEXTBOX_CSS)).last
    box = dialog.locator(TEXTBOX_CSS).first
    await box.wait_for(state="visible", timeout=15_000)
    await human_pause()
    await controls.checkpoint()

    # 3) Nhập nội dung + gắn ảnh
    await _type_text(page, box, text)
    await human_pause()
    if images:
        await controls.checkpoint()
        await _attach_images(page, dialog, images)
        await human_pause(2.0, 4.0)

    post_btn = dialog.get_by_role("button", name=POST_BUTTON).last

    # 4a) Bán tự động: chờ bạn tự bấm Đăng
    if mode == "semi":
        closed = await _wait_dialog_closed(dialog, controls, SEMI_WAIT_SECONDS)
        if not closed:
            return "skipped", "Bạn đã bấm Bỏ qua"
        return "manual_posted", "Hộp thoại đã đóng (bạn đã bấm Đăng hoặc tự đóng)"

    # 4b) Tự động: chờ nút Đăng mở khoá rồi bấm
    await _wait_post_enabled(post_btn, controls)
    await human_pause(1.0, 2.5)
    await controls.checkpoint()
    await post_btn.click()
    await _wait_dialog_closed(dialog, controls, 90)
    await human_pause(2.0, 4.0)
    return "posted", "Đã bấm Đăng (nếu nhóm duyệt bài, bài sẽ ở trạng thái chờ duyệt)"
