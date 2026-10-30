# Heracles Training Load

Spec và trạng thái triển khai trên nhánh `heracles_training_load`. Viết ngày 29/10/2026, cập nhật theo code ngày 30/10/2026. Nghiên cứu và số liệu kiểm chứng: báo cáo "Tải Gym quy đổi", https://claude.ai/artifact/QfvJ6wg8tvogCcTkNv2Qaz. Bản sống ngày 29/10 (https://claude.ai/artifact/1v7X759GLvaWvYvnf8agTZ) là bản cũ hơn file này.

## Tóm tắt

Heracles Training Load (Heracles TL) là tải tập luyện riêng của app cho buổi sức mạnh, cùng thang với TL chạy của COROS. COROS tính TL từ nhịp tim (TRIMP), nên ở cùng mức cảm nhận, buổi tạ chỉ được 1/3 đến 1/4 TL mỗi phút so với buổi chạy. Ví dụ lúc viết spec: buổi ngực – lưng 24/10 được 65 TL COROS và 203 Heracles TL, ngang một buổi chạy 10 km khoảng 70 phút.

Người dùng chọn nguồn tải trên màn Strength. Khi chọn Heracles, các màn trong mục Phạm vi dùng Heracles TL cho buổi sức mạnh; các môn khác vẫn là TL COROS.

| Quyết định | Nội dung |
| --- | --- |
| Tên | Heracles Training Load. UI vẫn ghi "Training load", "Load", "TL"; "Heracles TL" ở công tắc trong Settings và trong hover hai số; tên đầy đủ trong chỉ dẫn của Coach và trên website. |
| Cài đặt | Nút Settings trên màn Strength, mục "Training load formula": COROS TL · Heracles TL. Mặc định COROS TL. |
| Dùng Heracles TL | Strength, biểu đồ tuần, Coming up, Training load heatmap và phần "theo môn" của Training load distribution ở Overview, Calendar, Training Library, Activities. Load Impact, Base Fitness, Intensity Trend và dải khuyến nghị tuần tính theo công thức của COROS trên Heracles TL (chốt 30/10, phương án A). Coach và AI Plan đặt mục tiêu tải tuần theo Heracles TL. |
| Giữ số COROS | Recovery %, thời gian hồi phục, training effect (COROS không công bố cách tính hoặc tính từ nhịp tim). Phần "theo vùng nhịp tim" của Training load distribution chỉ tính các môn nhịp tim phản ánh đúng, không có buổi tạ. Load balance của Running/Cycling chỉ tính riêng môn đó nên không đổi. |
| Hover | Mỗi chỗ chỉ hiện một số, theo nguồn đã chọn. Hai số chỉ hiện ở chỗ con số khác với app COROS: tải tuần và dải khuyến nghị (Overview, Calendar), Load Impact, Base Fitness, Intensity Trend (chốt 30/10). |
| Chân biểu đồ tuần | Theo nguồn đã chọn, khớp tổng các cột; hover nêu số của COROS, không thêm dòng (chốt 30/10). |
| Bản đồ cơ | Set · Volume; thêm Load khi chọn Heracles. Bỏ Time. |
| Feel | Không phải đầu vào của một buổi tạ. Chỉ dùng để đo hệ số k trên các buổi chạy. RPE ghi cho từng set trong Hevy thì có được dùng (mục Buổi Hevy). |
| Lap gộp | Buổi không bấm nghỉ là lỗi người dùng, không tách set. |

## Công thức

Heracles TL của một buổi là tổng TL các set cộng phần thời gian ngoài set, mỗi phần bằng k × RPE × số phút. RPE của set được dự đoán từ tạ, số rep, cân nặng và năng lực của chính người tập ở bài đó. Môn khác không có Heracles TL; mọi chỗ cộng tải dùng TL COROS cho chúng.

1. **Tải hệ thống:** L = tạ + α × cân nặng − tạ trợ lực. α theo bài trong `heraclesLoadFactors.ts` (50 bài theo mã COROS). Ví dụ: hít đất 0,64, dips và hít xà 0,95, squat và lunge 0,88 (cộng cả khi có tạ). Bài không có mã COROS (Hevy) được tra theo tên (`heraclesFactorByName`) và dùng hệ số của bài COROS tương ứng. Bài có tạ ngoài mặc định α = 0. Bài không nhận ra: coi là bodyweight (α 0,6) cho tới khi có một set của nó mang tạ. Tạ trợ lực chỉ có ở bài assisted của Hevy.
2. **Năng lực bài:** C = max trong 120 ngày của L × (1 + (rep + RIR) / 30), với RIR = 1 (set failure của Hevy là 0; set có RPE ghi trong Hevy lấy RIR suy từ RPE đó, chỉ khi RPE ≥ 5).
    - Chỉ lấy set 1–20 rep, bỏ set warm-up, chỉ lấy các buổi tới ngày đang tính, và tính cả các set của chính buổi đó.
    - Mức mới cao hơn 115% mức cũ chỉ được nhận khi có ít nhất hai set của buổi cùng vượt; một set đơn lẻ vượt là rep đếm sai.
    - Bài bodyweight lấy max(lịch sử, mức dân số) với mức dân số = α × 70 × (1 + rep_bw / 30) × (cân nặng / 70)^0,67; rep_bw là số rep một người 70 kg tập phong trào làm được (theo bảng, mặc định 15).
