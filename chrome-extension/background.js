/**
 *    Service Worker (background.js) - MV3
 *    Service worker is a script that runs in the background of your browser, independently of the current tab.
 *
 *    Author: Nikolaos Papoutsakis
*/

import { AhoCorasick } from "./aho_corasick.js";
import { loadAutomaton } from "./cache.js";
import { gpu_match_test, cpu_worker_test} from "./tester.js";

// Aho Corasick Instance
let aho = null;
let ahoInitPromise = null;
let flush_timeout = null;
let pending_scans = [];
const scanned_domains = new Set();
const tab_domain_tracker = {};

const NATIVE_HOST_NAME = "com.papou.jarm_scanner";
const WARNING_PAGE = "./redirect_page/blocked.html";

// systematic cleanup of scanned domains every 5 minutes
setInterval(() => {
  scanned_domains.clear();
}, 300000);

// periodic update of the JARM dataset every 8 hours
setInterval(async () => {
  await Promise.all([
    aho.jarmFetcher.fetch_blocklist_jarms(),
    aho.jarmFetcher.fetch_tracker_jarms(),
  ]);
}, 28800000);

const BATCH_TIMEOUT_MS = 1000; // Trigger scan after 1 seconds
const MAX_BATCH_SIZE = 50;     // Trigger scan after 50 items

// upon installation listener
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // download the python scripts for the JARM fingerprinting
    // await Promise.all(['conf/threaded_jarm.py', 'conf/native_host.py'].map(downloadFile));
    
    // download the shell script for the installation process
    // await downloadFile('conf/install.sh');
    
    await getInstance();
    await chrome.storage.local.set({ 'blacklist': [] });
    await chrome.storage.local.set({ 'trackers': {} });
    await chrome.storage.local.set({ 'active': true });
  }
  catch (error) {
    console.error("[-] Installation failed!", error);
  }

  console.log("[+] Service Worker installed successfully.");
  return;
});

// startup listener
chrome.runtime.onStartup.addListener(async () => {
  if (!aho) {
    try{
      await getInstance();
      await chrome.storage.local.set({ 'blacklist': [] });
      await chrome.storage.local.set({ 'trackers': {} });
    }
    catch (error) {
      console.error("[-] Error during startup:", error);
    }
  }
});


// for the background domain requests
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {

    // check if the extension is active
    const storage = await chrome.storage.local.get('active');
    if (!storage['active']) {
      return; 
    }
    
    const url = details.url;
    const domain = new URL(url).hostname;
    
    // block extension requests
    if (url.includes("chrome-extension://")){
      return;
    }

    // Skip invalid tab IDs (service workers, background requests)
    if (details.tabId < 0) {
      return;
    }
    
    // check if the domain name matches with one of the blacklist
    // maybe we add a total blocked on the popup
    const data = await chrome.storage.local.get('blacklist');
    const blacklist = data['blacklist'] || [];

    if (blacklist.includes(domain)) {
      console.log(`[!] Domain ${domain} is on the blacklist. Redirecting immediately.`);
      chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(WARNING_PAGE) });
      return;
    }

    const alreadyScannedForTab = tab_domain_tracker[details.tabId]?.[domain];
    const globallyScanned = scannedDomain(domain);
    
    // If globally scanned and already checked for this tab, skip
    if (globallyScanned && alreadyScannedForTab) {
      return;
    }

    // Mark as scanned globally for malicious checks
    if (!globallyScanned) {
      scanned_domains.add(domain);
    }
    
    // Mark as scanned for this tab (for tracker counting)
    if (!tab_domain_tracker[details.tabId]) {
      tab_domain_tracker[details.tabId] = {};
    }
    tab_domain_tracker[details.tabId][domain] = true;
    
    const start = performance.now();
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { target: domain },
      async (response) => {
        const duration = performance.now() - start;
        
        if (chrome.runtime.lastError) {
          console.error(`[-] Native host error for ${domain}:`, chrome.runtime.lastError.message);
          return;
        }
        
        console.log(`[+] [Time: ${duration.toFixed(2)} ms] JARM response for ${domain}:`, response);
        
        scheduler({
          domain,
          tabId: details.tabId,
          url: details.url,
          jarm: response.JARM,
          frameId: details.frameId,
        });  
      }
    );
  },
  { urls: ["<all_urls>"] }
);


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Update dataset from github source
  if (message.action === "updateJarmDataset") {
    console.log("[+] Starting JARM dataset update from GitHub...");
    Promise.all([
      aho.jarmFetcher.fetch_blocklist_jarms(),
      aho.jarmFetcher.fetch_tracker_jarms(),
    ])
    .then(async ([blocklistJarms, trackerJarms]) => {
      console.log(`[+] Fetched ${blocklistJarms.length} blocklist JARMs and ${trackerJarms.length} tracker JARMs`);
      
      await chrome.storage.local.set({
        ['jarms']: {
          blocklist: blocklistJarms,
          trackers: trackerJarms,
        },
        lastUpdated: new Date().toString(),
      });
      console.log("[+] Saved patterns to storage");
      
      // Rebuild automaton with new patterns
      console.log("[+] Rebuilding automaton...");
      aho = null;
      ahoInitPromise = null;
      await getInstance();
      
      console.log("[+] Dataset update complete!");
      sendResponse({ status: "success" });
    })
    .catch((error) => {
      console.error("[-] Error updating JARM dataset:", error);
      sendResponse({ status: "error", message: error.message });
    });
    return true;
  }

  return false;
});


