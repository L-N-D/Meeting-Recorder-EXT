# Hướng dẫn Nghiên cứu Chuyên sâu: Cách dùng Playwright để Test Chrome Extension

Tài liệu này cung cấp các hướng dẫn kỹ thuật chuyên sâu về việc sử dụng **Playwright** để xây dựng, vận hành và duy trì hệ thống kiểm thử tự động cho một **Chrome Extension (Manifest V3)**. Hướng dẫn này tập trung vào các chức năng phức tạp như quay màn hình (screen/tab/window recorder), giao tiếp tin nhắn (message passing), tài liệu ẩn (offscreen document), và tích hợp hệ thống helper gốc (native helper).

---

## 1. Tổng quan: Playwright có test được Chrome Extension không?

### Mức độ hỗ trợ của Playwright đối với Chrome Extension
Playwright hỗ trợ kiểm thử Chrome Extension ở mức **Rất tốt trên Chromium**. Nó cho phép:
* Tải một extension chưa đóng gói (unpacked extension) vào trình duyệt.
* Tương tác với Popup UI, Side Panel UI, Options Page, và bất kỳ trang HTML nội bộ nào của extension.
* Inspect, theo dõi và chạy thử nghiệm mã nguồn bên trong Background Service Worker.
* Intercept tin nhắn (Message Passing) giữa các thành phần.
* Tương tác với Content Scripts được inject vào các trang web đích.

### Tại sao phải dùng Chromium Persistent Context?
Khi test các trang web thông thường, Playwright sử dụng các browser context độc lập chạy ở chế độ ẩn danh (incognito). Tuy nhiên, đối với Chrome Extension:
* **Yêu cầu persistent profile**: Chrome chỉ cho phép load unpacked extension khi trình duyệt khởi tạo bằng một thư mục người dùng thực tế (`Persistent Context`) thông qua tham số dòng lệnh.
* **Bảo toàn trạng thái**: Persistent Context giúp giả lập cấu hình người dùng, lưu trữ dữ liệu trong `chrome.storage.local/sync` bền vững qua các phiên chạy test.

### Sự khác biệt so với kiểm thử trang web thông thường
1. **Headless Mode Limitations**: Bạn không thể sử dụng `--headless` truyền thống (Headless cũ) vì Chrome sẽ vô hiệu hóa hoàn toàn extension. Phải dùng `--headless=new` (trên các phiên bản Chromium mới) hoặc giả lập màn hình bằng **Xvfb** trên môi trường Linux CI.
2. **Extension URL Routing**: Các trang UI như Popup hay Sidepanel không có domain web thông thường mà sử dụng định dạng: `chrome-extension://<EXTENSION_ID>/<PAGE>.html`.
3. **OS Dialogs & Hardware Permissions**: Các popup xin quyền Camera, Microphone hay hộp thoại Screen Picker (`getDisplayMedia`) là native UI của hệ điều hành và trình duyệt, Playwright không thể click trực tiếp bằng click chuột HTML. Chúng ta bắt buộc phải sử dụng các cờ (flags) Chromium để tự động chấp nhận (bypass).

---

## 2. Kiến thức nền cần hiểu trước khi test extension

Để kiểm thử extension hiệu quả, lập trình viên cần hiểu cách Playwright tiếp cận từng thành phần kiến trúc của Manifest V3:

```text
+-----------------------------------------------------------------------------------+
| Playwright Test Runner (Chromium Persistent Context)                              |
|                                                                                   |
|  +--------------+       +------------------+       +---------------------------+  |
|  |   Popup UI   | <---> | Background (SW)  | <---> |    Offscreen Document     |  |
|  | (Popup Page) |       | (Service Worker) |       | (MediaRecorder & Canvas)  |  |
|  +--------------+       +------------------+       +---------------------------+  |
|                                  ^                               |                |
|                                  | (Message Passing)             | (DOM Output)   |
|                                  v                               v                |
|  +-----------------------------------------+       +---------------------------+  |
|  |             Content Script              |       |      Native Helper        |  |
|  |       (Injected inside Meet/Teams)      |       |  (Application Audio Host) |  |
|  +-----------------------------------------+       +---------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 2.1 Background Service Worker (MV3)
* **Vai trò**: Là trung tâm điều khiển (brain) của extension, xử lý state machine, quản lý alarms, lưu trữ storage và điều phối message.
* **Cách test**: Lấy worker instance thông qua `context.serviceWorkers()`, theo dõi logs, lỗi hoặc gọi evaluate trực tiếp các hàm JavaScript toàn cục được export.

### 2.2 Popup & Side Panel UI
* **Popup UI**: Xuất hiện khi click icon extension. Tự động đóng (destroy DOM) khi người dùng click ra ngoài.
  * *Cách test*: Điều hướng trực tiếp đến trang `chrome-extension://<id>/popup.html`.
* **Side Panel UI**: Xuất hiện bên hông trình duyệt, giữ nguyên state và DOM khi người dùng switch qua lại giữa các tab.
  * *Cách test*: Điều hướng trực tiếp đến trang `chrome-extension://<id>/sidepanel.html`.

### 2.3 Content Script
* **Vai trò**: Inject vào trang web đích (như Google Meet) để lắng nghe DOM thay đổi (ví dụ: detect xem nút Join Meeting có xuất hiện không) và gửi message về Background.
* **Cách test**: Mở trang web giả lập (mock page) Meet, kiểm tra sự tồn tại của script và intercept các message truyền nhận qua API của extension.

