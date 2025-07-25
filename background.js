import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

const SUPABASE_URL = "https://dbtdplhlatnlzcvdvptn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGRwbGhsYXRubHpjdmR2cHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NDk3MTIsImV4cCI6MjA2ODUyNTcxMn0.U3pnytCxcEoo_bJGLzjeNdt_qQ9eX8dzwezrxXOaOfA";
const ALARM_NAME = 'poll-tasks-alarm';
const COOGI_APP_URL = "https://dbtdplhlatnlzcvdvptn.dyad.sh/*";

let supabase = null;
let supabaseChannel = null;
let userId = null;

let isTaskActive = false;
let cooldownActive = false;
const taskQueue = [];
let currentOpportunityContext = null;
let currentStatus = { status: 'disconnected', message: 'Initializing...' };
let linkedInTabId = null;

async function getLinkedInTab() {
  if (linkedInTabId) {
    try {
      const tab = await chrome.tabs.get(linkedInTabId);
      return tab;
    } catch (e) {
      linkedInTabId = null;
    }
  }

  const existingTabs = await chrome.tabs.query({ url: "https://*.linkedin.com/*" });
  if (existingTabs.length > 0) {
    linkedInTabId = existingTabs[0].id;
    return existingTabs[0];
  }

  const newTab = await chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: false });
  linkedInTabId = newTab.id;
  return newTab;
}

async function broadcastStatus(status, message) {
  currentStatus = { status, message };
  try {
    const tabs = await chrome.tabs.query({ url: COOGI_APP_URL });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (payload) => {
            window.dispatchEvent(new CustomEvent('coogi-extension-status', { detail: payload }));
          },
          args: [currentStatus],
          world: 'MAIN'
        });
      } catch (e) { /* Tab might not be ready, ignore */ }
    }
  } catch (e) { console.error("Error broadcasting status:", e.message); }
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

function subscribeToTasks() {
  if (!supabase || !userId || (supabaseChannel && supabaseChannel.state === 'joined')) return;
  if (supabaseChannel) supabase.removeChannel(supabaseChannel);
  supabaseChannel = supabase
    .channel("contact_enrichment_tasks")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_enrichment_tasks", filter: `user_id=eq.${userId}` }, (payload) => {
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
  
  broadcastStatus('active', `Starting discovery for ${opportunity.company_name}...`);
  currentOpportunityContext = { id: opportunityId, company_name: opportunity.company_name, role: opportunity.role, location: opportunity.location, finalAction };
  
  const keywords = "human resources OR talent acquisition OR recruiter OR hiring";
  let targetUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(opportunity.company_name + ' ' + keywords)}`;

  const tab = await getLinkedInTab();
  await chrome.tabs.update(tab.id, { url: targetUrl });

  const tabUpdateListener = async (tabId, info) => {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { action: "scrapeEmployees", taskId: finalAction.taskId, opportunityId });
    }
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);
  return { status: "Discovery process initiated." };
}

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
  if (message.action === "scrapedData") {
    const { taskId, contacts, error, opportunityId } = message;
    if (error) {
      await updateTaskStatus(taskId, "error", error);
      broadcastStatus('error', `Scraping failed: ${error}`);
    } else if (contacts.length === 0) {
        await updateTaskStatus(taskId, "complete", "No contacts found on page.");
        broadcastStatus('idle', `Task complete. No contacts found for ${currentOpportunityContext?.company_name}.`);
    } else {
      broadcastStatus('active', `Found ${contacts.length} contacts. AI is identifying key contacts...`);
      try {
        const { data: aiData, error: aiError } = await supabase.functions.invoke('identify-key-contacts', {
          body: { contacts, opportunityContext: currentOpportunityContext },
        });
        if (aiError) throw new Error(aiError.message);
        
        const recommendedContacts = aiData.recommended_contacts;
        if (recommendedContacts && recommendedContacts.length > 0) {
          await saveContacts(taskId, opportunityId, recommendedContacts);
          await updateTaskStatus(taskId, "complete");
          broadcastStatus('idle', `Successfully saved ${recommendedContacts.length} contacts.`);
        } else {
          await updateTaskStatus(taskId, "complete", "AI found no key contacts from the list.");
          broadcastStatus('idle', `Task complete. AI found no key contacts.`);
        }
      } catch (e) {
        const errorMessage = `AI contact identification failed: ${e.message}`;
        await updateTaskStatus(taskId, "error", errorMessage);
        broadcastStatus('error', errorMessage);
      }
    }
    // The tab is no longer removed here
    isTaskActive = false;
    startCooldown();
    processQueue();
  }
});

function enqueueTask(task) {
  if (!taskQueue.some(t => t.id === task.id)) {
    taskQueue.push(task);
    broadcastStatus('idle', `New task for ${task.company_name} added to queue.`);
    processQueue();
  }
}

function processQueue() {
  if (isTaskActive || cooldownActive || taskQueue.length === 0) {
    if (!isTaskActive && !cooldownActive) {
      broadcastStatus('idle', 'All tasks complete. Waiting for new tasks.');
    }
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

function startCooldown() {
  cooldownActive = true;
  const cooldownTime = Math.floor(Math.random() * (60000 - 20000 + 1)) + 20000;
  broadcastStatus('cooldown', `Taking a short break to appear human...`);
  setTimeout(() => {
    cooldownActive = false;
    processQueue();
  }, cooldownTime);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollForPendingTasks();
});

initializeFromStorage();