3. **Cường độ:** I = min(1, L / C); số rep tối đa RM = 30 × (1/I − 1); số rep dự trữ RIR = max(0, RM − rep). Set failure là RIR 0.
4. **RPE của set**: RPE người dùng ghi trong Hevy nếu có; không thì dự đoán theo thang RIR: RIR ≤ 3 cho 10 − RIR; RIR 3–6 cho 7 − (RIR − 3) × 2/3; RIR > 6 cho 2 + 3 × e^(−(RIR − 6)/6). Bài giữ tĩnh: 2 + 8 × min(1, thời gian giữ / mức tối đa), mức tối đa = 1,15 × lần giữ lâu nhất, hoặc theo bảng, mặc định 60 s.
5. **Thời lượng set:** τ = thời gian làm + min(thời gian nghỉ sau set, 180 s). Set Hevy không có đồng hồ: 3 s mỗi rep, nghỉ 90 s nếu không ghi.
6. **TL set** = k × RPE × τ / 60. Thời gian còn lại của buổi (khởi động, chuyển bài, giãn cơ, đồng hồ để chạy) tính RPE 1,5. Bước warm-up, cool-down, nghỉ, drill và giữ từ 180 s trở lên (giãn cơ) thuộc phần này.
7. **Heracles TL** = max(TL COROS, Σ TL set + TL ngoài set). Phần tim mạch (`cardio`) là TL COROS, phần cơ (`muscular`) là phần còn lại.

```
TL_Heracles = max( TL_COROS , k/60 × ( Σ RPE_s × τ_s + 1,5 × t₀ ) )
```

| Trường hợp | Cách tính | `quality` |
| --- | --- | --- |
| Buổi đọc được từng set | Công thức trên | `sets` |
| Drill, plyo chiếm hơn 50% thời gian | TL COROS | `conditioning` |
| Buổi COROS không lưu set (gym cardio, đồng hồ không ghi lap bài tập) | TL COROS | `conditioning` |
| Không đọc được set: một lap trên 40 rep, mã vùng cơ S4208–S4214, hoặc hơn 50% set không rõ bài | max(TL COROS, k × RPE trung vị 56 ngày × phút); chưa có buổi nào đọc được thì RPE 6,5 | `estimate` |
| Đọc được set nhưng không set nào chấm được (mọi set thiếu tạ hoặc không rõ bài) | max(TL COROS, k × 6,5 × phút) | `estimate` |
| Chưa có chi tiết buổi trong cache | TL COROS | `pending` |
| Set có rep nhưng thiếu tạ, hoặc set của bài không rõ | RPE trung vị của các set khác trong buổi | không đổi (`sets`); hover của set ghi rõ |

| Tham số | Giá trị | Nguồn |
| --- | --- | --- |
| k (TL mỗi đơn vị RPE × phút) | Σ TL COROS / Σ (feel × 2 × phút) trên các buổi chạy (100–103) có feel 3–5 trong 120 ngày; dưới 8 buổi thì dùng 0,5. Lúc viết spec: 0,47 | Đo trên dữ liệu người dùng |
| Cân nặng | Lịch sử cân nặng theo ngày (`body_weight_history`); chưa có thì cân nặng hồ sơ COROS đọc gần nhất; không có gì thì 75 kg | COROS |
| RIR của set tốt nhất | 1 | Thiết kế, kiểm trên 8 buổi |
| RPE ngoài set | 1,5 | Thiết kế (CR-10: rất nhẹ) |
| Giới hạn nghỉ tính vào set | 180 s | Thiết kế, không nhạy |
| Cửa sổ RPE trung vị | 56 ngày; mặc định 6,5 | Thiết kế |

Các mắt xích đã công bố: session-RPE (Foster 2001), thang RIR (Zourdos 2016, Helms 2016), rep theo %1RM (Epley, Nuzzo 2024), RPE buổi bằng trung bình RPE các set (Day 2004), α của bài bodyweight (Ebben 2011, de Leva 1996), năng lực theo cân nặng (Jaric 2002).

**Buổi dự kiến** (`estimatePlannedLoad`) dùng cùng công thức với năng lực tới hôm nay và cân nặng hôm nay:

1. Bước có bài, set, rep (và tạ, hoặc bài bodyweight): mỗi set là rep × 3 s cộng nghỉ (theo plan nếu là nghỉ có giờ, không thì 90 s, tối đa 180 s). Bước giữ tĩnh tính theo thời gian giữ. Thiếu tạ ở bài có tạ thì lấy RPE trung vị 56 ngày. Phần còn lại của thời lượng dự kiến tính RPE 1,5.
2. Không có bước đọc được nhưng có thời lượng dự kiến: k × RPE trung vị 56 ngày × phút.
3. Không có gì: không có ước tính, các màn dùng TL plan của COROS.

TL plan của COROS (thường là 0 cho buổi sức mạnh) là mức sàn, như ở buổi đã tập. Ước tính mang `quality: "planned"`.

## Phạm vi

Khi chọn Heracles, mọi con số tải của từng buổi và các tổng cộng từ chúng dùng Heracles TL. Các chỉ số COROS tính từ TL theo ngày bằng công thức đã biết (Load Impact, Base Fitness, Intensity Trend, dải khuyến nghị) cũng chuyển theo (mục Chỉ số thể lực theo Heracles TL), nên một tổng và dải nó được so luôn cùng thang. Chỉ số COROS không công bố cách tính thì giữ nguyên. Hai số đặt cạnh nhau để so (plan với buổi đã tập) luôn cùng thang: Heracles cả hai vế chỉ khi cả hai đều có, không thì COROS cả hai vế (`comparableLoads` ở renderer, `loadsToCompare` ở main).

