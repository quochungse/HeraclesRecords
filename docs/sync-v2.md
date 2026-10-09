# Sync v2: record nguyên vẹn, log đánh số, format có version

Đề xuất ngày 2026-10-09. Đã code: bước A (`b1cc82d`), B0 (`9693387`), B1 (`6fc46a5`) và B2;
còn B3 (xoá code v1 khi mọi máy đã lên v2). Những chỗ code khác bản đề xuất ban đầu được ghi
ngay tại mục đó.
mô tả code hiện tại nằm trong phần Sync của `CLAUDE.md`.

## 1. Vì sao

Sau bước A, không có gì đổi thì pull chỉ còn một lần list metadata. Còn lại ba chỗ tốn kém,
đều đo trên dữ liệu thật:

- **Một lượt chat đẩy cả conversation.** `chat_sessions.messages_json` là cả transcript trong
  một cột, và entry của log mang nguyên row. Conversation lớn nhất dài 823 KB với 142 message,
  nên thêm một câu hỏi là đẩy và tải lại 823 KB.
- **Snapshot 2,7 MB được tải lại ở mỗi lần mở app** (nó chứa entry localStorage, mà entry đó
  được đọc lại mỗi launch) và ở mỗi lần compaction.
- **Transcript là ngoại lệ duy nhất của "bản ghi sau thắng".** Hai máy cùng ghi thì
  `rowMergers` hợp hai danh sách thành một row mới, một row mà không máy nào từng tạo ra.
  Phần merge đó (`lendableIds`, id dự phòng, `isAuthoritative`, `takeRepublish`, `versionKey`
  theo máy, gộp khi compaction) là phần phức tạp và nhiều bug nhất của sync.

## 2. Nguyên tắc

1. **Record là đơn vị, luôn nguyên vẹn của một máy.** Bản ghi sau thắng theo HLC, cả record.
   Không patch theo cột, không version theo cột, không merge row. Kết quả luôn là bản của máy A
   hoặc bản của máy B, không bao giờ là một bản C.
2. **Format trên vault có version.** Build không hiểu format thì dừng sync và báo người dùng,
   không đoán.
3. **Dùng API tốt nhất mà provider có, nhưng luôn có đường thay thế.** API riêng của một
   provider (changes feed của Drive, cursor của Dropbox, `delta` của OneDrive…) được dùng khi
   nó rẻ hoặc nhanh hơn. Điều kiện: thuật toán vẫn chạy đúng trên provider không có API đó,
   bằng đường chung qua năm thao tác cơ bản (§8). Một khả năng mà hầu hết provider đều có
   (dù tên gọi khác nhau) thì cứ dùng, đặt sau một thao tác tuỳ chọn của `StorageProvider`.

## 3. Version của format dữ liệu

### Hai con số

Lưu trong `vault/id.json`, file mà `prepare()` vốn đã đọc ở mỗi lần mở vault:

```json
{ "version": 2, "id": "…", "createdAt": "…", "owner": "…",
  "dataVersion": 2, "dataVersionCompat": 2 }
```

- `dataVersion`: format mới nhất đã ghi vào vault.
- `dataVersionCompat`: format thấp nhất còn đọc và ghi an toàn được cùng với dữ liệu hiện có.
- Vault chưa có hai trường này được coi là `1` / `1` (mọi vault hiện nay).

Mỗi build có hai hằng số trong code: `DATA_VERSION` (format nó ghi) và `DATA_VERSION_COMPAT`.
Đây là số nguyên của **format**, không phải version app: app ra bản thường xuyên, còn format
hiếm khi đổi.

### Ba trường hợp

