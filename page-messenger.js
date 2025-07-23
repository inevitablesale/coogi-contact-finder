// page-messenger.js
console.log("Coogi Extension (In-Page): Announcing presence with 'coogi-extension-ready' event.");

// Notify the web app that the extension is present
window.dispatchEvent(new CustomEvent('coogi-extension-ready'));

// ✅ Listen for web app pings
window.addEventListener('coogi-app-ready', () => {
  console.log("Coogi Extension (In-Page): Received ping from app → notifying extension.");
  chrome.runtime.sendMessage({ action: 'APP_READY' });
});

// ✅ Receive extension responses and forward to web app
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'EXTENSION_ACK') {
    console.log("Coogi Extension (In-Page): Got ACK from extension → notifying app.");
    window.dispatchEvent(new CustomEvent('coogi-extension-response', { detail: message.payload }));
  }
});
