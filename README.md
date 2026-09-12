# KAPLA Tool v13 + Backend Vercel

Đây là bản v13 ổn định, giữ nguyên:
- nhận xét ngắn và tự nhiên
- đúng điểm cấu hình
- chỉ xử lý học sinh Có mặt / Đi trễ
- viền xanh nút Gửi
- popup Gửi / Dừng / progress

Khác biệt: Gemini API key đã chuyển ra backend.

## Deploy
1. Upload/import toàn bộ project này lên Vercel.
2. Vào Project → Settings → Environment Variables.
3. Tạo biến `GEMINI_API_KEY` và dán Gemini API key.
4. Save và Redeploy.
5. Mở URL Vercel để dùng.

Không double-click `index.html` để test AI vì `/api/generate` chỉ chạy trên Vercel (hoặc `vercel dev`).

Models giữ nguyên từ v13:
- gemini-3.6-flash
- gemini-3.1-flash-lite
- gemini-2.5-flash
- gemini-2.5-flash-lite
