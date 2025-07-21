import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dbtdplhlatnlzcvdvptn.supabase.co";
let supabase = null;
let userToken = null;
let userId = null;

let isSubscribed = false;
let isTaskActive = false;
let cooldownActive = false;

const taskQueue = [];

function initSupabase(token) {
  supabase = createClient(SUPABASE_URL, SUPABASE_URL, {
    global: {
      headers: { Authorization: `Bearer ${token}`, apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGRwbGhsYXRubHpjdmR2cHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NDk3MTIsImV4cCI6MjA2ODUyNTcxMn0.U3pnytCxcEoo_bJGLzjeNdt_qQ9eX8dzwezrxXOaOfA" },
    },
  });
}

// Listener for EXTERNAL messages (from your web app)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log("Coogi Extension: External message received from web app.", { message });

  if (message.type === "SET_TOKEN") {
    userToken = message.token;
    userId = message.userId;
    initSupabase(userToken);

    if (!isSubscribed) {
      subscribeToTasks();
      isSubscribed = true;
      console.log("✅ Subscribed to Supabase changes");
    }
    sendResponse({ status: "Token received and Supabase initialized" });
    return true; // Indicate async response
  }

  if (message.command === "TEST_COMMAND") {
    console.log(
      "%cCoogi Extension: Successfully received TEST_COMMAND with data:",
      "color: #00ff00; font-weight: bold;",
      message.data
    );
    sendResponse({ status: "success", received: message.command });
    return true; // Indicate async response
  }
});

// Listener for INTERNAL messages (e.g., from content scripts)
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("Coogi Extension: Internal message received from content script.", { message });

  if (message.action === "scrapedData") {
    const { taskId, contacts, error, opportunityId } = message;

    if (error) {
      console.error(`❌ Scraping error for task ${taskId}: ${error}`);
      await updateTaskStatus(taskId, "error", error);
      await logError(taskId, error);
      chrome.action.setBadgeText({ text: "ERR" });
    } else {
      try {
        const contactsToInsert = contacts.map((c) => ({
          task_id: taskId,
          opportunity_id: opportunityId,
          user_id: userId, // Use the stored userId
          name: c.name,
          job_title: c.title,
          linkedin_profile_url: c.profileUrl,
          email: c.email || null,
        }));

        const { error: insertError } = await supabase.from("contacts").insert(contactsToInsert);

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

function subscribeToTasks() {
  if (!supabase || !userId) return;
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

function enqueueTask(task) {
  taskQueue.push(task);
  processQueue();
}

async function processQueue() {
  if (isTaskActive || cooldownActive || taskQueue.length === 0) return;
  const nextTask = taskQueue.shift();
  await handleTask(nextTask);
}

async function handleTask(task) {
  const { company_name, id: taskId, opportunity_id } = task;

  try {
    isTaskActive = true;
    chrome.action.setBadgeText({ text: "RUN" });
    await updateTaskStatus(taskId, "processing");

    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company_name)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });

    await waitRandom(3000, 6000);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    chrome.tabs.sendMessage(tab.id, {
      action: "scrapeEmployees",
      company: company_name,
      taskId,
      opportunityId: opportunity_id,
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

async function updateTaskStatus(taskId, status, errorMessage = null) {
  if (!supabase) return;
  await supabase.from("contact_enrichment_tasks").update({ status, error_message: errorMessage }).eq("id", taskId);
}

async function logError(taskId, message, page = null) {
  if (!supabase) return;
  await supabase.from("scrape_logs").insert([{ task_id: taskId, message, page_number: page, created_at: new Date().toISOString() }]);
}

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
