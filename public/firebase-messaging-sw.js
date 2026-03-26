/* eslint-disable no-undef */

// Usamos SDK compat sólo en el SW (es lo recomendado por Firebase)
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// ⚠️ MISMA CONFIGURACIÓN QUE EN src/firebase.js
firebase.initializeApp({
  apiKey: "AIzaSyD2lYmJzZBPydRCUXP2nyzGQkzoXs0dJi4",
  authDomain: "stock-urualum.firebaseapp.com",
  projectId: "stock-urualum",
  storageBucket: "stock-urualum.firebasestorage.app",
  messagingSenderId: "539303926650",
  appId: "1:539303926650:web:0e183219d06270652b14c3"
});

const messaging = firebase.messaging();

// Mensajes cuando la app está en BACKGROUND o CERRADA
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Background message recibido:", payload);

  const notification = payload.notification || {};
  const title = notification.title || "Nueva notificación";
  const options = {
    body: notification.body || "",
    icon: notification.icon || "/logo-urualum.png",
    data: {
      // click_action viene desde la Cloud Function
      click_action: notification.click_action || "/"
    }
  };

  self.registration.showNotification(title, options);
});

// Manejo del clic en la notificación
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.click_action || "https://app.urualum.uy";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña abierta de la app, la enfocamos
      for (const client of clientList) {
        if (client.url.includes("urualum") && "focus" in client) {
          return client.focus();
        }
      }
      // Si no, abrimos una nueva
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
