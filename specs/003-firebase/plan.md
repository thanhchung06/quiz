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
  profiles/{profileId}          role, name, avatar, grade, preferences, password, updatedAt;
                                a child's points beside it (profiles/{id}/points, set from the totals)
  categories/{id}               ┐ quiz bank — also cached on every device (§3),
  questions/{id}                ┘ updatedAt indexed for incremental pulls
  exercises/{id}                read online; practice list = allowPractice
  assignments/{childId}/{id}    exerciseSnapshot, availableFrom, deadline, tries (atomic +1), updatedAt
  sessions/{childId}            the ongoing exercise: questions snapshot + progress, updatedAt
  results/{childId}/{n}         full detail of a finished try (last 1000 per child), createdAt
  history/{childId}/{n}         short record of every finished try, append-only, createdAt,
                                totalEarned, totalStars; indexed by createdAt, assignmentId, practiceOf
  pointUsage/{childId}/{n}      points traded by the parent, append-only, createdAt, totalUsed
```

History, results and point uses are numbered per child (`0000000001`, `0000000002`, …, the key is the
record's id); a try's history row and result share its number. The next row is written at the last
row's number + 1 (`limitToLast(1)` on the key); rows can only be created, never overwritten, so when two
devices take the same number one write is refused and redone at the next. Running totals: each row adds
its points (and stars) to the previous row's. Reads ask for what they show (the last row, the last 7
tries, a date range, one assignment's last try, a page of point uses), never a whole list — except
results, all of which (≤ 1000) the learning-needs view reads.

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
- **Finishing an exercise** — read the last history row and the last point use, then one atomic
  multi-path update at n = last + 1: `history/c/n` (with totals), `results/c/n`, `results/c/(n − 1000)` =
  removed, `sessions/c` = removed, `assignments/c/id` = removed when passed or no tries left,
  `profiles/c/points` = totalEarned − totalUsed. Refused (n taken) → done again at the next number.
- **Starting:** `assignments/c/id/tries` += 1, then `sessions/c` is written.
- **Each answer:** `sessions/c/progress` + `updatedAt`. The running clock is saved every few seconds and
  when the app is hidden.
- **Point use:** the same way: `pointUsage/c/n` (with totalUsed) + `profiles/c/points` = totalEarned −
  totalUsed, one atomic update. Points are always set from the two totals, never added to or taken from.
- **"Tính lại điểm":** sets `profiles/c/points` again from the last history row and the last point use.
- **Backup:** export reads everything from Firebase; import (2.0 and old 1.0 files) writes everything; a
  child's tries and point uses only when the server has none for that child (renumbered, totals redone).

## 5. Scoring, stars, tries, sessions

Unchanged from specs/002 §3.3–3.5.

## 6. Removed

Apps Script + Sheet, outbox/writer/reader, hash chain, "Đồng bộ ngay", auto-sync settings, local tables
other than the quiz bank and settings.

## 7. Moving data

Export from the current app → install → import (writes to Firebase). Then delete the Apps Script and
the Sheet.