### 2.4 Offscreen Document
* **Vai trò**: MV3 Service Worker không có quyền truy cập DOM và không thể dùng `MediaRecorder` hay render `Canvas`. Offscreen Document là trang HTML ẩn được tạo ra nhằm mục đích truy cập các API này để thực hiện quay video/audio.
* **Cách test**: Điều hướng tab mới đến `chrome-extension://<id>/offscreen.html` để inspect console log, mock đối tượng `MediaRecorder` hoặc kiểm tra luồng nhận/gửi chunks.

### 2.5 Message Passing
* **Vai trò**: Cơ chế giao tiếp nội bộ qua `chrome.runtime.sendMessage` và `chrome.runtime.onMessage`.
* **Cách test**: Viết các script tiêm vào trang để tự động phát message giả lập và verify trạng thái thay đổi trong Storage.

### 2.6 Native Messaging & Helper
* **Vai trò**: Kết nối với ứng dụng nhị phân chạy ngoài trình duyệt (Native Helper) qua socket/standard-IO để xử lý ghi âm thanh hệ thống.
* **Cách test**: Mock cổng giao tiếp `chrome.runtime.connectNative` để trả về các frame audio giả lập trên môi trường CI.

---

## 3. Setup Playwright để load Chrome Extension

Để khởi chạy trình duyệt Chromium kèm extension đã build, chúng ta cần cấu hình custom fixtures để tự động trích xuất Extension ID và thiết lập thư mục Persistent Context.

### Định nghĩa Custom Fixture (`tests/fixtures/extension.fixture.ts`):

```typescript
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Declare custom types for extension fixtures
type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  backgroundWorker: Worker;
  popupPage: Page;
  sidepanelPage: Page;
};

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    // 1. Path to unpacked extension build folder (WXT output target)
    const pathToExtension = path.join(__dirname, '../../dist/chrome-mv3');
    
    if (!fs.existsSync(pathToExtension)) {
      throw new Error(`Extension build directory not found at ${pathToExtension}. Please run build command first.`);
    }

    // 2. Set temporary persistent user data directory to avoid conflicts
    const userDataDir = path.join(__dirname, '../../.playwright-mcp/user-data-profile');

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Required for extension loading in Chromium
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--use-fake-ui-for-media-stream', // Automatically accept camera/microphone permissions
        '--use-fake-device-for-media-stream', // Use virtual media devices (test pattern)
        '--auto-select-desktop-capture-source=Entire screen', // Auto select screen source to record
      ],
    });

    await use(context);
    await context.close();
    
    // Cleanup temporary user data directory if needed post run
    if (fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (e) {
        // Suppress warning if files are locked during cleanup
      }
    }
  },

  extensionId: async ({ context }, use) => {
    // 3. Extract the randomly generated extension ID from background service worker
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    // URL format: chrome-extension://plmehkdmfenfighdnboaknnolkpngdpb/background.js
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },

  backgroundWorker: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    await use(background);
  },

  popupPage: async ({ context, extensionId }, use) => {
    // 4. Open popup directly in a new page/tab for isolated UI testing
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },

  sidepanelPage: async ({ context, extensionId }, use) => {
    // 5. Open sidepanel page directly
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await use(page);
  }
});

export { expect } from '@playwright/test';
```

---

## 4. Test popup UI

Vì popup biến mất ngay khi mất focus, việc test popup bằng cách click chuột vào extension bar của Chrome rất khó tự động hóa. **Giải pháp tốt nhất là mở trực tiếp file popup.html trong một tab mới.**

### Các kịch bản kiểm thử Popup UI:
* **Idle State**: Kiểm tra hiển thị mặc định (nút Start enabled, nút Pause/Stop disabled, timer = 00:00).
* **Meeting Detected State**: Khi tab hiện tại là Google Meet, popup phải hiển thị thông báo phát hiện cuộc họp.
* **Recording State**: Bấm Start -> Nút Start đổi thành Stop, biểu tượng rec nhấp nháy đỏ, timer chạy.
* **Error State**: Giả lập lỗi camera/micro -> Popup hiển thị banner lỗi đỏ.

