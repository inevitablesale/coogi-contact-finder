// handshake.js
console.log("Coogi Extension: Handshake script injected and listening for app ping.");

// Listen for the web app's "ready" signal
window.addEventListener('coogi-app-ready', () => {
  console.log("Coogi Extension: Received app ping. Responding with handshake.");

  // Respond to signal that the extension is ready
  const event = new CustomEvent('coogi-extension-ready');
  window.dispatchEvent(event);
}, { once: true });
