# Training plans: COROS là trung tâm

Phương án chốt ngày 2026-09-24. Tài liệu này giữ lại lý do của từng quyết định; mô tả code
hiện tại nằm trong phần Training Library của `CLAUDE.md` và
[training-library-architecture.md](training-library-architecture.md).

Mọi sự thật về API trong tài liệu đều đã được probe live trên tài khoản thật (2026-09-24/25),
bằng dữ liệu tạm và đã dọn sạch. Payload lấy từ chính bundle của Training Hub web
(`t.coros.com`). Chi tiết endpoint: [coros-plan-write-api.md](coros-plan-write-api.md).

## 1. Khái niệm

- **Plan = plan trên COROS.** Library chỉ liệt kê plan COROS. Mọi lần lưu thật ghi lên COROS
  qua `plan/add` / `plan/update`. App là nơi bấm thao tác; nguồn dữ liệu là tài khoản COROS
  của người dùng.
- **Draft = trạng thái đang sửa dở, lưu tạm ở máy.** Draft không phải plan: không lên lịch,
  không duplicate. Có hai loại (cách hiển thị ở §6):
  - draft của một plan mới: không có `baseRemoteId`;
  - draft sửa một plan COROS: mang `baseRemoteId` và `baseVersion`.

  Draft chỉ áp cho plan. Workout editor vẫn ghi thẳng lên COROS như hiện nay.
- **Plan của coach nằm trong coach cho tới khi được save.** Nó không hiện thành draft hay
  item nào ở màn hình Plans. Save là tạo thẳng một plan COROS. Quy tắc cũ giữ nguyên: một
  tool call của AI không tự ghi được; chỉ card xác nhận của người dùng mới gọi IPC ghi.
- **Không có lựa chọn "tạo local hay COROS".** Không còn plan local.

> Không nhầm với **chat plan draft** (`chatWorkoutTools.ts`, `chat_plan_drafts`): đó là bản
> plan mà coach dựng trong một cuộc chat và sống cùng cuộc chat đó (§7), không phải draft của
> Library. Hai khái niệm giữ tên riêng trong code.

## 2. Mô hình dữ liệu

Một mô hình duy nhất, cắt theo đúng những gì COROS lưu được. Draft dùng cùng mô hình, nên
lưu một draft lên COROS không mất gì.

| Field | COROS | Ghi chú |
|---|---|---|
| `id` | `coros:<remoteId>`; draft: `draft:<uuid>` | |
| `name`, `description` | `name`, `overview` | Tên dạng khoá i18n (`P10035`) được dịch qua `corosText` khi đọc |
| `weekCount` | suy từ `totalDay` | **Tính theo cách COROS tính**: `totalDay` = `dayNo` cuối + 1, nên tuần trống ở cuối không tồn tại. Editor được thêm tuần trống khi đang sửa, nhưng số tuần sau khi lưu là số COROS trả về |
| `sessions[]` | `entities` + `programs` | `week`, `day` (0 = Thứ Hai), `order`, `workout` |
| `session.corosProgram` | program thô | Giữ nguyên program COROS để lưu lại không mất field; chỉ dựng lại từ `workout` khi buổi đó bị sửa |
| `weekStages` | `weekStages[].stage` | **Đúng bảy giá trị của COROS**: 0 Not Set, 1 Preparation, 2 Base, 3 Build, 4 Peak, 5 Race, 6 Transition |
| `remoteVersion` | `version` | So trước mỗi lần ghi |
| `calendar` (chỉ đọc) | `executeStatus` + `endDay` | `unscheduled` (plan), `running` (instance `executeStatus 1`), `finished` / `stopped` (cả hai là `executeStatus 2`; `endDay` sớm hơn buổi cuối là `stopped`). Instance còn mang `startDate` (Thứ Hai tuần 1) và `sourcePlanId`; plan có bản chạy mang `runningInstanceId` |
| Metadata | — | `tags`, `favorite`, `archived`, `origin` (`user` \| `coach`), `coach?` — bảng riêng, xem §3 |

