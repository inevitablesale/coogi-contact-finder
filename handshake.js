// handshake.js
console.log("Coogi Extension: Handshake content script injecting page messenger.");

// Expose the extension ID to the page
document.body.setAttribute('data-coogi-extension-id', chrome.runtime.id);

// Inject page-messenger.js into the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-messenger.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();