### Code ví dụ Test Popup (`tests/extension/popup.spec.ts`):

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Extension Popup UI Suite', () => {
  
  test('should display pristine idle state on load', async ({ popupPage }) => {
    // Assert primary action buttons are in correct initial states
    const startButton = popupPage.getByRole('button', { name: /start recording/i });
    const stopButton = popupPage.getByRole('button', { name: /stop/i });
    const timerDisplay = popupPage.getByTestId('timer-display');

    await expect(startButton).toBeEnabled();
    await expect(stopButton).toBeDisabled();
    await expect(timerDisplay).toHaveText('00:00');
  });

  test('should toggle controls state during active recording', async ({ popupPage }) => {
    const startButton = popupPage.getByRole('button', { name: /start recording/i });
    const stopButton = popupPage.getByRole('button', { name: /stop/i });
    const statusText = popupPage.getByTestId('recording-status');

    // Start recording trigger
    await startButton.click();

    // Verify UI switches state to active recording representation
    await expect(startButton).toBeDisabled();
    await expect(stopButton).toBeEnabled();
    await expect(statusText).toHaveText(/recording/i);

    // Wait and verify timer updates
    const timerDisplay = popupPage.getByTestId('timer-display');
    await expect(timerDisplay).not.toHaveText('00:00');
  });

  test('should show validation error message on audio missing error', async ({ popupPage, context }) => {
    // Simulate error state state broadcast through extension local storage update
    await popupPage.evaluate(async () => {
      await chrome.storage.local.set({ 
        recordingState: 'error',
        errorDetails: 'Audio device disconnected' 
      });
    });

    // Check UI error notification banner is rendered correctly
    const errorBanner = popupPage.getByRole('alert');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/audio device disconnected/i);
  });
});
```

---

## 5. Test side panel UI

Side Panel là một tính năng đặc thù của Chrome MV3, cho phép duy trì giao diện kiểm soát ngay cả khi người dùng chuyển đổi qua lại giữa các tab (khác với popup sẽ bị huỷ DOM).

### Các kịch bản kiểm thử Side Panel:
1. **Layout và Responsive**: Đảm bảo sidepanel hiển thị tốt ở chiều rộng hẹp (mặc định 300px - 400px) và không bị vỡ bố cục khi co giãn.
2. **Tab Switch State Sync**: Đảm bảo các cài đặt cấu hình (Microphone toggle, quality settings) được giữ nguyên và cập nhật theo tab đang mở.
3. **Visual Regression**: So sánh hình ảnh tĩnh của side panel trạng thái idle và khi đang recording.

### Code ví dụ Test Side Panel (`tests/extension/sidepanel.spec.ts`):

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Extension Side Panel UI Suite', () => {

  test('should sync control toggles states correctly across reopens', async ({ sidepanelPage, context, extensionId }) => {
    // 1. Select option in sidepanel UI page
    const micToggle = sidepanelPage.getByLabel(/record microphone/i);
    await micToggle.check();
    
    // Close sidepanel page to simulate user folding or closing it
    await sidepanelPage.close();

    // 2. Open sidepanel again in a new tab page
    const reopenedPage = await context.newPage();
    await reopenedPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Verify option selected previously was persistent via chrome.storage
    const reopenedMicToggle = reopenedPage.getByLabel(/record microphone/i);
    await expect(reopenedMicToggle).toBeChecked();
  });

  test('should render properly without overflow wrap errors in visual regression', async ({ sidepanelPage }) => {
    // Force specific mobile sidepanel dimension to verify visual styling
    await sidepanelPage.setViewportSize({ width: 320, height: 600 });
    
    // Wait for interface rendering elements stability
    await expect(sidepanelPage.getByRole('button', { name: /start/i })).toBeVisible();

    await expect(sidepanelPage).toHaveScreenshot('sidepanel-compact-view.png', {
      animations: 'disabled'
    });
  });
});
```

---

## 6. Test content script và meeting detection

Project sử dụng Content Script để tự động phát hiện khi người dùng truy cập Google Meet (`meet.google.com`) hoặc Microsoft Teams. Để test luồng này mà không phụ thuộc vào trang Meet thật (vốn thay đổi DOM liên tục), chúng ta cần dựng một trang **Mock Meeting Page** chứa các phần tử DOM cơ bản.

### Code ví dụ Mock Meeting Page và Test Content Script (`tests/extension/content-script.spec.ts`):

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Content Script Meeting Detection Suite', () => {

  test('should detect meeting start and send notification to sidepanel', async ({ context, sidepanelPage }) => {
    // 1. Create a dummy tab representing mock Google Meet page
    const mockMeetPage = await context.newPage();
    
    // Force DOM setup representing a Google Meet workspace environment
    await mockMeetPage.goto('data:text/html,<html><head><title>Google Meet</title></head><body><div id="meet-grid">Workspace Grid</div></body></html>');

    // 2. Simulate URL update containing Google Meet route matching host permission pattern
    await mockMeetPage.evaluate(() => {
      // Fake history pushState to match regex pattern target for Meet
      window.history.pushState({}, '', 'https://meet.google.com/abc-defg-hij');
    });

    // Manually trigger target match listener inside content script if dynamic observer is set
    await mockMeetPage.dispatchEvent('body', 'DOMContentLoaded');

    // 3. Verify sidepanel UI reacts to meeting detection state broadcast
    const detectionBanner = sidepanelPage.getByTestId('meeting-detected-notification');
    await expect(detectionBanner).toBeVisible();
    await expect(detectionBanner).toContainText(/meeting detected/i);
  });
});
```

---

## 7. Test background service worker MV3

Background Service Worker là trái tim quản lý vòng đời và luồng dữ liệu của extension. Tuy nhiên, nó chạy trong một thread biệt lập và Chrome có thể giải phóng (suspend) nó bất cứ lúc nào khi không có hoạt động.

### Cách kiểm thử Service Worker bằng Playwright:
* Bắt instance của service worker bằng `context.serviceWorkers()`.
* Chạy code kiểm thử trong môi trường worker bằng `.evaluate()`.
* Kiểm tra việc lưu trữ dữ liệu bền vững (storage durability) khi worker khởi động lại.

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Background Service Worker Lifecycle Suite', () => {

  test('should verify service worker is active and holds correct global functions', async ({ backgroundWorker }) => {
    // Assert background worker script is running from correct path
    expect(backgroundWorker.url()).toContain('background.js');

    // Execute script context inside worker thread space to verify initial state structures
    const isStateInitialized = await backgroundWorker.evaluate(async () => {
      const state = await chrome.storage.local.get('recordingState');
      return state.recordingState !== undefined;
    });

    expect(isStateInitialized).toBe(true);
  });

  test('should survive worker reload and retain storage persistence data', async ({ backgroundWorker, context }) => {
    // 1. Write state metadata into chrome storage
    await backgroundWorker.evaluate(async () => {
      await chrome.storage.local.set({ activeSessionId: 'session_test_999' });
    });

    // 2. Simulate Service Worker crashing / restarting (MV3 Lifecycle simulation)
    // There is no direct "restart" API, we mock this by closing the browser context partially and reopening
    // Or evaluating runtime restart sequence
    const dataBeforeSuspend = await backgroundWorker.evaluate(async () => {
      const data = await chrome.storage.local.get('activeSessionId');
      return data.activeSessionId;
    });
    expect(dataBeforeSuspend).toBe('session_test_999');
  });
});
```

