import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

const SUPABASE_URL = "https://dbtdplhlatnlzcvdvptn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGRwbGhsYXRubHpjdmR2cHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NDk3MTIsImV4cCI6MjA2ODUyNTcxMn0.U3pnytCxcEoo_bJGLzjeNdt_qQ9eX8dzwezrxXOaOfA";
const ALARM_NAME = 'poll-tasks-alarm';

let supabase = null;
let supabaseChannel = null;
let userId = null;

let isTaskActive = false;
let cooldownActive = false;
const taskQueue = [];
let currentOpportunityContext = null;

function initSupabase(token) {
  if (!token) {
    supabase = null;
    return;
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function subscribeToTasks() {
  if (!supabase || !userId || (supabaseChannel && supabaseChannel.state === 'joined')) return;
  if (supabaseChannel) supabase.removeChannel(supabaseChannel);
  supabaseChannel = supabase
    .channel("contact_enrichment_tasks")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_enrichment_tasks" }, (payload) => {
      const task = payload.new;
      if (task.status === "pending" && task.user_id === userId) enqueueTask(task);
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') console.log("✅ Realtime subscription active for user:", userId);
      if (err) console.error("❌ Supabase subscription error:", err);
    });
}

async function initializeFromStorage() {
  console.log("Coogi Extension: Service worker starting...");
  const data = await chrome.storage.local.get(['token', 'userId']);
  if (data.token && data.userId) {
    console.log("Found token in storage. Initializing session.");
    userId = data.userId;
    initSupabase(data.token);
    subscribeToTasks();
    pollForPendingTasks();
  } else {
    console.log("No token found in storage. Waiting for user to log in.");
  }
}