| Màn | Dùng Heracles TL | Giữ TL COROS |
| --- | --- | --- |
| Strength | Ô Training load trong chi tiết buổi, cột TL từng set, lựa chọn Load của bản đồ cơ | Danh sách buổi và biểu đồ tuần (Set, Volume, thời lượng) |
| Overview | Biểu đồ tuần ở chế độ Load, chân biểu đồ (Load Impact, Base Fitness, tải tuần, dải khuyến nghị), Intensity Trend, Coming up, Training load heatmap, phần "theo môn" của Training load distribution, bản đồ cơ ở mục Strength | Recovery % (hình cơ thể); phần "theo vùng nhịp tim" của distribution (không có buổi tạ); Running, Cycling, Hiking |
| Calendar | Thẻ buổi, panel ngày, số tải và thanh của ô tuần, dòng Target và chữ trên/trong/dưới dải, Load ratio, Base Fitness, Load Impact trong tooltip, ghép cặp với plan, phần trăm hoàn thành, chi tiết buổi dự kiến | Tải xem trước trong workout builder |
| Training Library | Tải dự kiến của buổi sức mạnh trong plan, tổng tải tuần và cả plan, ridge "Weekly load", đã tập so với dự kiến, trạng thái hoàn thành | Tải COROS tính cho bước có mục tiêu cường độ (chạy, đạp) |
| Activities | Fact Training load trên dòng, tổng Training load và trung bình tuần, tổng theo nhóm môn, ô Training load trong chi tiết | Không có |
| Running, Cycling, Hiking | Không đổi | Load ratio từng môn |
| Coach, AI Plan | Khi chọn Heracles: Heracles load cạnh TL COROS, tool fitness trends theo Heracles; mục tiêu tải tuần theo nguồn đã chọn | Recovery, training effect |

## Cài đặt và cách hiển thị

Một cài đặt duy nhất trên màn Strength quyết định nguồn tải cho mọi màn trong Phạm vi. Nó được lưu ở main process, vì Training Library tính trạng thái hoàn thành plan và Coach đọc nó ở đó.

- **Vị trí:** đầu màn Strength chỉ còn ba nút: khoảng thời gian, Refresh, Settings. Settings mở popup "Strength settings" (`StrengthSettingsDialog`) có hai mục:
    - **Data source:** chọn Combined · COROS · Hevy, và một dòng trạng thái cho mỗi tài khoản. Dòng Hevy có nút Connect hoặc Manage; nút này đóng popup và mở dialog Hevy riêng (`StrengthHevyDialog`, nhập key, warm-up, ngắt kết nối). Đóng dialog Hevy thì quay lại popup. Khi chưa có nguồn nào, nút "Connect Hevy" trên màn mở thẳng dialog Hevy.
    - **Training load formula:** công tắc **COROS TL · Heracles TL**, dưới là một câu giải thích lựa chọn đang chọn. Heracles TL được giới thiệu là công thức riêng của Heracles Records, chấm từng set từ mức tạ, số rep, cân nặng và năng lực ở bài đó, để tải của từng buổi và từng nhóm cơ phản ánh đúng khối lượng đã tập. UI không so với thang chạy và không hiện hệ số k hay cân nặng đang dùng.
- **Lưu trữ:** `app_settings`, khóa `strength.loadSource`, giá trị `coros` hoặc `heracles`; `preference` trong `syncPolicy.ts`. Renderer giữ một bản ở localStorage `heraclesrecords.loadSource` (`derived`) chỉ để lần vẽ đầu đúng nguồn.
- **IPC:** `strength:getLoadSource` và `strength:setLoadSource` trả về `HeraclesLoadInfo` (nguồn, k, số buổi chạy đo k, cân nặng); renderer hiện chỉ dùng nguồn. Renderer giữ giá trị trong `LoadSourceProvider` (`src/training/loadSource.tsx`), các màn đọc qua `useLoadSource()`; mỗi lần sync kéo về, provider hỏi lại main.
- **Buổi chưa có chi tiết:** đổi nguồn không tự tải gì. Chi tiết buổi sức mạnh được tải khi mở màn Strength (theo khoảng đang xem) hoặc mục Strength ở Overview (4 tuần). Trước đó buổi hiện TL COROS, cờ `pending`.

**Một số, trừ chỗ dễ hiểu nhầm** (`src/training/loadFigures.ts`, chốt 30/10):

- Mọi chỗ hiện tải chỉ hiện một số, theo nguồn đã chọn, như trước khi có Heracles.
- **Hai số** chỉ hiện ở chỗ con số khác với con số app COROS hiện cho cùng chỉ số, để người dùng đối chiếu được:
    - tải tuần (`loadPairTitle`: `Heracles TL 1.033 · COROS TL 723`) và dải khuyến nghị (`Recommended range: Heracles 1.170–1.520 · COROS 756–983`) ở chân biểu đồ tuần của Overview;
    - Load Impact, Base Fitness, Intensity Trend ở Overview (`figurePairTitle`: `Heracles 167 · COROS 108`);
    - số tải của ô tuần trên Calendar, và dòng Target (hover nêu dải của COROS).
  Chỉ hiện khi đang chọn Heracles và hai số khác nhau. Khi trong 126 ngày gần đây còn buổi tạ chưa tải xong set, hover thêm dòng `Approximate: some strength sessions' sets are still loading`.
- **Ghi chú cho một số** (`activityLoadNote`), khi đang chọn Heracles: buổi `estimate` ghi `Estimated: the sets could not be read`; buổi `pending` (số đang hiện là của COROS vì chưa tải xong set) ghi `Not calculated yet: the session's sets are still loading`. Buổi đọc từ set và buổi dự kiến không có ghi chú.

## Strength

Heracles TL vào màn Strength ở bốn chỗ. Danh sách buổi và biểu đồ tuần (Volume, Set) giữ nguyên; việc so với chạy nằm ở biểu đồ tuần của Overview.

1. **Cài đặt** trong popup Settings của màn (mục trên).
2. **Ô Training load trong chi tiết buổi** (`LoadStat` trong `StrengthSessionDetail`). Khi chọn Heracles:
    - một số: Heracles TL, không có dòng phụ COROS;
    - hover hiện ghi chú (nếu là `estimate` hoặc `pending`) và, nếu có, buổi chạy tương đương: "About your 10.2 km run of 1:10:00 on 25 Jul (TL 208)". Đó là buổi chạy trong 56 ngày trước buổi tạ có TL COROS gần nhất với Heracles TL, lệch không quá 15%; hai buổi gần như nhau thì lấy buổi mới hơn. Chỉ có cho buổi `sets` và `estimate`.