**Bỏ**, vì COROS không lưu được: `goal`, `phases` (tên tự do, kéo dài nhiều tuần), buổi
`rest` và `note`, buổi chưa có ngày (holding area), `startDate` của plan, `calendarInstalls`,
`programId`/`remotePlanProgramId` trên buổi, bảng `training_plan_workout_links`, `syncState`,
`sportMix` và `plannedTrainingLoad` được lưu sẵn (tính khi đọc, hoặc lấy từ `calculate` lúc ghi).

Những gì COROS **không** có, để UI không hứa:

- **Buổi nghỉ và ghi chú trong plan.** `eventTags` gửi kèm `plan/add` hay `plan/update` đều
  trả `0000` rồi bị bỏ. Nghỉ là ngày trống; ghi chú chung đưa vào `description`.
- **Stage có tên tự đặt.** Chỉ có enum ở trên.

## 3. Lưu trữ

| Bảng | Tier | Nội dung |
|---|---|---|
| `training_plan_drafts` (mới) | `personal`, sync giữa các máy | Draft. Hai máy cùng sửa một draft thì bản lưu sau thắng — chấp nhận được với draft |
| `training_plan_metadata` (mới) | `personal` | Tags, favourite, archived, origin, coach, khoá theo `coros:<remoteId>` |
| `coros_plan_cache` (mới) | `device` | Chỉ document để vẽ: hiện ngay khi mở màn hình và khi offline. Mọi thao tác ghi đọc lại `detail` trước, nên payload thô của COROS không được lưu |
| `training_plans` | — | Bỏ sau khi migrate (§8) |

Thêm bảng nào thì phân loại trong `syncPolicy.ts`, hoặc `test:sync-policy` fail.

## 4. Thao tác

| Thao tác | Gọi COROS | Ghi chú |
|---|---|---|
| Tạo | `plan/add` | Mở editor trên một draft mới; Save = add, Save draft = lưu local |
| Sửa | `detail` → so `version` → `plan/update` | `update` gửi lại toàn bộ plan; `versionObjects` chỉ ghi thay đổi: thêm `{id, status:1}`, sửa `{id, planProgramId, planId, status:2}`, xoá `{…, status:3}` |
| Sửa plan đang chạy trên lịch | `plan/update` lên instance | **Lịch đổi ngay**; UI nói trước điều đó |
| Sửa plan mẫu đang có bản chạy | `plan/update` lên plan mẫu; nếu chọn cập nhật lịch thì `plan/update` tiếp lên instance | Sửa plan mẫu không tự đổi instance, nên lúc Save hỏi Keep editing / Save plan only / Save & update calendar. Cập nhật lịch **không** dùng `plan/sync`: đo 2026-09-25, sync không mang theo buổi bị dời. `planOntoRunningCopy` ghi các buổi từ hôm nay trở đi của plan mẫu lên instance (dời, thêm, xoá tại chỗ); buổi đã qua giữ nguyên, và sửa trực tiếp trên lịch từ hôm nay trở đi sẽ mất — câu hỏi nói rõ điều đó |
| Duplicate | `plan/copy` rồi `plan/update` đổi tên | `copy` giữ nguyên tên và ghi `originId` |
| Xoá | `plan/delete` (`[id]`) | Soft delete: rời `plan/query`. Plan đang có trên lịch (hoặc có bản chạy) được `quitSubPlan` trước — xác nhận nói rõ, và service từ chối nếu thiếu cờ `takeOffCalendar` — rồi xoá cả plan lẫn bản chạy; gỡ thất bại thì không xoá gì |
| Lên lịch | `executeSubPlan?subPlanId=<mẫu>&startDay=` | §5 |
| Gỡ khỏi lịch | `quitSubPlan?subPlanId=<instance>` | Gỡ mọi buổi của plan; instance còn lại với `executeStatus 2`; stage các tuần đó trên lịch về 0 |

**Plan COROS hiện trong Library:**

