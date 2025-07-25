import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

// =======================
// ✅ CONFIG & CONSTANTS
// =======================
const SUPABASE_URL = "https://dbtdplhlatnlzcvdvptn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGRwbGhsYXRubHpjdmR2cHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NDk3MTIsImV4cCI6MjA2ODUyNTcxMn0.U3pnytCxcEoo_bJGLzjeNdt_qQ9eX8dzwezrxXOaOfA";
const ALARM_NAME = 'poll-tasks-alarm';
const COOGI_APP_URL = "https://dbtdplhlatnlzcvdvptn.dyad.sh/*";

// Anti-Bot Protection Settings
const SHORT_COOLDOWN_RANGE = [20000, 60000]; // 20-60 seconds between tasks
const SESSION_PAUSE_THRESHOLD = 3; // Pause after this many tasks
const SESSION_PAUSE_DURATION = [300000, 900000]; // 5-15 minute pause
const CAPTCHA_COOLDOWN = 3600000; // 1 hour cooldown if CAPTCHA is detected
const MAX_TASKS_PER_HOUR = 15;

// =======================
// ✅ STATE MANAGEMENT
// =======================
let supabase = null;
let supabaseChannel = null;
let userId = null;

let isTaskActive = false;
let cooldownState = { active: false, until: 0 };
const taskQueue = [];
let taskTimestamps = []; // For hourly rate limiting
let tasksSinceLastPause = 0;

let currentOpportunityContext = null;
let currentStatus = { status: 'disconnected', message: 'Initializing...' };

// =======================
// ✅ CORE UTILITIES
// =======================
async function broadcastStatus(status, message) {
  console.log(`[STATUS] ${status.toUpperCase()}: ${message}`);
  currentStatus = { status, message };
  try {
    const tabs = await chrome.tabs.query({ url: COOGI_APP_URL });
    if (tabs.length === 0) {
      console.log("[Broadcast] No Coogi web app tab found to send status to.");
      return;
    }
    console.log(`[Broadcast] Found ${tabs.length} Coogi tab(s). Sending status...`);
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (payload) => { window.dispatchEvent(new CustomEvent('coogi-extension-status', { detail: payload })); },
          args: [currentStatus],
          world: 'MAIN'
        });
        console.log(`[Broadcast] Successfully sent status to tab ${tab.id}`);
      } catch (e) { 
        console.error(`[Broadcast] Failed to send status to tab ${tab.id}:`, e.message);
      }
    }
  } catch (e) { console.error("Error broadcasting status:", e.message); }
}

async function broadcastDataUpdate() {
  try {
    const tabs = await chrome.tabs.query({ url: COOGI_APP_URL });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { window.dispatchEvent(new CustomEvent('coogi-data-updated')); },
          world: 'MAIN'
        });
      } catch (e) { /* Tab might not be ready */ }
    }
  } catch (e) { console.error("Error broadcasting data update:", e.message); }
}

