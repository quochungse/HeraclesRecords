# Heracles Training Load

Spec và kế hoạch triển khai, 29/10/2026. Bản sống (có sơ đồ, comment): https://claude.ai/artifact/1v7X759GLvaWvYvnf8agTZ. Nghiên cứu và số liệu kiểm chứng: báo cáo "Tải Gym quy đổi", https://claude.ai/artifact/QfvJ6wg8tvogCcTkNv2Qaz.

## Tóm tắt

Heracles Training Load (Heracles TL) là tải tập luyện riêng của app cho buổi sức mạnh, nằm cùng thang với TL chạy của COROS. COROS tính TL từ nhịp tim (TRIMP), nên ở cùng mức cảm nhận, buổi tạ chỉ được 1/3 đến 1/4 TL mỗi phút so với buổi chạy. Ví dụ buổi ngực – lưng 24/10 được 65 TL COROS và 203 Heracles TL, ngang một buổi chạy 10 km khoảng 70 phút.

Người dùng chọn nguồn tải trên màn Strength. Khi chọn Heracles, các màn trong mục Phạm vi dùng Heracles TL cho buổi sức mạnh; các môn khác vẫn là TL COROS.

| Quyết định | Nội dung |
| --- | --- |
| Tên | Heracles Training Load. UI vẫn ghi "Training load" hoặc "Load"; tên đầy đủ chỉ ở chỗ giải thích chỉ số và trong hover hiện cả hai số. |
| Cài đặt | Trên màn Strength: "Training load: COROS · Heracles". Mặc định COROS. |
| Dùng Heracles TL | Strength, biểu đồ tuần ở Overview, Training activity heatmap, Calendar, Training Library, Activities. |
| Giữ TL COROS | Dải khuyến nghị tuần, Base Fitness, Load Impact, Intensity Trend, load ratio của Running và Cycling, phân bố tải theo môn. |
| Hover | Mọi chỗ hiện Heracles TL của buổi sức mạnh đều hiện kèm TL COROS. |
| Bản đồ cơ | Set · Volume; thêm Load khi chọn Heracles. Bỏ Time. |
| Feel | Không phải đầu vào của một buổi. Chỉ dùng để đo hệ số k trên các buổi chạy. |
| Lap gộp | Buổi không bấm nghỉ là lỗi người dùng, không tách set. |

## Công thức

Heracles TL của một buổi là tổng TL các set cộng phần thời gian ngoài set, mỗi phần bằng k × RPE × số phút. RPE của set được dự đoán từ tạ, số rep, cân nặng và năng lực của chính người tập ở bài đó. Với mọi môn khác, Heracles TL bằng TL COROS, nên cộng được giữa các môn.

1. Tải hệ thống: L = tạ + α × cân nặng. α theo bài, ví dụ hít đất 0,64, dips 0,95, squat không tạ 0,88; bài có tạ ngoài là 0 trừ khi bảng bài tập ghi khác.
2. Năng lực bài: C = max trong 120 ngày của L × (1 + (rep + 1) / 30), chỉ lấy set từ 20 rep trở xuống và chỉ lấy các buổi tới ngày đang tính. Bài bodyweight chưa có lịch sử dùng mức dân số quy theo cân nặng^0,67.
3. Cường độ I = L / C; số rep tối đa RM = 30 × (1/I − 1); số rep dự trữ RIR = max(0, RM − rep).
4. RPE của set theo thang RIR: RIR ≤ 3 cho 10 − RIR; RIR 3–6 cho 7 − (RIR − 3) × 2/3; RIR > 6 cho 2 + 3 × e^(−(RIR − 6)/6). Bài giữ tĩnh: 2 + 8 × min(1, thời gian giữ / mức tối đa).
5. Thời lượng set τ = thời gian làm + min(thời gian nghỉ sau set, 180 s).
6. TL set = k × RPE × τ / 60. Thời gian còn lại của buổi (khởi động, chuyển bài, giãn cơ) tính RPE 1,5.
7. Heracles TL = max(TL COROS, Σ TL set + TL ngoài set). Phần tim mạch là TL COROS, phần cơ là phần còn lại.

```
TL_Heracles = max( TL_COROS , k/60 × ( Σ RPE_s × τ_s + 1,5 × t₀ ) )
```

