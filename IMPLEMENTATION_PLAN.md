# Sync Text App — Implementation Plan

## 1. Mục tiêu

Xây dựng một ứng dụng web đơn giản cho phép người dùng:

- Đăng nhập bằng một tài khoản cố định.
- Nhập hoặc copy/paste nội dung text vào một rich-text editor.
- Tự động lưu nội dung.
- Reload trang hoặc đăng nhập trên thiết bị khác vẫn đọc được nội dung đã lưu.
- Chạy hoàn toàn trên Cloudflare Workers Free.

## 2. Phạm vi MVP

MVP có đúng một tài khoản và một tài liệu dùng chung:

1. Username cố định: `xuanthuphan2k`.
2. Password phải được cung cấp qua Cloudflare Worker secret hoặc `.dev.vars`; tuyệt đối không hardcode/commit password vào repository.
3. Không có đăng ký, đổi mật khẩu, quên mật khẩu hoặc quản lý user.
4. Không có nhiều ghi chú, version history, upload file, hình ảnh hoặc cộng tác realtime.
5. Nội dung được lưu dưới dạng BlockNote JSON trong Cloudflare D1.

## 3. Kiến trúc

```text
Browser
  ├── React SPA
  ├── BlockNote editor
  └── fetch /api/*
          │
          ▼
Cloudflare Worker
  ├── Authentication API
  ├── Signed session cookie
  ├── Document API
  └── D1 binding
          │
          ▼
Cloudflare D1
  └── Singleton document: id = "main"
```

Một Cloudflare Worker phục vụ cả React static assets và backend API. Không tách riêng frontend/backend deployment.

## 4. Công nghệ

- React.
- TypeScript strict mode.
- Vite.
- Cloudflare Vite plugin.
- Cloudflare Worker.
- Cloudflare D1.
- BlockNote React với Mantine UI.
- Vitest cho automated tests.
- Wrangler cho local development, migrations và deployment.

Không sử dụng Next.js, SSR, KV session, Durable Objects, R2, Supabase hoặc Firebase.

## 5. Cấu trúc thư mục mục tiêu

```text
sync-text-app/
├── migrations/
│   └── 0001_create_documents.sql
├── public/
├── src/
│   ├── components/
│   │   ├── LoginForm.tsx
│   │   ├── EditorPage.tsx
│   │   ├── SaveStatus.tsx
│   │   └── ErrorMessage.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   └── types.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── worker/
│   ├── auth.ts
│   ├── http.ts
│   ├── validation.ts
│   └── index.ts
├── tests/
│   ├── auth.test.ts
│   └── document.test.ts
├── .dev.vars.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── wrangler.jsonc
```

Tên file có thể được điều chỉnh theo template Cloudflare thực tế, nhưng phải giữ frontend, Worker code, migration và tests tách biệt rõ ràng.

## 6. Khởi tạo project

Khởi tạo bằng React template chính thức của Cloudflare:

```bash
npm create cloudflare@latest -- . --framework=react
```

Cài BlockNote:

```bash
npm install @blocknote/core @blocknote/react @blocknote/mantine
npm install @mantine/core @mantine/hooks @mantine/utils
```

Các npm scripts cần có:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Giữ các version do `create-cloudflare` sinh ra hoặc cài phiên bản stable mới nhất. Không tự hạ version nếu không có lý do tương thích cụ thể.

## 7. Cấu hình Cloudflare

`wrangler.jsonc` cần có:

- `main` trỏ tới Worker entrypoint.
- `compatibility_date` là ngày thực hiện triển khai.
- `compatibility_flags` chứa `nodejs_compat`.
- Static assets sử dụng SPA fallback.
- `/api/*` luôn chạy qua Worker.
- D1 binding tên `DB`.
- `AUTH_USERNAME` là non-secret variable.
- `AUTH_PASSWORD` và `SESSION_SECRET` là required secrets.
- Bật observability.

