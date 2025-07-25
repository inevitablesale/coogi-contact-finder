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
    
    const extractResultsHtml = () => {
      const resultNodes = document.querySelectorAll('[data-view-name="search-entity-result-universal-template"]');
      if (resultNodes.length === 0) {
        log('warn', 'No elements found with selector [data-view-name="search-entity-result-universal-template"]. Sending full page HTML as fallback.');
        return document.documentElement.outerHTML;
      }
      log('info', `Found ${resultNodes.length} search result blocks. Extracting their HTML.`);
      return Array.from(resultNodes).map(node => node.outerHTML).join('\n');
    };

    if (message.action === "scrapeCompanySearchResults") {
      const { taskId, opportunityId } = message;
      log('info', `Extracting HTML from company search results page for task ${taskId}`);
      await waitRandom(2000, 4000); // Wait for page to be stable
      
      const resultsHtml = extractResultsHtml();
      
      chrome.runtime.sendMessage({ 
        action: "companySearchResults", 
        taskId, 
        opportunityId, 
        html: resultsHtml
      });
    }

    if (message.action === "scrapeEmployees") {
      const { taskId, opportunityId } = message;
      log('info', `Extracting HTML from employee/people page for task ${taskId}`);
      await waitRandom(3000, 5000); // Wait for page to be stable

      const resultsHtml = extractResultsHtml();

      chrome.runtime.sendMessage({ 
        action: "scrapingFailed", // This message triggers the AI HTML parser in background.js
        taskId, 
        opportunityId,
        html: resultsHtml
      });
    }
    // Acknowledge the message was received.
    sendResponse({ status: "acknowledged" });
    return true;
  });
}
