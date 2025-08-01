console.log("Coogi Background Script Loaded at:", new Date().toLocaleTimeString());

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

// --- EXPLICIT LOGGER ---
const nativeConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
};

async function broadcastLog(type, ...args) {
  try {
    const prodTabs = await chrome.tabs.query({ url: COOGI_APP_URL });
    const localTabs = await chrome.tabs.query({ url: "http://localhost:*/*" });
    const allTabs = [...prodTabs, ...localTabs];
    const uniqueTabs = Array.from(new Map(allTabs.map(tab => [tab.id, tab])).values());

    for (const tab of uniqueTabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (payload) => {
            window.dispatchEvent(new CustomEvent('coogi-extension-log', { detail: payload }));
          },
          args: [{ type, args }],
          world: 'MAIN'
        });
      } catch (e) { /* Tab might not be ready, ignore */ }
    }
  } catch (e) { nativeConsole.error("Error broadcasting log:", e.message); }
}

const logger = {
  log: (...args) => {
    nativeConsole.log(...args);
    broadcastLog('log', ...args);
  },
  error: (...args) => {
    nativeConsole.error(...args);
    broadcastLog('error', ...args);
  },
  warn: (...args) => {
    nativeConsole.warn(...args);
    broadcastLog('warn', ...args);
  },
  info: (...args) => {
    nativeConsole.info(...args);
    broadcastLog('info', ...args);
  },
};
// --- END LOGGER ---


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
let currentTaskTimeout = null;

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
    const prodTabs = await chrome.tabs.query({ url: COOGI_APP_URL });
    const localTabs = await chrome.tabs.query({ url: "http://localhost:*/*" });
    const allTabs = [...prodTabs, ...localTabs];
    const uniqueTabs = Array.from(new Map(allTabs.map(tab => [tab.id, tab])).values());

    for (const tab of uniqueTabs) {
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
  } catch (e) { logger.error("Error broadcasting status:", e.message); }
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
  logger.log("Attempting to subscribe to Supabase Realtime for tasks...");
  supabaseChannel = supabase
    .channel("contact_enrichment_tasks")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_enrichment_tasks", filter: `user_id=eq.${userId}` }, (payload) => {
      logger.log("Received new task via Realtime:", payload.new);
      const task = payload.new;
      if (task.status === "pending" && task.user_id === userId) enqueueTask(task);
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        logger.log("✅ Realtime subscription active for user:", userId);
        broadcastStatus('idle', 'Ready and waiting for tasks.');
      }
      if (err) logger.error("❌ Supabase subscription error:", err);
      if (status === 'CHANNEL_ERROR') logger.error("❌ Realtime channel error.");
      if (status === 'TIMED_OUT') logger.error("❌ Realtime subscription timed out.");
    });
}

