// =======================
// ✅ CONFIG
// =======================
const MAX_PAGES_TO_SCRAPE = 5; // Reduced for safety
const ACTION_DELAY_RANGE = [2000, 4000]; // Time between actions like scrolling and clicking

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

// NEW: Checks if an element is visible and interactable to a human
function isElementSafeToInteract(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         element.offsetHeight > 0 &&
         element.offsetWidth > 0;
}

// NEW: More human-like scrolling with pauses and jitter
async function humanScrollToBottom() {
  let totalHeight = 0;
  const distance = () => Math.floor(Math.random() * (500 - 250) + 250);
  while (totalHeight < document.body.scrollHeight) {
    const scrollAmount = distance();
    window.scrollBy(0, scrollAmount);
    totalHeight += scrollAmount;
    await waitRandom(600, 1200);
    // 10% chance to scroll up a little
    if (Math.random() < 0.1) {
      window.scrollBy(0, -Math.floor(Math.random() * 100));
      await waitRandom(400, 800);
    }
  }
}

// NEW: Centralized CAPTCHA and restriction detection
function detectCaptchaOrRestriction() {
  const captchaSelectors = "input[name='captcha'], #captcha-internal, .sign-in-form, .recaptcha-container";
  const restrictionTitle = "Let's do a quick security check";
  
  if (document.querySelector(captchaSelectors)) return true;
  if (document.title.includes(restrictionTitle)) return true;
  
  return false;
}

// =======================
// ✅ SCRAPING LOGIC
// =======================
function scrapeContactsFromPage(opportunityId, selector, nameSel, titleSel, linkSel) {
  const results = document.querySelectorAll(selector);
  const contacts = [];

  results.forEach(item => {
    if (!isElementSafeToInteract(item)) return; // Honeypot check

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
  console.log(`Content Script: Scraped ${contacts.length} contacts from the page.`);
  return contacts;
}

// =======================
// ✅ MAIN HANDLER
// =======================
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === "scrapeEmployees") {
    const { taskId, opportunityId } = message;
    console.log(`🚀 Starting scrape for task ${taskId}`);

    let allContacts = new Map();
    let currentPage = 1;
    const isCompanyPeoplePage = window.location.pathname.includes('/company/') && window.location.pathname.includes('/people/');

    try {
      await waitRandom(...ACTION_DELAY_RANGE);

      while (currentPage <= MAX_PAGES_TO_SCRAPE) {
        // CRITICAL: Check for CAPTCHA on every loop iteration
        if (detectCaptchaOrRestriction()) {
          chrome.runtime.sendMessage({ action: "CAPTCHA_DETECTED" });
          return; // Stop immediately
        }

        console.log(`📄 Scraping page ${currentPage}`);
        const scrollHeightBefore = document.body.scrollHeight;
        await humanScrollToBottom();
        await waitRandom(...ACTION_DELAY_RANGE);

        // Check for empty results (soft-block detection)
        const resultsContainer = document.querySelector(isCompanyPeoplePage ? '.grid' : '.reusable-search__results-container');
        if (!resultsContainer || !isElementSafeToInteract(resultsContainer) || resultsContainer.children.length === 0) {
            throw new Error("Content container is empty or hidden, potential block detected.");
        }

        const contactsOnPage = isCompanyPeoplePage
          ? scrapeContactsFromPage(opportunityId, 'li.org-people-profile-card', '.org-people-profile-card__profile-title', '.artdeco-entity-lockup__subtitle', 'a')
          : scrapeContactsFromPage(opportunityId, 'li.reusable-search__result-container', '.entity-result__title-text', '.entity-result__primary-subtitle', 'a.app-aware-link');
        
        contactsOnPage.forEach(contact => {
          if (contact.profileUrl && !allContacts.has(contact.profileUrl)) {
            allContacts.set(contact.profileUrl, contact);
          }
        });
        
        console.log(`Total unique contacts found so far: ${allContacts.size}`);

        // Logic for pagination or ending infinite scroll
        if (isCompanyPeoplePage) {
          const scrollHeightAfter = document.body.scrollHeight;
          if (scrollHeightAfter === scrollHeightBefore) {
            console.log("Content Script: Reached end of infinite scroll.");
            break;
          }
        } else {
          const nextButton = document.querySelector(".artdeco-pagination__button--next");
          if (!nextButton || !isElementSafeToInteract(nextButton) || nextButton.disabled) {
            console.log("Content Script: No 'next' button found or it is disabled/unsafe.");
            break;
          }
          await waitRandom(...ACTION_DELAY_RANGE);
          nextButton.click();
          await waitForSpinnerToDisappear();
        }
        
        currentPage++;
      }

      chrome.runtime.sendMessage({ action: "scrapedData", taskId, opportunityId, contacts: Array.from(allContacts.values()) });
    } catch (error) {
      console.error("Content Script Error:", error);
      chrome.runtime.sendMessage({ action: "scrapingError", error: error.message });
    }
  }
});
