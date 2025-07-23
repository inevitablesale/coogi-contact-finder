console.log("[Coogi] Handshake content script running");

// Inject page-messenger.js into the webpage
const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-messenger.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

// Bridge: Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  if (event.data.source === 'coogi-page' && event.data.action === 'APP_READY') {
    console.log("[Coogi] Forwarding APP_READY to background");
    chrome.runtime.sendMessage({ action: 'APP_READY' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Coogi] Runtime error:", chrome.runtime.lastError.message);
        return;
      }
      // Send ACK back to page
      window.postMessage({ source: 'coogi-content', action: 'EXTENSION_ACK', payload: response }, '*');
    });
  }
});