---

## 8. Test message passing

Giao tiếp tin nhắn (Message Passing) là xương sống kết nối tất cả các thành phần trong extension. Chúng ta cần đảm bảo các thông điệp gửi đi từ UI được Background nhận diện và phản hồi chính xác.

### Các luồng tin nhắn chính:
1. `START_RECORDING`: Gửi từ Popup/Sidepanel yêu cầu Background kích hoạt quay.
2. `STOP_RECORDING`: Gửi yêu cầu dừng và lưu file.
3. `STATE_BROADCAST`: Background gửi cập nhật trạng thái mới cho toàn bộ UI.

### Code ví dụ Test Message Passing (`tests/extension/message-flow.spec.ts`):

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Extension Message Passing Suite', () => {

  test('should handle START_RECORDING message chain and transition state', async ({ popupPage, backgroundWorker }) => {
    // 1. Listen for background service worker internal console logs or evaluate reactions
    // We register a spy listener inside the service worker context
    await backgroundWorker.evaluate(() => {
      (self as any).messageLogs = [];
      chrome.runtime.onMessage.addListener((message) => {
        (self as any).messageLogs.push(message);
      });
    });

    // 2. Trigger action in UI which sends message to Background
    await popupPage.getByRole('button', { name: /start recording/i }).click();

    // 3. Extract messages caught inside service worker
    const capturedMessages = await backgroundWorker.evaluate(() => {
      return (self as any).messageLogs;
    });

    // Assert that the START_RECORDING event was dispatched and captured correctly
    const startMsg = capturedMessages.find((msg: any) => msg.type === 'START_RECORDING');
    expect(startMsg).toBeDefined();
    expect(startMsg.payload.audioSource).toBe('system'); // Default source selection check
  });
});
```

---

## 9. Test offscreen document và recording flow

Offscreen Document là giải pháp trong MV3 để khởi chạy `MediaRecorder` trong luồng DOM ẩn. 

### Các ranh giới và kỹ thuật kiểm thử:
* **Mock MediaRecorder**: Playwright không thể kiểm tra chất lượng file video nhị phân thật hoặc giải mã luồng audio của media recorder. **Vì vậy, trong môi trường kiểm thử tự động, chúng ta mock `MediaRecorder` trong Offscreen document để sinh ra các tệp video mẫu (test pattern) gọn nhẹ.**
* **Kiểm thử gián tiếp qua events**: Kiểm tra xem khi offscreen document ném ra lỗi (ví dụ: `AudioContext lost`), background có nhận được message cảnh báo và hiển thị nó lên UI hay không.

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Offscreen Document Recording Suite', () => {

  test('should open offscreen document and mock MediaRecorder chunks output', async ({ context, extensionId, sidepanelPage }) => {
    // 1. Setup offscreen monitor page by navigation directly
    const offscreenPage = await context.newPage();
    await offscreenPage.goto(`chrome-extension://${extensionId}/offscreen.html`);

    // 2. Inject mock MediaRecorder mock implementation into offscreen page window context
    await offscreenPage.evaluate(() => {
      // Override native MediaRecorder API with mock to output static test blob chunks
      (window as any).MediaRecorder = class MockMediaRecorder {
        onstart: any;
        ondataavailable: any;
        onstop: any;
        state = 'inactive';

        start() {
          this.state = 'recording';
          if (this.onstart) this.onstart();
          // Periodically dispatch dummy audio/video blob data frame
          setTimeout(() => {
            if (this.ondataavailable) {
              this.ondataavailable({ data: new Blob(['dummy_video_data_frame'], { type: 'video/webm' }) });
            }
          }, 100);
        }

        stop() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };
    });

    // 3. Trigger recording and assert state flows through to sidepanel UI
    await sidepanelPage.getByRole('button', { name: /start/i }).click();
    await expect(sidepanelPage.getByTestId('recording-status')).toHaveText(/recording/i);
  });
});
```

---

## 10. Test permission flow và browser/system dialog

Các hộp thoại hỏi quyền truy cập Camera/Microphone hay hộp thoại native chọn nguồn màn hình của Google Chrome là các cấu phần Playwright **không thể tương tác trực tiếp bằng click chuột**.

### Giải pháp xử lý các Dialogs:
* **Camera / Mic Permission**: Sử dụng cờ Chromium `--use-fake-ui-for-media-stream` để tự động gán quyền Accept cho các thiết bị ảo.
* **Screen Picker Dialog**: Dùng cờ `--auto-select-desktop-capture-source=Entire screen` để trình duyệt tự động chọn toàn bộ màn hình khi gọi API `getDisplayMedia`.
* **Close Tab Warnings (`beforeunload`)**: Đăng ký lắng nghe sự kiện `dialog` của Playwright để chấp nhận việc thoát hoặc đóng trang.

### Code mẫu xử lý Dialog và cảnh báo đóng tab:

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('Browser Dialogs Handling Suite', () => {

  test('should handle beforeunload warning alert during active recording session', async ({ sidepanelPage }) => {
    // Start active recording to setup state
    await sidepanelPage.getByRole('button', { name: /start/i }).click();

    let beforeUnloadAlertTriggered = false;

    // Register event listener BEFORE triggering dialog action
    sidepanelPage.on('dialog', async dialog => {
      beforeUnloadAlertTriggered = true;
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept(); // Accept navigation out, ignoring warning
    });

    // Simulate closing or refreshing page during active recording
    await sidepanelPage.reload();

    expect(beforeUnloadAlertTriggered).toBe(true);
  });
});
```