| Trường hợp | Cách tính | Cờ |
| --- | --- | --- |
| Buổi đọc được từng set | Công thức trên | không |
| Drill, plyo chiếm hơn 50% thời gian | TL COROS | không |
| Không đọc được set: lap gộp trên 40 rep, mã vùng cơ S4209–S4214, hoặc hơn 50% set không rõ bài | max(TL COROS, k × RPE trung vị của người tập × phút) | ước lượng |
| Chưa có chi tiết buổi trong cache | TL COROS | chưa tính |
| Set có rep nhưng thiếu tạ | RPE trung vị của buổi | ước lượng |

| Tham số | Giá trị | Nguồn |
| --- | --- | --- |
| k (TL mỗi đơn vị RPE × phút) | Σ TL COROS / Σ (feel × 2 × phút) trên các buổi chạy feel ≥ 3 trong 120 ngày; dưới 8 buổi thì dùng 0,5. Hiện tại của bạn: 0,47 | Đo trên dữ liệu người dùng |
| Cân nặng | Hồ sơ COROS (`weightKg`), theo ngày khi đã lưu lịch sử | COROS |
| RIR của set tốt nhất | 1 | Thiết kế, kiểm trên 8 buổi |
| RPE ngoài set | 1,5 | Thiết kế (CR-10: rất nhẹ) |
| Giới hạn nghỉ tính vào set | 180 s | Thiết kế, không nhạy |

Các mắt xích đã công bố: session-RPE (Foster 2001), thang RIR (Zourdos 2016, Helms 2016), rep theo %1RM (Epley, Nuzzo 2024), RPE buổi bằng trung bình RPE các set (Day 2004), α của bài bodyweight (Ebben 2011, de Leva 1996), năng lực theo cân nặng (Jaric 2002).

## Phạm vi

Khi người dùng chọn Heracles, mọi con số tải của từng buổi và các tổng cộng từ chúng đều dùng Heracles TL. Mọi chỉ số do COROS tính từ TL COROS vẫn giữ nguyên. Quy tắc để xem một chỗ thuộc bên nào: nếu con số được so với một dải hoặc một tỷ lệ mà COROS tính, nó phải là TL COROS.

| Màn | Dùng Heracles TL | Giữ TL COROS |
| --- | --- | --- |
| Strength | Ô Training load trong chi tiết buổi, TL từng set, lựa chọn Load của bản đồ cơ | Danh sách buổi và biểu đồ tuần giữ nguyên (Set, Volume, thời lượng) |
| Overview | Biểu đồ tuần ở chế độ Load, Training activity heatmap ở chế độ Training load, Coming up (tải so với plan) | Intensity Trend; phần chân Training load (Load Impact, Base Fitness, tải tuần so với dải khuyến nghị); Training load distribution; các mục Running, Cycling, Hiking |
| Calendar | Thẻ buổi, panel ngày, số tải và thanh của ô tuần, ghép cặp với plan, khối trạng thái plan, tải dự kiến của buổi sức mạnh đã lên lịch | Dòng mục tiêu COROS của tuần và phép so trên/trong/dưới dải; Load ratio, Base Fitness, Load Impact trong tooltip; tải xem trước trong workout builder |
| Training Library | Tải dự kiến của buổi sức mạnh trong plan và workout, tổng tải tuần của plan, phần trăm hoàn thành, trạng thái hoàn thành một phần | Tải do COROS tính cho bước có mục tiêu cường độ (chạy, đạp) |
| Activities | Fact Training load trên dòng, tổng Training load và trung bình tuần, ô Training load trong chi tiết | Không có |
| Running, Cycling, Hiking | Không đổi (Heracles TL của các môn này bằng TL COROS) | Load ratio từng môn |
| Coach | Luôn có cả hai trường, không theo cài đặt | TL COROS giữ nguyên tên và vị trí |

Coming up ở Overview ghép buổi với plan theo cùng thứ tự với Calendar, nên phải theo cùng nguồn tải để hai màn không ghép khác nhau.

## Cài đặt và cách hiển thị

Một cài đặt duy nhất trên màn Strength quyết định nguồn tải cho mọi màn trong Phạm vi. Nó được lưu ở main process, vì Training Library tính trạng thái hoàn thành plan ở đó.

