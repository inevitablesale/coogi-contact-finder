# 🚀 **Coogi Contact Finder**
> Automatically enrich opportunities with LinkedIn contacts using **Supabase** + **Chrome Extension** + **Human-like Automation**  
**Safe, Scalable, Event-Driven Scraping — Designed for Growth Teams**

---

## ✅ **Features**
✔ **Event-Driven Workflow**  
- Listens for new enrichment tasks in real-time via Supabase Realtime.

✔ **Headless Automation**  
- Scrapes LinkedIn profiles while mimicking human behavior.

✔ **Anti-Ban Mechanisms**  
- ✅ Randomized delays & scrolling  
- ✅ Behavioral noise injection (fake hovers, micro-interactions)  
- ✅ Task throttling & cooldowns  
- ✅ CAPTCHA detection + graceful exit  

✔ **Pagination Support**  
- Scrapes multiple pages automatically with safety limits.

✔ **Supabase Integration**  
- Realtime updates from `contact_enrichment_tasks`.  
- Inserts contacts into `contacts` table.  
- Logs failures into `scraping_errors` for analytics.

✔ **Task Queueing**  
- Processes multiple pending tasks sequentially, never in parallel.

---

## 🛠 **File Structure**
coogi-contact-finder/
│
├── background.js # Service worker (Supabase listener + task queue)
├── content.js # Page scraper with anti-ban logic
├── manifest.json # Chrome extension manifest (MV3)
├── images/ # Icons for the extension
│ ├── linkedin_scrapper_16.png
│ ├── linkedin_scrapper_48.png
│ ├── linkedin_scrapper_128.png
│
└── README.md

---

## 🔑 **Core Tech**
- **Chrome Extensions API (MV3)**
- **Supabase Realtime + Postgres**
- **Vanilla JavaScript (No frameworks)**
- **Human-like Automation Algorithms**

---

## ⚡ **How It Works**
### 1️⃣ Supabase Backend  
- **Tables:**
  - `contact_enrichment_tasks`: Stores enrichment jobs (`pending → processing → complete/error`)
  - `contacts`: Stores scraped contact data
  - `scraping_errors`: Logs structured error details

---

### 2️⃣ Background Script (background.js)
- Subscribes to `contact_enrichment_tasks` using Supabase Realtime.
- Queues tasks → Executes in sequence → Applies random cooldown.
- Injects `content.js` when ready.

---

### 3️⃣ Content Script (content.js)
- Detects page type (`Accounts` or `Leads`) dynamically.
- Waits for **spinner to finish loading**.
- Scrolls like a human with random pauses.
- Injects **behavioral noise** (hover, micro-scroll).
- Handles:
  - Pagination (safe limit with cooldown)
  - CAPTCHA detection (abort gracefully)
  - Retries with **exponential backoff**

---

## ✅ **Install Locally**
1. **Clone this repo:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/coogi-contact-finder.git
Open Chrome → Navigate to:
chrome://extensions/
Enable Developer Mode (top-right).

Click Load Unpacked → Select your project folder.

🔗 Supabase Setup
Add your Supabase credentials in background.js:
const SUPABASE_URL = "https://your-project.supabase.co";
Tokens are securely sent from your web app → extension via:
chrome.runtime.sendMessage({ type: "SET_TOKEN", token, userId });

🛡 Safety Best Practices
Do NOT run on accounts you cannot risk losing.

Keep daily scrape volume low (simulate real activity).

Comply with LinkedIn Terms of Service at all times.

📌 Next Up
 AI-based scraping anomaly detection

 LinkedIn session rotation (multi-profile support)

 Real-time Supabase analytics dashboard for error metrics

🧠 Author
Built by Coogi AI Team – Automation reimagined for Deal Sourcing & Lead Enrichment.