- Plan mẫu (`executeStatus 0`) là một dòng, mang badge "On calendar" khi có instance chạy
  với `sourcePlanId` trỏ về nó.
- Instance đang chạy mà không có plan mẫu trong library (ví dụ plan official đã áp lịch như
  P10035) là một dòng riêng. Sửa dòng này là sửa lịch.
- Instance chạy hết (`finished`) chỉ đọc, nằm trong mục Done. Instance đã gỡ khỏi lịch
  (`stopped`) không được liệt kê: COROS từ chối `executeSubPlan` trên nó (1031), và plan mẫu
  (nếu còn) là dòng đại diện.

**Sửa chồng giữa hai máy.** `update` gửi toàn bộ plan nên có thể ghi đè lẫn nhau. App so
`version` vừa đọc với `version` lúc bắt đầu sửa, giống cách workout editor đang làm. Việc
COROS có tự từ chối bản ghi cũ hay không chưa được probe; đừng dựa vào điều đó.

## 5. Lịch

- Lên lịch là `executeSubPlan`; COROS tự theo dõi instance. **Toàn bộ luồng install bị xoá**:
  `calendarInstalls`, `writeMayHaveSucceeded`, trạng thái partial, bản "Local Copy".
- **COROS gắn `dayNo 0` vào Thứ Hai của tuần chứa `startDay` và bỏ mọi buổi trước `startDay`.**
  Chọn Thứ Tư thì buổi Thứ Hai và Thứ Ba của tuần 1 mất; chọn Chủ nhật thì mất cả tuần 1.
  Hộp chọn ngày mặc định Thứ Hai và liệt kê các buổi sẽ mất nếu chọn giữa tuần. `MonthDayPicker`
  và `monthGridWeeks` đã có sẵn.
- **COROS không kiểm tra trùng ngày.** Buổi của plan và workout có sẵn nằm chung một ngày
  (web giới hạn 10 buổi/ngày). Preview tự đọc `schedule/query` để cảnh báo.
- **Dời buổi trên lịch** (`schedule/update` với `versionObjects:[{type:0, id, status:2, planId,
  planProgramId}]`) cập nhật `dayNo` của instance. Plan và lịch luôn khớp theo cả hai chiều.
- `previewPlanOnCalendar` / `putPlanOnCalendar` / `takePlanOffCalendar` / `syncPlanToCalendar`
  nằm trong `trainingLibraryService.ts`. Preview chặn: ngày bắt đầu trong quá khứ, plan đã có
  bản chạy, chạy một instance, plan không có buổi, và ngày bắt đầu làm mất hết buổi. "Đã có bản
  chạy" được trả lời từ cache (preview đọc lại mỗi lần chọn ngày, còn `plan/query` là payload
  nặng nhất COROS trả); `executeNativeCorosPlan` hỏi lại COROS ngay trước khi ghi và tự từ chối
  lần chạy thứ hai. Hộp chọn mặc định Thứ Hai kế tiếp.
- **Badge và compliance đọc từ instance.** Buổi trên lịch mang `planId = instanceId` và
  `idInPlan`, đúng khoá `schedulePlanId:idInPlan` mà `TrainingActivityMatch` đang dùng.
  `planCompliance` bỏ phần join qua occurrences.
- `copyWeek` / `deleteWeek` là thao tác trên lịch, không phải trên plan. `deleteWeek` xoá
  **mọi thứ** trong tuần; nếu đưa vào UI thì phải là thao tác chủ ý, có xác nhận.

## 6. Draft

- **Save draft** ghi toàn bộ trạng thái editor vào `training_plan_drafts`. `planDraft.ts` đã có
  undo và luật "draft chỉ resume cho đúng plan ở đúng version"; phần mới là lưu xuống DB và
  sync.
- **Lưu thật**: draft không có `baseRemoteId` gọi `plan/add`, có thì gọi `plan/update`. Sau đó
  đọc lại `detail` để xác minh, **rồi mới xoá draft**. Lỗi ở bước nào thì draft vẫn còn.