3. **Cột TL từng set** trong bảng bài tập của chi tiết buổi, ví dụ 8,5. Hover: "Predicted RPE 8.0 · 2.0 reps in reserve · 82% of estimated 1RM"; set giữ tĩnh chỉ có RPE; set thiếu tạ ghi "No weight to score it by: the session's median RPE". Chỉ hiện khi chọn Heracles và khi set của buổi khớp với buổi đã chấm (buổi gộp COROS + Hevy có số set khác thì không có cột).
4. **Bản đồ cơ** (`StrengthHero`, cả mục Strength trên Overview):
    - lựa chọn là Set · Volume, thêm Load khi chọn Heracles; bỏ Time;
    - `HeatMetric` là `"sets" | "volume" | "load"`. Lựa chọn đã lưu `time` không còn hợp lệ nên về Set; đã lưu `load` mà đang chọn COROS thì đọc như Set nhưng vẫn giữ, chọn lại Heracles thì quay về Load;
    - Load của một cơ = Σ (TL set × tỉ trọng của cơ đó trong bài), dùng tỉ trọng của `reviewedMuscleLoads`. Tổng các cơ bằng tổng TL các set; phần ngoài set không thuộc cơ nào;
    - bảng xếp hạng cơ (`MusclePanel`) ghi "x TL"; thang màu vẫn 5 bậc theo cơ bận nhất.

### Buổi Hevy

Hevy không có TL: API của Hevy không có nhịp tim hay chỉ số tải nào. Một buổi Hevy có giờ bắt đầu, giờ kết thúc và từng set (tạ, số rep, thời gian với bài tính giờ, loại set warm-up/normal/failure/dropset, RPE nếu người dùng ghi).

- **Chọn COROS TL:** buổi chỉ có trên Hevy không có tải nào; ô Training load không hiện.
- **Chọn Heracles TL:** buổi được chấm bằng đúng công thức trên, chỉ từ các set, không có mức sàn COROS (`cardio` để trống, toàn bộ là phần cơ). Hevy không ghi đồng hồ cho từng set nên mỗi set tính 3 s mỗi rep (bài tính giờ lấy thời gian của set) cộng 90 s nghỉ. Thời lượng buổi là giờ kết thúc trừ giờ bắt đầu; phần còn lại ngoài các set tính RPE 1,5.
- **Warm-up:** khi tắt "Include warm-up sets", set warm-up bị bỏ trước khi chấm, thời gian của nó rơi vào phần ngoài set. Khi bật, set warm-up được chấm như set thường nhưng không dùng để ước tính năng lực. Set failure tính 0 rep dự trữ.
- **Bài tập:** bài Hevy được nhận theo tên template (`heraclesFactorByName`): hít xà, chin-up, dips, hít đất (gối, dốc lên, dốc xuống theo Ebben 2011), squat và lunge có tạ hay không, split squat, leg raise, plank, drill, giãn cơ… dùng hệ số của bài COROS tương ứng, nên cùng một bài cho cùng một tải dù ghi ở app nào. Bài máy (squat máy, hack squat, dip máy) và bench dip không nhận theo tên. Tên không nhận ra thì đọc theo loại template: `bodyweight_reps`, `bodyweight_assisted_reps`, `reps_only` là bodyweight α 0,6; `duration` là giữ tĩnh; `distance_duration`, `short_distance_weight` là drill; còn lại là bài có tạ. Năng lực lấy theo template Hevy (`hevy:<id>`).
- **Bài assisted** (`bodyweight_assisted_reps`): tạ trợ lực được giữ riêng (`assistKg`) và trừ vào phần cân nặng, nên trợ lực càng nhiều thì set càng nhẹ. Nó không bao giờ tính là tạ đã nâng (volume).
- **RPE ghi trong Hevy** thay cho RPE dự đoán của set đó, và cho biết set cách thất bại bao xa khi ước tính năng lực. Hover của set ghi "Your logged RPE".
- **Buổi ghi ở cả COROS và Hevy** được gộp (`combineStrengthSessions`) và chấm một lần, có TL COROS làm mức sàn.
- **Chỉ màn Strength** (và mục Strength ở Overview) đọc Hevy. Overview, Calendar, Activities và Coach chỉ có buổi COROS, nên Heracles TL của một buổi chỉ có trên Hevy không vào tổng tuần ở các màn đó.

## Overview

Biểu đồ tuần là nơi so chạy với sức mạnh rõ nhất.

**Biểu đồ tuần** (`TodayWeek`, `buildWeekChart`):

- Giữ ba lựa chọn Time · Distance · Load.
- Ở Load với nguồn Heracles:
    - khối buổi sức mạnh = phần TL ngày của COROS chia cho buổi đó + (Heracles TL − TL COROS); khối môn khác giữ nguyên;
    - khối phần dư (tải COROS không thuộc buổi nào) giữ nguyên;
    - số trên đầu cột là tổng theo Heracles; trục tự tính lại từ cột cao nhất;
- Khối dự kiến của buổi sức mạnh dùng Heracles TL ước tính, vẫn tô gạch chéo; tooltip ghi kèm số COROS.

**Chân biểu đồ tuần và Intensity Trend** theo nguồn đã chọn (`fitnessInLoadSource`, mục Chỉ số thể lực theo Heracles TL): Load Impact, Base Fitness, Intensity Trend kèm dải trạng thái, tải tuần (thứ Hai tới hôm nay, bằng tổng các cột) và dải khuyến nghị. Hover mỗi số nêu số của COROS. Không thêm dòng ghi chú.

**Coming up** (`comingUpModel`, `OverviewComingUp`): số tải của buổi đã tập và buổi dự kiến theo nguồn đã chọn. Ghép buổi với plan (`pairTodayPlan`) và thanh "so với plan" dùng `comparableLoads`, cùng thứ tự với Calendar, để hai màn không ghép khác nhau. Biểu đồ tuần dùng cùng phép ghép để bỏ plan hôm nay đã tập.