| So sánh | Nghĩa | Hành vi |
|---|---|---|
| `DATA_VERSION >= cloud.dataVersion` | Build mới hoặc ngang bằng | Đọc ghi bình thường. Nếu lớn hơn: migrate vault rồi nâng `dataVersion` và `dataVersionCompat` lên giá trị của build. |
| `cloud.dataVersionCompat <= DATA_VERSION < cloud.dataVersion` | Build cũ nhưng còn tương thích | Đọc ghi bình thường theo format của build. **Không bao giờ hạ** hai con số. Settings hiện một dòng nhẹ "Có bản app mới hơn". |
| `DATA_VERSION < cloud.dataVersionCompat` | Build quá cũ | Trạng thái mới `outdated`: dừng loop, không đọc và không ghi gì. Settings → Sync báo cần cập nhật, có nút Cập nhật (`updaterService`). |

Ở trạng thái `outdated`, app vẫn dùng bình thường với dữ liệu trên máy. Thay đổi mới vẫn vào
`sync_outbox`, nên không mất. Sau khi nâng cấp, build mới chuyển các entry trong outbox sang
format mới rồi mới đẩy lên.

### Khi nào kiểm tra

- Ở `prepare()`: mở app, đăng nhập COROS, kết nối Drive.
- Ở mỗi pull: listing đã có revision của `vault/id.json`; revision đổi thì đọc lại.
  Máy kia nâng format trong lúc máy này đang chạy thì chậm nhất một chu kỳ poll là biết.
- Ngay trước khi migrate.

Nâng hai con số là một lần ghi có điều kiện theo revision (`put` với `expected`), sau khi
migrate xong. Hai máy cùng migrate thì một máy thua, đọc lại, thấy đã đúng version và dừng.

### Quy tắc khi đổi format (cho người viết code)

- **Đổi kiểu bổ sung** (thêm bảng hoặc trường mà build cũ bỏ qua được, và build cũ ghi đè
  cũng không làm mất thông tin mới): `DATA_VERSION + 1`, giữ nguyên `DATA_VERSION_COMPAT`.
- **Mọi thay đổi khác:** `DATA_VERSION + 1` và `DATA_VERSION_COMPAT = DATA_VERSION`.
- Mỗi lần nâng phải có test đọc vault ở mọi format mà build còn migrate được.

### Build ra đời trước cơ chế này

Build 1.0.x không đọc `dataVersion`. Nhưng chúng chỉ chấp nhận `vault/id.json` có
`version === 1` (`isVaultIdentity`). Gặp version khác, chúng coi vault là chưa có danh tính,
thử tạo mới với `expected: null`, bị từ chối vì file đã tồn tại, rồi dừng sync với lỗi "The
vault could not be identified." **mà không ghi gì.**

Vì vậy khi lên format 2 thì nâng luôn `version` của danh tính lên 2. Build cũ dừng an toàn;
câu lỗi không đúng nghĩa, nên ghi chú trong release notes. Build có cơ chế kiểm tra chấp nhận
mọi `version >= 1` và để hai con số quyết định.

## 4. Bốn thay đổi

### 4.1 Mỗi message là một record

- Trên vault, transcript không còn là một cột. Mỗi message là một entry scope `item`
  (`OpEntry.scope`), key là bảng (`chat_sessions`), record id là `<sessionId>` +
  `RECORD_ID_SEPARATOR` + `<mid>`, payload là `{ entry }`. Record `chat_sessions` chỉ còn các
  cột khác (tiêu đề, ghim, tóm tắt…). Code: `transcriptItems.ts`; bảng ghi những gì đã publish
  là `sync_published_items`.
- Mọi record, kể cả message, theo **một** luật: bản ghi sau thắng, cả record. Hai máy cùng thêm
  lượt thì đó là hai record khác nhau, cả hai đều còn. Hai máy cùng sửa một message thì một bản
  thắng, nguyên vẹn.
- Xoá message là gửi tombstone của đúng record đó. Hiện nay việc này không làm được, vì phép
  hợp sẽ đưa message trở lại.
