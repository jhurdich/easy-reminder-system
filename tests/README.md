# Authentication regression checks

Run from the repository root with Node.js 24. No package installation is required:

```sh
node --input-type=module --check < reminder-system.js
node --experimental-vm-modules --test tests/auth.test.cjs
```

These checks execute the entire production JavaScript as an ES module with Firebase
and DOM test doubles. They cover module startup, both popup providers, focus changes
while login is pending, duplicate clicks, real SDK error codes, retry, successful
auth-state handling, restricted session storage, and required CSP source entries.
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