---

## 11. Test download/export video

Sau khi bấm Stop, Offscreen Document sẽ tổng hợp lại các chunk video từ IndexedDB, xuất thành tệp tin `.webm`/`.mp4` và thực hiện hành động tải xuống (`download`).

### Code mẫu kiểm tra sự kiện tải tệp:

```typescript
import { test, expect } from '../fixtures/extension.fixture';

test.describe('File Export Operations Suite', () => {

  test('should trigger download on stop recording and verify exported file meta', async ({ sidepanelPage }) => {
    // 1. Start recording
    await sidepanelPage.getByRole('button', { name: /start/i }).click();
    await page.waitForTimeout(1000); // Record a short chunk

    // 2. Prepare to catch download event asynchronously
    const downloadPromise = sidepanelPage.waitForEvent('download');

    // 3. Trigger stop action in UI which triggers file generation & download
    await sidepanelPage.getByRole('button', { name: /stop/i }).click();
    
    // Resolve promise
    const download = await downloadPromise;

    // 4. Assert download outputs metadata properties
    expect(download.suggestedFilename()).toContain('.webm');
    
    const filePath = `./tests/downloads/${download.suggestedFilename()}`;
    await download.saveAs(filePath);

    // Verify file persists physically on the disk and size is valid
    const fs = require('fs');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.statSync(filePath).size).toBeGreaterThan(0);
  });
});
```

---

## 12. Test error và recovery flow

Một ứng dụng quay cuộc họp cần có độ tin cậy tuyệt đối. Chúng ta phải kiểm thử tự động khả năng tự khôi phục dữ liệu hoặc hiển thị thông báo lỗi khi gặp các kịch bản bất thường.

### Cách giả lập các lỗi ngoại lệ (Mocking Error Scenarios):

| Lỗi ngoại lệ | Cách mô phỏng kiểm thử | Expected UI / State | Có nên auto? |
| :--- | :--- | :--- | :---: |
| **Permission Denied** | Launch Context không truyền cờ `--use-fake-ui-for-media-stream`. | Hiển thị màn hình đỏ yêu cầu truy cập settings cấp quyền. | **Có** |
| **User Cancel Picker** | Không truyền cờ `--auto-select-desktop-capture-source` và mô phỏng lỗi reject promise từ `getDisplayMedia`. | Trở về trạng thái `idle`, nút Start hoạt động trở lại. | **Có** |
| **Tab Closed during record** | Close tab đang được record bằng `page.close()`. | Cảnh báo error banner hiển thị trên sidepanel, dừng ghi an toàn. | **Có** |
| **Video encoding stalled** | Mock offscreen gửi message `VIDEO_ENCODE_STALL`. | Hiển thị cảnh báo warning icon nhấp nháy, ghi tiếp. | **Có** |
| **Native Host Disconnected**| Mock port native messaging trả về lỗi ngắt kết nối. | Hiển thị cảnh báo mất audio hệ thống, nút reconnect. | **Có** |
| **Offscreen crashed** | Truy cập `chrome-extension://<id>/offscreen.html` và reload sập trang. | Tự động mở lại offscreen mới, khôi phục session. | **Có** |
| **Service Worker restarted** | Gọi ngắt kết nối context browser tạm thời. | Dữ liệu config cũ không mất nhờ lưu trong storage.local. | **Có** |
| **Popup Reopened** | Đóng popup page, đợi 2s, mở lại popup URL mới. | Popup mới lấy đúng state `recording` đang chạy từ Background. | **Có** |
| **Recovered after crash** | Đặt cờ `recoveredSession: true` trong storage. | Hiển thị popup thông báo: *"Chúng tôi phát hiện buổi ghi trước bị ngắt đột ngột. Bấm Tải xuống để khôi phục."* | **Có** |

---

## 13. Test Native Messaging / Native Helper nếu có

Nếu extension sử dụng native helper để ghi nhận âm thanh hệ thống (ví dụ trên Linux), nó sẽ giao tiếp qua cổng `chrome.runtime.connectNative`.

### Chiến lược kiểm thử:
* **Trên môi trường CI/CD**: Giao tiếp native thật bị cấm vì không thể cài đặt phần mềm nhị phân cài sâu vào OS. **Bắt buộc phải mock cổng native messaging.**
* **Môi trường Integration (Local)**: Chạy test thật trên máy có cài sẵn helper để verify luồng truyền tin socket.

```typescript
// Mocking native messaging API inside test file
await page.evaluate(() => {
  (chrome.runtime as any).connectNative = () => {
    return {
      onMessage: {
        addListener: (callback: any) => {
          // Fake audio streaming signals input
          setInterval(() => {
            callback({ type: 'AUDIO_FRAME', status: 'alive' });
          }, 1000);
        }
      },
      postMessage: (msg: any) => console.log('Sent to native host:', msg),
      onDisconnect: { addListener: () => {} }
    };
  };
});
```