- **Plan gốc đã đổi trên COROS** (`version` ≠ `baseVersion`): lúc lưu, hỏi Replace with my edit /
  Save as a new plan / Keep editing. So version xảy ra trước khi định giá buổi nào qua `calculate`.
- **Plan gốc đã bị xoá trên COROS**: draft giữ nguyên, và lúc lưu thì chuyển sang `plan/add`.
- **Validate lỏng**: draft được thiếu tên, thiếu buổi. Luật đầy đủ chỉ áp khi lưu lên COROS.
- **Hiển thị**: draft nằm đúng chỗ của plan, không có mục riêng.
  - Draft của plan mới là một tile như plan thường, gắn nhãn **Draft**; mở ra là vào thẳng
    editor, và bỏ draft bằng nút Discard draft trong editor.
  - Draft sửa một plan có sẵn không tạo tile riêng mà gắn nhãn **Editing** trên tile (và hero,
    reader) của plan gốc. Chỉ một lối vào editor: nút Edit của reader đổi thành **Continue
    editing** (style đậm) khi có draft, còn Edit thường là nút ghost nhẹ; menu ⋯ mở đầu bằng
    Clear editing.
  - Mỗi plan giữ một draft; Save draft thay draft cũ.
  - Draft sửa một plan không còn trong danh sách (bị xoá trên COROS) hiện như draft plan mới.

## 7. Coach

**Plan của coach sống trong coach, không phải trong Library.** Bản của nó là chat plan
draft (`chat_plan_drafts`, gắn với cuộc chat). Màn hình Plans không liệt kê nó, dù là draft
hay item nào khác. Chỉ khi được save nó mới thành một plan COROS.

- Card xác nhận có đích "Training Plan" (`nativePlan`): đi qua `savePlanToCoros`, ghi metadata
  `origin: "coach"` cùng `coach: {draftId}`. Card báo đã lưu vào COROS plans; card không tự mở
  reader (Library là màn hình khác), người dùng lên lịch từ trang của plan. Field `coach` là
  chỗ dành sẵn; hiện chưa có gì đọc nó.
- **"Edit plan first" mở một màn hình sửa riêng ngay trong Coach** (`CoachPlanEditor`), không
  chuyển sang Plans Library và không tạo plan local. Nó dùng lại `PlanEditor`, vốn được portal ra
  `<body>` (`.tl-plan-modal-backdrop`) nên mount được từ Coach mà không cần route Library.
- **Save trong màn hình đó cập nhật lại chính plan của coach**, không tạo draft Library nào:
  ghi vào row `chat_plan_drafts` của nó, và thay entry `planDraft` trong transcript bằng bản mới
  (`chatTypes.ts` đã thay theo index). Card trong chat hiện bản đã sửa. Đẩy lên COROS vẫn là nút
  **Save to COROS** riêng trên card.
- **Hướng chuyển ngược**: document → draft của coach (`savePlanDraftEdit` trong
  `chatWorkoutTools.ts`), không đổi schema của `chat_plan_drafts`: `CorosTrainingPlanDraft` có
  thêm `description`, `weekStages` và `layout` (tuỳ chọn), rồi preview dựng lại bằng
  `buildPlanPreview`. Ngày được giữ theo Thứ Hai của buổi có ngày đầu tiên
  mà coach viết; plan coach viết không có ngày thì vẫn không có ngày, và vị trí tuần/ngày người
  dùng xếp được giữ trong `layout`. Entry transcript chỉ thêm `editedAt` (đã sửa đủ bốn chỗ).
  Coach cũng được phép truyền `description` và `week_stages` trong `draft_training_plan`.
