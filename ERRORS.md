# ERRORS.md - Nhật ký Theo dõi và Học hỏi từ Lỗi

## 2026-06-22 09:40 - Lỗi Audio Permission Primer: NotReadableError

- **Type**: Runtime
- **Severity**: Low
- **File**: `entrypoints/offscreen/main.ts:206`
- **Agent**: Antigravity Orchestrator
- **Root Cause**: Chrome ném ra lỗi `NotReadableError` khi thiết bị âm thanh mặc định bị ứng dụng khác chiếm dụng hoặc không mở được lúc khởi tạo offscreen audio permission primer.
- **Error Message**: 
  ```
  [offscreen] audio permission primer: NotReadableError
  ```
- **Fix Applied**: Thêm `NotReadableError` vào danh sách ngoại lệ được lọc và chuyển sang ghi log info/debug dịu hơn trong `primeOffscreenAudioPermission()`, thay vì log warning gây nhiễu và lo lắng cho người dùng.
- **Prevention**: Đảm bảo các lỗi truy cập thiết bị tạm thời không được xem là fatal và được dập tắt/xử lý mượt mà ở giai đoạn khởi động (primer).
- **Status**: Fixed

---

## 2026-06-22 09:42 - Lỗi Heartbeat update: TypeError: Cannot read properties of undefined (reading 'local')

- **Type**: Runtime
- **Severity**: High
- **File**: `utils/recording.ts:292`
- **Agent**: Antigravity Orchestrator
- **Root Cause**: Trong cấu hình Manifest V3, Offscreen Document không thể truy cập trực tiếp `chrome.storage.local` do API này không khả dụng trực tiếp hoặc thiếu cấu hình trong ngữ cảnh offscreen.
- **Error Message**: 
  ```
  [recorder] failed to update heartbeat: TypeError: Cannot read properties of undefined (reading 'local')
  ```
- **Fix Applied**: Chuyển đổi hàm `updateHeartbeat()` trong `ScreenRecorder` để gửi message `RECORDING_HEARTBEAT` về background. Trong `background.ts`, thêm xử lý message này để thay offscreen cập nhật thông tin ghi âm vào `chrome.storage.local` một cách an toàn.
- **Prevention**: Luôn tuân thủ nguyên tắc thiết kế MV3: Offscreen Document nên đóng vai trò là một trang phụ trợ xử lý DOM/Media, mọi thao tác lưu trữ hay quản lý trạng thái tập trung nên được ủy thác cho Background/Service Worker qua hệ thống truyền tin (Message Passing).
- **Status**: Fixed

---

## 2026-06-22 09:47 - Lỗi Cảnh báo dataavailable trống: [recorder] dataavailable fired with empty data

- **Type**: Process
- **Severity**: Low
- **File**: `utils/recording.ts:147`
- **Agent**: Antigravity Orchestrator
- **Root Cause**: Khi MediaRecorder kết thúc ghi âm (stop), Chrome theo thiết kế sẽ phát ra sự kiện ondataavailable cuối cùng trống (size = 0). Code cũ log cảnh báo warn cho tất cả trường hợp, gây nhiễu log.
- **Error Message**: 
  ```
  [recorder] dataavailable fired with empty data
  ```
- **Fix Applied**: Thêm kiểm tra trạng thái của `mediaRecorder`. Chỉ in log warning nếu sự kiện xảy ra khi đang ở trạng thái `'recording'`, nếu ở trạng thái dừng hoặc inactive thì log info bình thường.
- **Prevention**: Luôn phân loại rõ ràng trạng thái hoạt động của các API trình duyệt (active vs stopping) để tránh in cảnh báo sai lệch cho các hành vi bình thường của hệ thống.
- **Status**: Fixed

---
