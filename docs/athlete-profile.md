# Athlete profile: spec

Trạng thái: **chờ duyệt**, bản 1 (2026-09-27). Chưa có dòng code nào theo spec này.

Nguồn: phase R4 của review "Coach Workbench" (2026-09-26), phát hiện **N7** và câu hỏi **Q6**
("Làm Athlete profile có cấu trúc? — Khuyên: viết spec riêng sau R3"). R0–R3 đã xong ở các
commit `9f78a0c`, `dc480ac`, `21f2b82`, `8bac951`.

Cỡ việc: **S** ≤ nửa ngày, **M** 1–2 ngày, **L** từ 3 ngày.

## 1. Vấn đề

Cùng một sự thật về vận động viên đang được nhập ở ba nơi không đọc nhau:

| Nơi | Dạng | Ví dụ |
|---|---|---|
| Settings → Coach → **Coach instructions** (`chat.customInstructions`) | chữ tự do, tối đa 4000 ký tự, gắn vào mọi prompt | "I race a marathon in October, I can only run Tue/Thu/Sat, and I have no gym access." (chính là placeholder của ô) |
| **Brief** của AI Plan / Coach (`CoachBriefEditor`, bước Your week) | có cấu trúc, nhưng nhập lại **mỗi brief** | ngày tập, giờ mỗi ngày, ngày dài, ghi chú "Injuries, equipment, travel…" |
| Coach tự **đoán** từ hoạt động | không lưu | mức độ ("From my data"), ngày thường chạy dài |

Hệ quả:

- Mỗi plan mới, người dùng khai lại tuần của mình; Coach instructions nói "Tue/Thu/Sat" nhưng
  brief mặc định vẫn là 5 buổi/6 giờ (`defaultPlanBriefRequest`).
- Coach đọc ràng buộc (chấn thương, thiết bị) dưới dạng văn xuôi, nên không kiểm được: một
  plan xếp buổi vào ngày "không chạy được" không bị `generatedPlanProblems` bắt, vì nó không
  biết ngày đó.
- Thông tin cũ (race tháng 10 đã qua) nằm mãi trong instructions, không có ngày hết hạn.

## 2. Mục tiêu

1. **Một nơi** giữ những gì ổn định về vận động viên: tuần tập thường lệ, mục tiêu đang theo,
   giới hạn (chấn thương, thiết bị, ngày không tập).
2. Brief mới **điền sẵn** từ đó, và mỗi trường ghi nguồn là "from your profile" như đang ghi
   "from chat"/"from your data".
3. Coach **đọc** profile dưới dạng có cấu trúc trong snapshot mỗi lượt, và các kiểm tra trong
   lượt (`planOutlineProblems`, `generatedPlanProblems`, `propose_schedule_changes`) **dùng** được
   những phần kiểm được (ngày không tập).
