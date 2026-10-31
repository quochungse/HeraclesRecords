# Changelog

All notable changes to Heracles Records are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.4] - 2026-10-31

Swimming gets a screen of its own.

### What's new
- **Swimming** - pool swims and open water, read the way a swimmer reads them: pace per 100 m (or yd), the week in metres, and in the pool every length. Critical Swim Speed from your fastest freestyle 200 and 400, freestyle SWOLF in your usual pool against the four weeks before, and your best 100. Technique follows SWOLF, distance per stroke, pace and stroke rate swim by swim. A swim's page draws every length in its stroke's colour with the rests as gaps, and groups the intervals into the sets they make (8 x 100 m Freestyle). Open water keeps its route and the watch's laps. Explained at heraclesrecords.com/activities/swimming.
- **Calendar** - a scheduled session shows its description. A done session's panel opens with the plan it answered and how much of it was done, COROS's own figure where it has one, in place of the badge on the card.

### Fixed
- A planned session's distance and time are COROS's estimate of the whole session, so a 17 km long run with a timed float no longer reads 14.5 km, and the session panel gives the same time as its card.
- A done session's planned load and distance are the plan's again, not the activity's, so completion no longer reads 100% for every session.
- A strength session's volume is its sets, not the time of its holds, and the session panel leaves out boxes with nothing to show.
- Overview's coming sessions give a run's distance and a strength session's sets, not a count of steps.
- Activities and Coach read a pool swim by its intervals, not as a list of every length and rest.
- Improve app performance and stability.

## [1.4.3] - 2026-10-30

A smoother way to sign in to COROS.

### What's new
- **Sign-in** - a streamlined sign-in flow.

## [1.4.1] - 2026-10-30

Heracles Training Load: strength scored from the sets themselves, on the same scale as a run, so a week of running and lifting finally adds up.

### What's new
- **Heracles Training Load** - COROS reads a gym session from heart rate, so an hour of heavy squats can count for less than a short jog. Heracles Training Load scores it set by set instead: the weight, the reps, your body weight and the most you have lifted on each exercise say how close to failure every set went, and each minute of lifting weighs what a steady minute at the same effort weighs on COROS's own curve. One formula for everyone, built on published research and a public dataset, with nothing tuned on you. Every step is explained at heraclesrecords.com/activities/strength/training-load.
- **One load across the app** - choose Heracles TL under Strength, Settings, Training load formula, and Overview, the Calendar, the Training Library, Activities and Coach count strength that way. Load Impact, Base Fitness, Intensity Trend and the recommended weekly range follow, by COROS's own formulas, and where a figure differs from the COROS app its hover gives COROS's. Other sports, recovery and training effect stay COROS's. COROS TL stays the default.
- **Every set scored** - with Heracles TL chosen, each set of a session carries its load, and its hover the predicted RPE and the reps it had left. The muscle map can be lit by load beside sets and volume.
- **Coach and plans in the same load** - Coach weighs a strength session at what it cost, and Coach and AI Plan set and progress the weekly load in the load you chose, the gym included.
- **Strength settings** - one dialog for the data source (Combined, COROS or Hevy) and the training load formula. The header keeps the window, Refresh and Settings.
- **Hevy** - Hevy clocks no rest, so the time its sets leave of a session now counts as rest between them, as COROS's laps do, and a session reads the same from either app. An assisted movement has its assistance taken off your body weight, and the RPE you log outranks any prediction.
- **Body weight by day** - the app keeps each day your weight changed, so a session is scored at what you weighed that day, not today.
- **Overview** - Training activity becomes the Training load heatmap, each session on a month card named by its load. Training load distribution reads its heart-rate zones over the sports heart rate measures, so a lifting session no longer counts in them.

### Fixed
- Improve app performance and stability.

## [1.4.0] - 2026-10-29

Overview, rebuilt around one question: how ready you are, and what the week holds. And Coach can now change one step of a saved workout without rewriting the whole of it.

