# Coach Plan Canvas: kế hoạch triển khai

Trạng thái: **chờ duyệt**, bản 2 (2026-09-25, sau một vòng review). Chưa có dòng code nào theo
kế hoạch này.

Nguồn: bản đề xuất "Coach Plan Canvas" (trang HTML, có wireframe) và review luồng tạo
plan/workout của Coach, cả hai đọc code tại `a06b8e3` ("Rebuild the AI plan generator").
Tài liệu này là phần *làm*: mọi quyết định đã chốt, thứ tự, file, test, và các quy tắc giữ
cho hai máy chạy hai build khác nhau không làm mất dữ liệu của nhau. Lý do sâu hơn của mô
hình plan COROS-first nằm ở [training-plan-coros-first.md](training-plan-coros-first.md);
§7 của tài liệu đó được viết lại khi P2 xong (§10).

Cỡ việc: **S** ≤ nửa ngày, **M** 1–2 ngày, **L** từ 3 ngày. Ước lượng thô, để xếp thứ tự chứ
không để hứa hạn.

## 1. Mục tiêu

Hiện có hai đường tạo plan và chúng không dùng chung gì:

- **Chat Coach** có hội thoại nhưng thiếu bộ máy. Card plan không được vẽ trong luồng chat
  (chỉ ở panel Creations và modal), mỗi lần sửa ra thêm một card mới, lưu xong thì card bị
  khoá, và Coach không thấy plan nó đã tạo.
- **AI Plan** trong Library có bộ máy (outline, kiểm tra ngay trong lượt, tuần tính từ Thứ Hai,
  giới hạn nguồn dữ liệu, chọn AI riêng) nhưng đứng ngoài hội thoại. Bước cuối là ngõ cụt, và
  không để lại gì trong Coach.

Đích đến: **một** đường, nằm trong hội thoại. Coach đề xuất gì thì cái đó hiện ngay trong câu
trả lời. Plan có version thay vì nhân bản. Người dùng và Coach cùng sửa một plan theo lượt,
thấy cùng một diff. Plan đã lưu vẫn nối với cuộc chat đã sinh ra nó, và cuộc chat luôn thấy
đúng bản đang nằm trên COROS.

## 2. Quyết định đã chốt

| # | Câu hỏi | Chốt |
|---|---|---|
| D1 | Dialog AI Plan | Giữ nút AI Plan ở chỗ cũ, cho nó mở Coach kèm brief. Bỏ dialog khi P2 xong |
| D2 | Plan sinh từ AI Plan nằm ở đâu trước khi lưu | Trong cuộc chat (chat plan draft), không phải library draft. Tile Draft của Library chỉ còn cho plan người dùng tự viết |
| D3 | Lưu plan thành các workout lẻ | **Giữ**, dùng cho plan one-shot "dùng ngay". Luật ở P0.5 |
| D4 | Coach đính kèm card khi không được yêu cầu | Có, tối đa 2 card mỗi câu trả lời, không bao giờ tự ghi. Công tắc trong Settings → Coach: mặc định bật với provider Claude, tắt với provider khác. **Giới hạn chỉ nằm trong prompt, không chặn cứng trong code** |
| D5 | Coach sửa plan đã lưu | Mặc định cập nhật chính plan đó (so version); "Save as a new plan" là lựa chọn phụ; plan đang chạy thì hỏi về lịch như `requestSave` |
| D6 | Chip tinh chỉnh | Coach gửi 2–4 chip kèm draft (`suggested_refinements`); có bộ mặc định khi thiếu |
| D7 | Tương thích transcript giữa hai build | Phương án **C** (§4), cộng: từ P0.1 parser giữ nguyên kind và field lạ |
| D8 | Lối vào | Card inline **và** nút Creations (hiện khi cuộc chat có ít nhất một artifact, không phụ thuộc độ rộng cửa sổ) |
| D9 | Card khi canvas đang mở plan đó | Card **vẫn đầy đủ**, không thu gọn |
| D10 | Chỗ sửa | **Mỗi artifact chỉ một chỗ sửa**: mọi chỉnh sửa (brief, outline, plan, workout) mở màn hình edit. Card inline và canvas chỉ để đọc và bấm nút chính |
| D11 | Sửa plan bằng patch | Có, trong P1: tool nhận danh sách thao tác thay vì model gửi lại cả plan |
| D12 | Plan đã lưu bị sửa ở Library hoặc trên COROS | **Nhập về thành version mới** ("Changed in Library"), kèm dòng diff trong luồng chat. COROS là nguồn sự thật |
| D13 | Phạm vi "What Coach reads" | **Cả cuộc chat**: mọi lượt trong cuộc chat đó, kể cả câu hỏi thường và analysis chạy trong nó |
| D14 | AI riêng cho plan (provider, model, effort) | **Giữ, gắn vào cuộc chat**: mỗi cuộc chat có thể ghi đè Coach settings |

## 3. Khái niệm

- **Artifact**: một thứ Coach tạo trong một cuộc chat: một plan hoặc một workout. Artifact có
  loại, và một chuỗi **version**.
- **Version**: một bản đầy đủ của artifact, bất biến sau khi ghi (trừ ngoại lệ ở §4, H6).
  Mỗi version là **một row** trong `chat_plan_drafts` với `draft_id` riêng, và là **một entry
  `planDraft`** trong transcript với chính `draft_id` đó. Row giữ nội dung ở ba dạng:
  - `document_json`: `TrainingPlanDocument`, **nguồn sự thật** với build mới; mang cả
    `corosProgram` và `idInPlan` khi version đến từ COROS, để "Update COROS plan" ghi lại
    đúng từng buổi;
  - `plan_json`: `CorosTrainingPlanDraft` như hiện nay, để build cũ vẫn lưu và sửa được;
  - `preview_json`: preview **đầy đủ**, có `source` như hiện nay. Chỉ entry trong transcript
    là bản gọn (Q5).
- **Tác giả của version**: `coach` (Coach viết hoặc sửa), `athlete` (người dùng sửa trong màn
  hình edit), `coros` (nhập về vì plan đã đổi trên COROS, D12). Quay về một bản cũ là tạo
  version mới mang nội dung bản cũ.
- **Trạng thái** là **suy ra**, không lưu: có `brief`/`outline` mà chưa có version là giai
  đoạn trước plan; version nào có `uploaded_at` và `uploadResult.planId` là đã lên COROS; bản
  chạy trên lịch đọc từ `coros_plan_cache`. Một máy trạng thái dùng chung cho card và canvas
  (P1.4):

  | Trạng thái | Pill | Nút chính | Nút phụ |
  |---|---|---|---|
  | `brief` (P2) | Brief | Draw the outline | Edit brief |
  | `outline` (P2) | Outline vN | Write the sessions | Adjust outline, Redraw with a note |
  | `proposal` | Proposal vN / Edited by you | theo luật D3 (P0.5) | Edit, các đích lưu còn lại, Remove |
  | `saved` | On COROS | Add plan to calendar… | Open in Library, Edit, Hide |
  | `scheduled` | Week 2 of 10 · 5/6 | Open in Library | Ask about progress, Remove from calendar, Hide |

  Nút hành động chỉ có trên **version mới nhất**. Version cũ chỉ để đọc, nút duy nhất là
  **Restore** (tạo version mới).
- **Remove và Hide**: artifact **chưa lưu** thì Remove (xoá các row version, entry giữ
  `removedAt`). Artifact **đã lưu** chỉ được Hide (entry giữ `removedAt`, row còn nguyên), vì
  `coach.draftId` trong metadata của plan COROS là đường từ Library về cuộc chat (P1.7).
- **Màn hình edit**: màn hình duy nhất được sửa một artifact. Plan dùng `PlanEditor` phủ lên
  Coach (tổng quát hoá `CoachPlanEditor`), workout dùng `WorkoutBuilderModal`, brief và
  outline có màn hình riêng ở P2. Canvas **không** chứa editor, nên quy tắc "ba scope" của
  Library (CLAUDE.md) không phải thêm scope thứ tư.
- **Khoá sửa**: khi màn hình edit của artifact X đang mở, nút chính của X trên card và canvas
  đổi thành **Continue editing** và dẫn vào màn hình đó. Không nút nào ghi lên COROS từ một
  bản đang có chỉnh sửa chưa lưu.
- **Cài đặt của cuộc chat** (D13, D14): nguồn dữ liệu Coach được đọc, và AI (provider, model,
  effort) ghi đè Coach settings. Áp cho mọi lượt trong cuộc chat.

## 4. Tương thích giữa hai build (D7)

Hai máy sync chung dữ liệu có thể chạy hai build khác nhau. H1–H4 đã được kiểm bằng
`test:chat-transcript-compat` (P0.1), chạy parser và merger thật trên đúng những gì một build
cũ gửi đi; H5–H7 đọc từ code.

- **H1. Transcript là một cột, merge là union theo `mid`** (`mergeTranscripts`,
  `sync/rowMergers.ts`). Một entry chỉ bên này có vẫn được giữ trong kết quả merge.
- **H2. Build hiện tại dựng lại entry từng field một** (`parseEntryShape` → `parsePlanDraft`…
  trong `chatHistoryStore.ts`, và `toPersistedEntries`/`fromPersistedEntries` ở renderer).
  Kind lạ thì bỏ cả entry; field lạ thì bỏ field đó.
- **H3. Build cũ làm mất field mới của một kind đã có, theo hai đường** (`stampEntries`,
  `logicalKey`, `mergeTranscripts`):
  - **H3a, lưu lại mà không sửa**: build cũ parse bản đang lưu và bản nó gửi đi theo cùng một
    cách, nên hai bản khớp nội dung; entry giữ nguyên `mid` **và** `mrev`. Khi merge, hai bản
    cùng revision được phân xử bằng cách so chuỗi JSON, nên field mất hay còn là do cách hai
    bản serialize, không do ý ai.
  - **H3b, build cũ sửa entry đó** (trả lời câu hỏi, sửa plan, remove card): nội dung đổi, id
    của card (`planDraft:<draftId>`) vẫn khớp, nên entry giữ `mid` và được tăng `mrev`. Bản
    mất field **luôn thắng** trên mọi máy.
- **H4. Một `message` không bị nhân đôi** khi build cũ bỏ field của nó: build cũ bỏ field ở cả
  hai phía nên message vẫn khớp nội dung, giữ `mid` và `mrev`. Nó chịu cùng rủi ro như H3a
  (build cũ không sửa message, nên không có H3b).

  (Bản 2 của tài liệu này viết H3 là "luôn tăng `mrev`" và H4 là "nhân đôi". Cả hai sai, và
  `test:chat-transcript-compat` là chỗ đã bắt được điều đó.)
- **H5. Row của bảng thường thì an toàn khi thêm cột**: `upsertRow` ghi đúng những cột có
  trong payload, nên payload thiếu cột (từ build cũ) nghĩa là *không đổi*; payload thừa cột
  được báo qua `takeIncomplete` và không bị stamp (CLAUDE.md, mục Sync).
- **H6. Build cũ sửa tại chỗ.** `CoachPlanEditor` của build hiện tại ghi đè `plan_json`,
  `preview_json` của đúng row đó và đặt `editedAt` trên entry. Một version mà build cũ đã sửa
  vì thế không còn bất biến.
- **H7. Lúc mở cuộc chat, `restoreChatPlanDraftSources` điền lại `source`** vào preview của
  entry từ `preview_json` của row. Card của build cũ có fallback sang `stepsSummary` khi thiếu
  `source` (`ChatView.tsx`, `formatPlanSourceSteps(...) ?? entry.stepsSummary`).

Từ đó, năm quy tắc:

- **Q1. Không thêm field vào kind đã có** (`message`, `planDraft`, `coachPrompt`,
  `workoutDelete`, các kind biểu đồ), kể cả field tuỳ chọn: một máy chạy build cũ có thể làm
  mất nó ở mọi máy (H3, H4). Field đã tồn tại thì được dùng (`editedAt`, `removedAt`,
  `uploadResult`…).