- **Vị trí:** hàng điều khiển đầu màn Strength, một `OptionGroup` nhãn "Training load" với hai lựa chọn **COROS · Heracles**. Mặc định COROS.
- **Lưu trữ:** `app_settings`, khóa `strength.loadSource`, giá trị `coros` hoặc `heracles`; xếp loại `preference` trong `syncPolicy.ts`. Không dùng `defineSelectionPreference`, vì localStorage thì main không đọc được.
- **IPC:** `strength:getLoadSource` và `strength:setLoadSource`, sửa cả ba file (`main.ts`, `preload.ts`, `heraclesrecords-api.ts`). Renderer giữ giá trị trong một provider dùng chung, các màn đọc qua hook `useLoadSource()`. Khi sync kéo về thay đổi của `app_settings`, provider đọc lại.
- **Bật lần đầu:** nếu chưa có chi tiết của một số buổi sức mạnh trong cache, chạy backfill như màn Strength đang làm. Trong lúc đó các buổi chưa tính hiện TL COROS kèm cờ "chưa tính".
- **Nhãn:** UI giữ "Training load", "Load", "TL" như hiện nay. Tên đầy đủ "Heracles Training Load" chỉ xuất hiện trong popover (i) cạnh cài đặt, trong hover hiện hai số, trong mô tả tool của Coach và trong guide trên website.

**Hover hai số** là một mảnh UI dùng chung cho mọi màn, chỉ hiện khi đang chọn Heracles và hai số khác nhau:

| Trường hợp | Nội dung hover |
| --- | --- |
| Một buổi sức mạnh | Heracles TL 203 · COROS TL 65 |
| Một buổi có cờ | thêm một dòng: "ước lượng, không đọc được từng set" hoặc "chưa tính, đang tải chi tiết buổi" |
| Một tổng (ngày, tuần, khoảng lọc) có buổi sức mạnh | Heracles TL 1.033 · COROS TL 723 |
| Buổi dự kiến (plan) | Heracles TL ước tính 180 · COROS TL 0 |
| Môn khác, hoặc đang chọn COROS | Không có hover mới |

Popover (i) cạnh cài đặt giải thích: Heracles Training Load tính tải buổi sức mạnh từ tạ, số rep, cân nặng và năng lực của bạn ở từng bài, theo cùng thang với Training Load chạy của COROS; các môn khác dùng Training Load của COROS. Hai dòng sau nêu giá trị đang dùng: "Hệ số so với chạy 0,47, đo từ 17 buổi chạy" và "Cân nặng 75 kg, từ hồ sơ COROS".

## Strength

Heracles TL vào màn Strength ở bốn chỗ. Danh sách buổi (set, volume, thời lượng) và biểu đồ tuần (Volume, Set) giữ nguyên; việc so với chạy nằm ở biểu đồ tuần của Overview.

1. **Cài đặt** ở hàng điều khiển đầu màn, cạnh chọn khoảng thời gian và nguồn dữ liệu, kèm nút (i).
2. **Ô Training load trong chi tiết buổi** (`StrengthSessionDetail`). Khi chọn Heracles:
    - số lớn là Heracles TL, dòng phụ ghi "COROS 65"; hover hiện hai số;
    - dưới hàng chỉ số có một thanh hai phần: tim mạch (TL COROS) và cơ (phần còn lại);
    - một dòng so với chạy: "Ngang buổi chạy 10,2 km, 70 phút ngày 25/07 (TL 208)". Đó là buổi chạy có TL gần nhất trong 8 tuần trước; không có buổi nào lệch dưới 15% thì bỏ dòng này;
    - buổi có cờ "ước lượng" hoặc "chưa tính" ghi cờ ở dòng phụ thay cho thanh.