### What's new
- **Overview** - redrawn from top to bottom. Readiness sets your recovery, last night's sleep and this week side by side: the body figure lit to your recovery, the night's score, overnight HRV and the heart rate you slept at, and COROS's training status over a column a day, in time, distance or load. Coming up puts today beside the days after it, and every sport you trained in the last four weeks gets a section of its own, Strength with its body map.
- **Training load** - Load Impact and Base Fitness read the way COROS reads them, on Overview, in the Calendar and in Coach, and this week's load is set against the range COROS recommends for the week.
- **Coach edits a workout in place** - ask for a change to one step of a session on your calendar or a workout in your library, and Coach proposes just that change. Before applying it, the app checks the workout has not changed since Coach read it.
- **Session notes** - Coach reads and writes a session's notes, and every name and note sent to COROS stays within what the COROS app can show.
- **AI Model Providers** - a clearer place to connect Claude, ChatGPT, OpenRouter and a local model. ChatGPT offers the reasoning efforts each model supports, and a new conversation starts on the AI you used last.
- **What Coach may read** - set in each conversation, the same way for every AI. Claude Code no longer has switches of its own.
- **Updates** - once an update has downloaded, Restart takes the place of Check for updates.
- **Workout view** - each strength exercise states its rest after a set.

### Fixed
- Strength reads each exercise by what it is rather than by its name, so a renamed movement is no longer counted on the wrong muscles.
- The reasoning effort menu no longer flickers at fractional zoom.
- Improve app performance and stability.

## [1.3.0] - 2026-10-24

A redesign, and the biggest refinement pass the app has had. Every screen was taken back to three ideas: **refined**, so nothing is drawn that does not need to be; **intuitive**, so a screen shows what you picked and nothing else; and **convenient**, so the thing you want is one press away.

### What's new
- **Strength** - one thing at a time: a session, or the weeks around it, never both on top of each other. Records sit in the exercises they were set in, each session shows the muscles it worked, and the body figure turns slowly until you pick a side.
- **Activities** - fewer boxes and lighter rows. The sport filter is the bar that shows your mix, and a session opens on what matters first.
- **Calendar** - sessions are small cards you read at a glance, and a press anywhere in a day opens it.
- **Light theme** - redrawn across the app: white cards on a cool grey page, gold where something is filled, and the accent kept for words.
- **Sleep and recovery** - Coach reads your recovery from the heart rate you slept at, which says far more about a night than COROS's resting heart rate, and the Sleep screen shows it beside HRV and the score.

### Fixed
- One quiet scrollbar across the app.
- Improve app performance and stability.

## [1.2.2] - 2026-10-22

### What's new
- **Exercises Library** - a third tab in the Training Library: COROS's whole movement catalogue to read. Pick a body part on the figure, then a muscle inside it, or an equipment; each movement shows its clip, the muscles it works and how hard. HYROX's eight stations are one toggle away, in race order, and a heart keeps your favourites.
- **Exercises described properly** - COROS files a squat as hamstring work, battle ropes as biceps and every twist and side plank with no obliques. The app now describes each movement again, its muscles and equipment one by one, so your strength totals and Coach read the right muscles. It may disagree with COROS here and there, on purpose; if you think it got one wrong, say so in Discussions or Issues.
- **Abductors** - a muscle of their own, on the body filter and on the Strength screen's 3D figure, no longer counted with the glutes.
- **Exercise picker** - the heart narrows the search to your favourite movements.
- **Plan in progress** - a tile among your plans rather than a banner over them, filled as far as the plan has got, with the next session beside it. "Done" counts the sessions trained out of those the plan put on the calendar.
- **Plan usage** - for Claude and ChatGPT subscriptions, "AI for this conversation" shows how much of your plan's limits is spent.
- **Coach cards open what they name** - a proposed change opens the session it acts on and what it would write, a session on a plan card opens it in the Workbench, and a question's chips open what they point at.

### Fixed
- Applying or dismissing a proposed change updates the conversation's "to decide" count straight away.
- Improve app performance and stability.

## [1.2.1] - 2026-10-21

The biggest Coach update since 1.0. A conversation is now something you work in rather than scroll through: take a question back, rewrite it, keep a turn out of Coach's reading or branch off to try another idea, and every session Coach shows you reads the way its own page does. Fewer clicks between asking, reading and deciding.

### Coach: a conversation you can shape
- **Take it back** - delete a question together with Coach's answer, and what Coach made in it if you choose. When the conversation's summary still mentions it, the summary can be rewritten on the spot.
- **Ask it again** - edit your last question and send it; Coach answers afresh. A question that got no answer says why right under it and offers Retry, and every message can be copied.
- **Keep it off the record** - hide a turn and it stays on screen while Coach no longer reads it. Show it again whenever you like.
- **Branch off** - start a new conversation from any answer, carrying everything up to that point with the same AI and sources, while what Coach made stays where it was made.
- **Find your way back** - in a long conversation a column of marks at the edge lists your questions. Press one, or use Alt with the up and down arrows, to jump straight to it.