Ví dụ cấu hình:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "sync-text-app",
  "main": "./worker/index.ts",
  "compatibility_date": "YYYY-MM-DD",
  "compatibility_flags": ["nodejs_compat"],

  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },

  "vars": {
    "AUTH_USERNAME": "xuanthuphan2k"
  },

  "secrets": {
    "required": ["AUTH_PASSWORD", "SESSION_SECRET"]
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "sync-text-db",
      "database_id": "<generated-database-id>"
    }
  ],

  "observability": {
    "enabled": true
  }
}
```

Sau khi binding/config hoàn tất, chạy:

```bash
npx wrangler types
```

Không viết thủ công interface `Env`. Sử dụng type do Wrangler tạo để đảm bảo code khớp với bindings thực tế.

## 8. Quản lý secrets

### Local development

Tạo `.dev.vars` nhưng không commit file này:

```dotenv
AUTH_PASSWORD=<password-do-user-cung-cap>
SESSION_SECRET=<random-secret-it-nhat-32-bytes>
```

Commit `.dev.vars.example`:

```dotenv
AUTH_PASSWORD=replace-me
SESSION_SECRET=replace-with-at-least-32-random-bytes
```

`.gitignore` phải chứa ít nhất:

```gitignore
.dev.vars
.env
.env.*
!.env.example
```

Không được:

- Đặt password trong React source.
- Đặt password trong Worker source.
- Đặt password trong `wrangler.jsonc`.
- In password ra logs hoặc error response.
- Lưu password vào localStorage/sessionStorage.

### Production

Thiết lập secrets bằng Wrangler hoặc Cloudflare Dashboard:

```bash
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Người triển khai tự nhập password đã được yêu cầu vào prompt tương tác. Không tạo file production secret để commit.

## 9. Database schema

File `migrations/0001_create_documents.sql`:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO documents (
  id,
  content_json,
  revision,
  updated_at
) VALUES (
  'main',
  '[]',
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
```

Không cần bảng user hoặc session. Không cần index bổ sung vì document luôn được truy cập bằng primary key `id = 'main'`.

Nội dung editor được lưu bằng:

```ts
JSON.stringify(editor.document)
```

Và đọc bằng:

```ts
JSON.parse(row.content_json)
```

Không lưu và render raw pasted HTML.

## 10. API contract

Tất cả API response phải có:

```http
Cache-Control: no-store
Content-Type: application/json
```

Error response thống nhất:

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
};
```

### 10.1 `POST /api/auth/login`

Request:

```json
{
  "username": "...",
  "password": "..."
}
```

Thành công:

- HTTP `204`.
- Set session cookie.
- Không trả password hoặc session token trong response body.

Sai thông tin:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Tên đăng nhập hoặc mật khẩu không đúng."
  }
}
```

Trả HTTP `401`. Không tiết lộ username hay password sai.

### 10.2 `GET /api/auth/session`

Authenticated response:

```json
{
  "authenticated": true,
  "username": "xuanthuphan2k"
}
```

Nếu chưa đăng nhập hoặc session hết hạn, trả HTTP `401`.

### 10.3 `POST /api/auth/logout`

- Expire cookie bằng `Max-Age=0`.
- Trả HTTP `204`.

### 10.4 `GET /api/document`

Yêu cầu session hợp lệ.

Response:

```json
{
  "content": [],
  "revision": 3,
  "updatedAt": "2026-09-03T10:30:00.000Z"
}
```

### 10.5 `PUT /api/document`

Request:

```json
{
  "content": [],
  "baseRevision": 3
}
```

Cập nhật có điều kiện:

```sql
UPDATE documents
SET
  content_json = ?,
  revision = revision + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'main'
  AND revision = ?;
```

Thành công:

```json
{
  "revision": 4,
  "updatedAt": "2026-09-03T10:31:00.000Z"
}
```

Nếu `baseRevision` đã cũ, trả HTTP `409`:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Nội dung đã được cập nhật ở một thiết bị khác."
  },
  "current": {
    "revision": 4,
    "updatedAt": "2026-09-03T10:31:00.000Z"
  }
}
```

Không tự động ghi đè khi xảy ra conflict.

## 11. Authentication implementation

### Session payload

```json
{
  "sub": "xuanthuphan2k",
  "iat": 1234567890,
  "exp": 1235172690
}
```

Cookie value:

```text
<base64url-payload>.<hmac-sha256-signature>
```

Cookie name có thể là `sync_text_session` và phải có:

```text
HttpOnly
SameSite=Strict
Path=/
Max-Age=604800
Secure    # bắt buộc ở production HTTPS
```

