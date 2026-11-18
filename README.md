# Tool đăng bài nhóm Facebook (Windows, giao diện web)

## Cài đặt (1 lần)
1. Cài **Python 3.10 trở lên** từ https://www.python.org/downloads/. Khi cài, nhớ tick **"Add python.exe to PATH"**.
2. Giải nén thư mục `fb_group_poster`, bấm đúp **`setup.bat`**. Script sẽ cài thư viện và trình duyệt Chromium, mất khoảng 2–5 phút.

## Sử dụng
Bấm đúp **`start.bat`**, trang http://127.0.0.1:8000 tự mở. Giao diện có 4 bước, bấm **Tiếp tục →** để sang bước sau:

1. **Đăng nhập**: bấm *Mở Facebook để đăng nhập*, rồi đăng nhập trong cửa sổ Chrome vừa mở. Tool tự nhận biết và chuyển sang bước 2.
2. **Chọn nhóm**: dán link nhóm vào ô (tool tự thêm khi dán), bỏ tick nhóm không muốn đăng. *💾 Lưu* để dùng lại; *📂 Danh sách đã lưu* để mở lại.
3. **Nội dung**: gõ bài, *😊 Biểu tượng* để chèn emoji, *🖼 Thêm ảnh* (tối đa 10). *💾 Lưu* thành mẫu để dùng lại.
4. **Đăng bài**: chọn *Ai bấm nút Đăng?* và tốc độ (*Chậm / Vừa / Nhanh*), rồi bấm **▶ Bắt đầu đăng**. Giới hạn số bài mỗi ngày và khung giờ nằm trong *Tuỳ chỉnh thêm*.

Nội dung đang soạn được tự lưu; tải lại trang không bị mất.

> **Đừng đóng cửa sổ Chrome của tool khi đang chạy.** Có thể thu nhỏ nó xuống.
> Tắt tool: đóng cửa sổ đen (cmd) của `start.bat`.

### Hai chế độ
| Chế độ | Tool làm gì | Bạn làm gì |
|---|---|---|
| **Bán tự động** (khuyên dùng) | Mở nhóm, điền nội dung và ảnh | Kiểm tra rồi bấm **Đăng** trên Facebook (tool chờ tối đa 15 phút). Bấm **Bỏ qua** trên web nếu không muốn đăng nhóm đó |
| **Tự động** | Làm hết, kể cả bấm Đăng | Chỉ theo dõi |

### Nút "Bỏ qua"
- Khi **đang đăng** một nhóm: bỏ qua nhóm đó.
- Khi **đang chờ** giữa 2 nhóm: không chờ nữa, đăng nhóm tiếp theo ngay.

## Giới hạn an toàn có sẵn
- Chế độ tự động: giãn cách tối thiểu **3 phút**.
- Tối đa **30 bài/ngày**. Bộ đếm reset lúc 0h.
- Thời gian chờ giữa các nhóm và giữa các thao tác là **ngẫu nhiên**.

Dù vậy, đăng tự động vẫn **vi phạm điều khoản của Facebook** và có thể bị hạn chế tài khoản. Hãy chỉ đăng vào nhóm bạn đã tham gia và nội dung hợp với nhóm.

## Khi tool báo lỗi "Không thấy ô Bạn viết gì đi..."
Nguyên nhân có thể là:
- bạn chưa tham gia nhóm,
- nhóm tắt quyền đăng bài,
- hoặc Facebook đã đổi giao diện.

Xem ảnh lỗi trong `data/screenshots/`. Nếu là do Facebook đổi giao diện, sửa phần `SELECTOR` ở đầu file `poster.py`.

## Cấu trúc thư mục
```
fb_group_poster/
├── setup.bat / start.bat   # cài đặt / chạy trên Windows
├── main.py                 # web server + các API
├── browser.py              # mở Chromium, giữ phiên đăng nhập
├── poster.py               # thao tác đăng 1 bài vào 1 nhóm
├── scheduler.py            # chạy lần lượt các nhóm, giãn cách, khung giờ, giới hạn
├── storage.py              # lưu/đọc dữ liệu JSON
├── static/                 # giao diện web (HTML/CSS/JS)
└── data/                   # tự tạo khi chạy: phiên đăng nhập, ảnh, cấu hình, lịch sử
```
`data/browser_profile/` chứa phiên đăng nhập Facebook. **Không gửi thư mục này cho người khác.**

---

## Giải thích các API

### A. API của web server (`main.py`)
Giao diện web gọi các API này bằng `fetch()`.

