// handshake.js
console.log("Coogi Extension: Handshake script injected and listening for app ping.");

const extensionId = chrome.runtime.id;

// Listen for the web app's "ready" signal
window.addEventListener('coogi-app-ready', () => {
  console.log("Coogi Extension: Received app ping. Responding with handshake.");

  // Respond with the extension ID
  const event = new CustomEvent('coogi-extension-ready', {
    detail: { extensionId },
  });
  window.dispatchEvent(event);
}, { once: true }); // Use { once: true } to ensure we only respond once.