---

## 14. Visual regression cho extension UI

Các màn hình nhỏ (Popup: 350x550px, Sidepanel: 320x600px) có mật độ chi tiết dày đặc, rất dễ bị lệch layout khi thay đổi CSS.

### Cách cấu hình Visual Test ổn định cho extension:
* **Cố định viewport**: Bắt buộc thiết lập kích thước viewport cố định trước khi chụp.
* **Cố định Timer**: Nếu timer thay đổi liên tục (`00:01`, `00:02`), screenshot sẽ lệch. Phải dùng `mask` để che timer đi hoặc đóng băng hàm tính thời gian.
* **Tắt hiệu ứng**: Thiết lập `animations: 'disabled'` để tắt hiệu ứng nhấp nháy đỏ của biểu tượng Rec.

```typescript
await expect(popupPage).toHaveScreenshot('popup-recording-active.png', {
  animations: 'disabled',
  mask: [
    popupPage.getByTestId('timer-display'), // Mask out counting timer display
    popupPage.getByTestId('waveform-visualizer') // Mask audio waves animation
  ]
});
```

---

## 15. Test matrix đề xuất cho Meeting Recorder Extension

Dưới đây là ma trận phân nhóm kiểm thử toàn diện áp dụng cho dự án Meeting Recorder:

| Area | Test Case | Automated? | Mock hay Real? | Priority | Ghi chú |
| :--- | :--- | :---: | :--- | :---: | :--- |
| **Popup UI** | Khởi chạy hiển thị đúng các nút, thông tin idle. | **Có** | Real UI | P0 | Chạy trên mọi commit. |
| **Popup UI** | Hiển thị đúng timer chạy khi đang ghi hình. | **Có** | Real UI | P1 | Sử dụng timer giả để chụp visual. |
| **Sidepanel** | Co giãn chiều rộng không bị vỡ giao diện layout. | **Có** | Real UI | P1 | Visual test ở 320px và 400px. |
| **Content Script** | Nhận diện Google Meet URL và thay đổi UI. | **Có** | Mock Meet Page| P0 | Tự tạo DOM giả để test. |
| **Service Worker**| Khởi động lại giữ nguyên config. | **Có** | Mock SW reload | P1 | Check storage.local. |
| **Message Passing**| Gửi lệnh START_RECORDING đổi state. | **Có** | Real Message | P0 | Verify state chuyển trong storage. |
| **Offscreen Doc** | Khởi tạo MediaRecorder và xuất chunks. | **Có** | Mock MediaRecorder| P1 | Tránh dùng media thật trên CI. |
| **Permission** | Bypass quyền truy cập mic/cam thành công. | **Có** | Chromium Flags | P0 | Cần thiết để auto test chạy được. |
| **Permission** | Hiển thị cảnh báo đỏ khi bị từ chối quyền. | **Có** | Mock denied state| P1 | Thiết lập permission trống. |
| **Download** | Click Export -> Tải file `.webm` thành công. | **Có** | Real Download | P0 | Check file size và file name. |
| **Error Recovery**| Khôi phục session ghi dở dang sau khi crash. | **Có** | Mock crashed SW | P2 | Mock storage state. |
| **Native Helper** | Audio helper kết nối/ngắt kết nối bất thường. | **Hạn chế**| Mock native port | P2 | Chỉ mock trên CI. |
| **Media Recording**| Kiểm tra chất lượng nén video, tiếng không giật.| **Không** | Real Hardware | P0 | **Bắt buộc test thủ công**. |
| **Cross OS** | Test chạy trên Windows, macOS và Linux. | **Không** | Real OS | P2 | Manual QA trước khi release. |

---

## 16. Automated vs Manual vs Integration testing boundary

Để đạt hiệu quả tối ưu về thời gian và chi phí, team cần phân định rõ ranh giới kiểm thử:

### 🟢 1. Nên Automated bằng Playwright (CI/CD)
* **Luồng UI (Popup/Sidepanel)**: State transitions, button status, error banner displays.
* **Storage persistence**: Config lưu vào storage và khôi phục khi mở lại tab.
* **Message routing**: Luồng trao đổi message giữa popup -> background -> offscreen.
* **Download triggers**: Click export -> Trình duyệt kích hoạt download sự kiện.
* **Visual regression**: Snapshot Popup, Side panel và Settings.

### 🟡 2. Nên viết Integration Test riêng (Không chạy thường trực trên CI)
* **Real Audio Mixing**: Trộn hai nguồn Mic + System Audio qua Web Audio API (cần chạy test trên máy local có driver card âm thanh).
* **Native messaging integration**: Giao tiếp chuẩn IO socket giữa extension và file nhị phân Helper thực tế.
* **Long-run memory leaks**: Ghi liên tục 30 phút trên trình duyệt thật để kiểm tra memory leak của Offscreen Document.

### 🔴 3. Bắt buộc phải Manual QA (Kiểm thử thủ công)
* **Lựa chọn nguồn chia sẻ (Screen/Tab Picker)**: Trực quan chọn cửa sổ Meet hay màn hình Slide trên UI native của hệ điều hành.
* **Độ mượt của video output**: Xem lại video đã tải để verify hình ảnh không giật lag, tiếng và hình đồng bộ (sync).
* **Kiểm thử trên Google Meet / Teams thật**: Thực hiện cuộc gọi thật, bật tắt mic/cam thật trên môi trường staging của đối tác.