| API | Công dụng |
|---|---|
| `POST /api/login/open` | Mở Chromium (nếu chưa mở) và vào facebook.com để bạn đăng nhập |
| `POST /api/login/check` | Kiểm tra đã đăng nhập chưa (tìm cookie `c_user`) |
| `POST /api/browser/close` | Đóng Chromium (không cho đóng khi job đang chạy) |
| `POST /api/groups/parse` | Nhận văn bản nhiều dòng, trả về link nhóm hợp lệ (đã chuẩn hoá, bỏ trùng) và các link sai |
| `GET /api/groups` | Lấy các danh sách nhóm đã lưu |
| `POST /api/groups` | Lưu một danh sách nhóm theo tên |
| `DELETE /api/groups/{name}` | Xoá một danh sách nhóm |
| `POST /api/upload` | Tải ảnh lên (`multipart/form-data`), lưu vào `data/uploads/` với tên ngẫu nhiên |
| `GET/POST/DELETE /api/templates` | Đọc, lưu, xoá mẫu bài đăng (nội dung + ảnh) |
| `GET /api/settings` | Lấy cấu hình thời gian |
| `POST /api/settings` | Lưu cấu hình. Server tự kẹp giá trị về mức an toàn và trả về giá trị đã lưu |
| `POST /api/job/start` | Kiểm tra dữ liệu rồi bắt đầu job đăng bài chạy nền |
| `POST /api/job/pause` · `resume` · `skip` · `stop` | Tạm dừng, tiếp tục, bỏ qua, dừng job |
| `GET /api/status` | Trạng thái trình duyệt, đăng nhập, số bài hôm nay, tiến trình từng nhóm. Giao diện gọi API này mỗi giây |
| `GET /api/history` | 200 bản ghi đăng bài gần nhất (từ `data/history.jsonl`) |

### B. API Playwright dùng để điều khiển trình duyệt (`browser.py`, `poster.py`)

| API | Công dụng trong tool |
|---|---|
| `async_playwright().start()` | Khởi động Playwright |
| `chromium.launch_persistent_context(user_data_dir, headless=False)` | Mở Chrome **có lưu profile ra ổ đĩa**, nên cookie đăng nhập còn nguyên sau khi tắt tool. Đây là cách giữ đăng nhập mà không cần lưu mật khẩu |
| `context.cookies(url)` | Đọc cookie của facebook.com. Có `c_user` nghĩa là đã đăng nhập |
| `context.on("close", ...)` | Biết khi bạn tự đóng cửa sổ Chrome |
| `page.goto(url, wait_until="domcontentloaded")` | Mở trang nhóm, chờ HTML tải xong |
| `page.on("dialog", ...)` | Tự bấm "Rời đi" khi trình duyệt hỏi "Rời khỏi trang?" để không bị kẹt |
| `page.get_by_text(regex)` | Tìm ô "Bạn viết gì đi..." theo chữ hiển thị (hỗ trợ cả giao diện tiếng Việt và tiếng Anh) |
| `page.locator(css).filter(has=...)` | Tìm đúng hộp thoại đăng bài: `div[role=dialog]` có chứa ô nhập `contenteditable` |
| `locator.get_by_role("button", name=regex)` | Tìm nút theo vai trò và tên trợ năng (`aria-label`), ví dụ nút "Đăng" hay "Ảnh/video". Ổn định hơn tìm theo class CSS vì class của Facebook là chuỗi ngẫu nhiên |
| `locator.wait_for(state="visible", timeout=...)` | Chờ phần tử xuất hiện; quá thời gian thì báo lỗi |
| `locator.click()` | Bấm chuột vào phần tử (Playwright tự cuộn tới và chờ phần tử bấm được) |
| `page.keyboard.insert_text(text)` | Chèn chữ vào ô nhập, giữ đúng tiếng Việt có dấu và emoji |
| `page.keyboard.press("Enter")` | Xuống dòng giữa các dòng nội dung |
| `locator.set_input_files([...])` | Gán ảnh trực tiếp vào `<input type="file">`, không cần mở cửa sổ chọn file của Windows |
| `locator.get_attribute("aria-disabled")` | Kiểm tra nút Đăng còn bị khoá không (Facebook khoá nút trong lúc ảnh đang tải lên) |
| `locator.is_visible()` | Kiểm tra hộp thoại đã đóng chưa. Đóng nghĩa là đã đăng xong |
| `page.screenshot(path=...)` | Chụp màn hình khi lỗi, lưu vào `data/screenshots/` |

### C. API Python dùng để chạy nền (`browser.py`, `scheduler.py`)

| API | Công dụng |
|---|---|
| `asyncio.ProactorEventLoop()` | Loại event loop mà Windows cần để Playwright mở được tiến trình Chrome |
| `threading.Thread(target=loop.run_forever)` | Chạy event loop của trình duyệt trong một luồng riêng, tách khỏi web server |
| `asyncio.run_coroutine_threadsafe(coro, loop)` | Web server gửi một việc sang luồng trình duyệt |
| `asyncio.wrap_future(fut)` | Web server `await` kết quả từ luồng trình duyệt mà không bị treo |
| `threading.Event` | "Công tắc" Dừng / Tạm dừng / Bỏ qua, an toàn khi dùng giữa 2 luồng |
| `random.uniform(min, max)` | Chọn thời gian chờ ngẫu nhiên giữa các nhóm và các thao tác |