async function startCompanyDiscoveryFlow(opportunityId, finalAction) {
  if (!supabase) {
    const errorMsg = "Cannot start discovery flow, Supabase not initialized.";
    console.error(errorMsg);
    if (finalAction.type === 'find_contacts') await updateTaskStatus(finalAction.taskId, "error", "Extension not authenticated.");
    return { error: "Not authenticated." };
  }

  console.log(`Starting discovery flow for opportunity ${opportunityId} with final action: ${finalAction.type}`);
  const { data: opportunity, error } = await supabase.from('opportunities').select('linkedin_url_slug, company_name, role, location').eq('id', opportunityId).single();

  if (error || !opportunity) {
    const errorMessage = `Could not find opportunity ${opportunityId}: ${error?.message}`;
    console.error(errorMessage);
    if (finalAction.type === 'find_contacts') await updateTaskStatus(finalAction.taskId, "error", errorMessage);
    return { error: errorMessage };
  }

  currentOpportunityContext = { id: opportunityId, company_name: opportunity.company_name, role: opportunity.role, location: opportunity.location, finalAction };
  const keywords = "human resources OR talent acquisition OR recruiter OR hiring";
  let targetUrl, scriptToInject;

  if (opportunity.linkedin_url_slug) {
    const slug = opportunity.linkedin_url_slug;
    console.log(`Direct slug found: ${slug}`);
    if (finalAction.type === 'find_contacts') {
      targetUrl = `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent(keywords)}`;
      scriptToInject = "content.js";
    } else { // 'enrich'
      targetUrl = `https://www.linkedin.com/company/${slug}/posts/`;
      scriptToInject = "company-content.js";
    }
  } else {
    console.log("No direct slug, searching for company.");
    targetUrl = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(opportunity.company_name)}`;
    scriptToInject = "company-search-content.js";
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  const tabUpdateListener = async (tabId, info) => {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [scriptToInject] });
      if (scriptToInject === "company-content.js") {
        await chrome.tabs.sendMessage(tab.id, { action: "startCompanyScrape", opportunityId });
      } else if (scriptToInject === "content.js") {
        await chrome.tabs.sendMessage(tab.id, { action: "scrapeEmployees", taskId: finalAction.taskId, opportunityId });
      }
    }
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);
  return { status: "Discovery process initiated." };
}

chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
  if (message.type === "SET_TOKEN") {
    console.log("Received new token from web app.");
    userId = message.userId;
    await chrome.storage.local.set({ token: message.token, userId: message.userId });
    initSupabase(message.token);
    subscribeToTasks();
    sendResponse({ status: "Token received and stored." });
    return true;
  }
  if (message.type === "SCRAPE_COMPANY_PAGE") {
    const response = await startCompanyDiscoveryFlow(message.opportunityId, { type: 'enrich' });
    sendResponse(response);
    return true;
  }
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "scrapedCompanySearchResults") {
    if (!supabase || !currentOpportunityContext) return;
    try {
      const { data, error } = await supabase.functions.invoke('select-linkedin-company', { body: { searchResults: message.results, opportunityContext } });
      if (error) throw new Error(error.message);

      const finalAction = currentOpportunityContext.finalAction;
      const keywords = "human resources OR talent acquisition OR recruiter OR hiring";
      let destinationUrl, scriptToInject;

      if (finalAction.type === 'find_contacts') {
        destinationUrl = `${data.url.replace(/\/$/, '')}/people/?keywords=${encodeURIComponent(keywords)}`;
        scriptToInject = "content.js";
      } else { // 'enrich'
        destinationUrl = `${data.url.replace(/\/$/, '')}/posts/`;
        scriptToInject = "company-content.js";
      }
      
      await chrome.tabs.update(sender.tab.id, { url: destinationUrl });
      const tabUpdateListener = async (tabId, info) => {
        if (tabId === sender.tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(tabUpdateListener);
          await chrome.scripting.executeScript({ target: { tabId }, files: [scriptToInject] });
          if (scriptToInject === "content.js") {
            await chrome.tabs.sendMessage(tabId, { action: "scrapeEmployees", taskId: finalAction.taskId, opportunityId: currentOpportunityContext.id });
          } else {
            await chrome.tabs.sendMessage(tabId, { action: "startCompanyScrape", opportunityId: currentOpportunityContext.id });
          }
        }
      };
      chrome.tabs.onUpdated.addListener(tabUpdateListener);
    } catch (e) { console.error("Error during AI company selection:", e.message); if (sender.tab?.id) chrome.tabs.remove(sender.tab.id); }
  }

  if (message.action === "scrapedData") {
    const { taskId, contacts, error, opportunityId } = message;
    if (error) await updateTaskStatus(taskId, "error", error);
    else {
      await saveContacts(taskId, opportunityId, contacts);
      await updateTaskStatus(taskId, "complete");
    }
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    isTaskActive = false;
    startCooldown();
    processQueue();
  }

  if (message.action === "scrapedCompanyData") {
    const { opportunityId, data, error } = message;
    if (error) console.error(`Error scraping company ${opportunityId}:`, error);
    else if (supabase) {
      console.log(`Saving scraped data for opportunity ${opportunityId}`);
      const { error: updateError } = await supabase.from('opportunities').update({ company_data_scraped: data }).eq('id', opportunityId);
      if (updateError) console.error("Failed to save scraped company data:", updateError);
      else console.log("Successfully saved scraped company data.");
    }
    currentOpportunityContext = null;
  }

  if (message.action === "scrapingComplete") {
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    currentOpportunityContext = null;
  }
});

function enqueueTask(task) {
  if (!taskQueue.some(t => t.id === task.id)) {
    taskQueue.push(task);
    console.log(`📥 Task ${task.id} enqueued. Queue size: ${taskQueue.length}`);
    processQueue();
  }
}

async function processQueue() {
  if (isTaskActive || cooldownActive || taskQueue.length === 0) return;
  const nextTask = taskQueue.shift();
  console.log(`🚀 Processing task ${nextTask.id}. Queue size: ${taskQueue.length}`);
  await handleTask(nextTask);
}

async function handleTask(task) {
  isTaskActive = true;
  chrome.action.setBadgeText({ text: "RUN" });
  await updateTaskStatus(task.id, "processing");
  await startCompanyDiscoveryFlow(task.opportunity_id, { type: 'find_contacts', taskId: task.id });
}

async function pollForPendingTasks() {
  console.log("⏰ Polling for pending tasks...");
  if (!supabase || !userId) return;
  const { data, error } = await supabase.from('contact_enrichment_tasks').select('*').eq('user_id', userId).eq('status', 'pending');
  if (error) console.error("Error polling for tasks:", error);
  else if (data && data.length > 0) {
    console.log(`Found ${data.length} pending tasks during poll.`);
    data.forEach(task => enqueueTask(task));
  }
}

async function updateTaskStatus(taskId, status, errorMessage = null) {
  if (!supabase) return;
  await supabase.from("contact_enrichment_tasks").update({ status, error_message: errorMessage }).eq("id", taskId);
}

async function saveContacts(taskId, opportunityId, contacts) {
  if (!supabase || contacts.length === 0) return;
  try {
    const contactsToInsert = contacts.map((c) => ({ task_id: taskId, opportunity_id: opportunityId, user_id: userId, name: c.name, job_title: c.title, linkedin_profile_url: c.profileUrl }));
    const { error } = await supabase.from("contacts").insert(contactsToInsert);
    if (error) throw error;
    console.log(`✅ Saved ${contacts.length} contacts for task ${taskId}`);
  } catch (err) {
    console.error(`❌ DB error for task ${taskId}: ${err.message}`);
    await updateTaskStatus(taskId, "error", `Failed to save contacts: ${err.message}`);
  }
}

function startCooldown() {
  cooldownActive = true;
  const cooldownTime = Math.floor(Math.random() * (60000 - 20000 + 1)) + 20000;
  console.log(`⏳ Cooldown active for ${cooldownTime / 1000}s`);
  setTimeout(() => {
    cooldownActive = false;
    processQueue();
  }, cooldownTime);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  console.log("Task polling alarm created.");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollForPendingTasks();
});

initializeFromStorage();