function initSupabase(token) {
  if (!token) {
    supabase = null;
    broadcastStatus('disconnected', 'Not connected. Please log in to the web app.');
    return;
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// =======================
// ✅ TASK & QUEUE MANAGEMENT
// =======================
function enqueueTask(task) {
  if (!taskQueue.some(t => t.id === task.id)) {
    taskQueue.push(task);
    broadcastStatus('idle', `New task for ${task.company_name} added to queue. Queue size: ${taskQueue.length}`);
    processQueue();
  }
}

function canRunTask() {
  // Remove timestamps older than an hour
  const oneHourAgo = Date.now() - 3600000;
  taskTimestamps = taskTimestamps.filter(ts => ts > oneHourAgo);
  if (taskTimestamps.length >= MAX_TASKS_PER_HOUR) {
    broadcastStatus('cooldown', `Hourly limit reached. Pausing to protect your account.`);
    return false;
  }
  return true;
}

function processQueue() {
  if (isTaskActive || cooldownState.active || taskQueue.length === 0) {
    if (!isTaskActive && !cooldownState.active) {
      broadcastStatus('idle', 'All tasks complete. Waiting for new tasks.');
    }
    return;
  }

  if (!canRunTask()) {
    // Schedule a check for later
    setTimeout(processQueue, 60000);
    return;
  }

  const nextTask = taskQueue.shift();
  handleTask(nextTask);
}

async function handleTask(task) {
  isTaskActive = true;
  chrome.action.setBadgeText({ text: "RUN" });
  await updateTaskStatus(task.id, "processing");
  broadcastStatus('active', `Starting search for ${task.company_name}...`);
  await startCompanyDiscoveryFlow(task.opportunity_id, { type: 'find_contacts', taskId: task.id });
}

function startCooldown(isLongPause = false, reason = '') {
  const [min, max] = isLongPause ? SESSION_PAUSE_DURATION : SHORT_COOLDOWN_RANGE;
  const cooldownTime = Math.floor(Math.random() * (max - min + 1)) + min;
  
  cooldownState = { active: true, until: Date.now() + cooldownTime };
  
  const message = reason 
    ? reason 
    : (isLongPause ? `Taking a longer break after several tasks.` : `Taking a short break to appear human.`);
  
  broadcastStatus('cooldown', message);

  setTimeout(() => {
    cooldownState = { active: false, until: 0 };
    processQueue();
  }, cooldownTime);
}

async function handleTaskCompletion(success = true) {
    isTaskActive = false;
    chrome.action.setBadgeText({ text: "" });
    
    if (success) {
        taskTimestamps.push(Date.now());
        tasksSinceLastPause++;
    }

    if (tasksSinceLastPause >= SESSION_PAUSE_THRESHOLD) {
        tasksSinceLastPause = 0;
        startCooldown(true); // Start a long session pause
    } else {
        startCooldown(false); // Start a short, regular cooldown
    }
    
    processQueue();
}

// =======================
// ✅ MAIN WORKFLOW
// =======================
async function startCompanyDiscoveryFlow(opportunityId, finalAction) {
  if (!supabase) {
    const errorMsg = "Cannot start discovery flow, Supabase not initialized.";
    broadcastStatus('error', errorMsg);
    if (finalAction.type === 'find_contacts') await updateTaskStatus(finalAction.taskId, "error", "Extension not authenticated.");
    return { error: "Not authenticated." };
  }

  const { data: opportunity, error } = await supabase.from('opportunities').select('linkedin_url_slug, company_name, role, location').eq('id', opportunityId).single();

  if (error || !opportunity) {
    const errorMessage = `Could not find opportunity ${opportunityId}: ${error?.message}`;
    broadcastStatus('error', errorMessage);
    if (finalAction.type === 'find_contacts') await updateTaskStatus(finalAction.taskId, "error", errorMessage);
    return { error: errorMessage };
  }
  
  currentOpportunityContext = { id: opportunityId, company_name: opportunity.company_name, role: opportunity.role, location: opportunity.location, finalAction };
  const keywords = "human resources OR talent acquisition OR recruiter OR hiring";
  let targetUrl;

  if (opportunity.linkedin_url_slug) {
    const slug = opportunity.linkedin_url_slug;
    broadcastStatus('active', `Found direct LinkedIn slug for ${opportunity.company_name}. Navigating to people page...`);
    targetUrl = `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent(keywords)}`;
  } else {
    broadcastStatus('active', `No direct URL for ${opportunity.company_name}. Starting LinkedIn search...`);
    targetUrl = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(opportunity.company_name)}`;
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  const tabUpdateListener = async (tabId, info) => {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to settle
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await chrome.tabs.sendMessage(tab.id, { action: "scrapePage", taskId: finalAction.taskId, opportunityId });
      } catch (e) {
        console.error(`Failed to inject script 'content.js' into tab ${tab.id}:`, e);
        broadcastStatus('error', `Could not load script into page. Error: ${e.message}`);
        if (tab.id) chrome.tabs.remove(tab.id);
        if (finalAction.type === 'find_contacts') {
            await updateTaskStatus(finalAction.taskId, "error", `Failed to inject script: ${e.message}`);
            handleTaskCompletion(false);
        }
      }
    }
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);
  return { status: "Discovery process initiated." };
}

// =======================
// ✅ EVENT LISTENERS
// =======================
chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
  if (message.type === "SET_TOKEN") {
    userId = message.userId;
    await chrome.storage.local.set({ token: message.token, userId: message.userId });
    initSupabase(message.token);
    subscribeToTasks();
    pollForPendingTasks();
    sendResponse({ status: "Token received and stored." });
    return true;
  }
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // --- CAPTCHA Emergency Stop ---
  if (message.action === "CAPTCHA_DETECTED") {
    broadcastStatus('error', 'CRITICAL: CAPTCHA detected. Aborting all tasks.');
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    
    // Clear queue and mark current task as failed
    const currentTask = currentOpportunityContext?.finalAction;
    if (currentTask?.type === 'find_contacts') {
        await updateTaskStatus(currentTask.taskId, "error", "CAPTCHA detected on page.");
    }
    taskQueue.length = 0; // Empty the queue
    isTaskActive = false;
    
    // Start a very long cooldown
    startCooldown(true, `CAPTCHA detected. Pausing for safety. Resumes in ~${CAPTCHA_COOLDOWN/60000} minutes.`);
    cooldownState.until = Date.now() + CAPTCHA_COOLDOWN; // Override with extra long cooldown
    return;
  }

  if (message.action === "scrapingError") {
    const errorMsg = `Scraping failed on page: ${message.error}`;
    broadcastStatus('error', errorMsg);
    if (currentOpportunityContext?.finalAction?.type === 'find_contacts') {
        await updateTaskStatus(currentOpportunityContext.finalAction.taskId, "error", errorMsg);
    }
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    currentOpportunityContext = null;
    handleTaskCompletion(false);
    return;
  }

  if (message.action === "scrapedCompanySearchResults") {
    if (!supabase || !currentOpportunityContext) return;

    if (!message.results || message.results.length === 0) {
        const errorMsg = `Could not find any company results for "${currentOpportunityContext.company_name}".`;
        broadcastStatus('error', errorMsg);
        await updateTaskStatus(currentOpportunityContext.finalAction.taskId, "error", errorMsg);
        if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
        currentOpportunityContext = null;
        handleTaskCompletion(false);
        return;
    }

    broadcastStatus('active', `Found ${message.results.length} potential companies. Asking AI to select the best match...`);
    try {
      const { data, error } = await supabase.functions.invoke('select-linkedin-company', { body: { searchResults: message.results, opportunityContext } });
      if (error) throw new Error(error.message);

      broadcastStatus('active', `AI selected a match. Navigating to its people page...`);
      const finalAction = currentOpportunityContext.finalAction;
      const keywords = "human resources OR talent acquisition OR recruiter OR hiring";
      const destinationUrl = `${data.url.replace(/\/$/, '')}/people/?keywords=${encodeURIComponent(keywords)}`;
      
      await chrome.tabs.update(sender.tab.id, { url: destinationUrl });
      const tabUpdateListener = async (tabId, info) => {
        if (tabId === sender.tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(tabUpdateListener);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
          await chrome.tabs.sendMessage(tabId, { action: "scrapePage", taskId: finalAction.taskId, opportunityId: currentOpportunityContext.id });
        }
      };
      chrome.tabs.onUpdated.addListener(tabUpdateListener);
    } catch (e) { 
        broadcastStatus('error', `AI selection failed: ${e.message}`);
        if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
        handleTaskCompletion(false);
    }
  }

  if (message.action === "scrapedData") {
    const { taskId, contacts, error, opportunityId } = message;
    if (error) {
      await updateTaskStatus(taskId, "error", error);
      broadcastStatus('error', `Scraping failed: ${error}`);
    } else if (contacts.length === 0) {
      await updateTaskStatus(taskId, "complete", "No contacts found on page.");
      broadcastStatus('idle', `Task complete for ${currentOpportunityContext?.company_name}. No contacts found.`);
    } else {
      broadcastStatus('active', `Found ${contacts.length} potential contacts. AI is identifying the best ones...`);
      try {
        const { data: aiData, error: aiError } = await supabase.functions.invoke('identify-key-contacts', {
          body: { contacts, opportunityContext: currentOpportunityContext },
        });

        if (aiError) throw new Error(aiError.message);
        
        const recommendedContacts = aiData.recommended_contacts;

        if (recommendedContacts && recommendedContacts.length > 0) {
          broadcastStatus('active', `AI identified ${recommendedContacts.length} key contacts. Saving to database...`);
          await saveContacts(taskId, opportunityId, recommendedContacts);
          await updateTaskStatus(taskId, "complete");
          await broadcastDataUpdate();
          broadcastStatus('idle', `Successfully saved contacts for ${currentOpportunityContext?.company_name}.`);
        } else {
          await updateTaskStatus(taskId, "complete", "AI could not identify any key contacts from the list.");
          broadcastStatus('idle', `Task complete. AI found no key contacts for ${currentOpportunityContext?.company_name}.`);
        }
      } catch (e) {
        const errorMessage = `AI contact identification failed: ${e.message}`;
        await updateTaskStatus(taskId, "error", errorMessage);
        broadcastStatus('error', errorMessage);
      }
    }
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    currentOpportunityContext = null;
    handleTaskCompletion(!error);
  }
});

// =======================
// ✅ INITIALIZATION & DB
// =======================
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
      if (status === 'SUBSCRIBED') {
        console.log("✅ Realtime subscription active for user:", userId);
        broadcastStatus('idle', 'Ready and waiting for tasks.');
      }
      if (err) console.error("❌ Supabase subscription error:", err);
    });
}

async function pollForPendingTasks() {
  if (!supabase || !userId) return;
  const { data, error } = await supabase.from('contact_enrichment_tasks').select('*').eq('user_id', userId).eq('status', 'pending');
  if (error) console.error("Error polling for tasks:", error);
  else if (data && data.length > 0) {
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
  } catch (err) {
    await updateTaskStatus(taskId, "error", `Failed to save contacts: ${err.message}`);
  }
}

async function initializeFromStorage() {
  console.log("Coogi Extension: Service worker starting...");
  const data = await chrome.storage.local.get(['token', 'userId']);
  if (data.token && data.userId) {
    userId = data.userId;
    initSupabase(data.token);
    subscribeToTasks();
    pollForPendingTasks();
  } else {
    broadcastStatus('disconnected', 'Not connected. Please log in to the web app.');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollForPendingTasks();
});

initializeFromStorage();