### Coach: sessions read in depth
- **Every channel on one chart** - a session's card draws its Performance chart as the session's own page does, two channels at a time with a chip each.
- **Time in zones** - a card shows the time in each heart-rate zone, as COROS scored it and named in your zone model. A lap table of five laps or more starts folded, one click from open.
- **Strength and Hybrid Fitness** - heart rate is drawn under the sets, numbered by exercise, and a set scheme reads "4 × 11–14" or "3 × 0:45".
- **Recovery trends** - the trend card now follows HRV and resting heart rate.
- **AI Model Providers** - Coach Models has a clearer name. "AI for this conversation" lists the providers that can answer, and Manage providers opens the rest.

### Across the app
- **Lap tables** - a structured workout's laps are headed by its parts (Warm Up, Training, Cool Down) and a recovery between repeats is marked Rest, on the run, ride and hike pages and on Activities.
- **Performance chart** - each channel but stride ratio wears the colour it has in the COROS app, toned so lines drawn together stay apart for colour-blind eyes too, and the form figures take COROS's names: Ground time, Stride height, Stride ratio. Power on a run is Running power.
- **Calendar** - a scheduled session is edited in the same workout builder as Create workout.
- **Notices** - a quiet card centred over the screen: at the bottom for what you just did, at the top when the app speaks unasked. It waits while the pointer is on it, and the same notice again restarts it instead of stacking a copy.

### Fixed
- **Strength** - a plank or any set held for a time is no longer dropped, a Hybrid Fitness rest is no longer counted as a set, and two exercises COROS numbered alike stay apart. Sessions are read again once after the update.
- Improve app performance and stability.

## [1.2.0] - 2026-10-20

### What's new
- **Running efficiency** - how much speed a road or track run bought for the heart rate it cost, on your COROS VO₂max scale and against your usual from the six weeks before, with how well you held it to the end. It is on the Running screen and on each run's page, and replaces Aerobic efficiency.
- **Time in zones** - the run, ride and hike pages and an opened Strength session show the time in every zone, as COROS scored it. A run switches between heart rate and pace.
- **Performance chart** - every surge and stop is drawn rather than averaged away, and the chart can split into two plots on one clock: what you produced above, what it cost below. Grade-adjusted pace is called Effort pace, as COROS calls it.
- **Training labels** - every run and ride is named by what it trained: Recovery, Aerobic, Tempo, Threshold, VO2 Max or Anaerobic, beside its shape, such as Intervals 6 × 1000 m, strides or a long run. The label is on Activities, on each Running and Cycling row and on the session's page, which says why it was given.


### Fixed
- **Workouts and plans on COROS** - written the way COROS's own web app writes them: a strength session shows its muscle map in COROS, steps are named on the watch in your language, and moving a plan's session on the calendar keeps it in its plan.
- The weekly volume charts no longer write the same number twice on their axis.
- Improve app performance and stability.

## [1.1.2] - 2026-10-19

### What's new

- **Strength** - the muscle figure follows the sex on your COROS profile: a gym-trained man, or a fit woman with her own proportions, each with a face of their own. The heat map runs in amber, from sand to ember, and a muscle you point at stands out on the light theme too.
- **Workout builder** - pick a muscle in the exercise picker and the movements that work it hardest come first, read from COROS's own catalogue.
- **Where you've been** - every place on the globe is named, not only the six newest, and names that would overlap make room for each other.
- **Activities** - a swim reads its pace per 100 m, and every sport reads the same on its screen as it does in Coach.

### Fixed

- Improve app performance and stability.

## [1.1.1] - 2026-10-12

### What's new

- **Updates** - an update downloads in the background and no longer closes the app the moment it lands. The Settings button on the rail shows its progress, and once it is ready you choose Restart now or Later. On Windows it installs without the setup wizard; on Linux the window no longer freezes while the update installs.
- **Overview** - the panels sit side by side on narrower windows, and a full 100% recovery draws your physique in sky blue.

### Fixed

- Coach's analysis presets fill the role and playbook in the language on screen.
- Improve app performance and stability.

## [1.1.0] - 2026-10-10

