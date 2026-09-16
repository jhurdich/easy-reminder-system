# Expanded task options

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

This repository serves the frontend through GitHub Pages, but GitHub Pages does **not** deploy Firestore rules or Cloud Functions. The old rules reject the new fields. Do not publish just the HTML/JavaScript before deploying the matching rules.

1. Check out the feature branch locally and run the tests below. Review the changes to `firestore.rules` before production deployment. Existing owner-only access remains; guest emails grant no read/write permissions.
2. From an already-authorized Firebase development environment, install the function dependencies and deploy using the existing project/configuration:

   ```sh
   npm --prefix functions-correct install
   npx firebase-tools deploy --project easy-reminder-system --config firebase-deploy.json --only firestore:rules,functions:sendDueReminderNotifications
   ```

   The configuration explicitly deploys `nodejs22`; the package accepts Node.js 22+ for local tooling, including Node.js 24. Keep the `--config firebase-deploy.json` argument: it selects the correct function source and cloud runtime. Node.js 20 is deprecated according to [Google's runtime schedule](https://docs.cloud.google.com/run/docs/runtimes/function-runtimes).

   Confirm the scheduled function exists and the `reminders` collection-group query succeeds. Configure an index if Firebase asks for one. This can require a billing-enabled Firebase project and authorized deployment access. No deployment, billing change, or credential setup was performed by this change.

3. Merge the reviewed pull request to `main` and let the existing GitHub Pages deployment finish. Publish all changed frontend files, including `functions-correct/task-core.js`, `task-options.js`, `task-options.css`, and `reminder-worker.js`.
4. Reload the app and enable notifications. Confirm the status says that background push is registered. The new root-level `reminder-worker.js` fixes the previous registration path that pointed at a directory rather than a service-worker script. The old nested files are intentionally left untouched.
5. Verify FCM registration succeeds on the target browsers. The existing Firebase project's web-push/VAPID configuration still applies. If token registration fails, the UI explicitly reports page-active-only fallback; do not assume closed-page delivery is working.
6. Complete the production smoke checks below before treating the rollout as verified.

## Scheduling and compatibility

- Existing reminders remain readable. Editing upgrades a task to schema version 2 and preserves its document identity, completion state, and archive timestamp.
- Legacy reminders have no stored time zone. Their existing interval arithmetic is retained until edited. Their background summary uses UTC; review the selected zone when upgrading them.
- New daily/weekly/monthly/annual schedules use local wall time in the chosen IANA zone. Monthly events on the 31st skip months without a 31st; February 29 annual events run in leap years. Spring-forward wall times that do not exist are skipped. Ambiguous fall-back start times use the earlier instant. Review events whose end time falls in a clock-change gap.
- Custom schedules include the start date plus chosen dates, or each day from start through range end. Up to 366 dates / days are allowed. Completing a repeating task stops the entire series; reopening it resumes future alerts. To change a repeating task's time, edit it instead of snoozing the whole series.
- The one-minute backend scheduler delivers alerts within a five-minute recovery window and does not replay older missed notifications or those before the latest schedule edit. Delivery timing is best effort, subject to the OS, browser, permissions, network, and deployed scheduler.
- Scheduler leases reduce overlapping-job sends. Successful device deliveries are recorded separately; transient failures retry only pending devices. FCM transport is not an exactly-once guarantee. Stable notification tags replace duplicate displays where supported.
- The frontend local timer is a fallback only when push registration fails. A successfully registered device relies on the deployed backend; registration alone does not establish that backend scheduling works.
- Background messages are data-only, avoiding FCM's automatic notification plus a second custom display. See [Firebase's receive-message documentation](https://firebase.google.com/docs/cloud-messaging/web/receive-messages).
- Existing account-level notification settings and the 90-second idle sign-out behavior are retained. Enabling/disabling notifications affects that account's setting. Registered devices may still receive background reminders after sign-out unless notifications are disabled first.

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

Tests run production modules against isolated DOM/Firebase doubles. They cover authentication regressions, form/edit persistence, all-day input state, notification rows, custom dates/ranges, unsafe input rejection, time-zone/DST conversions, recurrence boundaries, summaries, scheduler deduplication/leases/retries, FCM batching, and the worker click URL. They do not send email, notifications, or production writes.

These are not browser-layout tests or a Firestore emulator validation. Neither a runnable browser nor the Firebase emulator was available in the authoring workspace. Rules deployment and end-to-end push delivery remain unverified.

## Production smoke checks

- Sign in with both providers. Create an in-person timed task and an Online all-day task. Reload, edit, and verify every field survives. Test narrow/mobile layout and keyboard access.
- Add 10-minute, 5-minute, and custom alerts. Create a task sufficiently far in the future so all selected alerts are still upcoming. Observe each once with the app open, then test with its tab closed. Check the function logs and device permissions.
- Test a different time zone, an overnight event, a daily series, a monthly 31st, custom individual dates, and a custom range. Check the preview and delivered times.
- Open the guest invitation draft without sending; confirm recipients, location, both times, and links. Confirm that saving alone did not email anybody. Check Drive access as a guest without changing sharing implicitly.
- Complete, edit, archive, and reopen a task. Confirm a title-only edit does not reset notification delivery identities. Confirm sign-out, provider switching, and account privacy still work.
- In the Firestore emulator or a staging project, verify owner writes of legacy and v2 tasks, rejection of unknown fields and invalid offsets, denial of another user's reads/writes, and denial of client writes to `notificationState`.

If rollback is needed, revert the frontend commit. The expanded rules still accept legacy reminders; retain the updated backend for any v2 tasks already saved until those schedules are deliberately migrated. Do not blindly overwrite existing user reminders.