Yêu cầu implementation:

- Dùng Web Crypto HMAC-SHA256 với `SESSION_SECRET` để ký và verify.
- Session hết hạn sau 7 ngày.
- Không dùng `Math.random()` cho token hoặc secret.
- So sánh credential bằng cơ chế chống timing attack dựa trên Web Crypto/HMAC.
- Mọi endpoint document phải verify cookie phía Worker.
- Không coi React route guard là biện pháp bảo mật.
- Với request thay đổi state, từ chối `Origin` khác origin của app.
- Chỉ nhận JSON tại các endpoint có request body.
- Không trả stack trace ra client.
- Log lỗi có cấu trúc JSON và có `requestId`.
- Không lưu request-scoped state vào mutable module globals.

## 12. Backend validation

`POST /api/auth/login` phải kiểm tra:

- Body parse được JSON.
- `username` và `password` là string.
- Có giới hạn độ dài hợp lý cho cả hai field.
- Sai format trả `400`, sai credential trả `401`.

`PUT /api/document` phải kiểm tra:

- Body parse được JSON.
- `content` là array.
- `baseRevision` là integer không âm.
- `JSON.stringify(content)` không vượt quá 512 KiB.
- Quá giới hạn trả `413`.
- Sai `Content-Type` trả `415`.

Backend không cần validate toàn bộ internal BlockNote schema trong MVP. Frontend chịu trách nhiệm tạo BlockNote document hợp lệ; backend kiểm tra shape tối thiểu và kích thước.

## 13. Frontend flow

### App startup

1. Gọi `GET /api/auth/session`.
2. Nếu nhận `401`, hiển thị `LoginForm`.
3. Nếu authenticated, gọi `GET /api/document`.
4. Chỉ render component tạo BlockNote editor sau khi document load thành công.
5. Truyền document vào `initialContent` khi editor được tạo.
6. Nếu database chứa `[]`, khởi tạo một paragraph rỗng.

Không tạo BlockNote editor trước rồi mong `initialContent` tự cập nhật sau một request bất đồng bộ.

### Login screen

- Input username có label.
- Input password có label và `type="password"`.
- Nút `Đăng nhập`.
- Nhấn Enter để submit.
- Disable form khi request đang chạy.
- Hiển thị một lỗi chung khi login thất bại.
- Không lưu credential ở browser storage.

### Editor screen

Header gồm:

- Tên ứng dụng.
- Trạng thái lưu.
- Thời điểm cập nhật gần nhất.
- Nút `Lưu ngay`.
- Nút `Đăng xuất`.

Editor:

- Dùng `useCreateBlockNote` và `BlockNoteView`.
- Placeholder: `Nhập hoặc dán nội dung vào đây…`.
- Hỗ trợ paragraph, heading, list và basic text formatting.
- Không triển khai image/file upload.
- Paste plain text và rich text thông thường phải hoạt động.
- Layout responsive, editor có chiều rộng đọc khoảng 800–1000px.

## 14. Autosave

Không gọi API trên mỗi keystroke.

Thuật toán bắt buộc:

1. `onChange` cập nhật document mới nhất trong ref/state.
2. Đánh dấu trạng thái `Chưa lưu`.
3. Debounce từ 1.5 đến 2 giây.
4. Gửi `PUT /api/document` với `baseRevision` hiện tại.
5. Khi thành công, cập nhật revision và trạng thái `Đã lưu`.
6. Nếu người dùng tiếp tục sửa trong lúc save đang chạy, đánh dấu có pending change.
7. Sau khi request hiện tại kết thúc, save pending change mới nhất.
8. Chỉ cho phép tối đa một save request chạy tại một thời điểm.
9. Nút `Lưu ngay` bỏ qua debounce.
10. `Ctrl+S`/`Cmd+S` gọi lưu ngay và ngăn hành vi Save Page của browser.

Các trạng thái UI:

- `Đang tải…`
- `Chưa lưu`
- `Đang lưu…`
- `Đã lưu lúc HH:mm:ss`
- `Không thể lưu — Thử lại`

Không dựa vào `beforeunload` để đảm bảo lưu dữ liệu vì browser không đảm bảo request sẽ hoàn thành.

## 15. Conflict handling

Khi API trả `409`:

