// handshake.js
console.log("Coogi Extension: Handshake content script injecting page messenger.");

// Inject the extension ID into the DOM so the web app can access it.
document.body.setAttribute('data-coogi-extension-id', chrome.runtime.id);

const script = document.createElement('script');
// Get the URL of the messenger script from the extension's resources.
script.src = chrome.runtime.getURL('page-messenger.js');
// Append the script to the document's head.
(document.head || document.documentElement).appendChild(script);
// The script will load and execute, so we can remove the tag from the DOM.
script.remove();
