# src/py/features.py
import re
from urllib.parse import urlparse

IP_RE = re.compile(r'^(?:\d{1,3}\.){3}\d{1,3}$')

def normalize_url_for_parsing(url: str) -> str:
    if not isinstance(url, str):
        return ''
    s = url.strip()
    if s == '':
        return ''
    if not s.startswith(('http://','https://')):
        s = 'http://' + s
    return s

def extract_lexical_features(url: str):
    """
    Return a dict containing lexical features for the given url string.
    Order of keys must be stable.
    """
    s = url or ''
    s_norm = normalize_url_for_parsing(s)
    try:
        parsed = urlparse(s_norm)
    except Exception:
        parsed = None
    host = parsed.hostname if parsed and parsed.hostname else ''
    parts = [p for p in host.split('.') if p]

    features = {}
    features['length'] = len(s)
    features['hostname_length'] = len(host)
    features['count_dots'] = host.count('.')
    features['count_slashes'] = s.count('/')
    features['count_hyphens'] = s.count('-')
    features['has_ip'] = 1 if IP_RE.match(host) else 0
    features['count_query'] = s.count('?') + s.count('&')
    features['starts_with_https'] = 1 if s.lower().startswith('https') else 0
    features['contains_at'] = 1 if '@' in s else 0
    features['num_subdomains'] = max(0, len(parts) - 2)
    digits = sum(1 for c in s if c.isdigit())
    features['ratio_digits'] = digits / len(s) if len(s) else 0.0
    features['count_encoded'] = s.count('%')
    features['tld_len'] = len(parts[-1]) if len(parts) > 1 else 0

    return features
