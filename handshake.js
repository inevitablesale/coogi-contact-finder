// handshake.js
console.log("Coogi Extension: Handshake script injected and running.");

const extensionId = chrome.runtime.id;

const event = new CustomEvent('coogi-extension-ready', {
  detail: { extensionId },
});

window.dispatchEvent(event);

console.log(`Coogi Extension: Dispatched 'coogi-extension-ready' event with ID: ${extensionId}`);