3. **TL từng set** trong các dòng bài tập của chi tiết buổi: một số nhỏ cạnh mỗi set (ví dụ 8,5), hover hiện RPE dự đoán, số rep dự trữ và %e1RM. Chỉ hiện khi chọn Heracles.
4. **Bản đồ cơ** (`StrengthHero`, cả phần Strength trên Overview):
    - lựa chọn mặc định là Set · Volume; khi chọn Heracles thêm Load; bỏ Time;
    - `HeatMetric` thành `"sets" | "volume" | "load"`; lựa chọn đã lưu là `time`, hoặc là `load` khi đang chọn COROS, quay về `sets`;
    - Load của một cơ = Σ (TL set × tỉ trọng của cơ đó trong bài), dùng đúng tỉ trọng hiện có của `reviewedMuscleLoads`. Tổng các cơ bằng tổng TL các set; phần thời gian ngoài set không thuộc cơ nào;
    - bảng xếp hạng cơ (`MusclePanel`) ghi "x TL"; thang màu vẫn là 5 bậc theo cơ bận nhất.

Buổi chỉ có trên Hevy không có TL COROS: ô Training load hiện Heracles TL, dòng phụ ghi "COROS —". Hevy không ghi giờ nghỉ nên mỗi set tính 3 s mỗi rep cộng 90 s nghỉ; set warm-up của Hevy không dùng để ước tính năng lực, set failure tính là 0 rep dự trữ.

## Overview

Biểu đồ tuần là nơi so chạy với sức mạnh rõ nhất: khi chọn Heracles, lựa chọn Load vẽ khối gym bằng Heracles TL, còn phần chân vẫn là số của COROS.

**Biểu đồ tuần** (`TodayWeek`, `buildWeekChart`):

- Giữ ba lựa chọn Time · Distance · Load, không thêm lựa chọn thứ tư.
- Ở Load với nguồn Heracles:
    - khối buổi sức mạnh cao bằng Heracles TL; khối môn khác giữ TL COROS;
    - hiện khối được cắt từ TL ngày của COROS chia cho các buổi; khối gym mới = phần COROS của nó + (Heracles TL − TL COROS);
    - khối phần dư (tải COROS không thuộc buổi nào) giữ nguyên;
    - số trên đầu cột là tổng theo Heracles; trục tự tính lại từ cột cao nhất;
    - hover của khối gym và của cột có gym hiện hai số.
- Khối dự kiến của buổi sức mạnh dùng Heracles TL ước tính (cách tính ở mục Training Library), vẫn tô gạch chéo như mọi khối dự kiến; hover ghi "ước tính".

**Phần chân Training load** giữ nguyên số của COROS: Load Impact, Base Fitness, tải tuần và dải khuyến nghị. Hiện `thisWeekLoad` cố ý lấy tải tuần từ chính chuỗi của biểu đồ để hai chỗ khớp nhau. Với nguồn Heracles, nó phải tiếp tục cộng TL COROS, vì nếu đổi sang Heracles thì cả 8/8 tuần tháng 9–10 sẽ bị báo vượt dải. Hover vào tải tuần hiện "Heracles TL 1.033 · COROS TL 723" để người dùng hiểu vì sao số này nhỏ hơn tổng các cột.

| Phần | Nguồn khi chọn Heracles |
| --- | --- |
| Intensity Trend | COROS |
| Coming up | Heracles cho buổi sức mạnh và tải dự kiến của nó (`comingUpModel`, `loadAgainstPlan`) |
| Training activity heatmap | Heracles (mục riêng bên dưới) |
| Training load distribution | COROS |
| Running, Cycling, Hiking | Không đổi |
| Strength (bản đồ cơ) | Theo lựa chọn của bản đồ cơ trên Strength |

## Training activity heatmap

Ở chế độ Training load, tải của mỗi ngày = TL ngày của COROS + Σ (Heracles TL − TL COROS) của các buổi sức mạnh trong ngày. Chế độ Duration không đổi.

- **Giá trị ô** (`TrainingHeatmapPanel`, `buildHeatmapCells`): heatmap đã nhận danh sách buổi và gộp vào ngày qua `enrichDayListWithActivityTotals`. Thêm một bước cộng phần chênh của buổi sức mạnh vào bản sao của ngày dành riêng cho heatmap; ô giữ thêm TL COROS để hover hiện hai số.
- **Thang màu**: vẫn 5 bậc theo ngày nặng nhất trong khoảng đang xem. Ngày gym sẽ đậm hơn hiện nay, đó là thay đổi mong muốn.
- **Tổng của khoảng** (`buildHeatmapSummary`) cộng theo giá trị ô nên theo Heracles; hover của tổng hiện hai số.
- **Thẻ ngày** (`heatmapDaySummary`): vạch màu chia theo tải từng môn và các dòng buổi dùng Heracles TL cho buổi sức mạnh.
- **Màu môn của ngày** (`buildDominantSportByDay`, chọn theo buổi tải cao nhất): theo Heracles, nên một ngày có cả chạy nhẹ và gym nặng có thể đổi sang màu Strength.
- **Ngày ngoài danh sách buổi đã tải**: giữ TL COROS của ngày.