1. Không thay đổi nội dung hiện tại trong editor.
2. Không tự động ghi đè server.
3. Hiển thị dialog với hai lựa chọn:
   - `Tải phiên bản trên server`.
   - `Ghi đè bằng nội dung hiện tại`.
4. Nếu tải server, gọi lại `GET /api/document` rồi thay document hiện tại sau khi người dùng xác nhận.
5. Nếu ghi đè, gửi lại draft với revision mới nhất nhận từ conflict response.
6. Nếu lại xảy ra conflict, hiển thị dialog lại.

Draft trong editor không được mất chỉ vì server trả conflict hoặc lỗi mạng.

## 16. Error handling

Các status cần xử lý:

- `400`: request không hợp lệ.
- `401`: chưa đăng nhập hoặc session hết hạn.
- `409`: document conflict.
- `413`: nội dung quá lớn.
- `415`: sai content type.
- `429`: vượt giới hạn Cloudflare.
- `500`: lỗi server hoặc D1.

Khi nhận `401` trong lúc save:

- Chuyển UI về login.
- Không gửi lại password tự động.
- Giữ draft hiện tại trong memory cho đến khi trang bị reload.

Không hiển thị raw Worker/D1 error cho người dùng.

## 17. Tests

### Worker tests

- Login đúng tạo session cookie.
- Sai username trả `401`.
- Sai password trả `401` với cùng error message.
- Cookie bị sửa payload/chữ ký bị từ chối.
- Cookie hết hạn bị từ chối.
- Logout làm cookie hết hạn.
- API document không có cookie trả `401`.
- Load document mặc định thành công.
- Save document tăng revision.
- Reload trả đúng document đã save.
- Base revision cũ trả `409`.
- Body JSON sai trả `400`.
- Payload quá lớn trả `413`.
- Request mutation từ origin khác bị từ chối.

Không ghi password thật trong test source; inject test secrets qua test environment.

### Frontend tests

- Hiển thị login khi session trả `401`.
- Login thành công chuyển sang editor.
- Editor chỉ được khởi tạo sau khi document load xong.
- Nhiều thay đổi nhanh chỉ tạo một autosave sau debounce.
- Nếu thay đổi trong lúc đang save, thay đổi mới vẫn được save tiếp.
- Save error hiển thị retry action.
- Conflict không làm mất draft.

### Production smoke test

1. Login sai bị từ chối.
2. Login đúng thành công.
3. Paste nhiều paragraph vào editor.
4. Đợi trạng thái `Đã lưu`.
5. Reload và xác nhận nội dung còn nguyên.
6. Mở browser/device khác, login và xác nhận thấy cùng nội dung.
7. Sửa đồng thời ở hai browser và xác nhận conflict được hiển thị.
8. Logout rồi gọi `/api/document`, phải nhận `401`.
9. Search production bundle/source để đảm bảo không có password.

## 18. Implementation phases

### Phase 1 — Scaffold

- Khởi tạo React + Worker template.
- Cài BlockNote.
- Thiết lập TypeScript, tests và npm scripts.
- Xác nhận app mẫu chạy local và build được.

### Phase 2 — D1

- Tạo D1 database.
- Thêm binding `DB`.
- Viết migration.
- Apply migration local.
- Implement document read/update functions.
- Test optimistic revision update.

### Phase 3 — Auth

- Khai báo variables và secrets.
- Implement HMAC signed session.
- Implement login/session/logout routes.
- Implement auth guard cho document routes.
- Hoàn thành auth tests.

### Phase 4 — UI

- Implement login screen.
- Implement typed API client.
- Load session và document.
- Tích hợp BlockNote.
- Implement save button và save status.

### Phase 5 — Autosave và conflicts

- Implement serialized debounced autosave.
- Implement keyboard shortcut.
- Implement retry.
- Implement revision conflict dialog.
- Validate document size.

### Phase 6 — Verification

Chạy và sửa cho đến khi tất cả pass:

```bash
npm run typecheck
npm run test
npm run build
npm run preview
```

Sau đó thực hiện smoke test local.

### Phase 7 — Production deployment

