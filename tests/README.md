# Authentication regression checks

Run from the repository root with Node.js 24. No package installation is required:

```sh
node --input-type=module --check < reminder-system.js
node --input-type=module --check < account-linking.js
node --experimental-vm-modules --test tests/*.test.cjs
```

These checks execute the entire production JavaScript as an ES module with Firebase
and DOM test doubles. They cover module startup, both popup providers, focus changes
while login is pending, duplicate clicks on the active provider, switching providers
in either direction, rapid switches back, stale cancellation after success or failure,
real SDK error codes, retry, successful auth-state handling, restricted session storage,
and required CSP source entries.
App Check remains initialized; tests make no requests to Firebase or OAuth providers.

The CSP entries follow Google's [reCAPTCHA guidance](https://developers.google.com/recaptcha/docs/faq#im-using-content-security-policy-csp-on-my-website-how-can-i-configure-it-to-work-with-recaptcha)
and Firebase's [popup loader](https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/src/platform_browser/iframe/gapi.ts)
and [script URLs](https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/src/platform_browser/index.ts).

These tests do not establish that a real popup opens, that a browser enforces CSP
as intended, or that production provider credentials, authorized domains, and App
Check settings are correct. After deployment, test both buttons in a regular browser:

1. Check the console for startup errors and CSP violations.
2. Click Continue with Google; return focus to the app while the popup is still
   open. The attempt should remain pending. Finish sign-in and confirm reminders load.
3. Sign out and repeat with Continue with Facebook.
4. Close a popup before completing sign-in. An error should appear without a reload,
   and both buttons should be usable again. Blocking popups should show instructions
   to allow them and retry.
5. Start Google sign-in, then choose Continue with Facebook on the app. The Google
   button should reset immediately and Firebase should replace its popup with Facebook
   sign-in. Repeat in the other direction and switch back rapidly; the latest attempt
   should remain active without an error from the replaced attempt.

The Firebase double models the previous-popup cancellation in Firebase's
[PopupOperation](https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/src/platform_browser/strategies/popup.ts).
Some tests deliberately delay that cancellation to verify that stale results cannot
reset the latest attempt's UI. Real provider switching still needs the browser check above.

Account-linking checks cover required reauthentication, same-UID linking, both provider
directions, expired verification, existing-account conflicts, duplicate clicks, and stale
results after sign-out/account changes. No database or account-deletion APIs are exposed
to these tests. Normal login tests also assert that no implicit account linking occurs.

Hosting checks cover route-specific headers (excluding Firebase's reserved OAuth helper
paths) and public-asset allowlist staging with synthetic fixtures. These do not test a
deployed CDN or real browser headers. None of these tests validate published Firestore
rules, App Check enforcement, API restrictions, backups, or real OAuth account linking.

Before enabling the new feature for users, use disposable provider accounts in a staging
project: sign in, verify the current account, link the second provider, record the UID,
then sign out and sign in with each provider. Confirm the same UID and test reminder are
returned. Test a credential belonging to another existing account: it must stop without
merging or deleting either account. Do not use the missing-task accounts for this test.

See [the deployment checklist](../docs/SECURITY-ROLLOUT.md) for the production gates.