- **Q2. Dữ liệu mới nằm trong bảng.** Version, brief, outline, chip, cài đặt của cuộc chat:
  trong cột mới của `chat_plan_drafts` (qua `ensureColumn`) và bảng mới (§7). An toàn nhờ H5.
- **Q3. Kind mới chỉ làm neo.** Thứ gì cần *hiện* ở một vị trí trong luồng chat (brief,
  outline, dòng diff, tham chiếu của một câu hỏi) là một entry kind mới, chỉ mang id trỏ vào
  bảng và vài chữ để đọc. Build cũ bỏ entry đó khi đọc, nhưng nhờ H1 nó vẫn sống ở máy mới và
  trên vault; máy cũ chỉ mất phần hiển thị, không mất dữ liệu.
- **Q4. Từ P0.1, parser giữ nguyên kind và field lạ** thay vì bỏ đi — và từ review P0, cả một kind
  đã biết nhưng không đọc được (thiếu field bắt buộc, sai kiểu): nó thành opaque, không hiện gì,
  và về lại store y nguyên, thay vì bị lần lưu sau xoá khỏi row. Không cứu được build cũ
  hiện có (Q1–Q3 vẫn phải giữ), nhưng làm mọi thay đổi *sau* P0.1 an toàn hơn, và là đường để
  một ngày nào đó được nới Q1.
- **Q5. Entry `planDraft` trong transcript không mang `source`; `preview_json` thì vẫn mang.**
  Với plan 45 buổi, một preview có `source` nặng khoảng 50k ký tự; không có thì khoảng 12k, và
  transcript là cột được gửi lại mỗi lần lưu. Card của build mới đọc bước tập từ document của
  draft (`chat:planDraftDocument`), và `getChatSession` chỉ điền lại loại card (H7 với
  `sources: false`), không điền `source`, nếu không lần lưu sau sẽ ghi chúng vào transcript.
  `preview_json` **phải** giữ đầy đủ: bản 2 của tài liệu này viết rằng build cũ lưu từ
  `plan_json`, nhưng "Save to COROS" của build cũ dựng plan từ `stored.preview`
  (`coachDraftDocument`), nên một `preview_json` gọn làm build cũ ghi mọi buổi lên COROS mà
  không có bước tập. Build cũ vẫn điền `source` vào transcript khi mở cuộc chat (H7) — transcript
  do máy cũ lưu sẽ nặng như hiện nay, không sai.

Hệ quả nhìn thấy được trên máy chạy build cũ: mỗi version hiện thành một card riêng (đúng như
hiện nay, khi mỗi lần sửa ra một card mới), card không có cấu trúc step chi tiết, brief và
outline không hiện. Chấp nhận được.

## 5. Các phase

Phase nào cũng ship được riêng và dùng được ngay. Mỗi task ghi: cỡ, làm gì, chạm vào đâu, test
nào giữ, và xong khi nào.

### P0 — Sửa nhanh, chưa đổi mô hình

Không kind mới, không bảng mới. P0.1 nên ở một bản phát hành cài lên cả hai máy trước khi bắt
đầu P1.

**P0.1 Parser giữ nguyên kind và field lạ (Q4)** · M
- **Trước tiên**, suite mới `test:chat-transcript-compat` ghi lại hành vi *hiện tại* bằng
  parser và merger thật: H3a/H3b, H4 và H1. Nếu test nào không ra như §4 viết thì dừng lại và
  sửa §4 trước khi làm tiếp. (Đã xảy ra: H3 và H4 được viết lại theo kết quả test.)
- Main (`chatHistoryStore.ts`): kind không nhận ra thì giữ nguyên object, không trả `null`.
  Kind nhận ra thì mỗi `parse*` giữ lại các key **không** có trong danh sách key đã biết của nó,
  còn key đã biết luôn lấy từ bản đã parse (key đã biết mà không hợp lệ thì bị bỏ, không được
  sống lại từ bản gốc). Áp cho cả object lồng (`draft`, `prompt`, `preview`, từng `entries[]`).
  Danh sách key đã biết là một registry theo kind, đặt cạnh các parser.
- Renderer (`src/chat/chatTypes.ts`): `ChatEntry` thêm một kind mờ (`opaque`) mang object gốc;
  timeline giữ đúng vị trí nhưng không vẽ. Mọi kind đã biết mang thêm túi field lạ;
  `toPersistedEntries` ghi lại túi đó.
- Không được làm thay đổi byte của một lần lưu không có gì đổi (`saveChatSession` dựa vào đó để
  không chạm row mỗi lần mở cuộc chat).
- Test: `test:chat-transcript-compat` chuyển sang assert hành vi mới cho build này (kind lạ và
  field lạ đi qua một vòng lưu, byte giữ nguyên) trong khi giữ các assert về build cũ;
  `test:chat-history-store`; suite mới `test:chat-entry-passthrough` cho hai bộ chuyển đổi ở
  renderer; `test:sync-twoway`.
- Xong khi: một transcript chứa kind do tay viết ra (ví dụ `planBrief`) đi qua lưu, merge và
  mở lại trên build này mà không mất gì.

**P0.2 Card plan/workout nằm trong câu trả lời** · M
- `planDraft` được vẽ inline ở mọi độ rộng, không có phép đo nào (bài học của lần gỡ ngày
  10/9). `removedAt` → không vẽ.
- Card inline là **card gọn, chỉ đọc**: kicker, tên, một dòng tóm tắt, bốn con số, ridge (từ 3
  tuần trở lên), tuần đầu dạng dải 7 ngày, nút chính và nút phụ theo P0.5, nút **Open**. Ở P0,
  Open mở `CoachCreationModal` như hiện nay; P1 đổi thành canvas.
- Plan không có ngày: card và modal đọc bố cục tuần/ngày qua `chat:planDraftDocument` (đã có,
  tôn trọng `layout`), không nhóm tất cả vào "Unscheduled".
- **Card đứng sau phần chữ của lượt.** Hiện card được upsert giữa lượt nên đứng trước câu trả
  lời. Khi lượt kết thúc (`finishStreaming`, và bộ gom headless của analysis trong
  `chatService.ts`), message cuối được đặt trước các card và câu hỏi của chính lượt đó. Việc
  này chỉ đổi thứ tự trong phần đuôi chưa lưu, vì trong lượt không có gì được ghi. Trong lúc
  stream, card vẽ dưới bubble đang stream.
