// Loads the installed SDKs and the production export without running the job.
// No Firestore queries, notification sends, or deployment are performed.
const assert = require("node:assert/strict");
const { sendDueReminderNotifications } = require("./index.js");

assert.equal(typeof sendDueReminderNotifications, "function");
assert.equal(typeof sendDueReminderNotifications.run, "function");
assert.equal(sendDueReminderNotifications.__endpoint.platform, "gcfv2");
assert.equal(sendDueReminderNotifications.__endpoint.scheduleTrigger.schedule, "every 1 minutes");
console.log("Firebase SDK load check passed. No reminders were sent.");