4. Coach instructions chỉ còn cho **giọng điệu và ưu tiên** ("trả lời bằng tiếng Việt", "ngắn
   gọn"), không còn là chỗ chứa dữ liệu.

Ngoài phạm vi: số đo cơ thể và ngưỡng (đã có từ COROS: `readCorosAccount`, vùng tập); lịch sử
chấn thương chi tiết; chia sẻ profile giữa nhiều tài khoản.

## 3. Mô hình

```ts
/** Những gì ổn định về vận động viên (docs/athlete-profile.md). */
export interface AthleteProfile {
  /** Tuần thường lệ, cùng kiểu với brief để điền sẵn không phải đổi dạng. */
  week?: TrainingPlanGenerationWeek;
  /** Mục tiêu đang theo; hết hiệu lực sau `race.date`. */
  goal?: {
    kind: TrainingPlanGoalKind;
    text: string;
    race?: { date: string; distance?: string };
  };
  /** Môn tập chính, theo thứ tự hay tập. */
  sports?: WorkoutSport[];
  /** Ngày không tập được, Thứ Hai = 0 … Chủ Nhật = 6. Kiểm được. */
  blockedDayIndexes?: number[];
  /** Thiết bị có được: kiểm được với bài tập sức mạnh. */
  equipment?: ("none" | "dumbbells" | "barbell" | "gym" | "bike_trainer" | "pool")[];
  /** Chấn thương, hạn chế: văn xuôi, Coach đọc nhưng không kiểm. */
  limits?: string;
  /** Mỗi trường, lần sửa cuối (ISO), để Coach biết cái nào có thể đã cũ. */
  updatedAt: Partial<Record<Exclude<keyof AthleteProfile, "updatedAt">, string>>;
}
```

Quy tắc:

- **Mọi trường đều tuỳ chọn.** Profile rỗng là trạng thái hợp lệ và là mặc định; không có gì
  bắt buộc người dùng điền trước khi dùng Coach.
- `week` dùng đúng `TrainingPlanGenerationWeek` của brief: điền sẵn là sao chép, không chuyển
  dạng, và `briefOpenProblems` áp dụng nguyên vẹn.
- `goal` có race đã qua thì **không** điền sẵn và Coach đọc nó là "mục tiêu trước". Không tự
  xoá: người dùng quyết định.

## 4. Lưu trữ và sync

- Một bảng mới `athlete_profile` (một hàng, `id = 'me'`, cột `profile_json`, `updated_at`),
  tier **`personal`** trong `syncPolicy.ts`, như `chat_conversation_settings`. Bảng mới là
  additive, đúng luật §4 của coach-plan-canvas (không thêm field vào kiểu entry có sẵn).
- Merge last-writer-wins theo hàng, như các bảng `personal` khác. Hai máy sửa hai trường khác
  nhau cùng lúc thì một bên thắng cả hàng: chấp nhận được ở bản 1 (profile sửa hiếm); nếu thành
  vấn đề, tách mỗi trường một hàng (`id = <field>`), không cần merger riêng.
- `chat.customInstructions` giữ nguyên key và tier.

## 5. Giao diện

- **Nơi sửa: màn Personal** (rail → identity row), mục mới "Training profile", vì đây là thông
  tin về người chứ không phải cài đặt Coach. Dùng lại `GeneratorWeekStep` cho tuần (cùng thành
  phần brief đang dùng), `OptionChips` cho môn và thiết bị, một textarea cho `limits`, và
  `MonthDayPicker` cho ngày race.
- **Settings → Coach**: dưới Coach instructions thêm một dòng "Your week, goal and limits are in
  Personal → Training profile" dẫn sang. Placeholder của instructions đổi sang ví dụ về giọng
  điệu ("Answer in Vietnamese; keep it short").
- **Brief** (`CoachBriefEditor`): trường điền từ profile mang nhãn **from your profile**
  (`PlanBriefOrigin` thêm `"profile"`). Sửa trường trong brief **không** ghi ngược vào profile;
  cuối bước Your week có một nút "Save as my usual week" cho ai muốn.
- **Coach đề xuất cập nhật**: khi người dùng nói điều mâu thuẫn với profile ("tuần này tôi chỉ
  tập được thứ Bảy"), Coach không tự sửa profile. Nếu điều đó lâu dài, Coach có thể dùng tool
  `propose_profile_change` (xem §6), hiện như một card nhỏ Apply/Dismiss giống change set.

## 6. Coach đọc và kiểm

- `buildTrainingContext` thêm một khối "Athlete profile" ngắn (tuần, mục tiêu với ngày, ngày
  không tập, thiết bị, limits), kèm `updatedAt` từng trường. Khối này **không** thuộc nguồn
  nào của hội thoại (Activities/Sleep/Zones): profile là điều người dùng tự khai, nên hội thoại
  tắt mọi nguồn vẫn đọc nó. Sheet "This conversation" nói rõ điều đó (câu hỏi 4, §11).
- Kiểm trong lượt:
  - `generatedPlanProblems` / `planOutlineProblems`: buổi rơi vào `blockedDayIndexes` là lỗi
    trả lại cho model, trừ khi brief ghi đè tuần (brief là ý định cho plan này).
  - `propose_schedule_changes`: dòng `move`/`add` vào ngày bị chặn là lỗi trả lại.
  - Bài sức mạnh cần thiết bị không có: cảnh báo trả lại (không chặn), vì phân loại thiết bị của
    bài tập COROS không đầy đủ.
- Tool mới **`propose_profile_change`** (interactive only, **không** trong
  `READ_ONLY_ALLOWED_TOOLS`; nguồn `db` trong `LOCAL_CHAT_TOOL_SOURCES`): ghi một đề xuất vào
  bảng `chat_profile_changes` (`personal`) và anchor `{ kind: "profileChange", changeId }` vào
  transcript. Chỉ anchor — không field mới trên kiểu có sẵn.

## 7. Chuyển đổi

- Không tự phân tích Coach instructions thành profile (văn xuôi, dễ sai, và sai lặng lẽ).
- Lần đầu mở Personal → Training profile khi profile rỗng và instructions không rỗng: hiện
  instructions hiện tại bên cạnh form với dòng "Move what describes your training here". Người
  dùng tự chép.
- Một lượt Coach có thể giúp: nút "Ask Coach to fill it from my instructions" gửi instructions
  cho model với tool `propose_profile_change` — kết quả vẫn là card phải bấm Apply.

## 8. IPC

Ba kênh mới (luật ba file: `main.ts`, `preload.ts`, `heraclesrecords-api.ts`, rồi
`npm run test:ipc-surface`):

- `profile:get` → `AthleteProfile`
- `profile:save` (`AthleteProfile`) → `AthleteProfile`
- `chat:settleProfileChange` (`changeId`, `apply: boolean`) → `ProfileChange`

## 9. Thứ tự

| # | Việc | Cỡ |
|---|---|---|
| A1 | Bảng, kiểu, `profile:get/save`, `syncPolicy`, test lưu/đọc/sync tier | S |
| A2 | Personal → Training profile (form, gợi ý chép từ instructions) | M |
| A3 | Brief điền sẵn + nhãn "from your profile" + "Save as my usual week" | M |
| A4 | Khối profile trong snapshot; kiểm `blockedDayIndexes` trong ba chỗ | M |
| A5 | `propose_profile_change` + card + `chat:settleProfileChange` | M |
| A6 | Placeholder instructions, dòng dẫn trong Settings → Coach, CLAUDE.md | S |

A1–A3 dùng được riêng (điền sẵn brief đã là phần lớn giá trị). A4–A5 cần A1.

## 10. Test

- `test:athlete-profile` (Electron, SQLite): profile rỗng hợp lệ; lưu/đọc; tier `personal`;
  race đã qua không điền sẵn.
- `test:plan-brief`: brief mới lấy `week`/`sports`/`goal` từ profile với nhãn `profile`; sửa
  trong brief không đổi profile.
- `test:training-plan-generation`, `test:schedule-changes`: ngày bị chặn là lỗi trả lại.
- `test:coach-analysis-guards`: `propose_profile_change` không có trong run read-only.
- `test:chat-tool-sources`: tool mới có nguồn.
- `test:chat-transcript-compat`: anchor `profileChange` sống sót qua build cũ (§4, Q1–Q3 của
  coach-plan-canvas).

## 11. Câu hỏi cần chốt

1. **Nơi sửa**: Personal (đề xuất) hay Settings → Coach? Personal hợp nghĩa hơn; Settings gần
   chỗ người dùng đang tìm instructions.
2. **Ngày không tập có chặn cứng** plan không (đề xuất: có, trừ khi brief ghi đè), hay chỉ
   cảnh báo?
3. **`propose_profile_change`** có làm ở bản đầu không, hay để A1–A4 chạy một thời gian trước?
4. **Profile có đọc được trong hội thoại đã tắt mọi nguồn** không (đề xuất: có, vì người dùng
   tự khai; ghi rõ trong sheet)?
