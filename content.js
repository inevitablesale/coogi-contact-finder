if (typeof window.coogiContentScriptLoaded === 'undefined') {
  window.coogiContentScriptLoaded = true;

  const log = (level, ...args) => {
    try {
      chrome.runtime.sendMessage({ type: 'log', level, args });
    } catch (e) {
      // Extension context might be invalidated, ignore.
    }
  };

  function waitRandom(min, max) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    log('info', `Content script received action: ${message.action}`);

    if (message.action === "scrapeCompanySearchResults") {
      const { taskId, opportunityId } = message;
      log('info', `Extracting HTML from company search results page for task ${taskId}`);
      await waitRandom(2000, 4000); // Wait for page to be stable
      
      chrome.runtime.sendMessage({ 
        action: "companySearchResults", 
        taskId, 
        opportunityId, 
        html: document.documentElement.outerHTML 
      });
    }

    if (message.action === "scrapeEmployees") {
      const { taskId, opportunityId } = message;
      log('info', `Extracting HTML from employee/people page for task ${taskId}`);
      await waitRandom(3000, 5000); // Wait for page to be stable

      // For scraping employees, we also just send the HTML back.
      // The background script will decide whether to use the standard scraper or AI fallback.
      // In this case, we'll trigger the AI fallback directly.
      chrome.runtime.sendMessage({ 
        action: "scrapingFailed", // This message triggers the AI HTML parser in background.js
        taskId, 
        opportunityId
      });
    }
    // Acknowledge the message was received.
    sendResponse({ status: "acknowledged" });
    return true;
  });
}