- **Trong SQLite vẫn giữ `messages_json`**, nên `chatHistoryStore` và renderer không đổi.
  Chỉ lớp sync tách và ghép:
  - **Đẩy:** so `(mid, mrev)` của transcript (đã có, `stampEntries`) với bảng
    `sync_published_messages(session_id, mid, mrev)` (`device`). Message mới hoặc có `mrev`
    khác thì gửi `set`; `mid` đã publish mà không còn thì gửi `delete`.
  - **Nhận:** chèn hoặc thay theo `mid`, xoá theo `mid`, sắp theo `mid`.
- Một lượt chat chỉ còn vài KB, hoặc vài chục KB nếu có card chart.

### 4.2 Log đánh số theo máy, kèm file head

```
log/<device>/<seq 10 chữ số>.jsonl    tạo một lần (expected: null), không sửa
heads/<device>.json                   { "seq": 812 }   chỉ máy đó ghi
```

- **Đẩy:** ghi batch `seq + 1`, rồi ghi head. Nếu crash giữa hai bước thì head chậm một nhịp:
  lần sau ghi `seq + 1` bị báo trùng, máy list thư mục của chính mình để lấy số lớn nhất rồi
  đi tiếp.
- **Kéo:** máy giữ version vector `sync_vector(device, seq)` (`device` tier).
  1. Hỏi xem có gì đổi không. Provider có changes feed (`pollChanges`) thì dùng nó: một
     request nhỏ, rỗng nghĩa là dừng luôn. Provider không có thì list `heads/`: không head nào
     lớn hơn vector thì dừng. Changes feed chỉ là đường tắt; vector vẫn là thứ quyết định đọc
     gì, nên feed bỏ sót hay trả thừa cũng không làm sai, và thỉnh thoảng (ví dụ mỗi 10 phút)
     vẫn list `heads/` một lần cho chắc.
  2. Head tăng thì GET thẳng từng file `vector + 1 … head` theo tên, không cần list thư mục log.
  3. Áp dụng theo HLC, so với `recordVersions` như hiện nay. Data, stamp và vector ghi trong
     **một** transaction.
  4. GET trả 404 nghĩa là file đã bị compact (gap): đọc snapshot (§4.3).
- Phạm vi tính theo `seq`, nên không còn bẫy "batch đến muộn mang HLC cũ" của bản v1.

### 4.3 Một snapshot kèm version vector

```
snap/<tên>.json   { "dataVersion": 2, "vector": { "A": 812, "B": 455 }, "records": [ … ] }
```

- `records` là bản mới nhất của mỗi record, cộng tombstone chưa quá 90 ngày. Không gộp hay
  merge gì: chỉ chọn bản thắng.
- **Chỉ đọc khi:** máy mới (vector rỗng), có gap, hoặc vừa nâng cấp app (`sync.lastFullReadBuild`
  khác version app). Máy đang theo kịp không bao giờ đọc snapshot.
- Đọc xong thì vector bằng vector của snapshot, rồi đọc tiếp các file log sau đó.
- **Compaction** (dưới lease, khi có từ 50 file log trở lên): snapshot cũ cộng các file log sau
  vector của nó, ra snapshot mới; sau đó xoá file log có `seq <=` vector mới, rồi xoá snapshot
  cũ. Thứ tự ghi trước, xoá sau giữ như hiện nay.

### 4.4 Hộp thư bền cho localStorage

- Giá trị localStorage nhận từ máy khác được ghi vào `sync_local_storage_inbox(key, value,
  hlc)` (`device`). Renderer lấy khi sẵn sàng và xác nhận đã áp dụng; xác nhận xong mới xoá
  dòng.
- Entry localStorage được stamp bền như mọi entry khác. Bỏ `#localStorageMerged` và việc đọc
  lại file ở mỗi lần mở app.
- **Thay đổi này độc lập với format** (§9, B1): làm được ngay trên v1, và tự nó đã bỏ được
  2,7 MB snapshot mỗi lần mở app.

### Entry mà build không hiểu

