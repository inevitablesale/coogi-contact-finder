// This script runs in the main world of the web page.
// It announces that the extension's page script is ready.
console.log("Coogi Extension (In-Page): Announcing presence with 'coogi-extension-ready' event.");
window.dispatchEvent(new CustomEvent('coogi-extension-ready'));
