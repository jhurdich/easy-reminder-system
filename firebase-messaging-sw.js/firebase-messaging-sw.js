importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCe3qaOFx6ey5LAghth8l2cQ9VonSY7hnQ",
  authDomain: "easy-reminder-system.firebaseapp.com",
  projectId: "easy-reminder-system",
  storageBucket: "easy-reminder-system.firebasestorage.app",
  messagingSenderId: "502381230653",
  appId: "1:502381230653:web:8a0162b42b25d5356e4854"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || "Easy Reminder", {
    body: notification.body || "Your reminder is due now.",
    tag: payload.data?.reminderId || "easy-reminder",
    data: { url: self.location.origin + "/easy-reminder-system/reminder-system.html" }
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const existing = list.find(client => client.url.includes("reminder-system.html"));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});
