// feature_extractor.js (must match Python extractor)
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normalizeUrlForParsing(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (s === '') return '';
  if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'http://' + s;
  return s;
}

function extractLexicalFeatures(url) {
  const s = url || '';
  const s_norm = normalizeUrlForParsing(s);
  let host = '';
  try { host = new URL(s_norm).hostname || ''; } catch (e) { host = ''; }
  const parts = host.split('.').filter(Boolean);
  const digits = (s.match(/\d/g) || []).length;

  return {
    length: s.length,
    hostname_length: host.length,
    count_dots: (host.match(/\./g) || []).length,
    count_slashes: (s.match(/\//g) || []).length,
    count_hyphens: (s.match(/-/g) || []).length,
    has_ip: IP_RE.test(host) ? 1 : 0,
    count_query: ((s.match(/\?/g) || []).length + (s.match(/&/g) || []).length),
    starts_with_https: s.toLowerCase().startsWith('https') ? 1 : 0,
    contains_at: s.includes('@') ? 1 : 0,
    num_subdomains: Math.max(0, parts.length - 2),
    ratio_digits: s.length ? digits / s.length : 0.0,
    count_encoded: (s.match(/%/g) || []).length,
    tld_len: parts.length > 1 ? parts[parts.length - 1].length : 0
  };
}