Bảng mới, cột mới, hoặc phân loại mới từ build khác: một luật duy nhất. **Khi version app đổi,
đọc lại từ snapshot một lần.** Không còn trạng thái `retry` theo từng file.

## 5. Bỏ đi

| Bỏ | Vì sao không cần nữa |
|---|---|
| Merge transcript (`mergeChatSession`, `lendableIds`, id dự phòng `0-…`, `isAuthoritative`, `takeRepublish`, `versionKey` theo máy) | Mỗi message là một record |
| Gộp record khi compaction (`compactEntries` + merger) | Snapshot chỉ chọn bản thắng |
| `readIndex` với `done`/`retry` (bước A) | Version vector, hộp thư localStorage, đọc lại khi nâng cấp |
| Horizon HLC và dedupe `alreadyFolded` | Phạm vi theo `seq` |
| Đặt tên batch theo HLC | Đặt tên theo `seq` |

**Giữ nguyên:** HLC, `recordVersions`, `sync_outbox`, lease, `ObfuscatedProvider`,
`syncPolicy`, kiểm tra chủ vault, `fullState`, và luật chọn bản của `athlete_milestones`
(nó chọn nguyên một bản A hoặc B, không ghép).

## 6. Layout v2

```
vault/id.json                     danh tính + dataVersion/dataVersionCompat
heads/<device>.json               seq mới nhất của máy đó
log/<device>/<seq>.jsonl          batch, tạo một lần
snap/<tên>.json                   snapshot + vector
lease/…                           như hiện nay (thêm lease format-migration)
oplog/, oplog-snapshot/           v1: chỉ đọc trong thời gian chuyển tiếp, sau đó xoá
```

## 7. Migrate v1 → v2

1. Build v2 mở vault, thấy `dataVersion` 1 (`ahead`), nên migrate trước khi loop chạy
   (`migrateThenStart` trong `main.ts`, `SyncLoop.migrateToV2`).
2. Dưới lease `format-migration`, pull v1 lần cuối (bộ đọc tăng dần của bước A).
3. Dựng snapshot v2 **từ dữ liệu trên máy** sau lần pull đó (`collectStampedEntries`), mỗi
   record **giữ HLC gốc** là stamp `recordVersions` của nó; record chưa từng được stamp mới
   nhận HLC mới. Dữ liệu trên máy đã là kết quả merge v1, nên không phải resolve lại log v1.
   Transcript được tách thành item, mỗi item mang HLC của conversation chứa nó.
4. Ghi snapshot với vector rỗng, rồi ghi `vault/id.json` có điều kiện theo revision:
   `version: 2, dataVersion: 2, dataVersionCompat: 2` (`SyncService.raiseDataFormat`).
   Nếu lease đang do máy khác giữ hoặc migrate lỗi, loop dừng và lần `prepareSync` sau thử
   lại.
5. Outbox mà build cũ để lại vẫn được gửi: lúc loop nhận lại outbox, conversation nguyên
   khối được tách thành item.
6. Máy kia:
   - build có cơ chế kiểm tra thì thấy `outdated` và dừng;
   - build 1.0.x thì dừng ở lỗi danh tính (§3).
7. **Cầu chuyển tiếp:** mỗi lần pull, nếu vault còn `oplog/`, build v2 đọc thêm những file v1
   chưa đọc (bộ đọc của bước A, theo luật merge v1) rồi **publish lại sang v2** những gì vừa
   nhận: record thường giữ nguyên entry và HLC; conversation được đẩy lại đúng như nó đang có
   trên máy, nên chỉ message mới mới đi.
8. Khi file mới nhất trong `oplog/` đã cũ hơn 7 ngày, compaction v2 xoá `oplog/` và
   `oplog-snapshot/` (`LEGACY_LOG_RETENTION_MS`).

## 8. Hợp đồng provider

**Bắt buộc**, đường chung mà thuật toán luôn chạy được:

