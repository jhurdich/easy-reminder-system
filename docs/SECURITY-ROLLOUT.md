# Security rollout: prepared code, pending console verification

This repository change does not establish the state of production Firebase settings.
No production rules, App Check enforcement, API-key restrictions, backups, billing,
OAuth configuration, or hosting deployments were changed by preparing this PR.

| Requested control | Prepared here | Evidence still required |
| --- | --- | --- |
| Published rules deny unauthenticated/cross-user reads | Existing rules retained unchanged | Published rules and controlled client read tests |
| Enforce App Check for Firestore | Existing Enterprise SDK retained | Representative metrics, console enforcement, valid/missing-token tests |
| Restrict the API key | Safe rollout guidance below | Actual API/referrer restrictions and login/refresh/read/write tests |
| Backups or PITR | Recovery and billing checkpoints below | Billing approval, enabled schedule/PITR, restore verification |
| Google/Facebook linking | Explicit reauthentication then same-UID linking | Real OAuth tests on disposable accounts |
| Move hosting and add headers | Optional Firebase Hosting configuration | Host choice, domain settings, staged deployment, HTTP/browser verification |

## 0. Preserve data before making changes

Do not delete or recreate either existing Firebase Authentication account. Linking is
not a recovery mechanism and does not automatically merge two existing UIDs. Review
both the legacy `users/<uid>` document and `users/<uid>/reminders` subcollection.
Obtain a backup/export before any future data consolidation. Do not restore directly
over the live database; restore to a separate target and inspect it first.

