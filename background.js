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

// ========================================
// 🔥 NEW HANDSHAKE FIX
// ========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'APP_READY') {
    console.log("[Coogi] Background got APP_READY → sending ACK");
    sendResponse({ status: 'alive', message: 'Handshake successful' });
    return true;
  }
});

// ========================================
// ✅ STATUS BROADCAST (unchanged)
// ========================================
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

// ========================================
// ✅ Supabase Init & Session Restore
// ========================================
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
    broadcastStatus('disconnected', 'Not connected. Please log in to the web app.');
  }
}

// ========================================
// ✅ Core Task Flow (unchanged)
// ========================================
// (Keep all your original scraping logic here exactly as before)

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollForPendingTasks();
});

initializeFromStorage();
