// page-messenger.js
console.log("Coogi Extension (In-Page): Messenger loaded and waiting for app.");

// Listen for the app to announce it's ready
window.addEventListener('coogi-app-ready', () => {
  console.log("Coogi Extension (In-Page): Received 'coogi-app-ready'. Responding.");
  
  // Respond by dispatching the extension's presence event
  window.dispatchEvent(new CustomEvent('coogi-extension-ready', {
    detail: {
      extensionId: document.body.getAttribute('data-coogi-extension-id')
    }
  }));
}, { once: true }); // Only need to respond once