- **Coach thấy bản đã sửa.** Coach không có tool sửa draft; `draft_training_plan` luôn tạo
  draft mới, nên nếu không được báo thì coach sẽ dựng lại từ bản nó nhớ và bỏ mất phần người dùng
  đã sửa. `withPlanEdits` (`chatContextCompaction.ts`) đặt bản đã sửa lên trước câu hỏi mới nhất
  của người dùng — không thành một message riêng, để vai user/assistant vẫn xen kẽ — cả ở chat
  lẫn lượt analysis, và đọc toàn bộ transcript chứ không chỉ phần đuôi chưa bị tóm tắt.
- **Bỏ hạn 24 giờ** của chat plan draft (`prunePlanDraftStore` xoá draft chưa upload sau
  24 giờ, và card khi đó báo "expired, ask the coach to regenerate"). Draft sống cùng cuộc
  chat: xoá cuộc chat thì xoá mọi draft của nó (`deleteChatSessionById` đọc transcript trước
  khi xoá row, rồi gọi `deletePlanDraftsOf`).
- Xoá hai đích lưu local (`localPlan`, `localTemplate`). Mở lại `nativePlan` qua luồng trên.
  Workout Library và Calendar giữ nguyên.
- `TrainingPlanGenerator` (tạo plan bằng coach ngay trong Library) mở kết quả trong editor,
  chưa lưu; ở đây Save draft được phép vì người dùng đang đứng ở màn hình Plans.

## 8. Migration (chạy một lần khi mở DB)

- **Row `coros:*` trong `training_plans`**: chuyển tags, favourite, archived sang
  `training_plan_metadata`, rồi xoá row (nó chỉ là cache).
- **Row `local` và `coach`** (kể cả các bản "… Local Copy"): **bỏ hết**, không chuyển thành
  draft. Plan cũ mất là chấp nhận được.
- **Buổi mà plan local đã ghi lên lịch vẫn còn nguyên.** Đó là workout lẻ thật trên lịch
  COROS; migration chỉ xoá row trong SQLite và **không gọi COROS**, nên không buổi nào bị
  gỡ. Sau đó chúng là workout lẻ bình thường: app không còn biết chúng thuộc plan nào, và
  "Remove from calendar" theo plan không còn. Gỡ thì làm từng buổi trên lịch như mọi workout.
- `training_activity_matches` giữ nguyên: đó là match giữa buổi trên lịch và activity, không
  thuộc plan local nào.
- **Mỗi máy tự bỏ bảng của mình khi mở DB**, bằng `DROP TABLE`, không đi qua `syncBridge`, nên
  không phát tombstone nào lên vault. Entry `training_plans` mà một máy chạy bản cũ còn đẩy lên
  sẽ không có bảng để ghi vào; lỗi đó nằm gọn trong `try` theo từng entry của `applyEntries`.
  Bỏ `training_plans` và `training_plan_workout_links` khỏi `syncPolicy.ts` cùng lúc.
- Test chạy trên một database dạng cũ viết tay, **trong file riêng**, theo mẫu
  `test:library-migrations` và `test:analysis-legacy-drop` (`initializeDatabase` trả lại
  database có sẵn của process). Assert: tags/favourite/archived của plan COROS sang bảng
  metadata; row local/coach biến mất; không lời gọi COROS nào được phát ra.

## 9. Test giữ các quyết định này

| Suite | Giữ |
|---|---|
| `test:coros-plan-writes` | Body của mọi lần ghi (đối chiếu capture trong `scripts/fixtures/coros-plan-write/`), từng endpoint, và các luồng lưu / lịch / Coach của Library trên một COROS giả giữ lại những gì nó nhận |
| `test:coros-official-plan` | Plan official viết bằng khoá i18n, program kèm `exercises`, distance tính bằng cm, `totalSets` đếm step |
| `test:library-migrations` | Migration §8 trên một database dạng cũ viết tay |
| `test:training-library`, `test:plan-*`, `test:library-renderer`, `test:plan-editor-renderer` | Mô hình, bộ lọc, reader, editor, draft và compliance |
| `verify:coros-plan-api -- --live` | Lặp lại vòng đời trên tài khoản thật với dữ liệu tạm; chỉ chạy khi được yêu cầu |
