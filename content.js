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
  console.log("Coogi Extension: Scraping company search results...");
  const resultsContainer = document.querySelector('ul.reusable-search__results-container');
  if (!resultsContainer) throw new Error("Search results container not found.");
  
  await waitRandom(1000, 2000); // Wait for elements to render

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
  console.log(`Coogi Extension: Found ${results.length} company search results.`);
  chrome.runtime.sendMessage({ action: "scrapedCompanySearchResults", results });
}

// Scrapes a list of employees from a company's "People" page
async function scrapeEmployees(opportunityId) {
  console.log(`🚀 Starting employee scrape for opportunity ${opportunityId}`);
  let allContacts = new Map();
  let currentPage = 1;

  while (currentPage <= MAX_PAGES_TO_SCRAPE) {
    if (detectCaptchaOrRestriction()) {
      chrome.runtime.sendMessage({ action: "CAPTCHA_DETECTED" });
      return;
    }

    console.log(`📄 Scraping employee page ${currentPage}`);
    const scrollHeightBefore = document.body.scrollHeight;
    await humanScrollToBottom();
    await waitRandom(...ACTION_DELAY_RANGE);

    const resultsContainer = document.querySelector('.grid');
    if (!resultsContainer || !isElementSafeToInteract(resultsContainer)) {
      throw new Error("Employee container is empty or hidden, potential block detected.");
    }

    const contactsOnPage = scrapeContactsFromPage(opportunityId, 'li.org-people-profile-card', '.org-people-profile-card__profile-title', '.artdeco-entity-lockup__subtitle', 'a');
    contactsOnPage.forEach(contact => {
      if (contact.profileUrl && !allContacts.has(contact.profileUrl)) {
        allContacts.set(contact.profileUrl, contact);
      }
    });
    console.log(`Total unique contacts found so far: ${allContacts.size}`);

    const scrollHeightAfter = document.body.scrollHeight;
    if (scrollHeightAfter === scrollHeightBefore) {
      console.log("Content Script: Reached end of infinite scroll for employees.");
      break;
    }
    currentPage++;
  }
  chrome.runtime.sendMessage({ action: "scrapedData", contacts: Array.from(allContacts.values()), opportunityId });
}

function scrapeContactsFromPage(opportunityId, selector, nameSel, titleSel, linkSel) {
  const results = document.querySelectorAll(selector);
  const contacts = [];
  results.forEach(item => {
    if (!isElementSafeToInteract(item)) return;
    const linkElement = item.querySelector(linkSel);
    const nameElement = item.querySelector(nameSel);
    const titleElement = item.querySelector(titleSel);
    if (isElementSafeToInteract(linkElement) && isElementSafeToInteract(nameElement)) {
      const name = nameElement.innerText.trim().split('\n')[0];
      const profileUrl = linkElement.getAttribute('href');
      const title = titleElement ? titleElement.innerText.trim() : null;
      if (name && name.toLowerCase() !== 'linkedin member' && profileUrl) {
        contacts.push({ opportunityId, name, title, profileUrl, email: null });
      }
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