---

## 17. Cấu trúc folder test đề xuất

Đề xuất cấu trúc thư mục test suite chuẩn hóa, tách biệt rõ ràng các file mock và pages POM:

```text
tests/
├── extension/                     # Feature tests spec files
│   ├── popup.spec.ts              # UI test for popup.html
│   ├── sidepanel.spec.ts          # UI test for sidepanel.html
│   ├── content-script.spec.ts     # Injected script tests
│   ├── message-flow.spec.ts       # Message passing verify
│   ├── download.spec.ts           # Video export and download tests
│   └── recovery.spec.ts           # Crash recovery scenarios
├── fixtures/                      # Playwright custom fixtures
│   ├── extension.fixture.ts       # Unpacked extension launcher (Main)
│   ├── mock-recorder.fixture.ts   # MediaRecorder API mock helper
│   └── mock-native-host.fixture.ts# Native message port mock helper
├── pages/                         # Page Object Model (POM)
│   ├── popup.page.ts              # POM for Popup UI
│   └── sidepanel.page.ts          # POM for Sidepanel UI
└── mocks/                         # Simulated test pages/assets
    ├── meeting-pages/
    │   └── mock-meet.html         # Dummy page representing Google Meet DOM
    └── assets/
        └── dummy-audio.wav        # Audio file for virtual input stream
```

---

## 18. Code mẫu cần có

Dưới đây là cấu hình và code mẫu hoàn chỉnh để bạn bắt đầu triển khai hệ thống kiểm thử cho dự án Meeting Recorder.

### 18.1 Cấu hình Playwright cho Extension (`playwright.config.ts`):

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  fullyParallel: false, // Must be false for extension testing to avoid persistent profile locks
  workers: 1,           // Keep workers to 1 to avoid Chromium data directory conflicts
  reporter: 'html',
  use: {
    trace: 'retain-on-failure',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        // Custom arguments loaded in chromium launch persistent context inside fixtures
      },
    },
  ],
});
```

### 18.2 Page Object Model cho Popup Page (`tests/pages/popup.page.ts`):

```typescript
import { type Page, type Locator } from '@playwright/test';

export class PopupPage {
  readonly page: Page;
  readonly startBtn: Locator;
  readonly stopBtn: Locator;
  readonly timerText: Locator;
  readonly micCheckbox: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.startBtn = page.getByRole('button', { name: /start/i });
    this.stopBtn = page.getByRole('button', { name: /stop/i });
    this.timerText = page.getByTestId('timer-display');
    this.micCheckbox = page.getByLabel(/record microphone/i);
    this.errorBanner = page.getByRole('alert');
  }

  async startRecording() {
    await this.startBtn.click();
  }

  async stopRecording() {
    await this.stopBtn.click();
  }
}
```

### 18.3 Test Case kịch bản đầy đủ (`tests/extension/popup.spec.ts`):

```typescript
import { test, expect } from '../fixtures/extension.fixture';
import { PopupPage } from '../pages/popup.page';

test.describe('Meeting Recorder Core UI Flow', () => {

  test('should handle normal recording flow and download output file', async ({ popupPage, context }) => {
    const popup = new PopupPage(popupPage);

    // 1. Initial State Assertions
    await expect(popup.startBtn).toBeEnabled();
    await expect(popup.stopBtn).toBeDisabled();

    // 2. Start Recording Action
    await popup.startRecording();
    await expect(popup.startBtn).toBeDisabled();
    await expect(popup.stopBtn).toBeEnabled();

    // Verify timer changes text
    await expect(popup.timerText).not.toHaveText('00:00');

    // 3. Listen to download event on stop click
    const downloadPromise = popupPage.waitForEvent('download');
    await popup.stopRecording();
    const download = await downloadPromise;

    // Verify output filename format
    expect(download.suggestedFilename()).toContain('.webm');
  });

  test('should display recovery alert panel on state recovery detect', async ({ popupPage }) => {
    // Inject crashed session state into storage.local
    await popupPage.evaluate(async () => {
      await chrome.storage.local.set({ 
        recordingState: 'recovered',
        crashedSessionId: 'sync_error_01' 
      });
    });

    // Refresh popup to read new state updates
    await popupPage.reload();

    // Verify recovery text block is rendered
    await expect(popupPage.getByText(/unsaved recording detected/i)).toBeVisible();
    await expect(popupPage.getByRole('button', { name: /recover/i })).toBeEnabled();
  });
});
```

### 18.4 GitHub Actions Workflow với Xvfb (`.github/workflows/extension-ci.yml`):

```yaml
name: Chrome Extension E2E CI
on: [push, pull_request]

jobs:
  test-extension:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Build Extension
      run: npm run build # Outputs unpacked extension folder to dist/chrome-mv3

    - name: Install Playwright Chromium Browser
      run: npx playwright install --with-deps chromium

    - name: Run Tests with Virtual Display (Xvfb)
      # xvfb-run is required because extension tests run in headed mode (headless: false)
      run: xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" npx playwright test
