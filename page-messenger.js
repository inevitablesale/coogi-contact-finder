// This script runs in the main world of the web page.
console.log("Coogi Extension (In-Page): Messenger script loaded.");

const listener = () => {
  console.log("Coogi Extension (In-Page): Received app ping. Responding with handshake.");
  window.dispatchEvent(new CustomEvent('coogi-extension-ready'));
  // Clean up the listener after it has done its job.
  window.removeEventListener('coogi-app-ready', listener);
};

window.addEventListener('coogi-app-ready', listener);
console.log("Coogi Extension (In-Page): Messenger is now listening for the app's ping.");
