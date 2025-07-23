// handshake.js
console.log("Coogi Extension: Content script injecting messenger.");

// Inject the extension ID into the DOM so the web app can access it.
document.body.setAttribute('data-coogi-extension-id', chrome.runtime.id);

const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-messenger.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();