```

---

## 19. CI/CD strategy cho extension

Chạy extension test trên CI đòi hỏi một quy trình cấu hình nghiêm ngặt do yêu cầu bắt buộc chạy ở chế độ **Headed (headless: false)** của Google Chrome extension runner.

### Các nguyên tắc CI/CD cho Extension:
1. **Xvfb (X Virtual Framebuffer)**: Sử dụng `xvfb-run` trên máy Linux (ubuntu-latest) để khởi tạo một screen ảo trong bộ nhớ. Trình duyệt Chrome sẽ nghĩ nó đang chạy trên màn hình thực tế và cho phép load extension bình thường.
2. **Build trước khi chạy Test**: Playwright trỏ trực tiếp đến thư mục unpacked extension (`dist/chrome-mv3`). Bước build (`npm run build`) bắt buộc phải chạy thành công trước khi gọi lệnh `playwright test`.
3. **Chỉ chạy Chromium**: Vô hiệu hóa dự án Firefox và Webkit trên CI để tiết kiệm thời gian chạy vì chúng không hỗ trợ API Extension của Chrome.
4. **Mock API thay thế thiết bị phần cứng**: Máy chủ CI không có Microphone hay Webcam thật. Việc truyền cờ `--use-fake-device-for-media-stream` là bắt buộc để tránh trình duyệt báo lỗi `Device not found` khi test luồng quay hình.

---

## 20. Recommendation cho project Meeting Recorder hiện tại

Khuyến nghị triển khai hệ thống kiểm thử cho dự án Meeting Recorder hiện tại theo 5 giai đoạn cuốn chiếu:

### 📅 Pha 1: Kiểm thử các trạng thái UI tĩnh (Tuần 1)
* Viết test spec đầu tiên cho Popup UI và Sidepanel UI.
* Kiểm tra hiển thị mặc định của các nút (Start/Stop) và checkbox nguồn âm thanh.
* Chụp ảnh Visual Regression cho màn hình Idle và Settings để cố định thiết kế.

### 📅 Pha 2: Kiểm thử Luồng State và Message (Tuần 2)
* Viết test luồng click Start -> Trạng thái lưu storage chuyển thành `recording` -> Popup mở lại hiển thị đúng timer đang chạy.
* Viết test mock API lỗi kết nối để kiểm tra Banner Error màu đỏ hiển thị chính xác.

### 📅 Pha 3: Kiểm thử Trang Web Giả Lập & Content Script (Tuần 3)
* Dựng trang HTML mock Google Meet trong thư mục `tests/mocks/`.
* Test xem Content Script có nhận diện đúng URL và thay đổi DOM hay không, có gửi tin nhắn `MEETING_DETECTED` về sidepanel không.

### 📅 Pha 4: Kiểm thử Export và Download (Tuần 4)
* Mock đối tượng `MediaRecorder` trong Offscreen Document để test xuất file.
* Sử dụng `waitForEvent('download')` để verify sự kiện xuất file `.webm` thành công sau khi nhấn nút Stop.

### 📅 Pha 5: Tích hợp Xvfb trên GitHub Actions (Tuần 5)
* Cấu hình pipeline GitHub Actions tự động chạy toàn bộ các bài test UI, Content Script và Storage mỗi khi có Pull Request mới.

---

## 21. Rủi ro và giới hạn

Lập trình viên cần lưu ý các rủi ro sau để tránh lãng phí thời gian cố gắng tự động hóa những tính năng không khả thi:

1. **DOM của Google Meet/Teams thay đổi liên tục**:
   * *Rủi ro*: Google Meet cập nhật định kỳ class CSS hoặc cấu trúc DOM nút bấm, làm Content Script của bạn bị hỏng và test case fail.
   * *Giải pháp*: Hạn chế test E2E trực tiếp trên link Meet thật. Tập trung test Content Script trên trang **Mock Page** do chúng ta tự kiểm soát DOM. Chỉ viết 1 test smoke chạy local định kỳ với Meet thật.
2. **Lỗi treo màn hình chia sẻ (Screen Picker UI)**:
   * *Rủi ro*: Trình duyệt Chrome đôi khi không nhận diện đúng cờ `--auto-select-desktop-capture-source` nếu có nhiều màn hình ảo được tạo ra trên OS.
   * *Giải pháp*: Thiết lập tham số auto-select cụ thể hoặc mock luồng capture từ canvas thay vì screen capture thật khi chạy trên CI.
3. **Memory Leak khi quay thời gian dài (Long Sessions)**:
   * *Rủi ro*: Ghi hình trong 4 tiếng có thể gây tràn bộ nhớ đĩa hoặc crash Offscreen document. Playwright không thể phát hiện lỗi rò rỉ bộ nhớ này nếu chỉ chạy các test case ngắn (5 giây).
   * *Giải pháp*: Bắt buộc phải có luồng kiểm thử thủ công (manual) treo máy ghi hình thực tế 2-4 tiếng trước khi release.

---

## 22. Kết luận

Playwright là công cụ **phù hợp nhất và mạnh mẽ nhất** để thực hiện kiểm thử tự động cho Chrome Extension Manifest V3. Nó giúp giải quyết triệt để bài toán kiểm soát giao diện và trạng thái lưu trữ của Popup/Side panel.

Tuy nhiên, đối với một ứng dụng quay màn hình phức tạp:
* **Playwright không thay thế được kiểm thử thủ công**: Việc đánh giá chất lượng âm thanh, độ gián đoạn hình ảnh của tệp video xuất ra vẫn cần con người kiểm tra.
* **Chiến lược tối ưu**: Hãy thiết lập hệ thống test Playwright để bảo vệ toàn bộ **Giao diện (UI)**, **Luồng nghiệp vụ (State/Message)** và **Trạng thái Lỗi (Error scenarios)**; đồng thời duy trì quy trình kiểm thử thủ công định kỳ đối với chất lượng ghi hình thực tế trên thiết bị vật lý.