### What's new

- **Multi languages supported**  In your language, on every screen. Heracles Records now speaks 13 languages, pick one under Settings: English, Vietnamese, Japanese, Korean, Simplified Chinese, Spanish, Brazilian Portuguese, French, German, Italian, Russian, Indonesian and Thai.
- **Coach** - can search the web for things your data does not hold, such as a race's course and cut-offs, and names the pages it used. It is off until you switch on Web for a conversation. What a conversation may read now sits under Permissions in its AI sheet.
- **Overview** - the Sleep card shows the past seven days, and upcoming workouts list today and tomorrow in full.

### Fixed

- Coach's plan outline lists every session of a week, and a library workout goes into a plan or the calendar correctly.
- Improve app performance and stability.

## [1.0.3] - 2026-10-09

### What's new

- **Cycling** — your cycling VO₂max from COROS, on the Cycling screen and for Coach.
- **Sync** — faster and lighter: only what changed is sent and fetched. Update every computer you sync: older versions stop syncing once one machine runs 1.0.3.

### Fixed

- Improve app performance and stability.

## [1.0.2] - 2026-10-08

### What's new

- **Overview** — "Your physique" replaces the recovery ring: a wireframe of your body, shaped by your personal data and lit up to today's recovery in a colour that runs from red to green with it. Weekly Activity shows the week's totals beside its chart.

### Fixed

- Improve app performance and stability.

## [1.0.1] - 2026-10-06

### What's new

- **Where you've been, redesigned** — the globe sits beside a list of places. Point at one in the list or on the globe and both follow; open it to see its figures, the sports trained there, visits by month and its activities. A place is now one province or state, no more than 25 km across, named by its region until the town is found. Country borders and coasts are drawn on the globe, and zooming in opens a street map of your routes.
- **Hall of Records** — each month has a clear heading and a long month folds behind "N more". The Cattle of Geryon counts the same places Where you've been draws.
- **Linux** — a `.deb` for Debian and Ubuntu beside the AppImage. The AppImage still updates itself.
- **Coach** — tokens read from the prompt cache count as a tenth, so a turn's total and the monthly budget match what was spent. Settings tell you when a newer Claude Code is available.

### Fixed

- Sleep shows up as soon as COROS MCP is connected, without pressing Refresh.
- Improve app performance and stability.

## [1.0.0] - 2026-10-03

The first release of Heracles Records: a desktop companion for COROS athletes,
for reading your training in depth, planning it with an AI coach, and keeping a
record of everything you have achieved. It reads your watch through your COROS
account; it is not made or endorsed by COROS.

### Training

- **Overview** — today's readiness, the week's load and what is planned next, in one screen.
- **Activities** — every session COROS has, in one list with a detail pane, across all sports.
- **Running, Cycling and Hiking** — a screen per sport, each reading what that sport is about: pace, efficiency and drift for runs (and climb for trail runs), power, IF, TSS and climbs for rides, ascent, moving time, rests and terrain for hikes.
- **Strength** — COROS strength sessions merged with Hevy workouts, with a muscle heat map.
- **Sleep** — nights, naps, stages, heart rate and HRV, kept beyond the nine weeks COROS holds.

### Planning

- **Calendar** — scheduled workouts and completed activities by week or month; drag a session to move it.
- **Training Library** — your COROS workouts and plans: read, build, edit, duplicate and put plans on the calendar, saved straight to your COROS account.
- **Coach** — an AI coach that reads your COROS data and answers in charts, drafts workouts and multi-week plans, and proposes calendar changes you apply one line at a time. Runs on your ChatGPT account, your Claude subscription, a Claude or OpenRouter API key, or a local model. Scheduled analyses can debrief new activities on their own, read-only.

### Your journey

- **Hall of Records** — every milestone you have reached, month by month, and the Twelve Labours: twelve kinds of achievement in three stages each, with speed and VO₂max graded for your age and sex.
- **Where you've been** — every place you trained, on a globe.

### Your data

- **Sync through Google Drive** — conversations, plans and preferences stay the same on every computer signed in to the same COROS account. Sign-ins never leave the machine they were made on.
- **Backup and restore** — one file you keep, restorable into the COROS account that made it.
- Light and dark themes, a choice of accent colours, per-sport colours, metric and imperial units.
- **Report an issue** from Settings → About, with a redacted log of recent errors to copy.