async function initializeFromStorage() {
  logger.log("Coogi Extension: Service worker starting...");
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

  const { data: opportunity, error } = await supabase.from('opportunities').select('company_name, role, location').eq('id', opportunityId).single();

  if (error || !opportunity) {
    const errorMessage = `Could not find opportunity ${opportunityId}: ${error?.message}`;
    broadcastStatus('error', errorMessage);
    if (finalAction.type === 'find_contacts') await updateTaskStatus(finalAction.taskId, "error", errorMessage);
    return { error: errorMessage };
  }
  
  broadcastStatus('active', `Step 1: Searching for company page for ${opportunity.company_name}...`);
  currentOpportunityContext = { id: opportunityId, company_name: opportunity.company_name, role: opportunity.role, location: opportunity.location, finalAction };
  await chrome.storage.session.set({ currentOpportunityContext });
  
  const targetUrl = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(opportunity.company_name)}`;

  const tab = await getLinkedInTab();

  currentTaskTimeout = setTimeout(() => {
    logger.error(`Task timed out waiting for company search results for task ${finalAction.taskId}`);
    updateTaskStatus(finalAction.taskId, "error", "Task timed out during company search.");
    finalizeTask();
  }, 45000); // 45-second timeout

  const tabUpdateListener = async (tabId, info) => {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(tabUpdateListener);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { action: "scrapeCompanySearchResults", taskId: finalAction.taskId, opportunityId });
    }
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);
  
  await chrome.tabs.update(tab.id, { url: targetUrl });

  return { status: "Company search initiated." };
}

chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
  if (message.type === "SET_TOKEN") {
    logger.log("Received SET_TOKEN message from web app.");
    userId = message.userId;
    await chrome.storage.local.set({ token: message.token, userId: message.userId });
    logger.log("User ID and token stored. Initializing Supabase, subscriptions, and polling...");
    initSupabase(message.token);
    subscribeToTasks();
    pollForPendingTasks();
    sendResponse({ status: "Token received and stored." });
    return true;
  }
});

function finalizeTask() {
  if (currentTaskTimeout) {
    clearTimeout(currentTaskTimeout);
    currentTaskTimeout = null;
  }
  if (chrome.action) {
    chrome.action.setBadgeText({ text: "" });
  }
  isTaskActive = false;
  currentOpportunityContext = null;
  chrome.storage.session.remove('currentOpportunityContext');
  startCooldown();
  processQueue();
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'log') {
    logger[message.level](...message.args);
    return;
  }

  if (message.action === "companySearchResults") {
    logger.log(`[BACKGROUND] Received 'companySearchResults'.`);
    if (currentTaskTimeout) clearTimeout(currentTaskTimeout);

    if (!currentOpportunityContext) {
        const data = await chrome.storage.session.get('currentOpportunityContext');
        if (data.currentOpportunityContext) {
            currentOpportunityContext = data.currentOpportunityContext;
            logger.log("Restored opportunity context from session storage.");
        } else {
            logger.error("FATAL: Opportunity context lost and could not be restored. Aborting task.");
            finalizeTask();
            return; 
        }
    }

    const { taskId, opportunityId, html } = message;
    
    if (html) {
      broadcastStatus('active', `Step 2: Asking AI to analyze company search page...`);
      try {
        const payload = { html, opportunityContext: currentOpportunityContext };
        const { data, error } = await supabase.functions.invoke('find-company-url-from-html', {
          body: payload,
        });

        if (error) throw new Error(error.message);
        
        const companyUrl = data.url;
        if (companyUrl) {
          const companySlugMatch = companyUrl.match(/\/company\/([^/]+)/);
          if (!companySlugMatch || !companySlugMatch[1]) {
            throw new Error("Could not parse LinkedIn Company Slug from URL: " + companyUrl);
          }
          const companySlug = companySlugMatch[1];
          logger.log(`Extracted Company Slug: ${companySlug}`);

          const peoplePageUrl = `https://www.linkedin.com/company/${companySlug}/people/`;
          const searchKeywords = "recruiter OR \"talent acquisition\" OR \"hiring manager\"";

          broadcastStatus('active', `Step 3: Navigating to people page for ${currentOpportunityContext.company_name}...`);
          logger.log(`Navigating to people page: ${peoplePageUrl}`);
          
          const tab = await getLinkedInTab();
          
          const tabUpdateListener = async (tabId, changeInfo, tab) => {
            if (tabId === tab.id && changeInfo.status === 'complete' && tab.url?.includes(`/company/${companySlug}/people`)) {
              chrome.tabs.onUpdated.removeListener(tabUpdateListener);
              await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page to be stable
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
              await chrome.tabs.sendMessage(tab.id, { 
                  action: "searchWithinPeoplePage", 
                  keywords: searchKeywords,
                  taskId, 
                  opportunityId 
              });
            }
          };
          chrome.tabs.onUpdated.addListener(tabUpdateListener);
          await chrome.tabs.update(tab.id, { url: peoplePageUrl });

        } else {
          throw new Error("AI could not find a matching company URL on the page.");
        }
      } catch (e) {
        const errorMessage = `AI company parsing failed: ${e.message}`;
        logger.error(errorMessage);
        await updateTaskStatus(taskId, "error", errorMessage);
        broadcastStatus('error', errorMessage);
        finalizeTask();
      }
    } else {
      logger.error("Company search failed. No HTML received from content script.");
      await updateTaskStatus(taskId, "error", "Could not get HTML from LinkedIn page.");
      finalizeTask();
    }
  }

  if (message.action === "peopleSearchResults") {
    logger.log(`[BACKGROUND] Received 'peopleSearchResults'. Checking context...`);
    
    if (!currentOpportunityContext) {
        const data = await chrome.storage.session.get('currentOpportunityContext');
        if (data.currentOpportunityContext) {
            currentOpportunityContext = data.currentOpportunityContext;
            logger.log("Restored opportunity context from session storage for people search.");
        } else {
            logger.error("FATAL: Opportunity context lost during people search. Aborting task.");
            finalizeTask();
            return;
        }
    }
    logger.log("Context check passed.");

    const { taskId, opportunityId, html, error: contentError } = message;

    if (contentError) {
        logger.error(`Content script error: ${contentError}`);
        await updateTaskStatus(taskId, "error", contentError);
        finalizeTask();
        return;
    }
    
    broadcastStatus('active', `AI is analyzing page layout to find contacts...`);
    
    try {
      logger.log("Entering AI analysis try block.");
      if (!html) throw new Error("Could not retrieve HTML from the page.");
      logger.log("HTML is present. Invoking 'parse-linkedin-search-with-ai' function.");

      const { data: aiData, error: aiError } = await supabase.functions.invoke('parse-linkedin-search-with-ai', {
        body: { html, opportunityContext: currentOpportunityContext },
      });
      
      logger.log("'parse-linkedin-search-with-ai' function returned.");
      if (aiError) throw new Error(aiError.message);
      logger.log("No error from function invocation. Processing results.");

      const aiContacts = aiData.results.map(r => ({
        name: r.title,
        job_title: r.subtitle,
        linkedin_profile_url: r.url,
      }));
      logger.log(`Mapped ${aiContacts.length} contacts from AI results.`);

      if (!aiContacts || aiContacts.length === 0) {
        await updateTaskStatus(taskId, "complete", "No contacts were found after AI page parsing.");
        broadcastStatus('idle', `Task complete. No contacts found for ${currentOpportunityContext?.company_name}.`);
      } else {
        logger.log(`Processing ${aiContacts.length} found contacts.`);
        try {
            logger.log("Invoking 'identify-key-contacts' function.");
            const { data: recommendedData, error: recommendError } = await supabase.functions.invoke('identify-key-contacts', {
                body: { contacts: aiContacts, opportunityContext: currentOpportunityContext },
            });
            if (recommendError) throw new Error(recommendError.message);
            logger.log("'identify-key-contacts' returned. Processing recommendations.");

            const recommendedContacts = recommendedData.recommended_contacts;
            if (!recommendedContacts || recommendedContacts.length === 0) {
                await updateTaskStatus(taskId, "complete", "AI found contacts but none were deemed relevant.");
                broadcastStatus('idle', `Task complete. No key contacts identified for ${currentOpportunityContext?.company_name}.`);
            } else {
                logger.log(`AI recommended ${recommendedContacts.length} contacts. Saving to DB.`);
                await saveContacts(taskId, opportunityId, recommendedContacts);
                await updateTaskStatus(taskId, "complete");
                broadcastStatus('idle', `Successfully saved ${recommendedContacts.length} key contacts.`);
            }
        } catch (e) {
            const errorMessage = `AI contact identification failed: ${e.message}`;
            logger.error(errorMessage);
            await updateTaskStatus(taskId, "error", errorMessage);
            broadcastStatus('error', errorMessage);
        }
        logger.log("Finished processing found contacts.");
      }

    } catch (e) {
      const errorMessage = `AI page parsing failed: ${e.message}`;
      logger.error(errorMessage);
      await updateTaskStatus(taskId, "error", errorMessage);
      broadcastStatus('error', errorMessage);
    }
    
    logger.log("Finalizing people search task.");
    finalizeTask();
  }
});

