// handshake.js
console.log("Coogi Extension: Handshake content script injected.");

/**
 * This function is the "messenger" that will be injected into the web page's main world.
 * It listens for the app's ping and dispatches a response that the app can hear.
 */
function injectCode() {
  const listener = () => {
    console.log("Coogi Extension (In-Page): Received app ping. Responding with handshake.");
    window.dispatchEvent(new CustomEvent('coogi-extension-ready'));
    // Clean up the listener after it has done its job.
    window.removeEventListener('coogi-app-ready', listener);
  };

  window.addEventListener('coogi-app-ready', listener);
  console.log("Coogi Extension (In-Page): Messenger is now listening for the app's ping.");
}

// Create a <script> tag to inject the messenger function into the page
const script = document.createElement('script');
// Set the script's content to our messenger function, making it an IIFE so it runs immediately.
script.textContent = `(${injectCode.toString()})();`;
// Append the script to the document's head.
(document.head || document.documentElement).appendChild(script);
// The script has already run, so we can remove it from the DOM.
script.remove();
