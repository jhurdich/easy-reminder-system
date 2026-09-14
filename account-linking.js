import {
  GoogleAuthProvider, FacebookAuthProvider, onAuthStateChanged,
  reauthenticateWithPopup, linkWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Linking adds a login method to the captured UID. It never migrates tasks,
// merges accounts by email, deletes accounts, or stores OAuth credentials.
export function setupAccountLinking(auth) {
  const $ = id => document.getElementById(id);
  const methods = [
    { id: "google.com", name: "Google", button: $("linkGoogleBtn"), make: () => new GoogleAuthProvider() },
    { id: "facebook.com", name: "Facebook", button: $("linkFacebookBtn"), make: () => new FacebookAuthProvider() }
  ];
  const verifyButton = $("verifyAccountBtn");
  const message = $("linkAccountStatus");
  let account = null, generation = 0, busy = false, verifiedUntil = 0, expiryTimer = null;
  const verified = () => account && auth.currentUser?.uid === account.uid && Date.now() < verifiedUntil;
  const hasProvider = method => account?.providerData?.some(p => p.providerId === method.id);

  function forgetVerification() {
    verifiedUntil = 0;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function render() {
    const connected = methods.filter(hasProvider);
    $("linkedProviders").textContent = connected.length
      ? "Connected: " + connected.map(m => m.name).join(" and ")
      : "Sign in with Google or Facebook to manage login methods.";
    verifyButton.disabled = busy || !connected.length || connected.length === methods.length || Boolean(verified());
    verifyButton.textContent = verified() ? "Account verified" : "Verify current account first";
    for (const method of methods) {
      const linked = hasProvider(method);
      method.button.disabled = busy || !verified() || linked;
      method.button.textContent = linked ? method.name + " connected" : "Link " + method.name;
    }
  }

  function errorMessage(error) {
    const code = error?.code || "unknown";
    const explanations = {
      "auth/credential-already-in-use": "That login belongs to a separate account. Nothing was merged or deleted. Keep both accounts; back up and review their tasks before any consolidation.",
      "auth/email-already-in-use": "That email belongs to a separate account. Nothing was merged or deleted. Keep both accounts; back up and review their tasks before any consolidation.",
      "auth/account-exists-with-different-credential": "A separate account already uses this email. Nothing was merged or deleted. Sign in with its original provider to review it.",
      "auth/user-mismatch": "Verification must use the account you are currently signed into.",
      "auth/popup-blocked": "Allow popups for this site and try again.",
      "auth/popup-closed-by-user": "The popup was closed. Verify your current account and check connected methods before retrying.",
      "auth/cancelled-popup-request": "Cancelled. Verify your current account to start again.",
      "auth/provider-already-linked": "This provider is already linked to this account.",
      "auth/requires-recent-login": "Verify your current account again before linking.",
      "auth/operation-not-allowed": "This provider must be enabled in Firebase Authentication first."
    };
    return (explanations[code] || "Could not complete linking. Verify your account and try again.") + " [" + code + "]";
  }

  function ownsAttempt(token, uid) {
    return token === generation && account?.uid === uid && auth.currentUser?.uid === uid;
  }

  verifyButton.onclick = async () => {
    if (busy || !account || auth.currentUser?.uid !== account.uid) return;
    const method = methods.find(hasProvider);
    if (!method || methods.every(hasProvider)) return;
    const captured = account, token = generation;
    forgetVerification();
    busy = true;
    message.textContent = "Verify the current " + method.name + " account in the popup. Then choose the login method to link.";
    render();
    try {
      // Keep this call directly in the click handler to retain popup activation.
      const result = await reauthenticateWithPopup(captured, method.make());
      if (!ownsAttempt(token, captured.uid)) return;
      if (result.user.uid !== captured.uid) throw { code: "auth/user-mismatch" };
      verifiedUntil = Date.now() + 60000;
      expiryTimer = setTimeout(() => {
        forgetVerification();
        if (!busy) {
          message.textContent = "Verification expired. Verify your current account again to link a login.";
          render();
        }
      }, 60000);
      message.textContent = "Verified. Choose Link Google or Link Facebook within one minute. This will keep your current reminder account.";
    } catch (error) {
      if (ownsAttempt(token, captured.uid)) message.textContent = errorMessage(error);
    } finally {
      if (ownsAttempt(token, captured.uid)) { busy = false; render(); }
    }
  };

  for (const method of methods) {
    method.button.onclick = async () => {
      if (busy || hasProvider(method)) return;
      if (!verified()) {
        forgetVerification();
        message.textContent = "Verify your current account before linking another login.";
        render();
        return;
      }
      const captured = account, token = generation;
      // Consume verification for this one explicit linking attempt.
      forgetVerification();
      busy = true;
      message.textContent = "Linking " + method.name + " to your current reminder account…";
      render();
      try {
        const result = await linkWithPopup(captured, method.make());
        if (!ownsAttempt(token, captured.uid)) return;
        if (result.user.uid !== captured.uid) throw { code: "auth/user-mismatch" };
        account = result.user;
        message.textContent = method.name + " linked. Future sign-ins through either connected provider use this same reminder account. No tasks were moved or deleted.";
      } catch (error) {
        if (ownsAttempt(token, captured.uid)) message.textContent = errorMessage(error);
      } finally {
        if (ownsAttempt(token, captured.uid)) { busy = false; render(); }
      }
    };
  }

  onAuthStateChanged(auth, nextAccount => {
    if (account?.uid !== nextAccount?.uid) {
      generation++;
      forgetVerification();
      busy = false;
      message.textContent = "";
    }
    account = nextAccount;
    render();
  });
  render();
}
