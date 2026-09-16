# Expanded task options

## Free-plan delivery

This version is for Firebase's no-cost **Spark** plan and GitHub Pages. It does not require a billing account, deploy Cloud Functions, register FCM tokens, or rely on Cloud Scheduler. Existing Firebase Authentication and Firestore synchronization remain subject to their free-plan quotas. Do not enable Blaze or attach a billing account for this version. See [Firebase's pricing-plan documentation](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

Reminders require the page to remain **open, signed in, and running on an awake device**. Closing the page, signing out, or suspending the browser stops delivery; background tabs may be delayed. There is no guaranteed closed-page delivery. See [browser timer throttling](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#timeouts_in_inactive_tabs).

Use **Enable page reminders** to opt in for the current account in this browser. This asks for browser notification permission only from that click. Every delivered alert also appears in **Recent reminders** inside the page. If permission is denied, the browser does not support notifications, or the notification constructor fails (including on many mobile browsers), in-page alerts still work. Saving tasks and signing in never ask for notification permission. See [browser notification limitations](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).

The existing 90-second inactivity sign-out still applies by default and stops alerts. **Keep me signed in while reminders are on (this tab only)** is an explicit, unchecked opt-in for trusted devices. It suppresses the inactivity timeout only while page reminders are enabled. Disabling reminders, unchecking the option, signing out, switching accounts, or reloading resets that behavior. There is no wake lock or attempt to prevent device sleep.

## Included

- Address or Online location; a description; an existing Google Meet/Zoom URL; a Google Drive/Docs attachment URL.
- Guest emails (up to 50), saved with the private task. **Draft invitation email** opens the user's email app with the task, location, date/time, time zone, and links. The user reviews and sends it. Saving/editing a task never sends email.
- **Google Calendar draft** opens an editable draft for the displayed occurrence, with guests and links. It is not an API-created event. Review its recurrence and alerts in Google Calendar before saving or sending invitations.
- Up to 20 notification rows: at start, 5/10/15/30 minutes, 1 hour, 1 day, or a custom whole-number number of minutes/hours/days before (maximum 365 days). Remove every row for no notifications. Duplicate timings are collapsed.
- All-day tasks, inclusive start/end dates, overnight tasks, and IANA time zones. All-day alerts are relative to midnight in the task's zone, not 9 AM.
- Does not repeat, daily, weekly, monthly, annually, and custom individual dates or inclusive daily date ranges. The original every-X-minutes/hours/days/weeks choices remain available.
- Home, Work, Personal, Family, Religion, Health, Finances, Errands, Shopping, Travel, Learning, Fitness, Social, Admin, Planning, Someday / Maybe, and typed custom categories. Categories appear in task metadata, search, and the existing sidebar filter list.
- A notification summary preview and matching delivered summary: task, address/Online, start/end or all-day dates, and time zone.

## Deliberate integration boundaries

This version uses links and explicit drafts. It does **not** automatically send email, track RSVPs, create Meet rooms, create Zoom meetings, or browse/upload Drive files. It never changes Drive sharing permissions. No additional OAuth scopes, mail-provider credentials, or guest data are sent by saving a task.

Automatic Google Calendar guest invitations and Meet creation require an authorized Calendar API integration, appropriate scopes, `sendUpdates`, and `conferenceDataVersion=1` / `createRequest`. See [Google's event creation documentation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## Deploy in this order

This repository serves the frontend through GitHub Pages, but GitHub Pages does **not** deploy Firestore rules. The old rules reject the new fields. Do not publish just the HTML/JavaScript before deploying the matching rules.

1. Check out the feature branch locally and run the tests below. Review the changes to `firestore.rules` before production deployment. Existing owner-only access remains; guest emails grant no read/write permissions.
2. From an already-authorized Firebase development environment, deploy **only the Firestore rules**:

   ```sh
   npx firebase-tools deploy --project easy-reminder-system --config firebase-deploy.json --only firestore:rules
   ```

   No `npm --prefix functions-correct install`, function deployment, Cloud Build, Artifact Registry, or Cloud Scheduler setup is needed. The latest `firebase-deploy.json` includes **only** Firestore rules. Keep `--config firebase-deploy.json` because the repository's older default configuration is not the supported deployment path. Never retry the previous combined `firestore:rules,functions:sendDueReminderNotifications` command for this free-plan release.

   The already-downloaded `7d1c0885de01ad37f6baecac9effa2dd83f39103` archive has identical `firestore.rules`. You can run the rules-only command from that folder without another download: the explicit `--only firestore:rules` excludes its old Functions configuration. Wait for a successful rules deployment before merging the frontend update.

   If the command asks for a billing upgrade, deletion, or expanded permissions, stop and inspect the prompt; do not accept it automatically. No billing change, production deployment, or credential setup was performed by this code update.

3. Merge the reviewed pull request to `main` and let the existing GitHub Pages deployment finish. Publish all changed frontend files, including `functions-correct/task-core.js`, `task-options.js`, and `task-options.css`. The shared `task-core.js` is plain browser JavaScript; its folder name does not require deploying a function.
4. Reload the app and confirm the **Free plan · page reminders** panel. Sign in and enable page reminders. Optionally choose the trusted-device keep-signed-in checkbox if you need alerts after 90 seconds without interacting.
5. Complete the production smoke checks below before treating the rollout as verified.

The earlier backend, its dependency files, and old push worker source remain in the repository for history; they are **inactive in the free-plan app**. The frontend no longer imports Firebase Messaging, registers a service worker, reads account-level push preferences, or writes notification tokens. Existing saved tasks and legacy push records are not deleted. If a scheduler was separately deployed in another environment, this frontend change does not delete that cloud resource; review it separately. In the reported rollout the backend deployment stopped at the Spark-plan billing requirement.

## Scheduling and compatibility

- Existing reminders remain readable. Editing upgrades a task to schema version 2 and preserves its document identity, completion state, and archive timestamp.
- Legacy reminders have no stored time zone. Their existing interval arithmetic is retained until edited. Review the selected zone when upgrading them.
- New daily/weekly/monthly/annual schedules use local wall time in the chosen IANA zone. Monthly events on the 31st skip months without a 31st; February 29 annual events run in leap years. Spring-forward wall times that do not exist are skipped. Ambiguous fall-back start times use the earlier instant. Review events whose end time falls in a clock-change gap.
- Custom schedules include the start date plus chosen dates, or each day from start through range end. Up to 366 dates / days are allowed. Completing a repeating task stops the entire series; reopening it resumes future alerts. To change a repeating task's time, edit it instead of snoozing the whole series.
- The open page checks every 15 seconds and when focus/visibility returns, using a five-minute recovery window. Older missed alerts and alerts predating a schedule edit are not replayed. This is best effort, not an exact-time guarantee. No notification checks poll Firestore or call a backend.
- The enable preference and recent delivery receipts are stored locally, scoped to the signed-in account. Receipts contain task/delivery identifiers and times, not summaries or guest emails. They suppress repeat deliveries in one tab, across reloads, and in sequential checks from other tabs. Simultaneous checks in multiple tabs can still duplicate an alert: keep one reminder tab open. Clearing browser storage removes preferences and duplicate protection.
- If local storage is blocked, delivery still works with in-memory duplicate protection and the UI explains that settings last for the session. Receipts expire after one day; up to 2,000 are persisted. The in-page list retains the ten most recent alerts for the current sign-in session. Dismissing the list does not re-arm a sent occurrence.
- Signing out or switching accounts clears private in-page alerts and closes browser notifications created by this page. A pending notification-permission request or an older account's late task load cannot enable or deliver alerts for another account.
- Existing Firestore task sync remains: tasks load on sign-in and local edits are saved. Reload to pick up another device's edits; this release does not add paid polling or an always-on synchronization service. Refresh also resets the trusted-device session checkbox.

## Automated checks

From the repository root (Node.js 22+):

```sh
node --input-type=module --check < reminder-system.js
node --check task-options.js
node --check reminder-worker.js
node --check functions-correct/task-core.js
node --check functions-correct/index.js
node --experimental-vm-modules --test tests/auth.test.cjs tests/task-core.test.cjs tests/notifications.test.cjs
```

Tests run production modules against isolated DOM/Firebase doubles. They cover authentication regressions, form/edit persistence, all-day input state, notification rows, custom dates/ranges, unsafe input rejection, time-zone/DST conversions, recurrence boundaries, summaries, free-plan deployment configuration, page-alert delivery, denied permission, unsupported native notifications, blocked storage, reload duplicate suppression, multiple offsets, disabled/completed tasks, session opt-in, and account-switch races. The retained historical backend and worker tests also continue to pass but those components are not deployed. Tests do not send email, real notifications, or production writes.

These are not browser-layout tests or a Firestore emulator validation. Neither a runnable browser nor the Firebase emulator was available in the authoring workspace. The same rules compiled successfully in the user's previous deployment attempt, but actual rules publication and real-browser notification delivery still need confirmation.

## Production smoke checks

- Sign in with both providers. Create an in-person timed task and an Online all-day task. Reload, edit, and verify every field survives. Test narrow/mobile layout and keyboard access.
- Add 10-minute, 5-minute, and custom alerts. Create a task sufficiently far in the future so all selected alerts are still upcoming. Keep a single tab open, signed in, and the device awake. Select the trusted-device checkbox for long tests. Observe each alert once, with task, place, and both times.
- Deny browser notification permission and verify in-page alerts still appear. Try a mobile browser without native page notifications. Test restricted browser storage. Refresh within five minutes after an alert and confirm a stored receipt prevents a duplicate; then reselect the session checkbox if needed.
- Confirm default inactivity sign-out after 90 seconds pauses alerts. Check the session option, wait over 90 seconds, and verify it stays signed in. Disable alerts or uncheck the option and verify auto sign-out returns. Sign out or switch accounts and verify private alert contents disappear.
- Close the page or put the device to sleep: no reliable delivery is expected. Reopen within five minutes to test limited catch-up; older alerts are not replayed. Do not describe this release as background push.
- Test a different time zone, an overnight event, a daily series, a monthly 31st, custom individual dates, and a custom range. Check the preview and delivered times.
- Open the guest invitation draft without sending; confirm recipients, location, both times, and links. Confirm that saving alone did not email anybody. Check Drive access as a guest without changing sharing implicitly.
- Complete, edit, archive, and reopen a task. Confirm a title-only edit does not reset notification delivery identities. Confirm sign-out, provider switching, and account privacy still work.
- In the Firestore emulator or a staging project, verify owner writes of legacy and v2 tasks, rejection of unknown fields and invalid offsets, denial of another user's reads/writes, and denial of client writes to `notificationState`.

If rollback is needed, review the target version first: reverting to a push-dependent frontend will not restore background reminders on Spark. The expanded rules still accept legacy reminders. Do not overwrite existing user reminders or enable a paid backend as part of a rollback without a separate decision.
