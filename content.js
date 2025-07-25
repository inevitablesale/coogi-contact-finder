// =======================
// ✅ CONFIG
// =======================
const MAX_PAGES_TO_SCRAPE = 5;
const ACTION_DELAY_RANGE = [2000, 4000];

// =======================
// ✅ UTILITIES & ANTI-BOT
// =======================
function waitRandom(min, max) {
  return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

async function waitForSpinnerToDisappear(selector = ".artdeco-spinner", timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!document.querySelector(selector)) return true;
    await waitRandom(200, 400);
  }
  return false;
}

function isElementSafeToInteract(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetHeight > 0 && element.offsetWidth > 0;
}

async function humanScrollToBottom() {
  let totalHeight = 0;
  const distance = () => Math.floor(Math.random() * (500 - 250) + 250);
  while (totalHeight < document.body.scrollHeight) {
    const scrollAmount = distance();
    window.scrollBy(0, scrollAmount);
    totalHeight += scrollAmount;
    await waitRandom(600, 1200);
    if (Math.random() < 0.1) {
      window.scrollBy(0, -Math.floor(Math.random() * 100));
      await waitRandom(400, 800);
    }
  }
}

function detectCaptchaOrRestriction() {
  const captchaSelectors = "input[name='captcha'], #captcha-internal, .sign-in-form, .recaptcha-container";
  const restrictionTitle = "Let's do a quick security check";
  if (document.querySelector(captchaSelectors) || document.title.includes(restrictionTitle)) {
    return true;
  }
  return false;
}

// =======================
// ✅ SCRAPING LOGIC
// =======================

// Scrapes a list of companies from a search results page
async function scrapeCompanySearchResults() {
  chrome.runtime.sendMessage({ action: "logMessage", message: "Scraping company search results page..." });
  
  await waitRandom(3000, 5000);

  const resultsContainer = document.querySelector('ul.reusable-search__results-container');
  
  if (resultsContainer) {
    chrome.runtime.sendMessage({ action: "logMessage", message: "Results container found. Scraping items..." });
    const results = [];
    const resultElements = document.querySelectorAll('li.reusable-search__result-container');
    resultElements.forEach(el => {
      const linkElement = el.querySelector('a.app-aware-link');
      const titleElement = el.querySelector('.entity-result__title-text');
      const subtitleElement = el.querySelector('.entity-result__primary-subtitle');
      if (linkElement && titleElement && subtitleElement) {
        results.push({
          url: linkElement.href,
          title: titleElement.innerText.trim(),
          subtitle: subtitleElement.innerText.trim()
        });
      }
    });
    chrome.runtime.sendMessage({ action: "logMessage", message: `Found ${results.length} company search results.` });
    chrome.runtime.sendMessage({ action: "scrapedCompanySearchResults", results });
    return;
  }

  const noResultsElement = document.querySelector('.search-no-results, .search-results__blank-state');
  const pageText = document.body.innerText;

  if (noResultsElement || (pageText && pageText.toLowerCase().includes("no results found"))) {
    chrome.runtime.sendMessage({ action: "logMessage", message: "'No results' message detected. Sending empty array." });
    chrome.runtime.sendMessage({ action: "scrapedCompanySearchResults", results: [] });
    return;
  }

  throw new Error("Search results container not found, and no 'no results' message was detected. LinkedIn page structure may have changed.");
}


// Scrapes a list of employees from a company's "People" page
async function scrapeEmployees(opportunityId) {
  chrome.runtime.sendMessage({ action: "logMessage", message: `🚀 Starting employee scrape for opportunity ${opportunityId}` });
  let allContacts = new Map();
  let currentPage = 1;

  while (currentPage <= MAX_PAGES_TO_SCRAPE) {
    if (detectCaptchaOrRestriction()) {
      chrome.runtime.sendMessage({ action: "CAPTCHA_DETECTED" });
      return;
    }

    chrome.runtime.sendMessage({ action: "logMessage", message: `📄 Scraping employee page ${currentPage}` });
    const scrollHeightBefore = document.body.scrollHeight;
    await humanScrollToBottom();
    await waitRandom(...ACTION_DELAY_RANGE);

    const resultsContainer = document.querySelector('.grid, .scaffold-finite-scroll__content');
    if (!resultsContainer || !isElementSafeToInteract(resultsContainer)) {
      throw new Error("Employee container is empty or hidden, potential block detected.");
    }

    const contactsOnPage = scrapeContactsFromPage(opportunityId);
    contactsOnPage.forEach(contact => {
      if (contact.profileUrl && !allContacts.has(contact.profileUrl)) {
        allContacts.set(contact.profileUrl, contact);
      }
    });
    chrome.runtime.sendMessage({ action: "logMessage", message: `Total unique contacts found so far: ${allContacts.size}` });

    const scrollHeightAfter = document.body.scrollHeight;
    if (scrollHeightAfter === scrollHeightBefore) {
      chrome.runtime.sendMessage({ action: "logMessage", message: "Reached end of infinite scroll for employees." });
      break;
    }
    currentPage++;
  }
  chrome.runtime.sendMessage({ action: "scrapedData", contacts: Array.from(allContacts.values()), opportunityId });
}

function scrapeContactsFromPage(opportunityId) {
  const results = document.querySelectorAll('li.org-people-profile-card');
  const contacts = [];
  results.forEach(item => {
    if (!isElementSafeToInteract(item)) return;
    
    const linkElement = item.querySelector('a[href^="/in/"]');
    const profileUrl = linkElement ? linkElement.href : null;
    
    const nameElement = linkElement ? linkElement.querySelector('.org-people-profile-card__profile-title') : null;
    const name = nameElement ? nameElement.innerText.trim() : null;

    // Find all elements with the title class and pick the one that is NOT inside the main profile link.
    const allTitleElements = item.querySelectorAll('.org-people-profile-card__profile-title');
    let title = null;
    allTitleElements.forEach(el => {
        if (!el.closest('a')) {
            title = el.innerText.trim();
        }
    });

    const locationElement = item.querySelector('.org-people-profile-card__location');
    const location = locationElement ? locationElement.innerText.trim() : null;

    if (name && name.toLowerCase() !== 'linkedin member' && profileUrl) {
      contacts.push({ opportunityId, name, title, location, profileUrl, email: null });
    }
  });
  return contacts;
}

// =======================
// ✅ MAIN ROUTER
// =======================
async function main(message) {
  const { taskId, opportunityId } = message;
  const { pathname } = window.location;

  try {
    if (pathname.includes("/search/results/companies/")) {
      await scrapeCompanySearchResults();
    } else if (pathname.includes("/company/") && pathname.includes("/people/")) {
      await scrapeEmployees(opportunityId);
    } else {
      throw new Error(`Unrecognized LinkedIn page for scraping: ${pathname}`);
    }
  } catch (error) {
    console.error("Content Script Error:", error);
    chrome.runtime.sendMessage({ action: "scrapingError", error: error.message, taskId });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrapePage") {
    main(message);
  }
  return true; // Indicates that the response will be sent asynchronously
});
