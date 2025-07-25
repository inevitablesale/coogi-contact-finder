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

  // This function is specific to COMPANY search results
  const extractCompanyResultsHtml = () => {
    const selector = '[data-view-name="search-entity-result-universal-template"]';
    const resultNodes = document.querySelectorAll(selector);
    if (resultNodes.length === 0) {
      log('warn', `No elements found with company selector: ${selector}. Sending full page HTML as fallback.`);
      return document.documentElement.outerHTML;
    }
    log('info', `Found ${resultNodes.length} company search result blocks. Extracting their HTML.`);
    return Array.from(resultNodes).map(node => node.outerHTML).join('\n');
  };

  // This is a new, specific function for PEOPLE search results
  const extractPeopleResultsHtml = () => {
    // Primary selector for "People" tab on a company page, based on user feedback.
    const primarySelector = '.org-people-profile-card__profile-card-spacing';
    let resultNodes = document.querySelectorAll(primarySelector);

    if (resultNodes.length > 0) {
      log('info', `Found ${resultNodes.length} people profile cards with primary selector. Extracting their HTML.`);
      return Array.from(resultNodes).map(node => node.outerHTML).join('\n');
    }

    // Fallback selector for general people search results.
    const fallbackSelector = '.reusable-search__result-container';
    resultNodes = document.querySelectorAll(fallbackSelector);
    
    if (resultNodes.length > 0) {
      log('info', `Found ${resultNodes.length} people search result blocks with fallback selector. Extracting their HTML.`);
      return Array.from(resultNodes).map(node => node.outerHTML).join('\n');
    }

    log('warn', `No elements found with primary ('${primarySelector}') or fallback ('${fallbackSelector}') people selectors. Sending full page HTML.`);
    return document.documentElement.outerHTML;
  };

  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    log('info', `Content script received action: ${message.action}`);
    
    if (message.action === "scrapeCompanySearchResults") {
      const { taskId, opportunityId } = message;
      log('info', `Extracting HTML from company search results page for task ${taskId}`);
      await waitRandom(2000, 4000); // Wait for page to be stable
      
      const resultsHtml = extractCompanyResultsHtml();
      
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

      const resultsHtml = extractPeopleResultsHtml();

      chrome.runtime.sendMessage({ 
        action: "peopleSearchResults",
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
