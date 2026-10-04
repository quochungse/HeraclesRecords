# Languages (i18n)

Heracles Records is written in English and translated into twelve languages: Tiếng Việt,
日本語, 한국어, 简体中文 (Simplified), Español, Português (Brasil), Français, Deutsch,
Italiano, Русский, Bahasa Indonesia and ไทย. English is the default whatever the operating
system says, and the athlete switches in **Settings → Appearance → Language**, where each
language is listed in its own name beside its flag.

The work is phased, screen by screen. This file is the plan and the rules; `src/i18n/` is the
code, and `npm run test:i18n` holds both.

## Where it stands

| Phase | Scope | State |
|---|---|---|
| P1 | Runtime, Language setting with flags, CJK fonts, the rail, Settings (About, Navigation, Appearance, Connections, Sync, Backup & Restore, Report an issue, Updates, the COROS account row), sport and palette names | **Done** (2026-10-04) |
| P2 | Overview and its panels, the greeting, the COROS sign-in, `App.tsx`'s toasts and loading states, the update prompt, map styles, periods, MCP notices, COROS's sport names (`sports.*`), and **numbers**: the unit formatters' digits and every count follow the language | **Done** |
| P3 | Activities, Running, Cycling, Hiking, Strength, and what they share (`ActivitySeriesChart`, `activityChannels.ts`, `sportTypes.ts`, the heatmap) | |
| P4 | Calendar and Training Library (`WorkoutBuilder`, step kinds, zones, the plan reader and editor) | |
| P5 | Sleep, Hall of Records, Where you've been, Personal | |
| P6 | Coach's screen: `ChatView`, Coach Models, MCP servers, the Workbench, analyses. **Not the prompt** (below) | |
| P7 | Text the main process puts on screen: errors thrown over IPC, native dialog titles | |

## A release ships every language finished

**`npm run check:i18n-release` refuses a release while anything is left in English**, and it
runs twice: in `npm run release:prepare`, before the version is written, and in
`release.yml`'s preflight job, before any installer is built. It refuses when:

- `scripts/lib/i18n-pending.json` lists a file, or the scanner finds English anywhere in
  `src/` (`scripts/lib/i18n-coverage.mjs`);
- a language is missing a message English has, or a plural form its own rules use.

The pending list is a ratchet that `npm run test:i18n` holds. A file not on it must stay
clean, and a file on it that has become clean must come off it. `npm run i18n:coverage`
(`-- <path> -v` for one file, line by line) is the to-do list. The scanner passes over the
developer toolbar and the sample presets, which no packaged build draws. A line that looks
like text and is not (a log line, a selector, a COROS field value) carries `i18n-ignore` and
the reason.

Two things wait for the gate to pass: the changelog entry for languages, and a **Language**
line in the website's guide (`site/src/content/guide/customise.md`, under Appearance).

## How it works

- **Messages are flat, keyed by screen first** (`settings.language.title`), one file per
  namespace per language: `src/i18n/messages/<locale>/<namespace>.ts`. English is
  `messages/en/`; each other language types each namespace against English's
  (`const sync: SyncMessages = …`), so **`npm run build` fails on a missing or invented
  key**. A new namespace is added to every language's `index.ts`.
- **`t(key, vars)`** fills `{name}`. **`plural(key, count)`** picks `key_one` / `key_other` /
  … through `Intl.PluralRules` and writes `{count}` in the language's own digits.
  **`rich(key, { b: … })`** draws `<b>…</b>` spans (any lower-case tag, never nested). All
  three come from `core.ts` (React-free, so a pure module can translate) and from
  `useI18n()`.
- **A component that shows translated words calls `useI18n()`**, even when the words come
  from a helper that uses `t` directly. Subscribing is what redraws it on a switch. A
  memoised component that only calls the helper keeps the old language until something else
  redraws it.
