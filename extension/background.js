// background.js - unified model loader and badge setter
let MODEL = null;

async function loadModel(){
  try {
    const r = await fetch(chrome.runtime.getURL('model_rules.json'));
    if (!r.ok) throw new Error('model not found');
    MODEL = await r.json();
    console.log('Background: model loaded,', MODEL.trees.length, 'trees');
  } catch(e){
    console.error('Background loadModel error', e);
    MODEL = null;
  }
}

function extractLexicalFeaturesObj(url){
  if (!url || typeof url !== 'string') return null;
  let s = url.trim();
  if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'http://' + s;
  let host = '';
  try { host = new URL(s).hostname || ''; } catch(e){ host = ''; }
  const parts = host.split('.').filter(Boolean);
  const digits = (s.match(/\d/g) || []).length;
  return {
    length: s.length,
    hostname_length: host.length,
    count_dots: (host.match(/\./g) || []).length,
    count_slashes: (s.match(/\//g) || []).length,
    count_hyphens: (s.match(/-/g) || []).length,
    has_ip: /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ? 1 : 0,
    count_query: (s.match(/\?/g)||[]).length + (s.match(/&/g)||[]).length,
    starts_with_https: s.toLowerCase().startsWith('https') ? 1 : 0,
    contains_at: s.includes('@') ? 1 : 0,
    num_subdomains: Math.max(0, parts.length - 2),
    ratio_digits: s.length ? digits / s.length : 0.0,
    count_encoded: (s.match(/%/g)||[]).length,
    tld_len: parts.length > 1 ? parts[parts.length - 1].length : 0
  };
}

function evalNode(node, features){
  if (node.node_type === 'leaf') return node.prob_phish;
  const val = features[node.feature] ?? 0;
  if (val <= node.threshold) return evalNode(node.left, features);
  return evalNode(node.right, features);
}

function predictForest(modelJson, features){
  if (!modelJson || !modelJson.trees) return 0;
  let sum = 0;
  for (let i=0;i<modelJson.trees.length;i++){
    sum += evalNode(modelJson.trees[i], features);
  }
  return sum / modelJson.trees.length;
}

function setBadgeForTab(tabId, prob){
  try {
    const pct = Math.round(prob*100).toString();
    chrome.action.setBadgeText({ text: pct, tabId });
    const color = prob >= 0.7 ? [239,68,68,255] : prob >= 0.4 ? [251,191,36,255] : [16,185,129,255];
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch(e){ }
}

async function evaluateTab(tabId, url){
  if (!url || url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('file://')) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }
  if (!MODEL) {
    await loadModel();
    if (!MODEL) return;
  }
  const feats = extractLexicalFeaturesObj(url);
  if (!feats) return;
  const prob = predictForest(MODEL, feats);
  setBadgeForTab(tabId, prob);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.url) {
    evaluateTab(tabId, tab.url);
  }
});
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) evaluateTab(tab.id, tab.url);
  } catch(e){ }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'setBadge') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    const prob = typeof msg.prob === 'number' ? msg.prob : null;
    if (tabId != null && prob != null) {
      setBadgeForTab(tabId, prob);
      sendResponse({ ok:true });
      return true;
    }
  }
});

loadModel();
