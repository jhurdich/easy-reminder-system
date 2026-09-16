const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { createHash, randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const core = require("./task-core.js");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const hash = value => createHash("sha256").update(value).digest("hex");

// Shared by browser fallback and push, so offsets/recurrence use identical semantics.
exports.sendDueReminderNotifications = onSchedule("every 1 minutes", async () => {
  const now = Date.now();
  const snapshot = await db.collectionGroup("reminders").where("done", "==", false).get();
  for (const reminderDoc of snapshot.docs) {
    if (!/^users\/[^/]+\/reminders\/[^/]+$/.test(reminderDoc.ref.path)) continue;
    let leaseId, stateRef;
    try {
      const reminder = reminderDoc.data();
      const due = core.dueNotifications(reminder, now);
      if (!due.length) continue;
      const userRef = reminderDoc.ref.parent.parent;
      const setting = await userRef.collection("settings").doc("notifications").get();
      if (!setting.exists || setting.data().enabled !== true) continue;
      const tokenSnapshot = await userRef.collection("notificationTokens").get();
      const tokenDocs = tokenSnapshot.docs.filter(d => typeof d.data().token === "string");
      if (!tokenDocs.length) continue;
      stateRef = reminderDoc.ref.collection("notificationState").doc("delivery");
      leaseId = randomUUID();
      const delivery = await db.runTransaction(async transaction => {
        const current = await transaction.get(reminderDoc.ref);
        const state = await transaction.get(stateRef);
        if (!current.exists || current.data().done || current.data().scheduleVersion !== reminder.scheduleVersion ||
            current.data().next !== reminder.next || (state.exists && state.data().leaseUntil > now)) return null;
        const old = state.exists ? state.data().delivered || {} : {};
        const delivered = {};
        for (const item of due) {
          const id = hash(reminderDoc.id + ":" + item.id);
          delivered[id] = Array.isArray(old[id]) ? old[id] : [];
        }
        transaction.set(stateRef, { leaseId, leaseUntil: now + 120000, delivered });
        return delivered;
      });
      if (!delivery) continue;
      for (const item of due) {
        const deliveryId = hash(reminderDoc.id + ":" + item.id);
        const sent = new Set(delivery[deliveryId]);
        const pending = tokenDocs.filter(d => !sent.has(hash(d.data().token)));
        for (let i = 0; i < pending.length; i += 500) {
          const batch = pending.slice(i, i + 500);
          const response = await messaging.sendEachForMulticast({
            tokens: batch.map(d => d.data().token),
            // Data-only avoids a second, automatically displayed background notification.
            data: {
              title: String(reminder.title || "Easy Reminder").slice(0, 120),
              body: core.summary(reminder, item.start), reminderId: reminderDoc.id,
              userId: userRef.id, deliveryId
            },
            webpush: { headers: { TTL: "300" } }
          });
          for (let index = 0; index < response.responses.length; index++) {
            const result = response.responses[index];
            const invalid = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(result.error?.code);
            if (result.success || invalid) sent.add(hash(batch[index].data().token));
            if (invalid) await batch[index].ref.delete();
          }
          delivery[deliveryId] = [...sent];
          // Save successful recipients after every batch; retry only transient failures.
          await db.runTransaction(async transaction => {
            const state = await transaction.get(stateRef);
            if (state.exists && state.data().leaseId === leaseId) transaction.update(stateRef, { delivered: delivery });
          });
        }
      }
    } catch (error) {
      logger.error("Reminder notification failed", { reminderPath: reminderDoc.ref.path, code: error.code || "schedule-error" });
    } finally {
      if (stateRef && leaseId) {
        await db.runTransaction(async transaction => {
          const state = await transaction.get(stateRef);
          if (state.exists && state.data().leaseId === leaseId) transaction.update(stateRef, { leaseUntil: 0 });
        }).catch(error => logger.error("Could not release notification lease", { code: error.code }));
      }
    }
  }
});
