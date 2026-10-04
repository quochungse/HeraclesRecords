# Languages (i18n)

Heracles Records is written in English and translated into seven languages: Tiếng Việt,
日本語, 한국어, 简体中文 (Simplified), Español, Français and Deutsch. English is the default
whatever the operating system says, and the athlete switches in **Settings → Appearance →
Language**, where each language is listed in its own name beside its flag.

The work is phased, screen by screen. This file is the plan and the rules; `src/i18n/` is the
code, and `npm run test:i18n` holds both.

## Where it stands

| Phase | Scope | State |
|---|---|---|
| P1 | Runtime, Language setting with flags, CJK fonts, the rail, Settings (About, Navigation, Appearance, Connections, Sync, Backup & Restore, Report an issue, Updates, the COROS account row), sport and palette names | **Done** (2026-10-04) |
| P2 | Overview (`TrainingOverview`, `overviewGreeting.ts`, `greetings.ts`), the COROS sign-in, `App.tsx`'s toasts and messages, shared components (`ConfirmDialog`, `periodScale.ts` labels), **numbers and units** (see below) | Next |
| P3 | Activities, Running, Cycling, Hiking, Strength, and what they share (`ActivitySeriesChart`, `activityChannels.ts`, `sportTypes.ts`, the heatmap) | |
| P4 | Calendar and Training Library (`WorkoutBuilder`, step kinds, zones, the plan reader and editor) | |
| P5 | Sleep, Hall of Records, Where you've been, Personal | |
| P6 | Coach's screen: `ChatView`, Coach Models, MCP servers, the Workbench, analyses. **Not the prompt** (below) | |
| P7 | Text the main process puts on screen: errors thrown over IPC, native dialog titles | |

Until P7 lands, a non-English screen still shows some English. That is expected mid-way.
Releasing before every phase is done means shipping that mix, so two things wait until the
end: the changelog entry for languages, and a **Language** line in the website's guide
(`site/src/content/guide/customise.md`, under Appearance).

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
  `styles.css` names each CJK language's own system faces under `:root:lang(ja|ko|zh)`;
  without them Windows set Japanese in a full-width Gothic. Chinese is `zh-CN`, so Han
  characters take Simplified shapes.
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

## Numbers and units (P2)

`formatBytes` and every count on a translated screen go through the Intl locale, so German
reads `6,0 GB` and `1.234`. The unit formatters (`unitSystem.ts`, `training/formatters.ts`)
still write `toFixed`, so `5.2 km` stays `5.2 km` in German, French, Spanish and
Vietnamese, which all write `5,2 km`. Moving them is P2's first job, because every later
screen reads them. Unit symbols (km, mi, bpm, W, m) are not translated.

## Style, per language

The voice of each language, chosen to match the sports apps its readers already use:

| | Address | Register |
|---|---|---|
| Tiếng Việt | **bạn** | Friendly and plain; English terms kept where Vietnamese runners use them (Beta, API, MCP, Google Drive) |
| 日本語 | です / ます in sentences, nouns for labels | Katakana for established loanwords (ランニング, アクティビティ) |
| 한국어 | 합니다 in sentences, nouns for labels | 러닝, 사이클링 as Korean apps write them |
| 简体中文 | **你** | Short labels; full-width punctuation |
| Español | **tú** | Peninsular vocabulary (*ordenador*), as Strava and Garmin write in Spain |
| Français | **vous** | Typographic apostrophe (’), a space before `:` |
| Deutsch | **du** | As Strava and Garmin Connect write; compounds kept whole |

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