- **A label defined at module level is read while rendering, never kept.** `PRIMARY_NAV_*`,
  `SPORT_COLOR_LABELS` and `ACCENT_PALETTE_DETAILS` expose `label` as a getter over the
  message, so every call site reads the language on screen. A constant computed from one at
  load time freezes it in English (Settings' sport tiles did, and became a function).
- **English is the default and the fallback.** Each other language is a chunk of its own
  (`LOADERS` in `core.ts`), loaded before the first paint (`initLocale` in `main.tsx`) or on
  a switch (`setLocale`). A missing string falls back to English, string by string.
- **The choice is `heraclesrecords.language`**, a `preference`, so it follows the athlete to
  their other machine, which reads it at its next launch.
- **`<html lang>` follows the language.** Chromium picks fallback fonts from it, and
  `styles.css` names each language's own system faces under `:root:lang(ja|ko|zh|th)`;
  without them Windows set Japanese in a full-width Gothic. Chinese is `zh-CN`, so Han
  characters take Simplified shapes. Russian is drawn in the shipped faces: `fonts:fetch`
  brings their Cyrillic cuts (Space Grotesk has none and falls to Inter).
- **Dates and numbers follow the language, not the system.** `getIntlLocale()` (or `intl`
  from the hook) is the system's own regional variant of the chosen language when it has
  one, the language's usual region otherwise. Pass it to every `toLocale*String` and
  `Intl.*` call on a translated screen. `undefined` means the OS language.

## Rules

- **Never store a translated string.** Not in SQLite, not in localStorage, not in anything
  sync carries: another machine may be in another language. Store ids and keys.
- **COROS's own text is not ours to translate.** Activity names, workout and plan names, and
  what `corosText` resolves are the athlete's or COROS's, in the language they wrote them in.
- **Coach's prompt is not translated** (decided 2026-10-04). The model answers in the language
  the athlete writes in. Only Coach's *screen* is translated (P6).
- **Names stay names**: Heracles Records, COROS, Google Drive, Hevy, MCP, GitHub, Claude.
  The labour names on the Hall of Records are a P5 decision. The website reads
  `src/records/labours.ts` in English, so a translation must not change that file's English.
- **What drives the app from outside stays English.** `data-nav-label` is `english(labelKey)`,
  because the probe and the screenshot harness navigate by it.
- **A translated file stays translated.** Add it to `TRANSLATED_FILES` in
  `scripts/test-i18n.mjs`; the test then fails on English written straight into its JSX or
  into a `title` / `label` / `detail` / `aria-label` / `placeholder` literal.
- **A sentence is one message.** Never build one from fragments ("Writes " + n + " records"):
  word order differs, so the whole sentence is the key, with its variants as keys of their
  own when a part comes and goes (`backup.override.detail`, `…detailDeletes`,
  `…detailDeletesSettings`).
- **A count in front of a noun is a plural message**, even where English would get away with
  one form. Russian declines the noun by the number (1 изменение, 3 изменения, 5 изменений)
  and states `_one`, `_few` and `_many`; `Translation<T>` (`src/i18n/types.ts`) leaves room
  for them and `test:i18n` requires every form a language's rules use. Where a sentence
  cannot take a plural, a language writes the count as a label instead
  ("записей: {count}"), never "1 записей".
- **A new namespace** is a file in `messages/en/`, a line in `messages/en/index.ts`, the same
  file in every other language, and `npm run i18n:index`, which writes the other languages'
  `index.ts` and fails on a file missing.

## Numbers and units

**`electron/unitSystem.ts` writes its decimals through a formatter the renderer swaps for the
language's** (`setDecimalFormatter`, set by `core.ts` on every switch), so German reads
`5,2 km` while the main process, which writes for the coach, keeps `5.2 km`. In a component,
`formatDecimal(value, digits)` stands for `toFixed` and `formatCount` for a grouped count;
dates and `Intl` take `getIntlLocale()`. The scanner flags a `toFixed` on a displayed figure
and a `toLocale*String` or `Intl` without the app's locale; a `toFixed` that feeds a style or
a parser carries `i18n-ignore`.

Durations are messages (`units.duration.hm`, `.h`, `.m`), short enough for a tile in every
language. A tile draws any letter of any script in a figure as a small unit
(`withUnitSuffixes`). Weekday and month names come from `Intl` (`weekdayNames`,
`monthNames`), never from messages. Unit symbols (km, mi, bpm, W, m) are not translated.

## Style, per language

The voice of each language, chosen to match the sports apps its readers already use:

| | Address | Register |
|---|---|---|
| Tiếng Việt | **bạn** | Friendly and plain; English terms kept where Vietnamese runners use them (Beta, API, MCP, Google Drive) |
| 日本語 | です / ます in sentences, nouns for labels | Katakana for established loanwords (ランニング, アクティビティ) |
| 한국어 | 합니다 in sentences, nouns for labels | 러닝, 사이클링 as Korean apps write them |
| 简体中文 | **你** | Short labels; full-width punctuation |
| Español | **tú** | Peninsular vocabulary (*ordenador*), as Strava and Garmin write in Spain |
| Português (Brasil) | **você** | Brazilian vocabulary (*tela*, *arquivo*, *salvar*) |
| Français | **vous** | Typographic apostrophe (’), a space before `:` |
| Deutsch | **du** | As Strava and Garmin Connect write; compounds kept whole |
| Italiano | **tu** | As Strava Italia writes; typographic apostrophe (’) |
| Русский | **вы** (lower case) | Counts as plural messages or as "label: {count}"; ё written |
| Bahasa Indonesia | **Anda** | Standard (baku) forms; English kept for terms runners use (Beta, API) |
| ไทย | **คุณ** | No full stop at the end of a sentence; English kept for brand and tech terms |

### Glossary

Terms later phases must reuse rather than reinvent.

| English | vi | ja | ko | zh | es | fr | de |
|---|---|---|---|---|---|---|---|
| Overview | Tổng quan | 概要 | 개요 | 概览 | Resumen | Vue d’ensemble | Übersicht |
| Coach | Huấn luyện viên | コーチ | 코치 | 教练 | Entrenador | Coach | Coach |
| Activity | Hoạt động | アクティビティ | 활동 | 活动 | Actividad | Activité | Aktivität |
| Workout | Bài tập | ワークアウト | 운동 | 训练 | Entrenamiento | Séance | Workout |
| Training plan | Giáo án | トレーニングプラン | 훈련 계획 | 训练计划 | Plan de entrenamiento | Plan d’entraînement | Trainingsplan |
| Training Library | Thư viện bài tập | トレーニングライブラリ | 훈련 라이브러리 | 训练库 | Biblioteca de entrenamientos | Bibliothèque d’entraînements | Trainingsbibliothek |
| Running | Chạy bộ | ランニング | 러닝 | 跑步 | Carrera | Course à pied | Laufen |
| Cycling | Đạp xe | サイクリング | 사이클링 | 骑行 | Ciclismo | Vélo | Radfahren |
| Hiking | Leo núi | ハイキング | 하이킹 | 徒步 | Senderismo | Randonnée | Wandern |
| Strength | Sức mạnh | 筋トレ | 근력 운동 | 力量训练 | Fuerza | Musculation | Krafttraining |
| Sleep | Giấc ngủ | 睡眠 | 수면 | 睡眠 | Sueño | Sommeil | Schlaf |
| Hall of Records | Đại sảnh Kỷ lục | 記録の殿堂 | 기록의 전당 | 纪录殿堂 | Salón de los récords | Panthéon des records | Ruhmeshalle |
| Labour (of Heracles) | Kỳ công | 功業 | 과업 | 功业 | Trabajo | Travail | Arbeit |
| Record (a row of data) | Bản ghi | 記録 | 기록 | 记录 | Registro | Élément | Eintrag |
| Sync | Đồng bộ | 同期 | 동기화 | 同步 | Sincronización | Synchronisation | Synchronisierung |
| Vault (sync storage) | Kho | 保管庫 | 보관소 | 存储库 | Almacén | Espace | Speicher |
| Sign in | Đăng nhập | サインイン | 로그인 | 登录 | Iniciar sesión | Se connecter | Anmelden |
| Settings | Cài đặt | 設定 | 설정 | 设置 | Ajustes | Paramètres | Einstellungen |

The same terms in the five languages added after P1:

| English | pt | it | ru | id | th |
|---|---|---|---|---|---|
| Overview | Visão geral | Panoramica | Обзор | Ringkasan | ภาพรวม |
| Coach | Treinador | Coach | Тренер | Pelatih | โค้ช |
| Activity | Atividade | Attività | Активность | Aktivitas | กิจกรรม |
| Workout | Treino | Allenamento | Тренировка | Latihan | การฝึก |
| Training plan | Plano de treino | Piano di allenamento | План тренировок | Rencana latihan | แผนการฝึก |
| Training Library | Biblioteca de treinos | Libreria allenamenti | Библиотека тренировок | Pustaka latihan | คลังการฝึก |
| Running | Corrida | Corsa | Бег | Lari | วิ่ง |
| Cycling | Ciclismo | Ciclismo | Велоспорт | Bersepeda | ปั่นจักรยาน |
| Hiking | Trilha | Escursionismo | Хайкинг | Mendaki | เดินป่า |
| Strength | Força | Forza | Силовые | Latihan beban | เวทเทรนนิ่ง |
| Sleep | Sono | Sonno | Сон | Tidur | การนอน |
| Hall of Records | Galeria de recordes | Albo dei record | Зал рекордов | Galeri rekor | หอเกียรติยศ |
| Labour (of Heracles) | Trabalho | Fatica | Подвиг | Tugas | ภารกิจ |
| Record (a row of data) | Registro | Elemento | Запись | Data | รายการ |
| Sync | Sincronização | Sincronizzazione | Синхронизация | Sinkronisasi | ซิงค์ |
| Vault (sync storage) | Cofre | Archivio | Хранилище | Brankas | พื้นที่เก็บ |
| Sign in | Entrar | Accedi | Войти | Masuk | ลงชื่อเข้าใช้ |
| Settings | Configurações | Impostazioni | Настройки | Pengaturan | การตั้งค่า |
