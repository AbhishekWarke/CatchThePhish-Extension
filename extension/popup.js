// popup.js - compute prob and tell background to update badge
(async () => {
  const $ = id => document.getElementById(id);

  /* -------------------------
     Load rule-based model JSON
  ------------------------- */
  async function loadModel(){
    try {
      const r = await fetch(chrome.runtime.getURL('model_rules.json'));
      if (!r.ok) throw new Error('model not found');
      return await r.json();
    } catch(e) {
      console.error('popup loadModel error', e);
      return null;
    }
  }

  /* -------------------------
     Lexical feature extraction
  ------------------------- */
  function extractLexicalFeatures(url){
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

  /* -------------------------
     Decision tree evaluation
  ------------------------- */
  function evalNode(node, features){
    if (node.node_type === 'leaf') return node.prob_phish;
    const val = features[node.feature] ?? 0;
    if (val <= node.threshold) return evalNode(node.left, features);
    return evalNode(node.right, features);
  }
  function predictForest(modelJson, features){
    if (!modelJson || !modelJson.trees) return 0;
    let sum = 0;
    for (let i=0;i<modelJson.trees.length;i++) sum += evalNode(modelJson.trees[i], features);
    return sum / modelJson.trees.length;
  }

  /* -------------------------
     Render circular progress ring
     pct = 0..100
  ------------------------- */
  function renderRing(pct, color){
    const wrap = $('ringWrap');
    wrap.innerHTML = '';
    const size = 64, stroke=8;
    const radius = (size - stroke)/2, circ = 2*Math.PI*radius;
    const offset = circ * (1 - Math.max(0, Math.min(100, pct))/100);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS,'svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    // background ring
    const bg = document.createElementNS(svgNS,'circle');
    bg.setAttribute('cx', size/2); bg.setAttribute('cy', size/2); bg.setAttribute('r', radius);
    bg.setAttribute('stroke','#2b2b2b'); bg.setAttribute('stroke-width', stroke); bg.setAttribute('fill','none');
    // foreground ring
    const fg = document.createElementNS(svgNS,'circle');
    fg.setAttribute('cx', size/2); fg.setAttribute('cy', size/2); fg.setAttribute('r', radius);
    fg.setAttribute('stroke', color); fg.setAttribute('stroke-width', stroke); fg.setAttribute('stroke-linecap','round');
    fg.setAttribute('fill','none'); fg.setAttribute('stroke-dasharray', `${circ} ${circ}`); fg.setAttribute('stroke-dashoffset', offset);
    svg.appendChild(bg); svg.appendChild(fg);
    wrap.appendChild(svg);
    const center = document.createElement('div'); center.className='center'; center.innerText = `${Math.round(pct)}%`;
    wrap.appendChild(center);
  }

  /* -------------------------
     Map probability to label + color
     (prob = 0..1)
  ------------------------- */
  function probToStyle(prob){
    if (prob >= 0.7) return { label: 'DANGEROUS', color:'#ef4444', level: 'danger' };
    if (prob >= 0.4) return { label: 'SUSPICIOUS', color:'#f59e0b', level: 'suspicious' };
    return { label: 'SAFE', color:'#10b981', level: 'safe' };
  }

  /* -------------------------
     Friendly messages for user (not technical)
  ------------------------- */
  function friendlyMessage(prob){
    if (prob >= 0.7) return 'Multiple risk signals detected. Avoid interacting with this site.';
    if (prob >= 0.4) return 'This website shows unusual patterns. Exercise caution.';
    return 'This website appears normal and safe to browse.';
  }

  /* -------------------------
     Utility: normalize url (ensure protocol)
  ------------------------- */
  function normalizeUrlInput(input){
    if (!input) return '';
    let s = input.trim();
    if (!s) return '';
    // if it's already a data: or about: or chrome, accept as-is
    if (/^[a-zA-Z]+:/.test(s)) return s;
    return (s.startsWith('http://') || s.startsWith('https://')) ? s : ('https://' + s);
  }

  /* -------------------------
     Badge update to background script
  ------------------------- */
  function sendBadgeUpdate(tabId, prob){
    chrome.runtime.sendMessage({ type: 'setBadge', tabId, prob }, (resp) => {});
  }

  /* -------------------------
     Model load & initial checks
  ------------------------- */
  const model = await loadModel();
  if (!model) {
    const statusText = $('statusText');
    if (statusText) { statusText.innerText = 'Model not loaded'; statusText.style.color = '#666'; }
    const e = $('explain'); if (e) e.innerText = 'Place model_rules.json inside extension folder.';
  }

  /* -------------------------
     Helper to set status UI (heading + color)
  ------------------------- */
  function setStatus(text, color){
    const st = $('statusText');
    if (st) { st.innerText = text; st.style.color = color; }
  }

  /* -------------------------
     Update the UI with a URL (sets Current URL display)
  ------------------------- */
  function updateCurrentUrlDisplay(fullUrl){
    const el = $('currentUrlText');
    if (!el) return;
    el.innerText = fullUrl || '—';
  }

  /* -------------------------
     Event: Check Current Page URL (active tab)
  ------------------------- */
  $('btnUseTab').addEventListener('click', async () => {
    // query active tab
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const url = tabs && tabs[0] ? tabs[0].url || '' : '';
    // fill input and display
    const norm = normalizeUrlInput(url);
    $('url').value = norm;
    updateCurrentUrlDisplay(norm || '—');

    if (model && norm) {
      const feats = extractLexicalFeatures(norm);
      const prob = predictForest(model, feats);
      const style = probToStyle(prob);
      renderRing(prob*100, style.color);
      setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
      $('explain').innerText = friendlyMessage(prob);
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (tabId != null) sendBadgeUpdate(tabId, prob);
    } else {
      // no model or no url
      renderRing(0, '#10b981');
      setStatus('Waiting for URL…', '#6b7280');
      $('explain').innerText = '';
    }
  });

  /* -------------------------
     Event: Manual Check (search)
  ------------------------- */
  $('btnCheck').addEventListener('click', () => {
    const raw = $('url').value.trim();
    const norm = normalizeUrlInput(raw);
    if (!norm) {
      setStatus('Enter URL or use current page', '#666');
      return;
    }
    updateCurrentUrlDisplay(norm);
    if (!model) return;
    const feats = extractLexicalFeatures(norm);
    const prob = predictForest(model, feats);
    const style = probToStyle(prob);
    renderRing(prob*100, style.color);
    setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
    $('explain').innerText = friendlyMessage(prob);
    // update badge for active tab if available
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (tabId != null) sendBadgeUpdate(tabId, prob);
    });
  });

  /* -------------------------
     Copy current URL (uses Current URL display)
  ------------------------- */
  $('btnCopy').addEventListener('click', async () => {
    const txt = $('currentUrlText').innerText || '';
    if (!txt || txt === '—' || txt === 'Loading…') return;
    try { await navigator.clipboard.writeText(txt); } catch(e){ console.error(e); }
  });

  /* -------------------------
     Open current URL in new tab
  ------------------------- */
  $('btnOpen').addEventListener('click', () => {
    const txt = $('currentUrlText').innerText || '';
    if (!txt || txt === '—' || txt === 'Loading…') return;
    const to = txt.startsWith('http') ? txt : ('https://' + txt);
    chrome.tabs.create({ url: to });
  });

  /* -------------------------
     On popup load: populate input from active tab and auto-check if possible
  ------------------------- */
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    const url = t ? (t.url || '') : '';
    const norm = normalizeUrlInput(url);
    if (norm) {
      $('url').value = norm;
      updateCurrentUrlDisplay(norm);
    } else {
      updateCurrentUrlDisplay('—');
    }

    if (model && norm) {
      const feats = extractLexicalFeatures(norm);
      const prob = predictForest(model, feats);
      const style = probToStyle(prob);
      renderRing(prob*100, style.color);
      setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
      $('explain').innerText = friendlyMessage(prob);
      if (t && t.id) sendBadgeUpdate(t.id, prob);
    } else {
      renderRing(0, '#10b981');
      setStatus('Waiting for URL…', '#6b7280');
      $('explain').innerText = '';
    }
  });

})();
