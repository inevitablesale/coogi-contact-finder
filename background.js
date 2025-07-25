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

async function waitForSelector(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await waitRandom(200, 400);
  }
  return null;
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

// Grabs the raw HTML of the search results area to be parsed by AI
async function getSearchResultsHTML(taskId) {
  chrome.runtime.sendMessage({ action: "logMessage", message: "Waiting for search results to appear..." });
  
  await waitRandom(3000, 5000);

  const mainContent = await waitForSelector('main');
  if (!mainContent) {
    throw new Error("Could not find the main content area of the page.");
  }

  const pageText = document.body.innerText;
  if (pageText && pageText.toLowerCase().includes("no results found")) {
    chrome.runtime.sendMessage({ action: "logMessage", message: "'No results' message detected. Sending empty HTML." });
    chrome.runtime.sendMessage({ action: "scrapedRawHTML", html: "", taskId });
    return;
  }

  chrome.runtime.sendMessage({ action: "logMessage", message: "Found main content. Sending HTML to background for AI parsing." });
  chrome.runtime.sendMessage({ action: "scrapedRawHTML", html: mainContent.innerHTML, taskId });
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
      await getSearchResultsHTML(taskId);
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
