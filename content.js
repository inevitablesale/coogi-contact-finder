if (typeof window.coogiContentScriptLoaded === 'undefined') {
  window.coogiContentScriptLoaded = true;

  // Helper to send logs back to the background script
  const log = (level, ...args) => {
    chrome.runtime.sendMessage({ type: 'log', level, args });
  };

  // =======================
  // ✅ CONFIG
  // =======================
  const MAX_PAGES = 3;
  const COOLDOWN_RANGE = [15000, 30000];
  const RETRY_LIMIT = 3;
  const SELECTOR_TIMEOUT = 8000;

  // =======================
  // ✅ UTILITIES
  // =======================
  function waitRandom(min, max) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  async function waitForSelector(selector, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await waitRandom(100, 300);
    }
    return null;
  }

  async function waitForSpinnerToDisappear(selector = ".artdeco-spinner", timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!document.querySelector(selector)) return true;
      await waitRandom(200, 400);
    }
    return false;
  }

  async function humanScrollToBottom() {
    let totalHeight = 0;
    const distance = () => Math.floor(Math.random() * (600 - 300) + 300);
    while (totalHeight < document.body.scrollHeight) {
      const scrollAmount = distance();
      window.scrollBy(0, scrollAmount);
      totalHeight += scrollAmount;
      await waitRandom(800, 1500);
    }
  }

  async function addBehaviorNoise() {
    window.scrollBy(0, Math.floor(Math.random() * 200));
    await waitRandom(500, 1000);
    window.scrollBy(0, -Math.floor(Math.random() * 150));
  }

  function detectCaptchaOrRestriction() {
    return document.querySelector("input[name='captcha'], #captcha-internal, .sign-in-form");
  }

  // =======================
  // ✅ SCRAPING LOGIC
  // =======================
  function scrapeLinkedInSearchResults(opportunityId) {
    const results = document.querySelectorAll('li.reusable-search__result-container');
    const contacts = [];

    results.forEach(item => {
      const entityResult = item.querySelector('.entity-result');
      if (!entityResult) return;

      const titleElement = entityResult.querySelector('.entity-result__title-text a.app-aware-link');
      const name = titleElement ? titleElement.innerText.trim().split('\n')[0] : null;
      const profileUrl = titleElement ? titleElement.getAttribute('href') : null;

      const subtitleElement = entityResult.querySelector('.entity-result__primary-subtitle');
      const title = subtitleElement ? subtitleElement.innerText.trim() : null;

      if (name && name.toLowerCase() !== 'linkedin member' && profileUrl) {
        contacts.push({
          opportunityId,
          name,
          title,
          profileUrl,
          email: null
        });
      }
    });
    log('info', `Content Script: Scraped ${contacts.length} contacts from the search page.`);
    return contacts;
  }

  function scrapeCompanyPeoplePage(opportunityId) {
    const results = document.querySelectorAll('li.org-people-profile-card');
    const contacts = [];

    results.forEach(item => {
      const linkElement = item.querySelector('a');
      const profileUrl = linkElement ? linkElement.href : null;

      const nameElement = item.querySelector('.org-people-profile-card__profile-title');
      const name = nameElement ? nameElement.innerText.trim() : null;

      const titleElement = item.querySelector('.artdeco-entity-lockup__subtitle');
      const title = titleElement ? titleElement.innerText.trim().split('\n')[0] : null;

      if (name && name.toLowerCase() !== 'linkedin member' && profileUrl) {
        contacts.push({
          opportunityId,
          name,
          title,
          profileUrl,
          email: null
        });
      }
    });
    log('info', `Content Script: Scraped ${contacts.length} contacts from the company people page.`);
    return contacts;
  }


  // =======================
  // ✅ MAIN HANDLER
  // =======================
  chrome.runtime.onMessage.addListener(async (message) => {
    if (message.action === "scrapeEmployees") {
      const { taskId, opportunityId } = message;
      log('info', `🚀 Starting scrape for task ${taskId}`);

      let allContacts = new Map();
      let retries = 0;
      let currentPage = 1;
      const isCompanyPeoplePage = window.location.pathname.includes('/company/') && window.location.pathname.includes('/people/');

      try {
        await waitRandom(3000, 6000);
        await addBehaviorNoise();

        while (currentPage <= MAX_PAGES) {
          log('info', `📄 Scraping page ${currentPage}`);
          if (detectCaptchaOrRestriction()) throw new Error("CAPTCHA or login wall detected.");

          const scrollHeightBefore = document.body.scrollHeight;
          await humanScrollToBottom();
          await addBehaviorNoise();
          await waitRandom(3000, 5000);

          const contactsOnPage = isCompanyPeoplePage 
            ? scrapeCompanyPeoplePage(opportunityId)
            : scrapeLinkedInSearchResults(opportunityId);
          
          contactsOnPage.forEach(contact => {
            if (contact.profileUrl && !allContacts.has(contact.profileUrl)) {
              allContacts.set(contact.profileUrl, contact);
            }
          });
          
          log('info', `Total unique contacts found so far: ${allContacts.size}`);

          if (isCompanyPeoplePage) {
            const scrollHeightAfter = document.body.scrollHeight;
            if (scrollHeightAfter === scrollHeightBefore) {
              log('info', "Content Script: Reached end of infinite scroll.");
              break;
            }
          } else {
            const nextButton = document.querySelector(".artdeco-pagination__button--next");
            if (!nextButton || nextButton.disabled) {
              log('info', "Content Script: No 'next' button found or it is disabled.");
              break;
            }
            await waitRandom(...COOLDOWN_RANGE);
            nextButton.click();
            await waitForSpinnerToDisappear();
          }
          
          currentPage++;
          retries = 0;
        }

        chrome.runtime.sendMessage({ action: "scrapedData", taskId, opportunityId, contacts: Array.from(allContacts.values()) });
      } catch (error) {
        chrome.runtime.sendMessage({ action: "scrapedData", taskId, opportunityId, contacts: [], error: error.message });
      }
    }
  });
}