**Training load distribution** (`OverviewDistribution`, `distributionModel.ts`):

- Phần "theo môn" (4 tuần): mọi môn, theo nguồn đã chọn; buổi sức mạnh tính Heracles TL.
- Phần "theo vùng nhịp tim" (chốt 30/10): chỉ tính các môn nhịp tim phản ánh đúng nỗ lực (`isHeartRateSport`: chạy, hike, đạp xe, bơi, ski băng đồng, chèo, đi bộ, leo cầu thang, elliptical); tạ, gym cardio, leo vách, các môn bóng… bị loại. Chỉ còn thời gian, cộng từ số giây theo vùng của từng buổi (`zoneSeconds` trong bản tóm tắt chi tiết buổi, `useActivityDetailSummaries`), không dùng số tổng mọi môn của COROS. Không còn lựa chọn "Load" vì không buổi nào có tải theo vùng. Khi còn buổi chưa đọc chi tiết, dòng chú thích ghi "from x of y sessions". Hover tiêu đề "By heart-rate zone" nêu các môn được tính.

| Phần | Nguồn khi chọn Heracles |
| --- | --- |
| Intensity Trend | Heracles (công thức COROS), hover có số COROS |
| Biểu đồ tuần (Load) | Heracles |
| Chân biểu đồ tuần | Heracles (công thức COROS), hover có số COROS |
| Recovery % (hình cơ thể) | COROS |
| Coming up | Heracles |
| Training load heatmap | Heracles (mục dưới) |
| Training load distribution | Heracles theo môn; theo vùng nhịp tim chỉ các môn nhịp tim, không có buổi tạ |
| Running, Cycling, Hiking | Không đổi |
| Strength (bản đồ cơ) | Như bản đồ cơ trên Strength |

## Training load heatmap

Trước đây là "Training activity", có công tắc Training load / Duration; từ 30/10 chỉ còn training load, và mỗi buổi trong thẻ ngày (chế độ 4 tuần) ghi TL thay cho thời lượng. Tải của mỗi ngày = TL ngày của COROS + Σ (Heracles TL − TL COROS) của các buổi sức mạnh trong ngày (`withHeraclesDayLoads`).

- **Giá trị ô** (`buildHeatmapCells`): một số theo nguồn đã chọn, cả trong tooltip.
- **Thang màu**: vẫn 5 bậc theo ngày nặng nhất trong khoảng đang xem. Ngày gym đậm hơn trước, đó là thay đổi mong muốn.
- **Tổng của khoảng** (`buildHeatmapSummary`) cộng theo giá trị ô nên theo Heracles.
- **Thẻ ngày ở chế độ tháng**: vạch màu chia theo tải từng môn và các dòng buổi dùng Heracles TL cho buổi sức mạnh.
- **Màu môn của ngày** (`buildDominantSportByDay`, theo buổi tải cao nhất): theo Heracles, nên một ngày có cả chạy nhẹ và gym nặng có thể đổi sang màu Strength.
- **Ngày ngoài danh sách buổi đã tải**: giữ TL COROS của ngày.

## Calendar

Calendar đọc tải qua `activityLoad(activity, source)` và `plannedLoad(entry, source)`, so plan với buổi đã tập qua `comparableLoads`. Riêng dòng mục tiêu COROS của tuần so với một tổng TL COROS riêng.

| Thành phần | Với nguồn Heracles |
| --- | --- |
| Thẻ buổi (`DayCell`) | "x TL" là Heracles TL cho buổi sức mạnh, đã tập hoặc dự kiến |
| Panel ngày (`DayOverview`) | Tổng tải và tải từng dòng theo Heracles |
| Ô tuần (`WeekStatsCell`, `computeWeeklyStats`) | Số tải và thanh (đã tập, còn lại) theo Heracles. Dòng "Target x–y TL" là dải theo Heracles (`weekRangeInLoadSource`), chữ trên/trong/dưới dải so tải Heracles với dải đó. Hover số tải hiện hai số rồi vị trí so với dải; hover dòng Target nêu dải của COROS |
| Phần trăm hoàn thành (`completionPct`) | Load trước, cùng thang hai vế; plan không có ước tính thì COROS hai vế, rồi distance, rồi thời lượng |
| Ghép cặp (`matchScore`) | Gần nhất theo load (cùng thang), rồi distance, rồi thời lượng |
| Khối trạng thái plan (`PlanStatusBlock`) | Khi người dùng ghép tay, lưu thêm `plannedHeraclesLoad` và `completedHeraclesLoad` |
| Chi tiết buổi dự kiến (`ScheduledWorkoutDetail`) | Buổi sức mạnh hiện Heracles TL ước tính |
| Tooltip Load ratio, Base Fitness, Load Impact | Theo Heracles (công thức COROS) |
| Workout builder, thư viện workout trong modal | Không đổi |

Buổi dự kiến trên lịch được ước tính ở main (`withPlannedHeraclesLoads`) từ các bước của program COROS: mã bài, loại bước, set, rep, tạ, nghỉ có giờ, thời gian giữ; thời lượng là `estimatedTime` của program.

## Training Library

COROS chỉ tính TL plan cho bước có mục tiêu cường độ, nên buổi sức mạnh thường có TL plan bằng 0. Khi chọn Heracles, renderer gửi các buổi sức mạnh của những plan đang hiện lên kênh `strength:estimatePlanLoads` (`usePlanHeraclesLoads`), khóa `planId:entryId`. Main ước tính từ các bước của plan: warm-up, training/interval, cool-down; bước nghỉ bỏ qua; repeat nhân số set; lb đổi ra kg. Ước tính không bao giờ được lưu vào plan. Trong lúc chờ câu trả lời sau một lần sửa, màn giữ ước tính cũ để số không nhấp nháy.

