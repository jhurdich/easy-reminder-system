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

// Register click behavior before Firebase's listener.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL("./reminder-system.html", self.location.href).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const existing = list.find(client => client.url.startsWith(url));
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  // Older senders with a notification payload are displayed by FCM itself.
  if (payload.notification) return;
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "Easy Reminder", {
    body: data.body || "Your reminder is due.",
    tag: "easy-reminder-" + (data.deliveryId || data.reminderId || "task")
  });
});