## Calendar

Với nguồn Heracles, Calendar đọc tải thực tế và tải dự kiến của buổi sức mạnh qua hai helper dùng chung: `activityLoad(activity, source)` và `plannedLoad(entry, source)`. Riêng dòng mục tiêu COROS của tuần vẫn so với tổng TL COROS.

| Thành phần | Hiện tại | Với nguồn Heracles |
| --- | --- | --- |
| Thẻ buổi (`DayCell`) | "x TL" từ `activity.trainingLoad`; buổi dự kiến từ `scheduled.trainingLoad` | Heracles TL cho buổi sức mạnh; buổi sức mạnh dự kiến hiện Heracles TL ước tính; hover hai số |
| Panel ngày (`DayOverview`) | Tổng tải các buổi đã tập và tải từng dòng | Theo Heracles; hover của tổng hiện hai số |
| Ô tuần (`WeekStatsCell`, `computeWeeklyStats`) | Số tải, thanh đã tập và còn lại, dòng mục tiêu COROS, chữ trên/trong/dưới dải | Số tải và thanh theo Heracles. Dòng mục tiêu và chữ trên/trong/dưới dải so với một tổng TL COROS riêng (`actualCorosLoad`). Hover số tải hiện hai số |
| Phần trăm hoàn thành (`completionPct`) | Load trước nếu plan có TL; buổi sức mạnh thường có TL plan bằng 0 nên rơi xuống thời lượng | Heracles thực tế chia Heracles dự kiến; buổi sức mạnh vì vậy được tính theo tải |
| Ghép cặp (`matchScore`) | Gần nhất theo load, rồi distance, rồi thời lượng | Cùng thứ tự, load theo Heracles cả hai vế |
| Khối trạng thái plan (`PlanStatusBlock`) | TL plan và TL đã tập | Theo Heracles, hover hai số |
| Chi tiết buổi dự kiến (`ScheduledWorkoutDetail`) | TL plan của COROS | Buổi sức mạnh hiện Heracles TL ước tính, hover hai số |
| Tooltip Load ratio, Base Fitness, Load Impact | COROS | Không đổi |
| Workout builder, thư viện workout trong modal | TL xem trước do COROS tính | Không đổi |

## Training Library

Training Library cần Heracles TL **dự kiến** cho buổi sức mạnh chưa tập. COROS chỉ tính TL plan cho bước có mục tiêu cường độ, nên buổi sức mạnh hiện thường có TL plan bằng 0.

Ước tính tải dự kiến, theo thứ tự ưu tiên:

1. Plan có bài, set, rep và tạ (hoặc bài bodyweight): chạy đúng công thức trên từng set dự kiến, với năng lực hiện tại của người tập; thời gian làm = rep × 3 s, nghỉ lấy từ plan hoặc 90 s; phần còn lại của thời lượng dự kiến tính RPE 1,5.
2. Plan không có tạ nhưng có thời lượng dự kiến (`estimatedTime`): k × RPE trung vị của người tập trong 8 tuần × số phút.
3. Không có gì để ước tính: TL plan của COROS.

Mọi giá trị từ bước 1 và 2 mang cờ "ước tính" trong hover. Cùng hàm ước tính này cấp số dự kiến cho Calendar, Coming up và khối dự kiến trên biểu đồ tuần của Overview.

| Thành phần | Với nguồn Heracles |
| --- | --- |
| Tải của một buổi trong plan (`PlanEntryRow`, `PlanEditor`, `PlanSessionView`) | Buổi sức mạnh hiện Heracles TL dự kiến; hover hai số |
| Tổng tải tuần của plan (`trainingPlanDomain`, `planReaderModel`) | Cộng cả buổi sức mạnh |
| Đã tập so với dự kiến (`PlanSessionView`) | Cả hai vế theo Heracles |
| Trạng thái hoàn thành (`buildTrainingActivityMatches`, chạy ở main) | Tỷ lệ = Heracles thực tế / Heracles dự kiến; dưới 0,75 là "hoàn thành một phần". Main đọc nguồn tải từ `app_settings` |
| Điểm ghép buổi với plan (`scheduledActivityScore`) | Phần điểm theo tải dùng Heracles cả hai vế |