| Thành phần | Với nguồn Heracles |
| --- | --- |
| Tải của một buổi trong plan (`readPlan`, `PlanEditor`, `PlanReader`, ô plan ở danh sách) | Buổi sức mạnh có ước tính hiện Heracles TL dự kiến; không có ước tính thì TL COROS |
| Tổng tải tuần, tổng plan, ridge "Weekly load" (`summarizeTrainingPlan`, `planReaderModel`) | Cộng các số trên |
| Đã tập so với dự kiến (`PlanSessionView`) | Cùng thang: plan có ước tính thì so với `completedHeraclesLoad`, không thì với TL COROS. Plan có ước tính mà lần ghép chưa có Heracles thì không hiện dòng load |
| Trạng thái hoàn thành (`buildTrainingActivityMatches`, ở main) | Tỷ lệ = đã tập / dự kiến theo `loadsToCompare`; dưới 0,75 là "hoàn thành một phần". Main đọc nguồn từ `app_settings` |
| Điểm ghép buổi với plan (`scheduledActivityScore`) | Phần điểm theo tải dùng cùng thang hai vế |

**Lưu trữ:** `training_activity_matches` có thêm `planned_heracles_load` và `completed_heracles_load` (`ensureColumn`), ghi mỗi lần Library tải snapshot (`matchesInChosenLoad`) hoặc khi ghép tay trên Calendar. Đổi nguồn thì trạng thái được tính lại ở lần Library tải snapshot kế tiếp.

## Activities

Activities chỉ cộng và hiện tải của từng buổi, không so với dải nào của COROS, nên cả màn theo nguồn tải.

| Thành phần | Với nguồn Heracles |
| --- | --- |
| Fact trên dòng (`activityRowFacts`) | "x TL" của buổi sức mạnh là Heracles TL |
| Tổng theo khoảng lọc và theo nhóm môn (`summariseActivities`) | Cộng Heracles TL |
| Ô Training load và "x mỗi tuần" (`ActivitiesSummary`) | Theo Heracles |
| Ô Training load trong chi tiết (`ActivityDetailPane`, `StrengthDetailPanel`) | Buổi sức mạnh hiện Heracles TL lấy từ dòng danh sách |
| Buổi chưa tính | TL COROS, hover ghi "Not calculated yet" |

## Coach và AI Plan

Coach nói theo tải người dùng đang chọn (chốt 30/10). Prompt của Coach viết bằng tiếng Anh và không dịch. Không thêm trường mới vào loại chat entry đã lưu.

- **Chọn COROS TL:** Coach chỉ thấy TL COROS, như trước khi có Heracles. Không có dòng Heracles nào trong dữ liệu, không có chỉ dẫn nào về nó.
- **Chọn Heracles TL:** buổi sức mạnh có thêm Heracles load cạnh TL COROS (`coachReadsHeracles` trong `chatActivityTools.ts` quyết định cho mọi đường dữ liệu của Coach):

| Chỗ | Coach thấy |
| --- | --- |
| Dòng buổi (`list_recent_activities`, snapshot) | `load 65 · Heracles load 203` |
| Tổng theo môn (tool và snapshot) | `- Strength: 1 · 50:00 · load 25 · Heracles load 160`, dòng All cũng vậy |
| Chi tiết buổi (`get_activity_detail`) | `Training load: 65` và `Heracles Training Load: 203 (cardio 65 from COROS, muscular 138)` |
| Buổi sắp tới (snapshot, `list_scheduled_workouts`) | `Heracles load 180`; trong tool là trường `heracles_load` |
| Phân tích tự động (`formatPrecedingTraining`) | Mỗi buổi sức mạnh trong 72 giờ trước có `Heracles load x`; chỉ dẫn bảo đánh giá buổi tạ theo số này |

Không ghi "estimated" ở đâu cả. Buổi `pending` và `conditioning`, hoặc buổi có hai số bằng nhau, không ghi Heracles.

**Tool fitness trends** (`get_fitness_trends`) khi chọn Heracles: tải theo ngày, Load Impact, Base Fitness và load ratio là bản Heracles (cùng phép tính với màn hình), có thêm một dòng nói rõ đây là công thức của COROS chạy trên Heracles TL, cao hơn số app COROS hiện.

**Dòng giải thích có điều kiện** (`COACH_HERACLES_INSTRUCTION`): chỉ được thêm vào phần đầu của lượt Coach khi snapshot của lượt đó có hiện Heracles load, tức là đang chọn Heracles và trong các buổi gần đây hoặc sắp tới có buổi sức mạnh. Nội dung: Heracles load là tải của buổi tạ do app chấm từ các set, cùng thang với chạy; dùng nó để cân sức mạnh với các môn khác và để đặt và tăng mục tiêu tải tuần (môn khác theo TL COROS); Load Impact, Base Fitness và load ratio của tool fitness trends là công thức COROS trên tải này, cao hơn app COROS; recovery và training effect vẫn là của COROS. Mọi lượt Coach đi qua cùng chỗ này, gồm cả hai bước outline và sessions của AI Plan và các bản phân tích. Chỉ dẫn gốc (`buildBaseCoachInstructions`, hiện ở Settings) không nhắc tới Heracles.

Như vậy mục tiêu Coach đặt khớp với con số Calendar và Training Library cộng cho tuần đó. Ước tính Heracles của buổi tạ trong plan mới soạn không được gửi lại cho model; model ước theo các buổi tạ đã tập.

## Chỉ số thể lực theo Heracles TL

COROS tính các chỉ số này từ TL theo ngày (đối chiếu trên tài khoản thật ngày 28/10):

```
Load Impact   ati += (TL ngày − ati) / 7
Base Fitness  cti += (TL ngày − cti) / 42
Intensity Trend = ati / cti        (5 dải: < 50, 50–79, 80–99, 100–149, ≥ 150%)
Dải khuyến nghị tuần = cti của Chủ nhật trước × 7, max = min × 1,3
```

