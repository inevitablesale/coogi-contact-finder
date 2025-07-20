importScripts('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/umd/supabase.min.js');

const SUPABASE_URL = "https://dbtdplhlatnlzcvdvptn.supabase.co";
let supabase = null;
let userToken = null;
let userId = null;

let isSubscribed = false;
let isTaskActive = false;
let cooldownActive = false;

const taskQueue = [];

// ✅ Initialize Supabase client (fix: use global supabase from CDN)
function initSupabase(token) {
  supabase = supabase.createClient(SUPABASE_URL, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}

// ✅ Listen for messages
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "SET_TOKEN") {
    userToken = message.token;
    userId = message.userId;
    initSupabase(userToken);

    if (!isSubscribed) {
      subscribeToTasks();
      isSubscribed = true;
      console.log("✅ Subscribed to Supabase changes");
    }

    sendResponse({ status: "Token received" });
  }

  if (message.action === "scrapedData") {
    const { taskId, contacts, error } = message;

    if (error) {
      console.error(`❌ Scraping error for task ${taskId}: ${error}`);
      await updateTaskStatus(taskId, "error", error);
      await logError(taskId, error);
      chrome.action.setBadgeText({ text: "ERR" });
    } else {
      try {
        const { error: insertError } = await supabase.from("contacts").insert(
          contacts.map((c) => ({
            opportunity_id: c.opportunityId,
            name: c.name,
            job_title: c.title,
            linkedin_profile_url: c.profileUrl,
            email: c.email || null,
          }))
        );

        if (insertError) throw insertError;
        await updateTaskStatus(taskId, "complete");
        chrome.action.setBadgeText({ text: "" });
        console.log(`✅ Task ${taskId} completed with ${contacts.length} contacts`);
      } catch (err) {
        console.error(`❌ DB error for task ${taskId}: ${err.message}`);
        await logError(taskId, err.message);
        await updateTaskStatus(taskId, "error", err.message);
      }
    }

    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);

    isTaskActive = false;
    startCooldown();
    setTimeout(() => processQueue(), 1000);
  }
});

// ✅ Supabase subscription
function subscribeToTasks() {
  supabase
    .channel("contact_enrichment_tasks")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_enrichment_tasks" }, async (payload) => {
      const task = payload.new;
      if (task.status === "pending" && task.user_id === userId) {
        enqueueTask(task);
      }
    })
    .subscribe();
}

// ✅ Queue management
function enqueueTask(task) {
  taskQueue.push(task);
  processQueue();
}

async function processQueue() {
  if (isTaskActive || cooldownActive || taskQueue.length === 0) return;
  const nextTask = taskQueue.shift();
  await handleTask(nextTask);
}

// ✅ Task handler
async function handleTask(task) {
  const { company_name, id: taskId } = task;

  try {
    isTaskActive = true;
    chrome.action.setBadgeText({ text: "RUN" });
    await updateTaskStatus(taskId, "processing");

    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company_name)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });

    await waitRandom(3000, 6000); // Human-like delay
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    chrome.tabs.sendMessage(tab.id, {
      action: "scrapeEmployees",
      company: company_name,
      taskId,
      opportunityId: task.opportunity_id,
    });
  } catch (error) {
    console.error(`❌ Task ${taskId} failed: ${error.message}`);
    await updateTaskStatus(taskId, "error", error.message);
    await logError(taskId, error.message);
    chrome.action.setBadgeText({ text: "ERR" });
    isTaskActive = false;
    startCooldown();
  }
}

// ✅ Update task status in DB
async function updateTaskStatus(taskId, status, errorMessage = null) {
  await supabase.from("contact_enrichment_tasks").update({ status, error_message: errorMessage }).eq("id", taskId);
}

// ✅ Log errors
async function logError(taskId, message, page = null) {
  await supabase.from("scrape_logs").insert([{ task_id: taskId, message, page_number: page, created_at: new Date().toISOString() }]);
}

// ✅ Utilities
function waitRandom(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

function startCooldown() {
  cooldownActive = true;
  const cooldownTime = Math.floor(Math.random() * (90000 - 30000 + 1)) + 30000;
  console.log(`⏳ Cooldown for ${cooldownTime / 1000}s`);
  setTimeout(() => {
    cooldownActive = false;
    processQueue();
  }, cooldownTime);
}