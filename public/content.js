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

async function waitForSpinnerToDisappear(selector = ".loading-spinner", timeout = 10000) {
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
  const clickable = document.querySelector("a, button");
  if (clickable) clickable.focus();
}

function detectCaptchaOrRestriction() {
  return document.querySelector("input[name='captcha'], #captcha-internal, .sign-in-form");
}

// =======================
// ✅ SCRAPING LOGIC
// =======================
function scrapeAccounts(opportunityId) {
  const listItems = document.querySelectorAll(".artdeco-list .artdeco-list__item");
  return Array.from(listItems).map(item => {
    const nameElement = item.querySelector(".artdeco-entity-lockup__title a");
    const name = nameElement ? nameElement.textContent.trim() : null;
    const profileUrl = nameElement ? `https://www.linkedin.com${nameElement.getAttribute("href")}` : null;

    return {
      opportunityId,
      name: name || null,
      title: item.querySelector("span[data-anonymize='title']")?.textContent.trim() || null,
      profileUrl,
      email: null
    };
  });
}

function scrapeLeads(opportunityId) {
  const rows = document.querySelectorAll("tbody tr");
  return Array.from(rows).map(row => {
    const nameCell = row.querySelector("a span");
    const name = nameCell ? nameCell.textContent.trim() : null;
    const profileLink = row.querySelector("a")?.getAttribute("href");
    const designation = row.querySelector("div[data-anonymize='job-title']")?.textContent.trim() || null;

    return {
      opportunityId,
      name: name || null,
      title: designation,
      profileUrl: profileLink ? `https://www.linkedin.com${profileLink}` : null,
      email: null
    };
  });
}

// =======================
// ✅ MAIN HANDLER
// =======================
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === "scrapeEmployees") {
    const { taskId, opportunityId } = message;
    console.log(`🚀 Starting scrape for task ${taskId}`);

    let allContacts = [];
    let retries = 0;
    let currentPage = 1;

    try {
      await waitRandom(3000, 6000);
      await addBehaviorNoise();

      while (currentPage <= MAX_PAGES) {
        console.log(`📄 Scraping page ${currentPage}`);
        if (detectCaptchaOrRestriction()) throw new Error("CAPTCHA detected.");

        await humanScrollToBottom();
        await addBehaviorNoise();

        const accountList = await waitForSelector(".artdeco-list", SELECTOR_TIMEOUT);
        let contacts = [];

        if (accountList) {
          contacts = scrapeAccounts(opportunityId);
        } else {
          const leadTable = await waitForSelector("table", SELECTOR_TIMEOUT);
          if (leadTable) {
            contacts = scrapeLeads(opportunityId);
          } else {
            if (retries < RETRY_LIMIT) {
              retries++;
              await waitRandom(Math.pow(2, retries) * 1000, Math.pow(2, retries) * 1500);
              continue;
            } else throw new Error("Page structure not found.");
          }
        }

        allContacts.push(...contacts);

        const nextButton = document.querySelector(".artdeco-pagination__button--next");
        if (!nextButton || nextButton.disabled) break;

        await waitRandom(...COOLDOWN_RANGE);
        nextButton.click();
        await waitForSpinnerToDisappear();
        await waitForSelector(".artdeco-list, table", SELECTOR_TIMEOUT);
        currentPage++;
      }

      chrome.runtime.sendMessage({ action: "scrapedData", taskId, contacts: allContacts });
    } catch (error) {
      chrome.runtime.sendMessage({ action: "scrapedData", taskId, contacts: [], error: error.message });
    }
  }
});