// Checks whether a domain has been scanned or not
function scannedDomain(domain) {
  return scanned_domains.has(domain);
}


// Adds a domain to the blacklist in chrome local storage
async function addToBlackList(domain) {
  try {
    // get the current blocked domains from storage
    const data = await chrome.storage.local.get('blacklist');
    
    if (chrome.runtime.lastError) {
      console.error("[-] Storage get error before adding to blacklist:", chrome.runtime.lastError);
      return;
    }

    const blacklist = data['blacklist'] || [];
    
    if(!blacklist.includes(domain)) {
      blacklist.push(domain);
      await chrome.storage.local.set({ 'blacklist': blacklist });
      if (chrome.runtime.lastError) {
        console.error("[-] Error adding domain to blacklist:", chrome.runtime.lastError);
        return;
      }
    }
  }
  catch (error) {
    console.error("[-] Error adding domain to blacklist:", error);
  }
}


function scheduler({ domain, tabId, url, jarm, frameId }) {
  pending_scans.push({ domain, tabId, url, jarm, frameId });

  if (pending_scans.length >= MAX_BATCH_SIZE) {
    console.log(`[+] Batch full (${pending_scans.length}), sending to GPU immediately.`);
    clearTimeout(flush_timeout);
    flush_timeout = null;
    sendToGPU();
    return;
  }

  if (!flush_timeout) {
    flush_timeout = setTimeout(() => {
      sendToGPU();
    }, BATCH_TIMEOUT_MS);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        if (tab.url && tab.url.startsWith('chrome://')) return;

        // Clear per-tab domain tracking on navigation
        delete tab_domain_tracker[tabId];

        const data = await chrome.storage.local.get('trackers');
        const counts = data['trackers'] || {};
        
        if (counts[tabId] !== undefined && counts[tabId] !== 0) {
            counts[tabId] = 0;
            await chrome.storage.local.set({ 'trackers': counts });
        } else if (counts[tabId] === undefined) {
            counts[tabId] = 0;
            await chrome.storage.local.set({ 'trackers': counts });
        }
    }
});


chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    // Clean up per-tab domain tracking
    delete tab_domain_tracker[tabId];
    
    const data = await chrome.storage.local.get('trackers');
    const counts = data['trackers'] || {};
    delete counts[tabId]; 
    await chrome.storage.local.set({ 'trackers': counts });
});

async function incrementTrackerCount(tabId) {
    const data = await chrome.storage.local.get('trackers');
    const counts = data['trackers'] || {};
    counts[tabId] += 1;
    await chrome.storage.local.set({ 'trackers': counts });
}


// Sends the pending scans to the GPU for processing
async function sendToGPU() {
  
  // timeout cleanup
  if (flush_timeout) {
    clearTimeout(flush_timeout);
    flush_timeout = null;
  }

  // copy and clear the pending scans
  const batch = pending_scans;
  pending_scans = [];

  const jarm_list = batch.map(scan => scan.jarm);
  try {
    // ensure that the aho is initialized
    await getInstance();
    
    // const startTime = performance.now();
    
    // match 2 automata in parallel
    const [blocklist_results, trackers_results] = await Promise.all([
      aho.match(jarm_list, "blocklist"),  
      aho.match(jarm_list, "trackers")
    ]);

    // const results = await aho.match(jarm_list);
    // const duration = performance.now() - startTime;
    // console.log(`[+] Batch processing completed in ${duration.toFixed(2)} ms`);
    console.log(`[+] Results:`, blocklist_results, trackers_results);

    for (let i = 0; i < batch.length; i++) {
      const { domain, tabId, url } = batch[i];
      const isMalicious = blocklist_results[i];
      const isTracker = trackers_results[i];

      // Skip invalid tab IDs (must be non-negative integer)
      if (!Number.isInteger(tabId) || tabId < 0) {
        console.log(`[+] Skipping ${domain} - invalid tabId: ${tabId}`);
        continue;
      }

      // Check if the tab is still valid before taking action
      const tab = await chrome.tabs.get(tabId).catch((err) => {
        console.log(`[+] Failed to get tab ${tabId}:`, err.message);
        return null;
      });
      if (!tab) {
        console.log(`[+] Tab ${tabId} no longer exists, skipping ${domain}`);
        continue;
      }
      
      if (isMalicious) {
        await addToBlackList(domain);

        if (tab.url === url) {
          chrome.tabs.update(tabId, { url: chrome.runtime.getURL(WARNING_PAGE) });
        }
      } 
      else if (isTracker) {
        await incrementTrackerCount(tabId);
      }
    }
  }
  catch (error) {
    console.error("[-] sendToGPU() failed:", error);
  }
  return;
}


