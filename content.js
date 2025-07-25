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

  async function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const interval = 100;
      const endTime = Date.now() + timeout;

      const check = () => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
        } else if (Date.now() > endTime) {
          reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        } else {
          setTimeout(check, interval);
        }
      };
      check();
    });
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

    if (message.action === "clickPeopleTabAndSearch") {
      const { taskId, opportunityId, keywords } = message;
      try {
        log('info', 'Looking for the "People" tab link to click.');
        const peopleTabSelector = 'a.org-page-navigation__item-anchor[href*="/people/"]';
        const peopleTabLink = await waitForElement(peopleTabSelector);
        log('info', 'Found "People" tab link. Clicking it.');
        peopleTabLink.click();

        log('info', 'Waiting for the people search input to appear...');
        const searchInputSelector = '.org-people__search-input';
        const searchInput = await waitForElement(searchInputSelector);
        
        log('info', 'Found search input. Typing keywords...');
        searchInput.value = keywords;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await waitRandom(500, 1000);

        log('info', 'Simulating "Enter" key press.');
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, keyCode: 13 }));
        
        log('info', 'Waiting for search results to update...');
        await waitRandom(4000, 6000);

        log('info', 'Extracting HTML from people search results.');
        const resultsHtml = extractPeopleResultsHtml();

        chrome.runtime.sendMessage({ 
            action: "peopleSearchResults",
            taskId, 
            opportunityId,
            html: resultsHtml
        });

      } catch (e) {
        const errorMessage = `Error in clickPeopleTabAndSearch: ${e.message}`;
        log('error', errorMessage);
        chrome.runtime.sendMessage({ 
            action: "peopleSearchResults",
            taskId, 
            opportunityId,
            html: null,
            error: errorMessage
        });
      }
    }

    sendResponse({ status: "acknowledged" });
    return true;
  });
}
