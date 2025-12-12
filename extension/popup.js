// popup.js - compute prob and tell background to update badge (keeps both consistent)
(async () => {
  const $ = id => document.getElementById(id);

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

  function renderRing(pct, color){
    const wrap = $('ringWrap');
    wrap.innerHTML = '';
    const size = 64, stroke=8;
    const radius = (size - stroke)/2, circ = 2*Math.PI*radius;
    const offset = circ * (1 - pct/100);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS,'svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    const bg = document.createElementNS(svgNS,'circle');
    bg.setAttribute('cx', size/2); bg.setAttribute('cy', size/2); bg.setAttribute('r', radius);
    bg.setAttribute('stroke','#f1f5f9'); bg.setAttribute('stroke-width', stroke); bg.setAttribute('fill','none');
    const fg = document.createElementNS(svgNS,'circle');
    fg.setAttribute('cx', size/2); fg.setAttribute('cy', size/2); fg.setAttribute('r', radius);
    fg.setAttribute('stroke', color); fg.setAttribute('stroke-width', stroke); fg.setAttribute('stroke-linecap','round');
    fg.setAttribute('fill','none'); fg.setAttribute('stroke-dasharray', `${circ} ${circ}`); fg.setAttribute('stroke-dashoffset', offset);
    svg.appendChild(bg); svg.appendChild(fg);
    wrap.appendChild(svg);
    const center = document.createElement('div'); center.className='center'; center.innerText = `${Math.round(pct)}%`;
    wrap.appendChild(center);
  }

  function probToStyle(prob){
    if (prob >= 0.7) return { label: 'DANGEROUS', color:'#ef4444' };
    if (prob >= 0.4) return { label: 'SUSPICIOUS', color:'#f59e0b' };
    return { label: 'SAFE', color:'#0ea44a' };
  }

  function shortExplain(features){
    const reasons = [];
    if (!features) return '';
    if (features.length > 75) reasons.push('Long URL');
    if (features.contains_at) reasons.push('Contains @');
    if (features.count_dots > 3) reasons.push('Many subdomains');
    if (features.has_ip) reasons.push('IP in host');
    if (features.ratio_digits > 0.2) reasons.push('High digit ratio');
    return reasons.length ? reasons.join(', ') : 'No obvious lexical signals';
  }

  function sendBadgeUpdate(tabId, prob){
    chrome.runtime.sendMessage({ type: 'setBadge', tabId, prob }, (resp) => {});
  }

  const model = await loadModel();
  if (!model) {
    const statusText = $('statusText');
    if (statusText) { statusText.innerText = 'Model not loaded'; statusText.style.color = '#666'; }
    const e = $('explain'); if (e) e.innerText = 'Place model_rules.json inside extension folder.';
  }

  const $id = id => document.getElementById(id);
  function setStatus(text, color){
    $id('statusText').innerText = text;
    $id('statusText').style.color = color;
  }

  $id('btnUseTab').addEventListener('click', async () => {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const url = tabs && tabs[0] ? tabs[0].url || '' : '';
    $id('url').value = url;
    if (model && url) {
      const feats = extractLexicalFeatures(url);
      const prob = predictForest(model, feats);
      const style = probToStyle(prob);
      renderRing(prob*100, style.color);
      setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
      $id('explain').innerText = shortExplain(feats);
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (tabId != null) sendBadgeUpdate(tabId, prob);
    }
  });

  $id('btnCheck').addEventListener('click', () => {
    const url = $id('url').value.trim();
    if (!url) return setStatus('Enter URL or use tab', '#666');
    if (!model) return;
    const feats = extractLexicalFeatures(url);
    const prob = predictForest(model, feats);
    const style = probToStyle(prob);
    renderRing(prob*100, style.color);
    setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
    $id('explain').innerText = shortExplain(feats);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (tabId != null) sendBadgeUpdate(tabId, prob);
    });
  });

  $id('btnCopy').addEventListener('click', async () => {
    const txt = $id('url').value.trim();
    if (!txt) return;
    try { await navigator.clipboard.writeText(txt); } catch(e){ }
  });

  $id('btnOpen').addEventListener('click', () => {
    const txt = $id('url').value.trim();
    if (!txt) return;
    const to = txt.startsWith('http') ? txt : ('https://' + txt);
    chrome.tabs.create({ url: to });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    const url = t ? t.url || '' : '';
    if (url) $id('url').value = url;
    if (model && url) {
      const feats = extractLexicalFeatures(url);
      const prob = predictForest(model, feats);
      const style = probToStyle(prob);
      renderRing(prob*100, style.color);
      setStatus(`${style.label} — ${Math.round(prob*100)}%`, style.color);
      $id('explain').innerText = shortExplain(feats);
      if (t && t.id) sendBadgeUpdate(t.id, prob);
    } else {
      renderRing(0, '#0ea44a');
      setStatus('Waiting for URL…', '#6b7280');
      $id('explain').innerText = '';
    }
  });

})();
