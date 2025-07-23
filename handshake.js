// handshake.js
console.log("Coogi Extension: Announcing presence by setting body attribute.");
// This is the simplest possible way to signal presence.
// The web app will look for this attribute.
document.body.setAttribute('data-coogi-extension-id', chrome.runtime.id);
