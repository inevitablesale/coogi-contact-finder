// page-messenger.js
console.log("Coogi Extension (In-Page): Messenger loaded. Announcing presence.");

// Announce that the extension is ready and pass its ID.
// The web app will be listening for this single event.
window.dispatchEvent(new CustomEvent('coogi-extension-ready', {
  detail: {
    extensionId: document.body.getAttribute('data-coogi-extension-id')
  }
}));