If data was deleted within the last hour, Firebase documents that enabling PITR within
that hour may permit recovery even if PITR was disabled. This is time-sensitive, requires
billing, and is not a promise that the missing task can be restored. No recovery has
been attempted here. See [PITR guidance](https://firebase.google.com/docs/firestore/use-pitr).

## 1. Confirm the published Firestore rules

In Firebase Console, select project `easy-reminder-system`, then Firestore Database →
Rules. Record the published rules and publication time; compare them with the unchanged
`firestore.rules` in this repository. A GitHub Pages deployment does not publish these rules.
If they differ, review the differences before publishing anything; do not blindly overwrite
production rules with an old copy.

Use the Rules Playground/emulator for initial checks, then controlled web-client checks
against the published rules using two disposable accounts and a non-sensitive test reminder.
Do not enumerate real users' data. Record each result:

| Request | Expected |
| --- | --- |
| Unauthenticated get/list under `users/A/reminders` | Denied |
| Account B get/list under `users/A/reminders` | Denied |
| Account A get/list its own reminders | Allowed |
| Unauthenticated/B get the legacy `users/A` document | Denied |
| Account A get its legacy `users/A` document | Allowed |
| Unauthenticated/B update or delete A's test reminder | Denied; test in emulator first |

The console Data tab and administrator/server SDKs are not evidence that client rules
work. An App Check rejection also does not prove that a Firestore ownership rule denied
access: use valid App Check tokens for the authenticated ownership tests. Do not disable
production enforcement to run tests. See [Firestore rules](https://firebase.google.com/docs/firestore/security/rules-conditions).

## 2. Review metrics before enforcing App Check

In Firebase Console → App Check, verify the registered web app uses the existing
reCAPTCHA Enterprise site key. Open the Cloud Firestore request metrics and inspect a
representative usage period, including both login providers, token refresh, and the planned
new host. Capture valid, invalid, and missing-token counts; investigate legitimate requests
in the latter categories before enforcement. Register all legitimate app/host variants.

Only after that review, enable enforcement for Cloud Firestore and verify that legitimate
reads/writes still succeed while controlled requests without valid attestation are rejected.
An empty graph or merely installing the SDK is not proof of protection. Never put debug
App Check tokens in production code. See [Enterprise setup and enforcement](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

## 3. Stage API-key restrictions without breaking OAuth

In Google Cloud Console → APIs & Services → Credentials, identify the browser key used
by this app. Save its current restrictions, check whether other apps share it, and test
proposed settings with a staging app/key before changing the production key.

Use Website (HTTP referrer) restrictions with exact required hosts, initially including:

- `https://jhurdich.github.io` and `https://jhurdich.github.io/*` for the existing app origin.
- `https://easy-reminder-system.firebaseapp.com` and `https://easy-reminder-system.firebaseapp.com/*`
  for the existing OAuth helper origin.
- The exact new Hosting and any temporary preview host after they are confirmed.

Do not allow all `github.io` or all `web.app` hosts. Cross-origin requests commonly send
only the origin, so a restriction to the repository's URL path alone can break requests.
The proposed Referrer-Policy preserves the origin for cross-origin HTTPS requests.
See [Google Cloud's browser-restriction patterns](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys).

Review the [official Firebase API allowlist](https://firebase.google.com/docs/projects/api-keys)
for the products used: Authentication, App Check, and Firestore. In particular, retain
Identity Toolkit (`identitytoolkit.googleapis.com`), Token Service
(`securetoken.googleapis.com`), and Firebase App Check (`firebaseappcheck.googleapis.com`).
Review the listed Firestore, Datastore, Firebase Management, and Logging APIs as well.
Do not blindly replace the allowlist with only two or three API names. Remove unrelated
billable APIs, especially Generative Language/Gemini, from this publicly visible key.

Test Google and Facebook login, refresh, reauthentication, linking, reminder save/load,
and App Check after the change. If a required service is blocked, restore its specific
permission; do not broadly remove all key restrictions. Keep the old and new origins
working through migration, then remove obsolete referrers only after cutover.

## 4. Enable a recovery facility only after billing approval

Review the database's existing recovery settings first. PITR requires a billed project
and incurs storage charges. Confirm billing approval and the desired recovery window
before enabling it. If chosen, Google Cloud Console → Firestore → Databases → select
the database → Disaster Recovery → Edit → Enable point-in-time recovery → Save.

Alternatively, review scheduled backups and choose an approved schedule/retention period.
Record the enabled setting and verify an actual recoverable time/backup plus a restore
to a separate database. Enabling a feature now is not evidence that an older task is
recoverable. Never disable and re-enable existing PITR as a troubleshooting step.
See [PITR](https://firebase.google.com/docs/firestore/use-pitr) and
[scheduled backups](https://firebase.google.com/docs/firestore/backups).

## 5. Roll out linking without merging existing accounts

The signed-in screen adds Sign-in methods. First use Verify current account, then click
the other provider's Link button within one minute. Verification is a client-UI safeguard,
not a replacement for Firebase's server-side token and account security. Each operation
captures the original UID and ignores stale UI results after an account change.

If the second credential is already used by another Firebase UID, the feature stops with
instructions to retain both accounts. It does not delete, unlink, move tasks, or merge by
matching email addresses. Existing split accounts require a separate backed-up data and
identity review; this PR intentionally does not consolidate them. See [account linking](https://firebase.google.com/docs/auth/web/account-linking).

Complete the real OAuth tests in `tests/README.md` before production rollout. Retain the
original login method throughout the test and do not test on accounts with missing tasks.

## 6. Optional Firebase Hosting migration

Firebase Hosting is the proposed destination because the app already uses Firebase and
it supports response headers. Confirm that choice and inspect the existing Hosting site
before deploying. Do not overwrite another app. Keep the same Firebase project, authDomain,
database, and user IDs. Do not create a replacement Firebase project to move hosting.

`firebase.json` stages only seven public assets with `scripts/build-hosting.cjs`.
Rules, tests, documents, and configuration files are excluded from the upload. It has no
Firestore deployment configuration. GitHub Pages does not interpret this configuration.
The index keeps its existing meta refresh and link; the redundant inline redirect script
is removed so response CSP can forbid inline scripts.

Prepare a preview using an approved, authenticated Firebase CLI environment. After the
new exact hostname is known, add it to Firebase Authentication authorized domains,
reCAPTCHA Enterprise allowed domains, and the browser key's referrer allowlist. Preserve
the OAuth helper domain and confirm Google/Facebook authorized redirect URIs. Never
change those settings to permissive wildcards just to make a preview work.

After confirming the target project/site and billing terms:

```sh
node --experimental-vm-modules --test tests/*.test.cjs
node scripts/build-hosting.cjs
firebase hosting:channel:deploy security-review --expires 1d --project easy-reminder-system
```

The predeploy script builds the asset allowlist. Run the real sign-in, switching, linking,
save/read, sign-out, and App Check checks on that exact preview host. Inspect response
headers on `/`, `reminder-system.html`, and both JavaScript files. Confirm CSP (including
`frame-ancestors 'none'`), X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
Permissions-Policy, and HSTS. Confirm Firebase's reserved `/__/auth/` helper routes remain
usable: the custom header matcher deliberately excludes them. Do not add restrictive COOP
or COEP without separate OAuth compatibility testing.

Firebase overrides custom HSTS values on its default subdomains; inspect the actual
response rather than assuming the configured value is returned. See [Hosting headers](https://firebase.google.com/docs/hosting/full-config#headers).

Only after the preview passes and the new URL is approved, publish hosting explicitly:

```sh
firebase deploy --only hosting --project easy-reminder-system
```

Verify the production response headers and functional checks again. Then separately approve
updating links/redirecting the old Pages site. Until that final step, retain Pages as the
working fallback and retain its authorized domain/referrer entries. A hosting rollback must
not roll back or delete Firestore data. No live migration is performed by this PR.
