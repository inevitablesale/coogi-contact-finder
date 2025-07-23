console.log("[Coogi] Page Messenger injected → dispatching presence event");
window.dispatchEvent(new CustomEvent('coogi-extension-ready'));
document.dispatchEvent(new CustomEvent('coogi-extension-ready')); // ✅ Added fallback

// Listen for app ping and forward to content script
window.addEventListener('coogi-app-ready', () => {
  console.log("[Coogi] Got coogi-app-ready → posting message to content script");
  window.postMessage({ source: 'coogi-page', action: 'APP_READY' }, '*');
});

// Listen for extension ACK from content script
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.source === 'coogi-content' && event.data.action === 'EXTENSION_ACK') {
    console.log("[Coogi] Got EXTENSION_ACK → notifying web app");
    const ackEvent = new CustomEvent('coogi-extension-response', { detail: event.data.payload });
    window.dispatchEvent(ackEvent);
    document.dispatchEvent(ackEvent); // ✅ Added fallback
  }
});