function enqueueTask(task) {
  if (!taskQueue.some(t => t.id === task.id)) {
    logger.log(`Enqueuing task for ${task.company_name} (ID: ${task.id})`);
    taskQueue.push(task);
    broadcastStatus('idle', `New task for ${task.company_name} added to queue.`);
    processQueue();
  } else {
    logger.log(`Task for ${task.company_name} is already in the queue.`);
  }
}

function processQueue() {
  logger.log(`Processing queue. Active: ${isTaskActive}, Cooldown: ${cooldownActive}, Queue size: ${taskQueue.length}`);
  if (isTaskActive || cooldownActive || taskQueue.length === 0) {
    if (!isTaskActive && !cooldownActive) {
      broadcastStatus('idle', 'All tasks complete. Waiting for new tasks.');
    }
    return;
  }
  const nextTask = taskQueue.shift();
  logger.log(`Dequeued task: ${nextTask.id}`);
  handleTask(nextTask);
}

async function handleTask(task) {
  logger.log(`Handling task ID: ${task.id} for company: ${task.company_name}`);
  isTaskActive = true;
  if (chrome.action) {
    chrome.action.setBadgeText({ text: "RUN" });
  }
  await updateTaskStatus(task.id, "processing");
  await startCompanyDiscoveryFlow(task.opportunity_id, { type: 'find_contacts', taskId: task.id });
}

async function pollForPendingTasks() {
  if (!supabase || !userId) return;
  logger.log("Polling for any pending tasks...");
  const { data, error } = await supabase.from('contact_enrichment_tasks').select('*').eq('user_id', userId).eq('status', 'pending');
  if (error) {
    logger.error("Error polling for tasks:", error);
  } else if (data && data.length > 0) {
    logger.log(`Found ${data.length} pending tasks from polling.`);
    data.forEach(task => enqueueTask(task));
  } else {
    logger.log("No pending tasks found during poll.");
  }
}

async function updateTaskStatus(taskId, status, errorMessage = null) {
  if (!supabase) return;
  await supabase.from("contact_enrichment_tasks").update({ status, error_message: errorMessage }).eq("id", taskId);
}

async function saveContacts(taskId, opportunityId, contacts) {
  if (!supabase || contacts.length === 0) return;
  try {
    const contactsToInsert = contacts.map((c) => ({ 
      task_id: taskId, 
      opportunity_id: opportunityId, 
      user_id: userId, 
      name: c.name, 
      job_title: c.job_title, 
      linkedin_profile_url: c.linkedin_profile_url 
    }));
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