Các phép này tuyến tính theo TL ngày, nên bản Heracles bằng số của chính COROS cộng cùng phép tính chạy trên phần Heracles chênh thêm mỗi ngày (Heracles TL − TL COROS của các buổi tạ trong ngày). Không phải dựng lại lịch sử của COROS; ngày trước buổi tạ đầu tiên thì hai bản bằng nhau.

- **Main** (`heraclesLoadService.ts`, `withHeraclesDayDeltas`): đọc các buổi tạ COROS (400, 402) trong DB, lấy phần chênh của từng buổi, cộng theo ngày, chạy `heraclesDeltaSeries` (`electron/heraclesFitness.ts`) từ buổi tạ đầu tiên tới hôm nay. Kết quả gắn vào payload của `trainingHub:getDailyMetrics` và `trainingHub:getTrainingAnalytics`: mỗi ngày một trường `heracles` (`load`, `ati`, `cti`, `range`, `partial`), mỗi tuần trong `weekList` một trường `heraclesRange`. Gắn luôn, bất kể đang chọn gì, nên đổi nguồn là hiện ngay. Lỗi thì trả payload như COROS gửi.
- **Renderer** (`fitnessInLoadSource`, `weekRangeInLoadSource`): khi chọn Heracles thì `ati`, `cti`, `trainingLoadRatio`, `recommendedLoadMin/Max` của mỗi ngày được cộng phần chênh; số của COROS giữ trong `coros` cho hover. `trainingLoad` của ngày không đổi, vì các màn đã tự cộng phần chênh từ danh sách buổi.
- **Coach** dùng cùng hàm, có cộng cả `trainingLoad` ngày (`withLoad`).
- **Ước tính (`partial`):** buổi tạ chưa tải xong set (`pending`) tính phần chênh bằng 0. Nếu trong 126 ngày tới ngày đó còn buổi như vậy thì ngày bị đánh dấu, và hover ghi "Approximate". 126 ngày là lúc trung bình 42 ngày đã giữ 95% ảnh hưởng.
- **Giữ số COROS:** Recovery %, thời gian hồi phục, training effect. COROS chỉ trả giá trị lúc đọc (`recoveryPct`, `recoveryState`, `fullRecoveryHours`), không công bố cách tính; training effect đọc từ nhịp tim nên Heracles không thay đổi nó.

## Kiến trúc và luồng dữ liệu

Heracles TL được tính ở một chỗ duy nhất trong main process và đi theo các payload đang có. Renderer chỉ chọn số theo cài đặt.

```
strength_sessions + hevy_workouts ─┐
training_activities (feel → k)  ───┤
body_weight_history (cân nặng)  ───┼─► heraclesLoadService ─► heraclesLoad đi theo payload ─► loadFigures.ts ─► các màn
training_activities (TL, runs)  ───┤      (heraclesLoad.ts)      + strength:estimatePlanLoads     useLoadSource()
app_settings (strength.loadSource) ┘                              + tool và prompt của Coach
```

- **Trường mới, không ghi đè `trainingLoad`:**
    - `TrainingHubActivity.heraclesLoad?`: `value`, `cardio` (TL COROS), `muscular`, `quality` (`sets`, `estimate`, `conditioning`, `pending`, `planned`);
    - `StrengthSession.heracles?`: TL buổi, RPE buổi, TL từng set theo đúng thứ tự set, buổi chạy tương đương;
    - `TrainingHubScheduledWorkoutEntry.heraclesLoad?` và `TrainingHubUpcomingWorkout.heraclesLoad?`: ước tính, `quality: "planned"`.
- **Nơi gắn ở main:** `trainingHub:listActivities` (`withHeraclesLoads`), `trainingHub:listScheduledWorkouts` và `trainingHub:getUpcomingWorkouts` (`withPlannedHeraclesLoads`), `trainingHub:syncStrengthHistory` (`withStrengthSessionLoads`), snapshot Training Library (`matchesInChosenLoad`), các tool và snapshot của Coach (chỉ khi chọn Heracles).
- **Ba kênh IPC mới:** `strength:getLoadSource`, `strength:setLoadSource`, `strength:estimatePlanLoads`.
- **Đệm:** một lần chạy chấm mọi buổi sức mạnh từ cũ tới mới và được giữ cho tới khi khóa đổi. Khóa gồm `heraclesLoadInputsVersion()` (số dòng và `fetched_at` mới nhất của `strength_sessions`; số buổi, tổng TL và buổi mới nhất của môn 400/402; số buổi có feel; số buổi chạy và tổng TL; Hevy; lịch sử cân nặng), cân nặng hôm nay, `HERACLES_FACTORS_VERSION` và ngày hôm nay. Mỗi lô (một danh sách buổi, một lô plan) chỉ hỏi khóa một lần.
- **Nhân quả:** năng lực của một buổi chỉ dùng các buổi tới ngày đó, nên PR mới không viết lại quá khứ.
- **Dependency injection:** service nhận `HeraclesLoadDeps` có `createDefaultDeps()`, để suite truyền dữ liệu giả.

## Lưu trữ, sync, dịch thuật và website

| Thứ mới | Nơi lưu | Loại trong `syncPolicy.ts` | Ghi chú |
| --- | --- | --- | --- |
| Nguồn tải | `app_settings`, khóa `strength.loadSource` | `preference` | Mặc định `coros` khi chưa có dòng |
| Bản sao cho lần vẽ đầu | localStorage `heraclesrecords.loadSource` | `derived` | |
| Tải Heracles của mỗi lần ghép plan | `training_activity_matches`, cột `planned_heracles_load`, `completed_heracles_load` | theo bảng hiện có | Thêm bằng `ensureColumn` |
| Lịch sử cân nặng | Bảng mới `body_weight_history` (`day` YYYYMMDD, `weight_kg`, `recorded_at`) | `personal` | Ghi mỗi lần đọc hoặc sửa hồ sơ COROS, chỉ khi cân nặng khác dòng gần nhất ≥ 0,05 kg. Buổi lấy cân nặng gần nhất tới ngày của nó; buổi cũ hơn mọi dòng lấy dòng đầu tiên |
| Heracles TL của từng buổi, từng set | Không lưu; đệm trong main | không | Hết hiệu lực khi khóa đệm đổi |

