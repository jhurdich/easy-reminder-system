const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
const intervals = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };

exports.sendDueReminderNotifications = onSchedule("every 1 minutes", async () => {
  const now = Date.now();
  const snapshot = await db.collectionGroup("reminders").where("done", "==", false).get();
  const jobs = [];
  for (const reminderDoc of snapshot.docs) {
    const reminder = reminderDoc.data();
    const due = Date.parse(reminder.next);
    if (!Number.isFinite(due) || due > now) continue;
    const repeatInterval = intervals[reminder.repeat];
    const occurrence = reminder.repeat === "once" ? 0 : Math.floor((now - due) / ((Number(reminder.amount) || 1) * repeatInterval));
    const userRef = reminderDoc.ref.parent.parent;
    if (!userRef) continue;
    const setting = await userRef.collection("settings").doc("notifications").get();
    if (!setting.exists || setting.data().enabled !== true) continue;
    const stateRef = reminderDoc.ref.collection("notificationState").doc("delivery");
    const state = await stateRef.get();
    if (state.exists && state.data().occurrence >= occurrence) continue;
    jobs.push((async () => {
      const tokenSnapshot = await userRef.collection("notificationTokens").get();
      const tokens = tokenSnapshot.docs.map(d => d.data().token).filter(Boolean);
      if (!tokens.length) return;
      const response = await messaging.sendEachForMulticast({ tokens, notification: {
        title: reminder.title || "Easy Reminder",
        body: "Your reminder is due now." + (reminder.note ? " " + reminder.note : "")
      }, data: { reminderId: reminderDoc.id } });
      const invalid = response.responses.map((result, index) => !result.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(result.error?.code) ? tokens[index] : null).filter(Boolean);
      await Promise.all(invalid.map(token => userRef.collection("notificationTokens").doc(encodeURIComponent(token).slice(0, 150)).delete()));
      await stateRef.set({ occurrence, sentAt: admin.firestore.FieldValue.serverTimestamp() });
    })());
  }
  await Promise.all(jobs);
  logger.info("Processed " + jobs.length + " due reminder notification(s).");
});