// Singleton, ensures that the Aho is only one and if not we create a new one.
async function getInstance() {
  
  if (aho) {
    return;
  }
  
  // Prevent race conditions - return existing initialization promise
  if (ahoInitPromise) {
    await ahoInitPromise;
    return;
  }

  // Create initialization promise to prevent race conditions
  ahoInitPromise = (async () => {
    // load from cache
    const blocklist_cached = await loadAutomaton("blocklist"); 
    const tracker_cached = await loadAutomaton("trackers");

    aho = new AhoCorasick();
    await aho.init();

    if (blocklist_cached && tracker_cached) {
      console.log("[#] Blocklist cached num_states:", blocklist_cached.num_states);
      // console.log("[#] Blocklist cached table size:", blocklist_cached.table.byteLength);
      // console.log("[#] Blocklist cached output size:", blocklist_cached.output.byteLength);
      
      aho.num_states['blocklist'] = blocklist_cached.num_states;
      aho.table['blocklist'] = blocklist_cached.table;
      aho.output['blocklist'] = blocklist_cached.output;
      
      console.log("[#] trackers cached num_states:", tracker_cached.num_states);
      // console.log("[#] trackers cached table size:", tracker_cached.table.byteLength);
      // console.log("[#] trackers cached output size:", tracker_cached.output.byteLength);
      
      aho.num_states['trackers'] = tracker_cached.num_states;
      aho.table['trackers'] = tracker_cached.table;
      aho.output['trackers'] = tracker_cached.output;
      
      await aho.prepareGPU("blocklist");
      await aho.prepareGPU("trackers");
    }
    else {
      // otherwise just load patterns
      await aho.loadPatterns('blocklist');
      await aho.loadPatterns('trackers');
    }
  })();
  
  try {
    await ahoInitPromise;
  } 
  finally {
    ahoInitPromise = null;
  }
}


// Downloads necessary files (jarm, native host, install.sh)
export async function downloadFile(filename) {
  const response = await fetch(chrome.runtime.getURL(filename));
  if (response.ok) {
    const content = await response.text();
    const dataUrl = `data:py/plain;base64,${btoa(content)}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
    });
    console.log(`[+] ${filename} downloaded successfully`);
    return;
  }
  else {
    console.error(`[-] Failed to download ${filename}`);
  }

  return;
}

// --------------------------------- TESTING ---------------------------------

// Fetches JARMs from a list of domains
async function getJarms(domains) {
  const results = domains.map(domain => {
    return new Promise((resolve) => {
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { 
          target: domain 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[-] Native host error for ${domain}:`, chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          resolve(response?.JARM || null);
        }
      );
    });
  });

  const jarms = await Promise.all(results);
  return jarms.filter(jarm => jarm !== null);
}

// Benchmark
async function runBenchmarks() {
  // 50 fixed domains for testing
  const domains = [
    "google.com", "youtube.com", "facebook.com", "amazon.com", "wikipedia.org",
    "twitter.com", "instagram.com", "linkedin.com", "reddit.com", "netflix.com",
    "microsoft.com", "apple.com", "bing.com", "yahoo.com", "office.com",
    "zoom.us", "ebay.com", "tiktok.com", "pinterest.com", "imdb.com",
    "cnn.com", "bbc.com", "nytimes.com", "foxnews.com", "theguardian.com",
    "whatsapp.com", "dropbox.com", "spotify.com", "adobe.com", "paypal.com",
    "cloudflare.com", "github.com", "bitbucket.org", "stackoverflow.com", "medium.com",
    "wordpress.com", "quora.com", "tumblr.com", "slack.com", "trello.com",
    "canva.com", "hulu.com", "espn.com", "ny.gov", "whitehouse.gov",
    "who.int", "cdc.gov", "nasa.gov", "weather.com", "booking.com",
  ];


  // get the JARM for each domain
  await getInstance();
  const jarms = await getJarms(domains);

  // GPU test
  const gpu_timer_start = performance.now();
  await gpu_match_test(jarms, aho, 'blocklist');
  const gpu_timer_end = performance.now();
  console.log(`[GPU] Time: ${(gpu_timer_end - gpu_timer_start).toFixed(2)} ms`);
  
  // Web Worker test
  await cpu_worker_test(jarms, 'blocklist');
  
  return;
}

// End of Service Worker (background.js) - MV3
self.runBenchmarks = runBenchmarks;