| Thao tác | Dùng cho |
|---|---|
| `list(prefix)` kèm revision | Đọc `heads/`, compaction, tìm `seq` lớn nhất của chính mình |
| `get(path)` | Đọc |
| `put(path, …, null)`: chỉ tạo khi chưa có | Batch, lease |
| `put(path, …, revision)`: ghi theo revision | Lease, `vault/id.json` |
| `delete(path)` | Compaction |

Drive, Dropbox, OneDrive, S3 và WebDAV đều làm được năm việc này (Drive giả lập "chỉ tạo khi
chưa có" như code đang làm).

**Tuỳ chọn**, dùng khi provider có, với đường thay thế khi không có:

| Thao tác tuỳ chọn | Provider có | Khi không có |
|---|---|---|
| `pollChanges(cursor)`: có gì đổi từ lần trước | Drive (`changes.list`), Dropbox (`list_folder/continue`), OneDrive (`delta`), Box (Events) | List `heads/` |
| `get` có điều kiện theo ETag (trả `304`) | Ví dụ S3, WebDAV (HTTP chuẩn) | GET đầy đủ (file head vốn rất nhỏ) |

Một thao tác tuỳ chọn chỉ được làm nhanh hơn, không bao giờ được là điều kiện để đúng: test
của sync chạy cả hai đường. Thêm provider là viết một lớp `StorageProvider`, khai báo những
thao tác tuỳ chọn nó có; mọi tầng phía trên giữ nguyên.

## 9. Thứ tự làm

| Bước | Nội dung | Format |
|---|---|---|
| **B0** | Cơ chế kiểm tra format: hằng số `1`/`1`, chấp nhận danh tính `version >= 1`, trạng thái `outdated` và UI. Phát hành riêng, trước mọi thứ khác, để lần đổi format sau đã có cổng chặn. | v1 |
| **B1** | Hộp thư localStorage (§4.4). | v1 |
| **B2** | Log theo `seq` + head + snapshot có vector + message record + migrate + cầu chuyển tiếp. `DATA_VERSION = 2`, `COMPAT = 2`, danh tính `version: 2`. | v2 |
| **B3** | Khi cả hai máy đã lên v2: xoá code v1 (merge transcript, `readIndex`, `oplog.ts` v1, cầu chuyển tiếp). | v2 |

Cả hai máy cần nâng cấp gần nhau ở B2.

## 10. Kiểm chứng

- **Cổng format:** ba trường hợp ở §3, nâng version đồng thời trên hai máy, build 1.0.x gặp
  danh tính `version: 2` thì không ghi gì.
- **Message record:** hai máy thêm lượt vào cùng conversation thì cả hai còn; sửa cùng một
  message thì một bản thắng nguyên vẹn; xoá không bị đưa trở lại; một lượt chat đẩy đúng các
  message mới.
- **Log và vector:** chạy cả đường changes feed và đường list `heads/`, kết quả như nhau, kể
  cả khi feed bỏ sót một thay đổi; không có gì mới thì chỉ một request nhỏ; gap thì đọc snapshot; head chậm sau
  crash; crash giữa merge và vector thì đọc lại chứ không bỏ sót.
- **Migrate:** vault v1 thật (bản sao), kết quả v2 đọc ra đúng từng record; outbox v1 đẩy lên
  sau khi nâng cấp.
- Các suite sync hiện có vẫn pass ở mọi bước.

## 11. Còn để ngỏ

- Card `activityVisual` chiếm khoảng 75% dung lượng chat. Sau §4.1 mỗi card là một record chỉ
  gửi một lần. Bỏ dữ liệu chart khỏi sync (dựng lại từ COROS ở máy nhận) là quyết định riêng.
- Thời gian giữ cầu chuyển tiếp (7 ngày) là ước lượng.
- Changes feed của Drive với scope `drive.file`: cần probe xem feed có báo file do máy khác
  (cùng OAuth client) tạo ra không, trước khi bật nó cho Drive. Chưa probe thì Drive đi đường
  list `heads/`.