**Lưu trữ:** `training_activity_matches` thêm hai cột `planned_heracles_load` và `completed_heracles_load` qua `ensureColumn`. Đổi nguồn tải thì tính lại trạng thái cho khoảng đang xem.

## Activities

Activities chỉ cộng và hiển thị tải của từng buổi, không so với dải nào của COROS, nên cả màn chuyển theo nguồn tải.

| Thành phần | Với nguồn Heracles |
| --- | --- |
| Fact trên dòng (`activityFacts`) | "x TL" của buổi sức mạnh là Heracles TL; hover hai số |
| Tổng theo khoảng lọc và theo nhóm môn (`activityFilters`) | Cộng Heracles TL; giữ thêm tổng TL COROS để hover |
| Ô Training load và "x mỗi tuần" (`ActivitiesSummary`) | Theo Heracles; hover hai số |
| Ô Training load trong chi tiết (`ActivityDetailPane`, `ActivityDetailPanel`, `StrengthDetailPanel`) | Buổi sức mạnh hiện Heracles TL, dòng phụ "COROS 65" |
| Buổi chưa tính | TL COROS, hover ghi "chưa tính" |

## Coach

Coach luôn nhận cả hai số cho buổi sức mạnh, không phụ thuộc cài đặt, kèm một quy tắc so sánh. Prompt của Coach viết bằng tiếng Anh và không dịch.

| Chỗ | Hiện tại | Thay đổi |
| --- | --- | --- |
| Dòng buổi trong tool (`chatActivityTools`) | `load 65` | Buổi sức mạnh: `load 65 (COROS), Heracles 203` |
| Chi tiết buổi trong tool | `Training load: 65` | Thêm `Heracles Training Load: 203 (cardio 65, muscular 138)` và cờ nếu có |
| Tổng theo môn (`chatActivityTools`, `chatCoachContext`) | `load 124` | Nhóm sức mạnh: `load 124 COROS, 413 Heracles` |
| Phân tích tự động (`formatPrecedingTraining`) | "COROS training load undercounts strength; judge it by duration and the muscles worked" | Mỗi buổi sức mạnh có Heracles TL |

Mô tả tool nêu: Heracles Training Load là tải buổi sức mạnh trên cùng thang với TL chạy của COROS; dải khuyến nghị, Load Impact, Base Fitness và load ratio được tính từ TL COROS nên chỉ so với TL COROS. Không thêm trường mới vào loại chat entry đã lưu.

## Kiến trúc và luồng dữ liệu

Heracles TL được tính ở một chỗ duy nhất trong main process rồi đi theo các payload đang có; renderer chỉ chọn số theo cài đặt.

```
strength_sessions ─┐
training_activities (feel → k) ─┤                       ┌─ TrainingHubActivity.heraclesLoad ─┐
hồ sơ COROS (cân nặng) ─┼─► heraclesLoadService ─► ├─ buổi dự kiến: tải ước tính       ├─ IPC ─► loadSource.ts ─► Strength, Overview,
danh sách buổi COROS (TL) ─┘   (heraclesLoad.ts)   ├─ StrengthSession: TL từng set     │                          Heatmap, Calendar,
app_settings (strength.loadSource) ──────────────► └─ ghép plan, tool Coach           ─┘                          Training Library, Activities
```

- **Trường mới, không ghi đè `trainingLoad`:**
    - `TrainingHubActivity.heraclesLoad?`: `value`, `cardio` (TL COROS), `muscular`, `quality` (`sets`, `estimate`, `pending`, `conditioning`);
    - `StrengthSession.heracles?`: TL buổi và TL từng set theo đúng thứ tự set của `parseStrengthDetail`;
    - `TrainingHubScheduledWorkoutEntry.heraclesLoad?` và `TrainingHubUpcomingWorkout.heraclesLoad?`: tải dự kiến, `quality` là `planned`.