Nhãn mới có đủ 13 ngôn ngữ (`strength.*`, `units.load.*`). Câu chữ của Coach ở main process không dịch. Website: guide Hevy có mục "Training load" (hai lựa chọn, Load trên bản đồ cơ, các màn tính theo Heracles, Coach và AI Plan đặt tải tuần theo nó); trang Activities thôi nhắc thời gian nâng tạ và có một đoạn giới thiệu lựa chọn Heracles.

## Trạng thái triển khai

| Commit | Nội dung |
| --- | --- |
| `27234be2` | Spec và kế hoạch |
| `cdc37f19` | Engine (`heraclesLoad.ts`), bảng hệ số, service, cài đặt, IPC, sync policy |
| `cfc01279` | Màn Strength: cài đặt, ô Training load, cột TL từng set, bản đồ cơ Set · Volume · Load |
| `624504b5` | Overview (biểu đồ tuần, Coming up) và heatmap |
| `f59c6dfc` | Calendar, Training Library, Activities; kênh `strength:estimatePlanLoads` |
| `3b420f53` | Coach, website, ghi chú repo |
| `b9e49db3` | Lịch sử cân nặng |
| `ff537bcc` | Mỗi lô một lần hỏi khóa đệm; năng lực chỉ giữ 120 ngày |
| `857fa459` | Training load distribution theo nguồn; dòng mục tiêu tải tuần cho Coach và AI Plan; Coming up và "đã tập so với dự kiến" của Library luôn cùng thang; snapshot Training Library ghép plan theo nguồn đã chọn |
| `a3f70646` | Popup Settings của màn Strength (nguồn dữ liệu, công thức tải); dialog Hevy giữ riêng |
| `aa98ae5c` | Công tắc COROS TL · Heracles TL, viết lại câu giới thiệu Heracles TL, bỏ phần hệ số và cân nặng trong Settings |
| `a6e32572` | Một số TL mỗi chỗ, hai số chỉ ở tổng tuần cạnh dải COROS; Coach chỉ thấy Heracles khi được chọn, dòng giải thích có điều kiện, bỏ "estimated"; Hevy: bài nhận theo tên, trợ lực được trừ, RPE đã ghi được dùng |
| `c5694324` | Phương án A: Load Impact, Base Fitness, Intensity Trend, dải khuyến nghị theo Heracles TL ở Overview, Calendar và Coach; ghi chú trong Settings |
| commit kế tiếp | Overview: Training load heatmap chỉ tính tải, thẻ ngày ghi TL; vùng nhịp tim của Training load distribution chỉ tính các môn nhịp tim |

Test: `test:heracles-load`, `test:heracles-load-service`, `test:heracles-fitness`, `test:body-weight-history`, `test:overview-model`, `test:calendar-pairing`, `test:plan-reader`, `test:training-library`, `test:activity-filters`, `test:strength-analytics`, `test:chat-activity-tools`, `test:coach-analysis-runner`, `test:chat-service`, `test:ipc-surface`, `test:sync-policy`, `test:i18n`, `check:coach`.

## Chưa làm và giới hạn đã biết

- **Đổi nguồn không tự tải chi tiết** các buổi sức mạnh còn thiếu; chúng mang cờ `pending` tới khi màn Strength hoặc mục Strength ở Overview tải.
- **Trạng thái plan trong Library** chỉ tính lại khi Library tải snapshot, không tính lại ngay lúc đổi nguồn.
- **Kênh `trainingHub:refreshTrainingActivityMatches`** có ở cả ba file IPC nhưng renderer không gọi.
- **Coach không nhận ước tính Heracles của plan nó vừa soạn**; mục tiêu tải tuần theo Heracles dựa trên các buổi đã tập.
- **Lịch sử buổi tạ cho Base Fitness:** chi tiết buổi tạ chỉ được tải theo khoảng đang xem ở màn Strength. Buổi cũ hơn chưa tải thì tính phần chênh bằng 0 và các chỉ số mang cờ "Approximate"; muốn đủ thì mở màn Strength với khoảng 6 tháng.
- **Buổi chỉ có trên Hevy** không có trong số liệu ngày của COROS nên chưa được cộng vào các chỉ số thể lực (cũng như biểu đồ tuần).
- **Recovery %, thời gian hồi phục** vẫn là của COROS. Chưa ghi lịch sử của chúng để thử dựng lại mô hình.

## Rủi ro

| Rủi ro | Ảnh hưởng | Xử lý |
| --- | --- | --- |
| Năng lực tự tham chiếu | Người tập nhẹ được nhiều TL hơn thực tế | Chưa ghi trên UI |
| k đo từ feel của buổi chạy | TL mỗi phút của buổi chạy gần như không đổi theo feel (2,3–3,3), nên k lệch khoảng ±15% tùy dải feel | Chỉ đo ở feel ≥ 3; dưới 8 buổi thì dùng 0,5 |
| Mẫu kiểm chứng nhỏ | 8 buổi, thang feel 5 mức | Kiểm lại khi có thêm buổi gym có feel |
| Buổi chưa có chi tiết trong cache | Hiện TL COROS cho tới khi tải xong | Cờ `pending` |
| COROS không biết Heracles TL | Thời gian hồi phục, Recovery %, và các chỉ số trên đồng hồ và app COROS vẫn đánh giá thấp buổi gym | Không ghi ngược lên COROS; app ghi rõ số nào là của COROS |
| Số trong app khác app COROS | Load Impact, Base Fitness, Intensity Trend, dải khuyến nghị cao hơn số COROS khi chọn Heracles | Hover nêu số của COROS; Settings ghi chú rõ |
