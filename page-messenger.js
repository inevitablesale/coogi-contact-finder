console.log("Coogi Extension (In-Page): Announcing presence with 'coogi-extension-ready' event.");
window.dispatchEvent(new CustomEvent('coogi-extension-ready'));

// Listen for pings from the app
window.addEventListener('coogi-app-ready', () => {
  console.log("Coogi Extension (In-Page): Received app ping, notifying extension...");
  chrome.runtime.sendMessage({ action: 'APP_READY' });
});

// Listen for extension status and forward to the app
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'EXTENSION_ACK') {
    window.dispatchEvent(new CustomEvent('coogi-extension-response', { detail: message.payload }));
  }
});
