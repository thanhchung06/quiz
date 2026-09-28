# Firebase online-first data — plan

Status: **agreed, being implemented.** Replaces the Apps Script + Google Sheet sync
(specs/002-sync-data-redesign) because of Apps Script's cold start.

## 1. Principles

- **Online-first.** Firebase Realtime Database (project `quiz-e411e`, region asia-southeast1) is the one
  place the data lives. Screens read and write it directly; there is no local copy to sync — except the
  quiz bank (§3).
- **Needs internet.** Without a connection the app shows "Mất kết nối" and waits (writes are held and
  sent when the connection is back, screens retry). There is no local-only mode anymore.
- **No Google login.** Each device signs in anonymously and automatically (Firebase Auth). Access is
  limited by security rules (`firebase/database.rules.json`) to one family path known to the app.
- **One record per row.** Per-child data sits under the child; nothing is packed into a JSON list.
- **Atomic counters.** Points and try counts change by Firebase's atomic increment, so two devices can't
  lose each other's changes.
- **Server times.** `updatedAt` / `createdAt` are stamped by Firebase (`now`), never by the device.

## 2. Data layout

```
families/<familyKey>/
  meta/quizVersion              write counter: +1 (atomic) on every question/category write
  profiles/{profileId}          role, name, avatar, grade, preferences, password, updatedAt
  points/{childId}              the child's spendable points (number; atomic +/−)
  categories/{id}               ┐ quiz bank — also cached on every device (§3),
  questions/{id}                ┘ updatedAt indexed for incremental pulls
  exercises/{id}                read online; practice list = allowPractice
  assignments/{childId}/{id}    exerciseSnapshot, availableFrom, deadline, tries (atomic +1), updatedAt
  sessions/{childId}            the ongoing exercise: questions snapshot + progress, updatedAt
  results/{childId}/{id}        full detail of a finished try (last 500 per child), createdAt
  history/{childId}/{id}        short record of every finished try, append-only, createdAt
  pointUsage/{childId}/{id}     points traded by the parent, append-only, createdAt
```

## 3. Quiz bank cache (the only synced part)

- Questions and categories are cached in IndexedDB on each device (fast search, building exercises,
  playing).
- App start: read `meta/quizVersion`. Same as the device's → nothing to do. Otherwise pull questions and
  categories with `updatedAt` newer than the device's last pull, then store the version.
- A question/category write goes to Firebase together with a +1 on `meta/quizVersion` (one atomic
  multi-path update), then to the local cache. The writing device reads the version before and after: if
  it was up to date before and the version moved by exactly 1, nobody else wrote in between, so it takes
  the new version (and its write's server time as pull cursor) — its next start doesn't re-download its
  own writes. Otherwise it keeps the old one and pulls at the next start.
- A question an exercise needs but the device lacks is fetched when the child starts.
- "Tải lại toàn bộ câu hỏi" re-downloads the whole bank.

## 4. Flows

- **App start:** anonymous sign-in (kept by the SDK) → quiz version check / pull → login enabled. Errors:
  message + "Thử lại".
- **Finishing an exercise** — one atomic multi-path update: `results/c/id`, `history/c/id`,
  `sessions/c` = removed, `assignments/c/id` = removed when passed or no tries left, `points/c` +=
  points when counted. Then results beyond 500 for the child are pruned.
- **Starting:** `assignments/c/id/tries` += 1, then `sessions/c` is written.
- **Each answer:** `sessions/c/progress` + `updatedAt`. The running clock is saved every few seconds and
  when the app is hidden.
- **Point use:** `pointUsage/c/id` + `points/c` −= n, one atomic update.
- **"Tính lại điểm":** points = Σ counted history − Σ point usage, written to `points/c`.
- **Backup:** export reads everything from Firebase; import (2.0 and old 1.0 files) writes everything.

## 5. Scoring, stars, tries, sessions

Unchanged from specs/002 §3.3–3.5.

## 6. Removed

Apps Script + Sheet, outbox/writer/reader, hash chain, "Đồng bộ ngay", auto-sync settings, local tables
other than the quiz bank and settings.

## 7. Moving data

Export from the current app → install → import (writes to Firebase). Then delete the Apps Script and
the Sheet.
