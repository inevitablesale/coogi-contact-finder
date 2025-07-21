// handshake.js
console.log("Coogi Extension: Handshake content script injecting page messenger.");

const script = document.createElement('script');
// Get the URL of the messenger script from the extension's resources.
script.src = chrome.runtime.getURL('page-messenger.js');
// Append the script to the document's head.
(document.head || document.documentElement).appendChild(script);
// The script will load and execute, so we can remove the tag from the DOM.
script.remove();