- Panel Creations còn lại làm mục lục, mỗi dòng mang trạng thái thật ("In library", "On
  calendar Thu 2 Oct", "Proposal").
- CSS: đưa các token `--tl-*` mà ridge và tuần của reader đọc lên `styles.css`, để các component
  đó vẽ đúng ngoài Library.
- Test: pure function sắp thứ tự lúc kết thúc lượt, unit test (strip-types); suite renderer mới
  `test:chat-plan-card-renderer` mount card ở ba độ rộng (một bản duy nhất, thứ tự sau message,
  nút theo P0.5); `test:css-tokens`, `test:elevation`, `test:design-vocabulary`.

**P0.3 Câu hỏi đã trả lời thu thành một dòng** · S
- `coachPrompt` đã có `answer` vẽ thành một dòng "Asked: <câu hỏi> → <câu trả lời>", không còn
  `null`. Câu trả lời gõ tay cũng hiện ở đó. Chỉ đổi phần vẽ.
- Test: `test:chat-plan-card-renderer` thêm một trường hợp.

**P0.4 Workout lẻ: sửa trước khi lưu, và lưu cả hai nơi** · M
- Nút **Edit** trên card workout mở `WorkoutBuilderModal` với
  `planWorkoutInputToEditorDraft(source)` (`source` đọc từ `plan_json`, không từ preview). Lưu
  qua IPC mới `chat:editWorkoutDraft`: main cập nhật `plan_json`, dựng lại preview bằng
  `buildPlanPreview`, đặt `editedAt` (field đã có), giữ nguyên `draftId` (P1 đổi thành version
  mới). Từ chối nếu đã lưu lên COROS, như plan.
- Tuỳ chọn **Also keep in library** khi lên lịch: `buildTrainingPlanDestinationInput` giữ
  `save_to_library` cho đích calendar. Tham số thêm vào `chat:uploadPlanDraft`, không đổi tên
  channel.
- Test: `test:chat-workout-tools` (sửa rồi lưu, body ghi lên COROS có cả library và lịch);
  `test:ipc-surface`.

**P0.5 Luật one-shot và nhãn (D3)** · S
- Pure function `planSaveChoices(preview, today)` quyết định nút chính và nút phụ:

  | Plan | Nút chính | Nút phụ | Trong ⋯ |
  |---|---|---|---|
  | Workout lẻ, ngày gợi ý còn tới | Schedule for <ngày> | Save to Workout Library | — |
  | Workout lẻ, không ngày hoặc ngày đã qua | Save to Workout Library | Schedule… (chọn ngày) | — |
  | Plan **one-shot**: mọi buổi có ngày, buổi đầu tới buổi cuối ≤ 14 ngày | **Put sessions on calendar** (workout lẻ) | Save to COROS as a plan | Save to Workout Library |
  | Plan còn lại | **Save to COROS** | Add plan to calendar… (từ P1) | Put sessions on calendar (khi mọi buổi có ngày), Save to Workout Library |

- Hai nhãn khác nhau cho hai việc khác nhau, không bao giờ dùng lẫn: **Put sessions on
  calendar** là ghi từng workout lẻ (`uploadTrainingPlan`), **Add plan to calendar…** là tạo bản
  chạy của plan COROS (`executeSubPlan`).
- Bỏ fieldset "How should this plan be saved?".
- Copy: một tên "Save to COROS" (thay "Save Plan"); tóm tắt "10 weeks · 4–5 sessions/week ·
  3–6.5 h · Run, Strength" thay "8 workouts · none scheduled · 8 library-only…"; bỏ cảnh báo "No
  workouts have schedule_date set…" và tile "Weeks 0"; bỏ kicker "Plan 2 of 3".
- Test: unit test cho `planSaveChoices` (biên 14 ngày, buổi thiếu ngày, ngày đã qua, workout).

**P0.6 Generator: lên lịch đúng Thứ Hai đã chọn** · S
- `TrainingPlanCalendarDialog` nhận `defaultStartDay`; generator truyền `request.startDate`.
  Không truyền thì giữ Thứ Hai kế tiếp.
- Chỉ sửa lỗi này. Các lỗi nhỏ khác của dialog (preview không có ngày, `firstMonday` tính một
  lần, dòng snapshot) để nguyên, vì dialog bị bỏ ở P2.5.
- Test: `test:plan-generator-renderer`.

**P0.7 Dọn phần model thấy, và cắt token** · M
- Bỏ tool `upload_training_plan` (không bao giờ ghi gì), khỏi danh sách tool, khỏi phần gate
  của Claude Code, và bỏ câu "Always call this before upload" trong mô tả tool.
- Tool result của `draft_workout` / `draft_training_plan` **bỏ `entries[].source`**, giữ tên,
  ngày, volume, tóm tắt step, cảnh báo và kết quả kiểm tra. Câu dặn: "The card is shown under
  your reply. Explain the logic and the key weeks; do not list every session."
- `draft_training_plan` nhận `week` (từ 1) và `day` (`mon`…`sun`, tên chứ không phải số, để
  model không lệch một ngày) cho buổi không có ngày, ghi vào `layout` (field **đã có** trong
  `CorosTrainingPlanDraft`, build hiện tại đã đọc nó). Plan không ngày vì vậy không còn bị xếp
  mỗi ngày một buổi khi lưu (`placeDatedWorkouts`).
- **Không trộn**: hoặc mọi buổi có `schedule_date`, hoặc mọi buổi có `week`/`day`. Trộn thì bị
  từ chối ngay trong lượt.
- **Prompt nói khi nào dùng kiểu nào**, vì luật one-shot (P0.5) dựa vào nó: "sessions for this
  week or the next few days → `schedule_date`; a program the athlete will start later →
  `week`/`day`".
- Sửa copy "opens in my plan editor" trong prompt của generator và tool reply.
- Test: `test:chat-workout-tools` (không còn `source` trong result, trộn bị từ chối, schema
  < 20 kB), `test:coach-analysis-guards`, `test:chat-tool-sources`,
  `test:training-plan-generation`.

**P0.8 Lỗi nhỏ về lưu trữ** · S
- **Remove** một card chưa lưu xoá row `chat_plan_drafts` của nó qua IPC mới
  `chat:removePlanDraft`; entry giữ `removedAt` như hiện nay. Card đã lưu chỉ được **Hide**
  (`removedAt`, row còn nguyên). Không chạm gì đã lên COROS.
- Lượt bị huỷ mà đã sinh card thì card được giữ và lưu, theo cùng luật với lượt lỗi sau khi đã
  có output.
- Card xoá workout sau khi mở lại app: báo "This request expired; ask Coach again" thay vì để
  nút bấm rồi báo lỗi. Lưu bền thật sự làm ở P3.
- Lưu "Put sessions on calendar" cho một bản đã sửa mà có buổi rơi vào quá khứ: kiểm tra trước
  và nêu tên buổi, thay vì để COROS báo "cannot be scheduled in the past".
- Test: `test:chat-history-store`, `test:chat-transcript-race`, `test:ipc-surface`.

**Ship P0 khi:** card hiện đúng một bản dưới câu trả lời ở mọi độ rộng; câu hỏi đã trả lời còn
thấy được; workout sửa được trước khi lưu; generator lên lịch đúng Thứ Hai đã chọn; tool result
không còn `source`; `test:chat-transcript-compat` xác nhận §4; `npm run build` sạch.

**Review P0 (2026-09-26).** Đọc lại toàn bộ P0.1–P0.8; đã sửa:
- **Entry của một kind đã biết mà không đọc được bị bỏ**, nên lần lưu sau xoá nó khỏi row trên máy
  này — trái với Q4. Đó có thể là hình dạng của một build mới hơn (một field trở thành tuỳ chọn, như
  `bindingId` của marker analysis từng làm ở đây). Giờ nó được giữ nguyên dạng opaque: không hiện,
  không gửi cho model, về lại store y nguyên. Entry không có `kind` vẫn bị bỏ. Bốn test từng khẳng
  định "bị bỏ" nay khẳng định "không hiện dở, và không mất".
- **Lưu từng buổi lên COROS bị ngắt giữa chừng** ("Put sessions on calendar", "Save to Workout
  Library"): các buổi trước đã nằm trên COROS nhưng card vẫn "chưa lưu", và bấm lại ghi trùng chúng.
  Giờ `uploadTrainingPlan` ném `PartialUploadError` kèm những buổi đã ghi; lỗi nói rõ buổi nào đã
  lên, và lần bấm lại chỉ ghi phần còn thiếu (giữ trong RAM của lần chạy app này).
- `upload_training_plan` (bỏ ở P0.7) được liệt kê lại trong `LOCAL_CHAT_TOOL_SOURCES` như tên cũ,
  để câu trả lời cũ đã gọi nó không bị gắn nhãn "MCP".

Test mới: case lưu bị ngắt trong `test:coros-plan-writes` (fail trên code cũ); kiểm tra nhãn tool cũ
trong `test:chat-tool-sources`.

Còn lại, biết và chưa làm: phần đã ghi của một lần lưu bị ngắt chỉ được nhớ trong lần chạy app đó —
khởi động lại rồi bấm lưu sẽ ghi lại mọi buổi (lỗi lúc trước đã nói buổi nào đã lên).

### P1 — Vòng lặp chỉnh sửa

**P1.1 Artifact và version trong bảng** · L
- Bảng mới `chat_plan_artifacts` và cột mới trên `chat_plan_drafts` (§7). Row cũ không có
  `artifact_id` được đọc như một artifact một version; `document_json` của nó dựng từ
  `plan_json` khi cần (`trainingPlanFromCoachDraftPreview`). Không cần migration.
- Version mới ghi preview gọn (Q5).
- `chat:planArtifacts(sessionId)` trả metadata: artifact, danh sách version, tác giả, trạng thái
  suy ra. Nội dung một version đọc qua `chat:planDraftDocument(draftId)` (đã có; mở rộng cho
  workout và cho `document_json`). Renderer nhóm các entry `planDraft` theo artifact: version
  mới nhất vẽ đầy đủ; version cũ thu thành dòng "v1 → v2 · Coach · 3 changes · View diff".
- **Rẽ nhánh**: hai máy cùng sửa lúc offline tạo hai row cùng `version`. Không row nào bị mất;
  thứ tự theo `created_at`, và bản sau hiện là "v3 (other device)". Mới nhất là bản có
  `created_at` lớn nhất.
- **Version bị build cũ sửa tại chỗ (H6)**: `preview.editedAt` mới hơn `created_at` của row thì
  coi như người dùng sửa từ máy khác, hiện "Edited on another device", và `document_json` được
  dựng lại từ `plan_json` đã sửa.
- Test: suite mới `test:chat-plan-artifacts` (tạo, nhóm, rẽ nhánh, row cũ, sửa tại chỗ);
  `test:sync-policy`.

**P1.2 Coach sửa bằng patch (D11)** · L
- Tool mới `revise_training_plan { draft_id, ops[], summary, suggested_refinements? }`.
  (Đã làm: không có `base_version` — mỗi version có `draft_id` riêng, nên `draft_id` chính là
  bản gốc của thao tác; `summary` lưu ở cột `change_summary`. Thao tác áp trong
  `electron/planRevision.ts`, thuần. `suggested_refinements` đến ở P1.8.)
  Các thao tác: `move_session {key, week, day}`, `replace_session {key, workout}`,
  `remove_session {key}`, `add_session {week, day, workout}`, `set_week_stage {week, stage}`,
  `rename {name}`, `set_description {description}`. `day` là tên thứ như P0.7. Workout lẻ dùng
  `replace_session`.
- Áp thao tác lên `document_json` của version mới nhất, rồi kiểm tra như `draft_training_plan`
  (`validatePlanDraft`, và `generatedPlanProblems` khi plan bị buộc theo outline). Hỏng thì trả
  lý do ngay trong lượt.
- `draft_id` không phải version mới nhất (người dùng vừa sửa, hoặc vừa nhập bản từ COROS): từ
  chối, kèm `draft_id` và danh sách buổi của bản mới nhất; model đọc thêm bằng `get_plan_draft`.
- Plan đã lưu: trước khi áp thao tác, đồng bộ với COROS theo P1.6. Cho tới P1.6, sửa một
  artifact đã lưu bị **từ chối** (`draft_saved`), để một version mới không thành plan COROS thứ
  hai.
- Remove một artifact chưa lưu xoá **mọi** version và đánh dấu mọi card của nó, nếu không bản
  trước bản mới nhất sẽ bung ra lại.
- Thành công: ghi row version mới (`author: coach`), thêm một entry `planDraft` mới vào
  transcript (id mới, preview gọn), trả về tóm tắt, diff và kết quả kiểm tra.
- `draft_training_plan` nhận `revises: <draft_id>` cho trường hợp viết lại gần hết; kết quả cũng
  là version mới của cùng artifact.
- **Không** nằm trong `READ_ONLY_ALLOWED_TOOLS`: analysis chạy ngầm và lượt pipeline chỉ được
  tạo artifact mới, không được sửa artifact có sẵn, để bản người dùng đang theo dõi không bị đổi
  sau lưng họ. Vì cùng lý do, `executeChatTool` bỏ `revises` khỏi `draft_training_plan` ở mọi
  lượt không phải `interactive`. Nguồn `null` trong `LOCAL_CHAT_TOOL_SOURCES`, như
  `draft_training_plan`.
- Test: `test:chat-workout-tools` (từng thao tác, xung đột version, kiểm tra),
  `test:coach-analysis-guards`, `test:chat-tool-sources`, schema < 20 kB.

**P1.3 Coach thấy những gì nó đã tạo** · M
- Mỗi lượt, một **mục lục artifact** đứng trước câu hỏi mới nhất, mỗi artifact một dòng
  (~30 token): id, tên, loại, version, tác giả của bản mới nhất, trạng thái, `coros:` id, lịch.
- Tool mới `get_plan_draft { draft_id, version? }` đọc chi tiết (read-only, nguồn DB).
- Entry kind mới `planEvent` (neo, Q3) ở đúng lượt có thay đổi không do Coach: người dùng sửa,
  Restore, hoặc nhập bản từ COROS (D12). Mang `artifactId`, `from`, `to` và dòng diff dạng chữ.
  `toWireMessages` mở nó thành một dòng "[Athlete edited …]" hoặc "[Changed in Library …]"
  **tại vị trí đó** trong lịch sử, thay vì chép lại cả plan vào mọi lượt.
- (Đã làm: mục lục là `creationIndex`/`withCreationIndex`; renderer đọc version ngay trước khi
  gửi, analysis qua dep `getPlanArtifacts`. Lần sửa trong editor đã sinh `planEvent` ngay từ
  P1.3, còn trong một lượt `planEvent` đi kèm message kế tiếp của người dùng, không thành message
  riêng, để vai vẫn xen kẽ.)
- Bỏ `withPlanEdits`/`planEditNote`, cả trong chat lẫn `coachAnalysisService`. Draft cũ có
  `editedAt` mà không có `planEvent` hiện trong mục lục là "edited by athlete"; model đọc chi
  tiết bằng `get_plan_draft`.
- Test: `test:chat-context-compaction` (mục lục, mở `planEvent`), `test:coach-analysis-runner`.

**P1.4 Canvas** · L
- (Đã làm: `src/chat/CoachCanvas.tsx`, dựng trong khung `.chat-plan-panel` và nở rộng ở chế độ
  artifact; `CoachCreationModal` và hai card preview cũ đã xoá cùng CSS của chúng. Khác bản viết:
  khối token `--tl-*` của Library thêm `.chat-canvas` làm scope thứ tư — chỉ token, không rule
  control; Restore có ngay ở P1.4 (`chat:restorePlanVersion`), bị từ chối trên artifact đã lưu
  như revise; composer thành container query vì canvas làm cột chat hẹp cả ở cửa sổ rộng.)
- Một pane trong `.chat-layout` thay `.chat-plan-panel` và `CoachCreationModal`. Hai chế độ:
  **mục lục** (mở từ nút Creations) và **artifact** (mở từ Open trên card, hoặc từ một dòng của
  mục lục).
- Chế độ artifact đọc bằng các mảnh của Library reader: ridge xếp theo môn, dải stage, `WeekCard`
  có ngày thật khi biết Thứ Hai bắt đầu, ghi chú của Coach, kết quả kiểm tra. Có bộ chọn version
  và tab Versions (danh sách, tác giả, diff giữa hai bản bất kỳ, Restore).
- Nút chính và phụ đến từ **một** pure function `artifactActions(artifact, version, editLock)`,
  dùng chung cho card và canvas, nên hai nơi không bao giờ lệch nhau (D9).
- Cửa sổ hẹp (dưới ~1100px): canvas thành sheet phủ lên luồng chat, có nút quay lại. 7 cột tuần
  tự về dạng danh sách qua container query đang có (`plan-week`, 680px).
- Diff là module thuần `planDiff.ts` (thêm, bỏ, dời, đổi buổi; đổi stage, tên, mô tả), dùng
  chung cho canvas, dòng "v1 → v2", `planEvent` và tool result.
- Test: suite renderer mới `test:chat-canvas-renderer` (mục lục, artifact, version cũ chỉ đọc,
  sheet ở cửa sổ hẹp); unit test cho `planDiff.ts` và `artifactActions`. Lưu ý: window ẩn không
  có rAF.

**P1.5 Màn hình edit và khoá sửa (D10)** · M
- (Đã làm: `savePlanDraftEdit`/`saveWorkoutDraftEdit` trả `PlanVersionSave` — `written` với
  diff so với bản bị thay, hoặc `conflict` khi bản đã mở không còn là mới nhất; `writeVersion`
  dùng chung với Restore. `NewerVersionDialog` hỏi ba lựa chọn. Card và canvas hiện Continue
  editing khi editor của nó đang mở. Undo trên dòng `planEvent` chỉ có khi version nó để lại vẫn
  là mới nhất và chưa lưu. Toast bỏ; nút lưu là "Save changes".)
- Edit của plan mở `PlanEditor` phủ lên Coach (tổng quát hoá `CoachPlanEditor`), nạp
  `document_json` của version mới nhất. Save tạo version mới (`author: athlete`) và một
  `planEvent`, **thay** bước "Save to the card" rồi quay lại modal lưu lần hai. Toast "Plan
  updated…" bỏ.
- Edit của workout mở `WorkoutBuilderModal`, cùng cách.
- Khoá sửa: khi màn hình edit của X đang mở, nút chính của X trên card và canvas là **Continue
  editing**. Nếu lúc Save mà version mới nhất đã khác bản đã mở (một lượt Coach, hoặc bản nhập
  từ COROS), hỏi: Replace with my edit / Keep the newer version / Keep editing.
- **Undo** trên dòng `planEvent` = Restore bản trước, tức một version mới.
- Test: `test:plan-editor-renderer` (mount từ Coach), `test:chat-canvas-renderer` (khoá sửa,
  xung đột).

**P1.6 Card sống sau khi lưu, và luôn theo COROS (D5, D12)** · L
- (P1.6a đã làm: bản đọc lại sau khi lưu là `document_json` của version, khoá buổi đổi về khoá
  của Coach (`keyedAsSent`: theo `idInPlan`, rồi theo thứ tự). Version mới của plan đã lưu mang
  danh tính COROS (`carryCorosIdentity`): `remoteId`/`remoteVersion`, `idInPlan` theo khoá, và
  `corosProgram` chỉ cho buổi có workout không đổi — "không đổi" so với `plan_json` của bản gốc,
  cùng dạng, vì workout đọc lại từ COROS không bao giờ bằng bản đã viết. `document_json` giữ
  kèm hash của `plan_json`; build cũ sửa `plan_json` tại chỗ thì document được dựng lại và giữ
  danh tính. Nút chính "Update COROS plan", ⋯ "Save as a new COROS plan"; xung đột version trên
  COROS hỏi Replace with my edit / Save as a new plan / Keep editing (`CorosConflictDialog`).
  Workout đã lưu vẫn không sửa được: không có gì để cập nhật.)
- (P1.6b đã làm: `syncPlanDraftFromCoros` — chỉ khi version mới nhất là bản đã lưu, vì một
  version chưa lưu là thay đổi người dùng chưa gửi và được kiểm lúc gửi. Một request (`detail`
  thô, so `version`), request thứ hai chỉ khi COROS mới hơn; `cacheOnly` khi mở canvas không tốn
  request. Bản nhập về là version `author: coros`, khoá buổi đổi về khoá cũ theo `idInPlan`, và
  **được đánh dấu đã lưu** — nó chính là thứ COROS đang giữ. Plan bị xoá trên COROS: version
  `detached` không còn danh tính, lần lưu sau là `plan/add`; `isOnCoros` đọc dấu mới nhất. Coach
  sửa plan đã đổi trên COROS: bản COROS được nhập trước (một `planEvent` qua stream
  `chat:streamInfo` kind `planEvent`, và card của nó), rồi thay đổi của Coach chồng lên.)
- (P1.6c đã làm: "Add to calendar…" dùng `TrainingPlanCalendarDialog` qua `CoachCalendarDialog`;
  bản chưa lưu đưa vào preview dưới id `chat:<draftId>` — `previewPlanOnCalendar` đọc nó qua
  `setChatPlanReader`, chatWorkoutTools đăng ký, để hai module không import nhau — và
  `saveFirst` lưu đúng một lần. Nút có trên plan đã lưu chưa chạy trên lịch, và là lựa chọn phụ
  của một programme chưa lưu; plan one-shot không có, vì đã dẫn bằng "Put sessions on
  calendar". Trạng thái lấy từ `chat:planCalendarState` — bản chạy trong `coros_plan_cache` và
  các match đã lưu, không tốn request — qua `creationCalendar`: "On calendar", "Week n of N" hoặc
  "Starts …", và `describeCompliance` của Library (không bao giờ 0%). Chưa làm: "Remove from
  calendar" và "Open in Library" — thuộc P1.7.)
- **Save to COROS**: `savePlanToCoros` với `document_json`, như Library. Version vừa lưu được
  đọc lại từ COROS (việc Library đã làm sau mỗi lần lưu) và `document_json` của nó được thay bằng
  bản đọc về, để mang `corosProgram` và `idInPlan`.
- **Đồng bộ với COROS (D12)**: khi mở canvas, so `remoteVersion` của version mới nhất với
  `coros_plan_cache` (không tốn request). Trước khi Edit hoặc `revise_training_plan`, đọc
  `detail` (như mọi lần ghi của Library). COROS mới hơn thì **nhập về thành version mới**
  (`author: coros`) cùng một `planEvent` "Changed in Library" có diff, rồi mới sửa trên bản đó.
  Plan đã bị xoá trên COROS: artifact trở về `proposal` (lần lưu sau là `plan/add`), và một
  `planEvent` nói điều đó.
- **Update COROS plan** là nút chính của một version mới trên plan đã lưu: `detail` → so
  `version` → `plan/update`, dùng lại dialog xung đột (Replace with my edit / Save as a new plan
  / Keep editing). Plan đang chạy trên lịch thì hỏi Keep editing / Save plan only / Save & update
  calendar như `requestSave`.
- **Add plan to calendar…** từ Coach: `TrainingPlanCalendarDialog` với `saveFirst`, mặc định Thứ
  Hai bắt đầu của artifact nếu có. `previewPlanOnCalendar` nhận thêm id của một chat draft (đọc
  qua `planDraftDocument`), như nó đang nhận `draft:` của Library; các quy tắc chặn (ngày quá
  khứ, plan đã chạy) được kiểm lại cho loại id mới.
- Trạng thái trên card: On COROS / On calendar · Week n of N · done/planned, đọc từ
  `coros_plan_cache` và `planCompliance` (plan chưa lên lịch thì không có số nào, không bao giờ
  0%).
- Test: `test:coros-plan-writes` (Coach → save → sửa ở Library → nhập về → update → lịch, trên
  COROS giả).

**P1.7 Hỏi về đúng chỗ (tham chiếu)** · M
- (Đã làm: `planRefs` là kind neo; mỗi `PlanRef` mang `label` đọc được, và `toWireMessages` gộp
  nó vào câu hỏi đi ngay sau — như `planEvent` — để vai vẫn xen kẽ. Canvas có Ask Coach cho cả
  plan, cho mỗi tuần (`WeekCard.onAsk`, prop tuỳ chọn) và cho buổi đang mở; tối đa ba chip, chip
  thuộc về cuộc chat được chọn và bị xoá khi đổi cuộc chat. Library: ⋯ "Ask Coach about this
  plan" với plan `origin: coach` — `chat:findDraftSession` tìm cuộc chat theo mọi version của
  artifact (tìm chữ `"draftId":"…"` trong transcript); không thấy thì mở cuộc chat mới với tên
  plan trong composer và không có chip, vì draft đã đi cùng cuộc chat bị xoá. `onOpenCoach` nhận
  `string | CoachOpenRequest` thay vì đổi chữ ký hoàn toàn: Calendar vẫn truyền chuỗi.)
- Chọn một tuần hoặc một buổi trong canvas → **Ask Coach** → composer nhận chip. Khi gửi, một
  entry kind mới `planRefs` (neo, Q3) đứng ngay trước message của người dùng. `toWireMessages` mở
  nó thành dòng "[Athlete refers to] <artifact> v3 · week 6 (2–8 Nov) · Sun · Long run 16 km".
- Library reader có **Ask Coach about this plan**: đọc `coach.draftId` trong metadata (lần đầu có
  thứ đọc field này) → mở đúng cuộc chat đã sinh ra plan, kèm chip. Không tìm thấy thì mở cuộc
  chat mới.
- `onOpenCoach(prompt)` ở `App.tsx` đổi thành
  `onOpenCoach({ conversation: "new" | id, refs?, prompt?, send? })`.
- Test: `test:chat-context-compaction` (mở `planRefs`), `test:chat-canvas-renderer`.

**P1.8 Chip tinh chỉnh (D6)** · S
- (Đã làm: cột `refinements_json` trên row của version, không phải field trên entry (Q1);
  `refinementsFrom` bỏ chip trùng, quá 40 ký tự hoặc không phải chữ, và dưới hai chip thì coi như
  không có, để bộ mặc định thay. Bộ mặc định theo môn: "Long run on Sunday" chỉ khi plan có chạy,
  "More strength" chỉ khi chưa có sức mạnh. Bấm chip gửi đúng chữ của chip kèm `planRefs` tới cả
  creation, qua tham số `aboutRefs` của `sendMessage`, không động tới chip đang chờ trong composer.)
- `suggested_refinements` (2–4 chuỗi, mỗi chuỗi ≤ 40 ký tự) trên `draft_training_plan`,
  `draft_workout` và `revise_training_plan`, lưu trên artifact. Thiếu thì dùng bộ mặc định theo
  loại (plan: Lighter, Fewer days, Long run on Sunday, More strength; workout: Shorter, Easier,
  Harder).
- Bấm chip gửi một message thường mang đúng chữ của chip, kèm `planRefs` tới artifact. Không phải
  chỉnh sửa, nên không vi phạm D10.

**P1.9 Card không được yêu cầu (D4)** · S
- (Đã làm: `chat.coach.inlineSuggestions`, `preference`; `inlineSuggestionsEnabled` quyết theo
  provider của **nhánh gọi**, không theo provider trong Settings — một analysis có thể chạy bằng
  provider khác. Đoạn prompt nằm trong `chatCoachContext.ts` (`INLINE_SUGGESTIONS_GUIDE`,
  `inlineSuggestionsSection`), module thuần mà `test:chat-service` import được, và chỉ thêm khi
  lượt có `draft_workout`. Settings → Workout suggestions là một `OptionGroup` Automatic/On/Off.)
- Setting mới `chat.coach.inlineSuggestions`: `auto` | `on` | `off`, mặc định `auto` (bật với
  `claude-code`/`claude-api`, tắt với provider khác). Phân loại `preference` trong
  `syncPolicy.ts`. Nằm ở Settings → Coach, kèm câu về chi phí khi provider không có cache.
- Khi bật, prompt cho phép `draft_workout` khi Coach khuyên một buổi cụ thể, tối đa 2 mỗi câu trả
  lời, và "more than two options belong in one plan". **Không chặn cứng trong code** (D4); số
  card mỗi lượt được theo dõi qua chi phí mỗi câu trả lời (`TurnCostFooter`).
- Test: `test:chat-service` (prompt có đoạn này đúng khi bật và chỉ khi bật), `test:sync-policy`.

**Ship P1 khi:** sửa plan không còn sinh card mới; người dùng sửa thì Coach thấy đúng diff, đúng
lượt; canvas thay modal; plan đã lưu vẫn cập nhật và lên lịch được từ Coach, và sửa ở Library
hiện lại trong cuộc chat.

**Review P1 (2026-09-26).** Đọc lại toàn bộ P1.1–P1.9; đã sửa:
- **Draft đọc từ row, không từ bản giữ trong RAM.** `loadStoredPlanDraft` ưu tiên `draftStore`
  (cache trong tiến trình), trong khi `versionsOf` đọc SQLite. Một row đổi sau lưng tiến trình —
  máy kia lưu creation lên COROS và pull đánh dấu `uploaded_at` — thì máy này vẫn thấy "chưa lưu"
  và cho `plan/add` lần nữa: **một plan trùng trên COROS**. Cache đã bỏ.
- **Hai lần lưu bắt đầu cùng lúc** (bấm đúp, hoặc card và canvas) cùng qua kiểm tra "đã lưu" rồi
  mỗi lần `plan/add` một plan; giờ có khoá đang-lưu theo creation (`savingArtifacts`).
- **Hai lần đọc COROS cùng lúc** (mở canvas và bấm Edit) mỗi lần ghi một version "Changed in the
  Library" giống nhau; giờ lời gọi thứ hai dùng chung kết quả lần đầu (`corosSyncsInFlight`), và
  `appendVersion` không chèn một card hai lần.
- **Card lạc cuộc chat.** `openCreation`/Edit đọc COROS bất đồng bộ; nếu người dùng chuyển cuộc
  chat trong lúc chờ, version mới được chèn và lưu vào **cuộc chat đang mở**, không phải cuộc chat
  của creation. `appendVersion` giờ nhận cuộc chat đã hỏi và bỏ qua khi nó không còn mở (version
  vẫn nằm trong store); Edit không mở editor ở cuộc chat khác.
- **Restore trên plan đã lên COROS** giữ `idInPlan` của version cũ; một buổi đã bị xoá khỏi COROS
  ở version sau sẽ được gửi với id không còn tồn tại. Giờ nội dung cũ nhận định danh COROS từ
  version mới nhất theo key, như một lần revise; buổi đã bị xoá quay lại là buổi mới.
- Lỗi của các thao tác creation (lưu, sửa, khôi phục, lịch) hiện bằng lời của nó (`remoteErrorMessage`).

Test mới: bốn case trong `test:coros-plan-writes`, một case trong `test:chat-plan-card-renderer`;
cả năm fail trên code cũ.

Còn lại, biết và chưa làm: revise dời hết buổi của tuần đầu làm plan có ngày bị đánh số tuần lại
(week 1 tính từ Thứ Hai của buổi đầu tiên), `week_stages` khi đó lệch một tuần; chip tinh chỉnh
bấm khi Coach đang chờ câu trả lời (`coachPrompt`) thì được coi là câu trả lời.

### P2 — Một pipeline

**P2.0 Cài đặt theo cuộc chat (D13, D14)** · M
- (Đã làm: `getConversationSettings` mặc định chia sẻ tất cả và không có row; `setConversationSettings`
  xoá row khi mọi nguồn bật và không có runtime, nên chỉ phần khác Coach settings được giữ. Row
  đọc hỏng thì coi như không có. `chat:send` mang `sessionId`, và `streamConversationTurn` đọc cài
  đặt rồi gọi `streamChat` với `sources`/`runtime`; `streamChat` đăng ký một reach
  (`conversationReach`) trong `runTools` trừ khi lượt đó đã có reach riêng (generator). Nguồn bị
  tắt còn được nói thành luật trong prompt ("## What the athlete shares in this conversation",
  `conversationWithheldLines`), vì một tool bị giấu không nói cho Coach biết vì sao nó thiếu.
  Analysis: nguồn của cuộc chat áp dụng; runtime ghép bằng `analysisRuntimeOver` — provider và
  model là **một** lựa chọn nên cặp đó lấy nguyên từ bên đã chọn (analysis trước), effort lấy
  riêng theo cùng thứ tự; một model chọn cho Claude không bao giờ bị gửi tới OpenRouter của
  cuộc chat. UI: dải `.chat-conversation-settings` trên
  transcript mở `CoachConversationSettings` (lazy), dùng lại sheet và công tắc của generator,
  portal ra `body` trong `.coach-sheet` — scope thứ tư của các rule control Library.
  Row bị xoá cùng cuộc chat. Test riêng: `test:conversation-settings`.)
- Bảng mới `chat_conversation_settings` (§7): nguồn dữ liệu (activities, sleep, zones) và
  runtime (provider, model, effort; chỉ phần khác Coach settings, như `planGeneratorRuntime.ts`
  đang làm).
- **Mọi lượt** trong cuộc chat đọc bảng này: runtime truyền vào `streamChat` qua `runtime` (đường
  analysis đang dùng); nguồn bị tắt thì bị giữ lại khỏi tool (`toolReadsWithheldSource` qua
  `runTools`) **và** khỏi snapshot (`buildTrainingContext`, thêm scope cho sleep, hiện chỉ chặn
  qua tool).
- Analysis chạy trong cuộc chat: nguồn của cuộc chat áp dụng; runtime của analysis (nếu có) thắng
  runtime của cuộc chat.
- UI: một dải nhỏ ở đầu cuộc chat ("Reads: Activities · Zones · AI: Opus, High"), bấm vào mở
  màn hình edit cài đặt, dùng lại `GeneratorProviderPanel` và các công tắc nguồn của generator.
- Test: `test:training-plan-generation` (giữ lại qua cả lượt thường), `test:chat-service`,
  `test:coach-analysis-runner`, `test:sync-policy`.

**P2.1 Brief** · L
- (Đã làm: bảng `chat_plan_artifacts` (§7) ra đời ở đây, không phải ở P1.1 — P1.1 đặt chip lên row
  version. Brief là `PlanBriefRequest` = request của generator trừ `sources`/`runtime`/`outline`
  (của cuộc chat, hoặc tới sau), cộng `origins` (`chat`/`data`) cho từng trường Coach điền; trường
  không có origin là mặc định của form. `electron/planBrief.ts` (không `node:`) giữ mặc định — bằng
  đúng `DEFAULT_GENERATOR_FORM` —, `briefFromPrefill` (lấy được gì thì lấy, trường sai hình dạng
  nêu trong `not_taken` thay vì hỏng cả brief; ngày bắt đầu dời về Thứ Hai) và schema tool.
  `chatPlanBriefs.ts` lưu; gọi lại với `brief_id` là điền tiếp chính brief đó; brief đã có version
  thì từ chối. Kết quả tool trả Coach những gì `generationRequestProblems` còn thấy thiếu, và bảo
  Coach dừng. Lượt biết cuộc chat của nó qua `StreamChatOptions.sessionId` (`turnSessions`). Card
  dùng lại dòng snapshot của generator (`briefRows` trong `src/chat/planBriefModel.ts`, cùng
  `formFromBrief`/`briefFromForm`, round-trip không mất gì với các giá trị form biểu diễn được).
  Màn hình edit là `CoachBriefEditor`: bước Goal và Your week của generator, cột bên là công tắc
  nguồn **của cuộc chat**; lưu được cả khi còn thiếu, card liệt kê chỗ thiếu. Sửa một trường thì
  trường đó mất nhãn "from chat"/"from data". `creationIndex` liệt kê brief tới khi có version. Hỏi
  "Redraw the outline?" để sang P2.2, khi có outline. Channel đọc: `chat:planBriefs`.
  `test:chat-entry-passthrough` và `test:chat-transcript-compat` dùng `planBrief` làm kind lạ; giờ
  dùng `futureAnchor`. Test: `test:plan-brief`, case P2.1 trong `test:chat-plan-card-renderer`.)
- Tool `request_plan_brief { prefill }`: Coach điền sẵn những gì đã biết (từ cuộc chat, từ dữ
  liệu), tạo artifact ở giai đoạn brief, và một entry kind mới `planBrief` (neo). Không có trong
  lượt read-only (analysis), giống `request_coach_input`.
- Card brief inline chỉ đọc: các trường cùng nhãn "from chat" / "from data", và nguồn dữ liệu
  của cuộc chat. Nút chính **Draw the outline**, phụ **Edit brief**.
- Màn hình edit brief dùng lại bước Goal và Your week của generator (`GeneratorGoalStep`,
  `GeneratorWeekStep`, `planGeneratorModel.ts`, `generationRequestProblems`). Level "From my data"
  nằm cạnh công tắc nguồn Activities của cuộc chat.
- Sửa brief khi đã có outline thì hỏi "Redraw the outline?", như công tắc nguồn đang làm.

**P2.2 Outline** · L
- (Đã làm: bước pipeline đi qua `chat:send` — tham số thứ năm `ChatPipelineStep { step: "outline",
  artifactId, note? }` — chứ không phải channel riêng, nên lượt vẫn stream, huỷ và lưu như một lượt
  chat. Renderer hiện chữ "Draw the outline" / "Redraw the outline: <ghi chú>"; main thay tin nhắn
  user cuối trên wire bằng `trainingPlanOutlinePrompt` (brief + nguồn của cuộc chat, và với redraw
  thì outline hiện có và ghi chú). `streamOutlineStep` chạy read-only, `runTools` cấp
  `propose_plan_outline` và giữ lại `draft_training_plan`, `draft_workout`, `revise_training_plan`,
  `request_plan_brief`; nguồn bị tắt bị giữ như P2.0. Brief không còn, đã thành plan, hoặc còn
  thiếu gì thì lượt bị từ chối trước khi stream (renderer hoàn lại như mọi lần gửi hỏng).
  Outline lưu trên row artifact: `outline_json` = `{ outline, author, updatedAt }`, chỉ giữ outline
  hiện tại; `outline_version` đếm mọi lần vẽ, vẽ lại và chỉnh tay. Một lượt được chấp nhận hai lần
  thì ghi đè version của chính nó. Neo `planOutline { artifactId, outlineVersion }`; card vẽ ở neo
  **mới nhất** của artifact, neo cũ gập thành một dòng "Redrawn below". Chỉnh tay không ghi neo:
  card mới nhất hiện "Adjusted by you · vN". **Adjust outline** là `CoachOutlineEditor` (sheet của
  generator trong `.coach-sheet`): stage, giờ, số buổi, tuần nhẹ; focus và buổi chính là của Coach,
  đổi bằng redraw. Kiểm tra bằng `planOutlineProblems`, và `chat:updatePlanOutline` từ chối đúng
  những câu đó. Card brief có nút chính **Draw the outline** khi chưa có outline và brief đủ; sửa
  brief khi đã có outline thì hỏi "Redraw the outline?" (vẽ mới, không phải revision). `creationIndex`
  ghi "outline vN: 12 weeks, 4–6 h a week[, adjusted by the athlete]". **Chưa làm:** câu hỏi khi đổi nguồn của cuộc chat dưới một outline đã vẽ (generator
  có hỏi). Test: `test:plan-outline` (chạy lượt thật dưới `HERACLES_SIMULATE_PLAN_AI`), case P2.2
  trong `test:chat-plan-card-renderer`.)
- Draw the outline gửi một lượt (message thấy được: "Draw the outline") với `planRequest` lấy từ
  brief. Lượt chạy **`toolPolicy: "read-only"`** và `runTools` cấp `propose_plan_outline`, như
  generator: `chat:send` thường có `delete_workout`, và một lượt viết plan không cần nó.
- Outline lưu trên artifact, có version riêng; entry kind mới `planOutline` (neo).
- Card outline inline chỉ đọc (ridge theo stage, tuần nhẹ, "What Coach read"). Nút chính **Write
  the sessions**, phụ **Adjust outline** và **Redraw with a note**.
- **Adjust outline** là màn hình edit: đổi stage, giờ, số buổi, tuần nhẹ của từng tuần, kiểm tra
  tại chỗ bằng `planOutlineProblems`, **không gọi model**. Mỗi lần lưu là một version outline.

**P2.3 Sessions** · M
- (Đã làm: **Write the sessions** là nút chính của card outline, gửi `ChatPipelineStep { step:
  "sessions" }` qua `chat:send`. `streamSessionsStep` dựng request từ brief + nguồn/AI của cuộc chat
  + `outline` của brief, chạy read-only với `trainingPlanGenerationPrompt`; `runTools` giữ lại mọi
  tool viết trừ `draft_training_plan`. Lượt đăng ký `planGenerations` với `artifactId` của brief,
  nên draft vẫn bị `generatedPlanProblems` kiểm tra trong lượt, nhưng draft được chấp nhận được
  **ghi vào `chat_plan_drafts`** làm version 1 của artifact đó (`planArtifactId` trong
  `handleDraftTrainingPlan`); được chấp nhận lần hai trong cùng lượt thì ghi đè cùng draft id. Từ
  chối trước khi stream: chưa có outline, brief đã thành plan, hoặc outline không còn khớp brief
  (sửa brief sau khi vẽ). Plan có `schedule_date` từ Thứ Hai đầu của brief, nên canvas vẽ ngày thật
  và `CoachCalendarDialog` mở đúng Thứ Hai đó (nó đã mở theo buổi đầu tiên của plan có ngày);
  `start_monday`/`race_day` vẫn nằm trên row artifact từ P2.1. Khi đã có version: card outline thôi
  hiện nút và nói "change the plan from its card", card brief bỏ Edit brief; `creationIndex` liệt kê
  plan thay cho brief. Run trail: `CoachStepTrail` trong bubble của lượt đang chạy (cả outline và
  sessions), gấp từ stream bằng `stepRunEvent` (`src/chat/stepRun.ts`, dùng lại `runTrail.ts`).
  Test: case P2.3 trong `test:plan-outline` và `test:chat-plan-card-renderer`.)
- Write the sessions gửi một lượt **read-only**, bị buộc theo outline đã chấp nhận
  (`generatedPlanProblems`, như generator). Draft ghi vào `chat_plan_drafts` làm version 1 của
  artifact (D2), không còn `generatedDrafts` chỉ trong RAM. Artifact mang Thứ Hai bắt đầu và ngày
  đua, nên canvas vẽ được ngày thật, và Add plan to calendar… mặc định đúng ngày.
- Run trail (`runTrail.ts`) hiện trong skeleton của card khi lượt đang chạy.

**P2.4 Lượt pipeline không mang theo cả lịch sử** · S
- (Đã làm: là một hàm thuần `pipelineWire` trong `chatContextCompaction.ts` thay vì tuỳ chọn
  `wire: "pipeline"` trên `streamChat`: hai bước (`streamOutlineStep`, `streamSessionsStep`) gọi nó
  trên wire renderer gửi. Giữ 6 **tin nhắn** trước tin nhắn của bước (bắt đầu từ một tin nhắn user,
  bỏ tóm tắt compaction), rồi prompt của bước, vốn đã mang brief và outline; tin nhắn cuối của
  renderer — chữ athlete thấy và `creationIndex` — bị thay. System prompt và snapshot (theo nguồn
  của cuộc chat) vẫn do `streamChat` thêm. Renderer không gọi `compactBeforeSend` trước một bước,
  nên không tốn lời gọi tóm tắt. Test: case P2.4 trong `test:plan-outline`, và
  `test:chat-plan-card-renderer` khẳng định không có `compactChatContext`.)
- Lượt outline và lượt sessions gửi: system, snapshot (theo nguồn của cuộc chat), brief, outline
  và 6 lượt gần nhất. Không gửi cả transcript, và không tạo tóm tắt (tóm tắt chỉ có sau khi
  compaction đã chạy; tạo mới tốn thêm một lời gọi). Một tuỳ chọn `wire: "pipeline"` trên
  `streamChat`.

**P2.5 AI Plan mở Coach (D1)** · M
- (Đã làm: nút AI Plan của Library gọi `onOpenCoach({ newPlan: true })`; `CoachOpenRequest.newPlan`
  làm Coach tạo cuộc chat mới, đặt tên "New plan", gọi `chat:createPlanBrief` (`createBlankPlanBrief`:
  mặc định của form, Thứ Hai kế tiếp, không trường nào có nhãn, không gọi model) và lưu ngay neo
  `planBrief` làm entry đầu tiên. Cuộc chat không có row cài đặt, tức theo Coach settings. Khi brief
  được lưu với một mục tiêu và cuộc chat vẫn tên "New plan", nó được đổi tên theo `briefTitle`. Đã
  bỏ `TrainingPlanGenerator`, `GeneratorOutlineStep`, `GeneratorRun`, hai channel
  `trainingLibrary:generatePlan`/`outlinePlan`, `generateTrainingPlan`/`outlineTrainingPlan`,
  `generatedDrafts` (draft chỉ trong RAM), `trainingPlanFromDraftPreview` và
  `trainingPlanCoachHandoff`, cùng ~90 rule CSS chỉ các màn đó dùng. `GeneratorGoalStep`,
  `GeneratorWeekStep`, `GeneratorProviderPanel`, `planGeneratorModel.ts` và `runTrail.ts` ở lại vì
  brief, cài đặt cuộc chat và trail dùng chúng. Stage của plan viết theo outline lấy từ outline
  (trước đây `trainingPlanFromDraftPreview` làm việc này), trong `handleDraftTrainingPlan`.
  Simulation chạy qua hai bước của cuộc chat. `test:plan-generator-renderer` bị bỏ: brief và outline
  có renderer riêng trong `test:chat-plan-card-renderer`, có thêm case P2.5.
  `test:training-plan-generation` kiểm tra hai bước thay cho hai lượt cũ; `test:training-plan-simulation`
  chạy qua `streamConversationTurn`. Analysis vẫn chưa thấy brief trong `creationIndex` của nó
  (chỉ creation có version) — `coachAnalysisService` không truyền brief.)
- Nút AI Plan tạo một cuộc chat mới (tên "New plan" cho tới khi brief có mục tiêu), cài đặt của
  cuộc chat lấy từ Coach settings, và card brief với giá trị mặc định (`chat:createPlanBrief`,
  không gọi model, không tốn gì), rồi chuyển sang Coach.
- Bỏ `TrainingPlanGenerator` và các bước của nó, channel `trainingLibrary:generatePlan` và
  `trainingLibrary:outlinePlan`. Simulation (`HERACLES_SIMULATE_PLAN_AI`) chạy qua chat.
- Library draft do generator tạo trước đây vẫn là draft Library bình thường.
- Test: `test:plan-generator-model` giữ; `test:plan-generator-renderer` chuyển thành renderer của
  brief và outline; `test:training-plan-generation`, `test:training-plan-simulation` chạy qua
  đường chat; `test:ipc-surface`.

**Review P2 (2026-09-26).** Đọc lại toàn bộ P2.0–P2.5; đã sửa:
- `sendMessage` kiểm tra key theo provider **của cuộc chat** (P2.0), không theo Coach: cuộc chat
  dùng OpenRouter chưa có key giờ báo đúng key thiếu thay vì gửi rồi hỏng ở main. (Chiều ngược lại
  — Coach chưa sẵn sàng, cuộc chat dùng AI khác — vẫn bị các gate toàn màn Coach chặn; đó là thiết
  kế của màn, không đổi ở đây.)
- Một bước pipeline main từ chối trước khi stream được **lấy lại** khỏi cuộc chat, thay vì để câu
  "Draw the outline" không có trả lời nằm lại và đi theo mọi lượt sau.
- Lỗi từ main hiện bằng lời của nó (`remoteErrorMessage`), không kèm "Error invoking remote
  method '…': Error:".
- Đồng bộ: một pull có `chat_plan_artifacts` làm ChatView đọc lại brief/outline; có
  `chat_conversation_settings` thì đọc lại cài đặt của cuộc chat.
- **Write the sessions** bị khoá khi brief còn thiếu điều main sẽ từ chối (ví dụ "From my data" khi
  cuộc chat không chia sẻ Activities), không chỉ khi outline lệch brief.
- `readOutline` kiểm tra đủ (stage 1–6, giờ, và từng key session: ngày, sport, phút), vì outline
  đến từ IPC và từ row đồng bộ, và card đánh chỉ số tên thứ và theme sport bằng nó.
- `request_plan_brief` trên brief đã có outline báo Coach rằng outline không đổi theo.
- AI Plan bấm khi Coach đang trả lời thì nói ra, thay vì làm rơi yêu cầu.

Còn lại, biết và chưa làm: câu hỏi "Redraw the outline?" khi đổi nguồn của cuộc chat dưới một
outline đã vẽ; analysis không thấy brief trong `creationIndex`; ô số trong Adjust outline không xoá
trắng được (giữ số cũ cho tới khi gõ số mới); tắt Sleep không bỏ Resting HR và Recovery % khỏi
snapshot (chúng nằm trong dashboard, đi theo Activities); chưa chạy với provider thật.

**Ship P2 khi:** từ nút AI Plan tới plan trên lịch, mọi bước nằm trong một cuộc chat; nguồn dữ
liệu tắt ở cuộc chat thì không lượt nào đọc được; dialog generator không còn.

### P3 — Coach làm việc trên lịch và plan COROS có sẵn

Mục tiêu: Coach đọc được plan COROS và tiến độ của plan đang chạy, đề xuất thay đổi trên lịch
(dời, thay, bỏ, thêm nhiều buổi một lúc) mà athlete áp từng dòng hoặc cả nhóm, và làm điều đó cả
trong analysis. Mọi đề xuất sống qua restart và qua máy khác.

**Điều đã biết (đọc code và các probe đã chạy, 2026-09-26):**
- COROS **không có thao tác "dời"**: `schedule/update` với `status 2` bị từ chối (17004,
  `verify-calendar-api.mjs`). `rescheduleScheduledWorkout` thêm ở ngày mới rồi xoá ở ngày cũ, và
  thêm vào **lịch riêng của athlete** (`maxIdInPlan` của lịch), không vào bản chạy của plan.
- Một buổi trên lịch thuộc plan đang chạy mang `planId` = id **bản chạy** (`executeSubPlan`);
  buổi lẻ mang id lịch của athlete. Compliance ghép theo `planId:idInPlan` đó.
- Đã đo (`verify-coros-plan-api.mjs`): `plan/update` trên bản chạy **đưa được thay đổi lên lịch**
  (thêm buổi); sửa plan mẫu **không** đụng bản chạy. `planOntoRunningCopy` dời, thêm, bỏ trên bản
  chạy từ hôm nay trở đi (CLAUDE.md, 2026-09-25).
- Chưa đo: xoá một buổi của plan đang chạy bằng `schedule/update status 3` (đường màn Calendar và
  `delete_workout` đang dùng) làm gì với **bản chạy**; thay chương trình của một buổi (cùng
  `idInPlan`) trên bản chạy có lên lịch không; `schedule/update` nhiều entity một lần có nguyên tử
  không.
- Card xoá workout (`workoutDelete`) chỉ sống trong RAM (`deleteRequestStore`): restart là mất, bấm
  thì báo "expired".
- `PlanRef` (P1.7) chỉ trỏ vào **creation của Coach** (`artifactId`, `draftId`); lịch và plan
  COROS không phải creation.
- Analysis read-only đã được `draft_workout`/`draft_training_plan` (card chờ athlete duyệt).

**P3.0 Probe trên tài khoản thật** · S · *xong 2026-09-26*
- Đo một lần trên tài khoản thật (plan tạm trong cửa sổ lịch trống cách một năm, dọn sạch sau khi
  chạy); script probe không giữ trong repo. Mỗi câu trả lời chốt một quyết định của P3.3:
  - **A. Xoá buổi của bản chạy bằng `schedule/update` status 3:** lịch mất buổi, **bản chạy cũng mất
    entity đó**, một `plan/update` sau không đưa lại. → Xoá không làm lệch bản chạy; lệnh xoá của
    màn Calendar và `delete_workout` giữ nguyên cho buổi của plan.
  - **B. `plan/update` trên bản chạy thay chương trình một buổi:** lịch hiện bài mới, **`idInPlan`
    giữ nguyên**, plan mẫu không đổi. → "Thay một buổi mà không đổi plan mẫu" đi qua bản chạy.
  - **C. `plan/update` trên bản chạy đổi `dayNo`:** lịch dời theo, ngày cũ trống, **`idInPlan` giữ
    nguyên**, vẫn thuộc bản chạy. → Dời buổi của plan đi qua bản chạy.
  - **D. `rescheduleScheduledWorkout` trên buổi của bản chạy:** buổi mới thuộc **lịch riêng** của
    athlete (plan khác, `idInPlan` mới) và **bản chạy mất buổi đó** — buổi tách khỏi plan, compliance
    mất. → Cấm đường này cho buổi của plan; màn Calendar hiện dời mọi buổi bằng nó — sửa ở P3.3.
  - **E. Một `schedule/update` hai entity, một hỏng:** `17004 Plan data is illegal.`, **không** buổi
    nào được ghi — nguyên tử. → Change set ghi **mỗi dòng một request** để có kết quả từng dòng.
    `plan/update` trên bản chạy coi như cũng nguyên tử (một body cả plan), nên P3.3 ghi từng dòng,
    mỗi lần đọc lại `detail`.

**P3.1 Coach đọc plan COROS** · M · *xong*
- Tool `list_training_plans`: mỗi plan một dòng (tên, số tuần, môn, trạng thái lịch, nếu đang
  chạy thì tuần hiện tại và tỉ lệ hoàn thành), đọc từ `coros_plan_cache` và compliance đã lưu —
  không request nào. Tool `get_training_plan { plan_id, weeks? }`: tuần theo stage, mỗi buổi một
  dòng (`idInPlan`, ngày, tên, môn, thời lượng, trạng thái done/missed/upcoming), đọc `detail` một
  lần (như Library). Không đưa chương trình đầy đủ trừ buổi được hỏi (`sessions`).
- Read-only được phép (`READ_ONLY_ALLOWED_TOOLS`), nguồn `coros` (`LOCAL_CHAT_TOOL_SOURCES`);
  tiến độ đọc từ activity nên khi cuộc chat tắt Activities thì trả plan **không** kèm tiến độ
  (`toolReadsWithheldSource` không giấu cả tool, chỉ bỏ phần đó).
- Plan Coach đã tạo và đã lưu thì dòng của nó ghi `draft_id` để Coach sửa qua
  `revise_training_plan` thay vì qua change set.
- Test: `test:chat-plan-tools` mới (fake COROS như `test:coros-plan-writes`), guards, sources.
- **Đã làm** (`electron/chatPlanTools.ts`, đi cùng họ tool workout nên mọi provider và
  `getClaudeCodeTools` — quyền `upcomingWorkouts` — đều nhận). Plan đang chạy gộp vào plan mẫu
  (`calendar_plan_id` là id bản chạy, cặp mà P3.3 dùng để trỏ buổi); bản chạy đã gỡ không liệt kê;
  plan lưu trữ chỉ khi `include_archived`. Cache trống (Library chưa mở trên máy này) hoặc `refresh`
  thì đọc lại như Library (`getTrainingLibrarySnapshot`). `get_training_plan` đọc `detail` của bản
  chạy, offline thì đọc cache và nói thế; plan dài hơn 8 tuần mặc định chỉ đưa 4 tuần quanh hiện tại.
  `draft_id` chỉ có khi creation nằm trong chính cuộc chat này — sửa từ cuộc chat khác sẽ đặt card
  version mới vào chỗ athlete không đọc. Phần đếm compliance chuyển sang `electron/planCompliance.ts`
  để Library và Coach dùng một phép đếm.

**P3.2 Card xoá workout lưu bền** · S — bước đầu của change set · *xong*
- Bảng `chat_schedule_changes` (§7) ra đời ở đây; một đề xuất xoá là một change set một dòng.
  `delete_workout` ghi row thay vì `deleteRequestStore`; card neo bằng kind mới `scheduleChange
  { changeSetId }`. Entry `workoutDelete` cũ vẫn đọc được (chỉ hiện, nút báo "Ask Coach again").
- Test: `test:chat-workout-tools`, `test:chat-history-store` (neo mới), restart giữa chừng.
- **Đã làm** (`electron/chatScheduleChanges.ts`, `CoachScheduleChangeCard`): `delete_workout` ghi một
  change set — một dòng `remove` cho buổi trên lịch, một dòng `deleteWorkout` cho workout trong thư
  viện, hoặc cả hai — và stream `scheduleChange { changeSet }`; transcript giữ neo. Mỗi dòng đọc lại
  COROS trước khi ghi (ngày đó qua `schedule/query`; thư viện đọc lại, bỏ qua cache vài phút của nó):
  buổi biến mất hoặc đổi tên thì *stale*, không ghi gì. Một dòng một lần ghi, lưu kết quả ngay; dòng
  đã áp không ghi lại; bấm hai lần trong một process bị từ chối (`applying`). Dòng mang op mà build
  này không biết được giữ nguyên qua mỗi lần lưu và không được áp. Card cũ `workoutDelete` chỉ hiện,
  kèm câu "Ask Coach again"; `chat:confirmWorkoutDelete` và `deleteRequestStore` đã bỏ. Xoá cuộc chat
  xoá change set của nó. Còn lại: hai máy áp cùng một set gần như cùng lúc thì máy sau thấy buổi đã
  mất và ghi *stale* đè *applied* (row thắng theo last-writer-wins) — không ghi COROS hai lần, chỉ
  sai chữ trên card.

**P3.3 Change set trên lịch** · L · *xong*
- Tool `propose_schedule_changes { summary, changes: [{ op: move | replace | remove | add,
  target: { plan_id, id_in_plan, happen_day } , to_day?, workout? }] }`. Chỉ **đề xuất**: không
  ghi gì lên COROS, nên được phép trong read-only (analysis). Mỗi dòng được kiểm tra ngay trong lượt
  (buổi còn đó không, ngày không ở quá khứ, workout hợp lệ qua `validateWorkoutDraftShared`) và lỗi
  trả lại cho model như các tool draft.
- Card: danh sách dòng ("Dời Long run T7 → CN", "Thay Tempo 8 km bằng Easy 45′"), mỗi dòng có Áp /
  Bỏ, và **Áp tất cả**. Trạng thái từng dòng lưu trong row: proposed / applied / failed (kèm lý do)
  / dismissed / stale.
- Áp một dòng: **đọc lại ngày đó** (`schedule/query`) trước; buổi đã đổi hoặc biến mất thì dòng
  thành *stale*, không ghi. Buổi lẻ: `rescheduleScheduledWorkout` / `removeScheduledWorkout` /
  `createAndScheduleWorkout`. Buổi của plan đang chạy: một `plan/update` trên **bản chạy** gom mọi
  dòng (đường `planOntoRunningCopy`), chỉ từ hôm nay. Theo P3.0: dời và thay đi qua `plan/update`
  trên **bản chạy**, mỗi dòng một lần ghi, đọc lại `detail` trước mỗi lần (E: một lần ghi là nguyên
  tử, nên gom dòng thì mất kết quả từng dòng); xoá dùng `removeScheduledWorkout` (A: bản chạy cũng
  bỏ buổi); **không bao giờ** `rescheduleScheduledWorkout` cho buổi của plan (D). Mỗi dòng ghi kết quả ngay khi xong (bài học lưu-từng-phần của review P0); khoá theo change
  set như `savingArtifacts`.
- Sửa kèm (P3.0 D): màn Calendar dời buổi của plan đang chạy qua bản chạy (`plan/update` đổi `dayNo`),
  không qua `rescheduleScheduledWorkout`. Xoá giữ nguyên (P3.0 A).
- Test: `test:schedule-changes` mới (fake COROS giữ lịch và bản chạy), renderer của card.
- **Đã làm.** Tool `propose_schedule_changes` (trong họ tool workout; tối đa 20 dòng; `session { plan_id,
  id_in_plan, date }`, `to_date`, `workout` dạng của `draft_workout`) kiểm từng dòng trong lượt — buổi
  có trên ngày đó (đọc lịch một lần cho cả khoảng), không ngày nào đã qua, mỗi buổi một thay đổi, workout
  qua `validatePlanDraft` và resolve bài tập — và trả mọi lỗi một lần. Áp: `electron/scheduleMoves.ts`
  (`moveCalendarSession`, `replaceCalendarSession`) chọn đường theo `isRunningCopy` (cache, không có thì
  hỏi COROS `plan/query`): buổi của plan → `plan/update` trên bản chạy, đọc `detail` lại mỗi dòng; buổi
  riêng → dời bằng thêm-rồi-xoá, thay bằng thêm-trước-xoá-sau (hỏng giữa chừng thì còn hai buổi chứ không
  mất buổi). Dòng `add` đã có buổi cùng tên trên ngày đó thì *stale* (máy kia đã áp). Change set nhớ
  `unit_system` (cột qua `ensureColumn`). Màn Calendar kéo buổi của plan giờ đi qua bản chạy (P3.0 D).
  `list_scheduled_workouts` ghi `in_plan` cho buổi của plan đang chạy. `creationIndex` mang trạng thái
  từng đề xuất (đã áp, lỗi/stale kèm lý do, bỏ, chưa quyết) đọc lại từ row mỗi lượt. Review tự làm
  phát hiện: P3.2 khai báo state `scheduleChanges` sau chỗ dùng đầu tiên — một cuộc chat có neo
  `scheduleChange` làm ChatView văng (TDZ); đã sửa, `test:schedule-change-renderer` giữ nó.

**P3.4 Card trong analysis** · M
- Analysis tuần và review sau buổi tập được phép gọi `propose_schedule_changes` và các tool draft
  (đã có), trong giới hạn D4 (tối đa 2 card mỗi lần chạy, theo setting P1.9). Card nằm trong cuộc
  chat của analysis như câu trả lời của nó; áp vẫn là của athlete.
- Kèm theo: `coachAnalysisService` truyền brief vào `creationIndex` (lỗ hổng ghi ở review P2).
- Test: `test:coach-analysis-runner`, `test:coach-analysis-guards`.

**P3.5 Hỏi về đúng chỗ, từ Calendar và Library** · M
- Kind neo mới `scheduleRefs { refs: [{ scope: day | week | session, day, plan_id?, id_in_plan?,
  label }] }` — **không** mở rộng `PlanRef`, vì `parsePlanRef` đòi `artifactId`/`draftId` và một
  build P1 sẽ không đọc được. `toWireMessages` gộp vào câu hỏi như `planRefs`.
- Calendar: "Ask Coach" của ngày, tuần và buổi mở Coach với chip (thay chuỗi prompt hiện nay).
  Library reader: "Ask Coach" trên một buổi của **mọi** plan COROS (không chỉ plan của Coach),
  trỏ `plan_id` + `id_in_plan` để Coach đọc bằng `get_training_plan`.
- Test: `test:chat-plan-card-renderer` (chip), `test:chat-context-compaction` (wire).

**Thứ tự:** P3.0 → (P3.1 ∥ P3.2) → P3.3 → (P3.4 ∥ P3.5). Cỡ việc thô: P3.0 ≈ 1–2 ngày (tuỳ lịch
chạy probe), P3.1 ≈ 3 ngày, P3.2 ≈ 2 ngày, P3.3 ≈ 1–1.5 tuần, P3.4 ≈ 3 ngày, P3.5 ≈ 4 ngày.

**Ship P3 khi:** Coach trả lời "tuần này tôi bị ốm, sắp lại giúp" bằng một change set mà athlete
áp được từng dòng; buổi của plan đang chạy vẫn thuộc plan sau khi dời; đề xuất sống qua restart và
qua máy khác; áp hai lần không ghi hai lần.

**Việc tồn đọng nên làm trước hoặc cùng P3** (từ các lần review): câu hỏi "Redraw the outline?"
khi đổi nguồn của cuộc chat; analysis không thấy brief (gộp vào P3.4); phần đã ghi của một lần lưu
bị ngắt chỉ nhớ trong RAM (P3.3 có thể dùng cùng cơ chế lưu kết quả từng dòng).

## 6. IPC

Mỗi channel mới sửa đủ `main.ts`, `preload.ts`, `coroslink-api.ts`, rồi chạy
`npm run test:ipc-surface`.

| Channel | Phase | Việc |
|---|---|---|
| `chat:editWorkoutDraft` | P0.4 | Lưu workout đã sửa vào draft (P1: thành version mới) |
| `chat:uploadPlanDraft` | P0.4 | Thêm tham số `keepInLibrary` (không đổi tên) |
| `chat:removePlanDraft` | P0.8 | Remove artifact chưa lưu: xoá row |
| `chat:planArtifacts` | P1.1 | Metadata artifact và version của một cuộc chat |
| `chat:planDraftDocument` | P1.1 | Đã có; mở rộng cho workout và `document_json` |
| `chat:restorePlanVersion` | P1.5 | Restore một version cũ thành version mới |
| `chat:editPlanDraft` | P1.5 | Trả về version mới thay vì sửa tại chỗ |
| `chat:syncPlanArtifact` | P1.6 | Đọc `detail`, nhập bản COROS mới hơn thành version |
| `chat:conversationSettings`, `chat:setConversationSettings` | P2.0 | Nguồn dữ liệu và runtime của cuộc chat |
| `chat:createPlanBrief`, `chat:updatePlanBrief`, `chat:updatePlanOutline` | P2 | Brief và outline không qua model |
| `chat:send` + `ChatPipelineStep` | P2.2, P2.3 | Tham số thứ năm: lượt là một bước pipeline (`outline`, `sessions`), không phải câu hỏi |
| `chat:planBriefs` | P2.1 | Đọc brief của các anchor `planBrief` |
| `trainingLibrary:generatePlan`, `trainingLibrary:outlinePlan` | P2.5 | **Đã bỏ** |
| `chat:scheduleChanges` | P3.2 | Đọc change set của các neo `scheduleChange` |
| `chat:applyScheduleChange`, `chat:dismissScheduleChange` | P3.2–P3.3 | Áp / bỏ một dòng hoặc cả change set |

## 7. Dữ liệu và sync

| Bảng / cột | Tier | Nội dung |
|---|---|---|
| `chat_plan_drafts` + cột mới (P1.1) | `personal` (giữ) | `artifact_id`, `version`, `parent_draft_id`, `author` (`coach` \| `athlete` \| `coros`), `document_json`. Mỗi version một row. `plan_json` và `preview_json` giữ nguyên hình dạng (đầy đủ) cho build cũ (Q5) |
| `chat_plan_artifacts` (mới, P1.1) | `personal` | `artifact_id` PK, `session_id`, `kind` (plan/workout), `start_monday`, `race_day`, `refinements_json`, `brief_json` (P2), `outline_json` + `outline_version` (P2), `updated_at`. Chỉ những gì không suy ra được: không có tên, trạng thái hay id COROS (đọc từ version). Hai máy sửa brief cùng lúc thì bản sau thắng, như draft Library |
| `chat_conversation_settings` (mới, P2.0) | `personal` | `session_id` PK, `sources_json`, `runtime_json`, `updated_at`. Bảng riêng, không thêm cột vào `chat_sessions`, để không đụng merger của bảng đó |
| Setting `chat.coach.inlineSuggestions` (P1.9) | `preference` | `auto` \| `on` \| `off` |
| `chat_schedule_changes` (mới, P3.2) | `personal` | `change_set_id` PK, `session_id`, `summary`, `lines_json` (mỗi dòng: op, target, trạng thái, kết quả, lý do), `created_at`, `updated_at`. Personal để áp được từ máy kia; áp hai lần an toàn vì mỗi dòng đọc lại lịch trước khi ghi |
| Entry kind mới `planEvent`, `planRefs` (P1), `planBrief`, `planOutline` (P2), `scheduleChange`, `scheduleRefs` (P3) | trong `chat_sessions` | Chỉ là neo (Q3) |

- Thêm bảng thì phân loại trong `syncPolicy.ts`, hoặc `test:sync-policy` fail.
- Cột mới đi qua `ensureColumn`, không sửa khối `CREATE TABLE`.
- Xoá cuộc chat thì xoá artifact, version và cài đặt của nó (mở rộng `deletePlanDraftsOf`).
- `hydratePlanDraftStoreFromDatabase` thôi nạp mọi draft vào RAM lúc khởi động; đọc theo cuộc
  chat khi cần.

## 8. Token và dung lượng

Đo trên 10 draft thật trong DB (khoảng 3.5 ký tự/token). Một buổi tập chiếm 900–1300 ký tự
trong tool result hiện nay, 450–600 ký tự trong input model phải viết ra, và 100–140 ký tự trong
`withPlanEdits`. Ví dụ tính cho một plan 10 tuần, 45 buổi:

| Thay đổi | Ảnh hưởng | Phase |
|---|---|---|
| Card inline | 0 (chỉ UI; card vẫn không gửi cho model) | P0.2 |
| Tool result bỏ `source` | −9 đến −11k input mỗi vòng sau khi draft | P0.7 |
| "Đừng liệt kê lại từng buổi" | −0.5 đến −1.5k output mỗi lượt tạo plan | P0.7 |
| Sửa bằng patch thay vì viết lại | −6 đến −8k output mỗi lần sửa | P1.2 |
| Mục lục artifact thay `withPlanEdits` | +~30 token mỗi artifact mỗi lượt; −~1.8k mỗi lượt cho mỗi plan đã sửa | P1.3 |
| Brief | Bớt 2–5 lượt hỏi đáp | P2.1 |
| Sửa outline bằng tay | Bớt cả lượt vẽ lại | P2.2 |
| Lượt pipeline chỉ mang brief, outline và 6 lượt | Không phụ thuộc độ dài cuộc chat | P2.4 |
| Card không được yêu cầu | +1 vòng tool mỗi card (phần lớn được cache với Claude) + ~300 output | P1.9 |

Tổng chi phí **giảm**, với điều kiện giữ ba chốt: tool result không có `source`, sửa bằng
patch, và lượt pipeline không mang cả lịch sử.

**Dung lượng transcript.** Transcript lớn nhất hiện là 563k ký tự, và sync đẩy nguyên row mỗi
lần lưu. Đo trên năm transcript lớn nhất: **75% là biểu đồ `activityVisual`** (~35k mỗi cái),
plan draft chỉ là phần nhỏ. Kế hoạch này không được làm plan draft thành vấn đề thứ hai: mỗi
version thêm một preview gọn (~12k ký tự cho plan 45 buổi, thay vì ~50k nếu có `source`), và
patch làm version nhiều hơn, nên Q5 là bắt buộc. Việc thu nhỏ biểu đồ là một task riêng.

## 9. Rủi ro và việc cần probe

| Rủi ro | Xử lý |
|---|---|
| §4 sai ở một điểm nào đó | P0.1 bắt đầu bằng test ghi lại hành vi hiện tại; sai thì sửa §4 trước khi làm tiếp |
| Card inline gây lại lỗi 10/9 | Không có phép đo độ rộng nào quyết định card hay nút tồn tại; test renderer ở ba độ rộng |
| `ChatView.tsx` (~5k dòng) phình thêm | Card, canvas, máy trạng thái tách ra `src/chat/canvas/`; logic thuần tách khỏi component để test được |
| Version rẽ nhánh giữa hai máy | Không mất row nào; hiển thị "(other device)"; mới nhất theo `created_at` |
| Build cũ sửa tại chỗ một version (H6) | Nhận ra qua `editedAt` > `created_at`, hiện "Edited on another device" (P1.1) |
| Coach và người dùng sửa cùng lúc | `base_version` trên tool; hỏi xung đột khi người dùng lưu (P1.5) |
| Bản trên COROS đổi mà chat không biết | So với cache khi mở canvas; đọc `detail` trước mỗi lần sửa (P1.6) |
| Giới hạn 2 card chỉ nằm trong prompt (D4) | Model có thể vượt; theo dõi qua chi phí mỗi câu trả lời; công tắc tắt được |
| Claude Code `maxTurns: 10` / `MAX_TOOL_ROUNDS = 10` | Patch và kiểm tra trong lượt dùng ít vòng hơn gửi lại cả plan; theo dõi `no-plan` sau P1 |
| Provider không cache (OpenRouter, Local) | D4 tắt mặc định; câu chi phí trong Settings |
| Thay một buổi trên bản chạy mà không đổi plan mẫu | **Đã đo (P3.0 B, C):** thay chương trình và dời ngày qua `plan/update` trên bản chạy — lịch theo, `idInPlan` giữ, plan mẫu không đổi |
| Xoá/dời buổi của plan đang chạy làm tách buổi khỏi plan (compliance mất) | **Xoá: không (P3.0 A)** — status 3 bỏ buổi khỏi cả bản chạy. **Dời: có (P3.0 D)** — `rescheduleScheduledWorkout` đưa buổi sang lịch riêng; sửa màn Calendar ở P3.3 |
| Một change set ghi nhiều buổi trong một request | **P3.0 E: nguyên tử** — một dòng hỏng làm hỏng cả request; ghi mỗi dòng một request |
| Change set áp hai lần từ hai máy | Mỗi dòng đọc lại lịch trước khi ghi; dòng đã khác thì *stale* |

Mặc định nhỏ, đổi được khi review:
- Ngưỡng one-shot 14 ngày tính từ buổi đầu tới buổi cuối (không phải từ hôm nay).
- Bộ chip mặc định ở P1.8.
- Canvas dưới ~1100px thành sheet.
- Lượt pipeline mang 6 lượt gần nhất.

## 10. Tài liệu phải sửa

- (Đã sửa) [training-plan-coros-first.md](training-plan-coros-first.md) §7: plan của AI Plan nằm trong
  cuộc chat (D2); "Edit plan first" và "Save to the card" được thay bằng version; plan đã lưu
  theo COROS (D12); hết đoạn generator giữ library draft. Sửa khi P2 xong.
- `CLAUDE.md`, mục Training Library (đoạn "A Coach plan stays in the conversation" và "The AI
  plan generator") và mục Coach (thêm H1–H7 và Q1–Q5 của §4 cạnh đoạn "A transcript entry is
  rebuilt field by field in four places").
- (Đã sửa) [coach-analysis.md](coach-analysis.md): analysis đọc mục lục artifact thay `withPlanEdits`,
  theo nguồn dữ liệu của cuộc chat, và không `revise` artifact có sẵn.

## 11. Thứ tự và phụ thuộc

```
P0.1 ──► (ship lên cả hai máy) ──► P1.1 ──► P1.2 ──► P1.3
P0.2 ──► P0.3                        │        │
P0.4, P0.5, P0.6, P0.7, P0.8         ▼        ▼
                                   P1.4 ──► P1.5 ──► P1.6 ──► P1.7 ──► P1.8
                                                          P1.9 (sau P0.7)
P1.* ──► P2.0 ──► P2.1 ──► P2.2 ──► P2.3 ──► P2.4 ──► P2.5 ──► §10
P2 ──► P3.0 (probe) ──► P3.1 ∥ P3.2 ──► P3.3 ──► P3.4 ∥ P3.5
```

Trong P0, các task độc lập với nhau trừ P0.3 dựa trên phần vẽ của P0.2. P0.1 là task duy nhất
nên có trong một bản phát hành riêng trước P1.

Tổng cỡ việc thô: P0 ≈ 1.5 tuần, P1 ≈ 3–4 tuần, P2 ≈ 3 tuần, P3 ≈ 3–4 tuần sau probe.