- **Nơi gắn:** `listTrainingHubActivities`, `listScheduledWorkoutEntries`, payload lịch sử Strength, `buildTrainingActivityMatches`, các tool của Coach.
- **Đệm:** khóa gồm số dòng và `fetched_at` mới nhất của `strength_sessions`, cân nặng, số buổi chạy có feel trong 120 ngày, phiên bản bảng bài tập.
- **Nhân quả:** tính theo thứ tự thời gian; năng lực của một buổi chỉ dùng các buổi tới ngày đó, nên PR mới không viết lại quá khứ.
- **Dependency injection:** service nhận `Deps` có `createDefaultDeps()`, để suite truyền dữ liệu giả.

## Lưu trữ, sync, dịch thuật và website

| Thứ mới | Nơi lưu | Loại trong `syncPolicy.ts` | Ghi chú |
| --- | --- | --- | --- |
| Nguồn tải | `app_settings`, khóa `strength.loadSource` | `preference` | Mặc định `coros` khi chưa có dòng |
| Tải theo Heracles của mỗi lần ghép plan | `training_activity_matches`, cột `planned_heracles_load`, `completed_heracles_load` qua `ensureColumn` | theo bảng hiện có | Thay đổi cộng thêm |
| Lịch sử cân nặng | Bảng mới `body_weight_history` (ngày, kg), ghi khi đọc hồ sơ COROS thấy cân nặng đổi | `personal` | Buổi cũ dùng cân nặng gần nhất trước ngày đó |
| Heracles TL của từng buổi, từng set | Không lưu; bộ nhớ đệm trong main | không | Hết hiệu lực khi dữ liệu đầu vào thay đổi |

Nhãn mới cần đủ 13 ngôn ngữ trước khi phát hành (`check:i18n-release`). Câu chữ của Coach ở main process không dịch. Guide màn Strength trên `site/` cần bỏ Time và thêm cài đặt Training load.

## Kế hoạch triển khai

1. **Engine và service ở main.** `electron/heraclesLoad.ts`, `electron/heraclesLoadFactors.ts`, `electron/heraclesLoadService.ts`; cài đặt `strength.loadSource`, hai kênh IPC, `syncPolicy.ts`. Test: `test:heracles-load`, `test:ipc-surface`, `test:sync-policy`.
2. **Strength và helper dùng chung.** `src/training/loadSource.ts`; cài đặt và popover; ô Training load, thanh tim mạch/cơ, dòng "ngang buổi chạy", TL từng set; bản đồ cơ Set · Volume · Load.
3. **Overview và heatmap.**
4. **Calendar, Training Library, Activities.**
5. **Coach, dịch thuật, website, ghi chú repo.**
6. **Lịch sử cân nặng.**

## Rủi ro và câu hỏi còn mở

| Rủi ro | Ảnh hưởng | Xử lý |
| --- | --- | --- |
| Năng lực tự tham chiếu | Người tập nhẹ được nhiều TL hơn thực tế | Ghi rõ trong popover (i) |
| k đo từ feel của buổi chạy | TL mỗi phút của buổi chạy gần như không đổi theo feel (2,3–3,3), nên k lệch khoảng ±15% tùy dải feel | Đo ở feel ≥ 3; dưới 8 buổi thì dùng 0,5 |
| Mẫu kiểm chứng nhỏ | 8 buổi, thang feel 5 mức | Kiểm lại khi có thêm buổi gym có feel |
| Buổi chưa có chi tiết trong cache | Hiện TL COROS cho đến khi backfill xong | Cờ "chưa tính" |
| COROS không biết Heracles TL | Thời gian hồi phục, dải khuyến nghị và plan của COROS vẫn đánh giá thấp buổi gym | Không ghi ngược lên COROS |

Câu hỏi còn mở:

- Training load distribution trên Overview đang giữ COROS. Có chuyển theo Heracles cho khớp với biểu đồ tuần và heatmap không?
- Phần chân biểu đồ tuần có thêm một dòng ghi chú khi tổng các cột khác tải tuần của COROS, hay chỉ cần hover?
- AI Plan và plan do Coach soạn đặt mục tiêu tải tuần theo thang COROS. Đề xuất hiện tại: không tính phần Heracles vào mục tiêu đó.