```bash
npx wrangler login
npx wrangler d1 create sync-text-db
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

Thứ tự thực tế có thể cần điều chỉnh nếu template/Wrangler yêu cầu database ID trước khi chạy type generation. Không được bỏ remote migration hoặc production secrets.

Sau deploy:

- Kiểm tra URL `*.workers.dev`.
- Chạy toàn bộ production smoke test.
- Kiểm tra Worker logs nếu API lỗi.
- Custom domain là tùy chọn, không thuộc MVP.

## 19. Cloudflare Free constraints

Thiết kế phải tối ưu cho Free plan:

- Static SPA assets được phục vụ trực tiếp, không ép mọi asset request chạy qua Worker.
- Chỉ `/api/*` chạy Worker code.
- Document chỉ là một D1 row.
- Không autosave trên từng keystroke.
- Không polling document liên tục.
- Không dùng dịch vụ Cloudflare bổ sung nếu không cần thiết.
- Nếu API/D1 trả lỗi quota, UI phải báo chưa lưu; không được hiển thị `Đã lưu`.

## 20. Security checklist

- [ ] Password không xuất hiện trong Git hoặc client bundle.
- [ ] `.dev.vars` và `.env*` đã được ignore.
- [ ] Session cookie là `HttpOnly` và `SameSite=Strict`.
- [ ] Production cookie có `Secure`.
- [ ] Session có expiration.
- [ ] Session signature được verify bằng Web Crypto.
- [ ] Tất cả document endpoints có server-side auth guard.
- [ ] Mutation endpoints kiểm tra method, content type và origin.
- [ ] API responses dùng `Cache-Control: no-store`.
- [ ] Không trả stack trace hoặc secret trong response/log.
- [ ] Không render raw HTML từ database.
- [ ] Payload document có size limit.

## 21. Definition of Done

Chỉ coi công việc hoàn thành khi:

- [ ] App login đúng với tài khoản yêu cầu và từ chối credential sai.
- [ ] Password chỉ được cung cấp qua secret.
- [ ] API document không truy cập được nếu chưa đăng nhập.
- [ ] Người dùng nhập và paste nội dung bằng BlockNote được.
- [ ] Nội dung tồn tại sau reload.
- [ ] Hai thiết bị dùng chung một document.
- [ ] Autosave không tạo request trên mỗi keystroke.
- [ ] Lỗi save không bị hiển thị sai thành `Đã lưu`.
- [ ] Conflict không làm mất draft.
- [ ] Typecheck pass.
- [ ] Automated tests pass.
- [ ] Production build pass.
- [ ] Local migration pass.
- [ ] Remote migration pass.
- [ ] App hoạt động tại Cloudflare URL.
- [ ] Production smoke test pass.
- [ ] Không triển khai feature ngoài phạm vi MVP.

## 22. Chỉ dẫn cho model triển khai

Model triển khai cần tuân thủ các nguyên tắc sau:

1. Thực hiện từng phase theo thứ tự và chạy verification sau mỗi phase lớn.
2. Không hardcode hoặc in password ra output/log.
3. Không thay D1 bằng localStorage; localStorage không đáp ứng yêu cầu đồng bộ giữa các thiết bị.
4. Không bỏ server-side auth chỉ vì frontend đã có login screen.
5. Không thêm framework/backend service không cần thiết.
6. Ưu tiên code nhỏ, rõ ràng và typed; tránh abstraction quá mức cho app một document.
7. Không deploy trước khi tests và build pass.
8. Nếu API của Cloudflare hoặc BlockNote khác do version mới hơn, kiểm tra tài liệu chính thức hiện tại và điều chỉnh implementation, nhưng giữ nguyên kiến trúc và acceptance criteria của plan này.
9. Khi hoàn thành, báo cáo rõ:
   - Các file đã tạo/thay đổi.
   - Các lệnh verification đã chạy và kết quả.
   - Migration đã apply ở local/remote hay chưa.
   - App đã deploy hay chưa và URL nếu có.
   - Những bước nào còn cần người dùng thực hiện.

## 23. Tài liệu tham khảo

- [Cloudflare React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 pricing and Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [BlockNote getting started](https://www.blocknotejs.org/docs/getting-started)
- [BlockNote editor setup](https://www.blocknotejs.org/docs/getting-started/editor-setup)
- [BlockNote saving and loading](https://www.blocknotejs.org/examples/backend/saving-loading)
