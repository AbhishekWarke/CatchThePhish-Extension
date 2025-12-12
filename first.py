# first.py
import pandas as pd
import re
from urllib.parse import urlparse
import os

# ---------- helper: feature extractor ----------
IP_RE = re.compile(r'^(?:\d{1,3}\.){3}\d{1,3}$')

def normalize_url_for_parsing(url: str) -> str:
    if not isinstance(url, str):
        return ''
    if not url.startswith(('http://', 'https://')):
        return 'http://' + url
    return url

def extract_features(url: str):
    s = url or ''
    s_norm = normalize_url_for_parsing(s)
    try:
        parsed = urlparse(s_norm)
    except Exception:
        parsed = None
    host = parsed.hostname if parsed and parsed.hostname else ''

    features = {}
    features['url'] = s
    features['length'] = len(s)
    features['hostname_length'] = len(host)
    features['count_dots'] = host.count('.')
    features['count_slashes'] = s.count('/')
    features['count_hyphens'] = s.count('-')
    features['has_ip'] = 1 if IP_RE.match(host) else 0
    features['count_query'] = s.count('?') + s.count('&')
    features['starts_with_https'] = 1 if s.lower().startswith('https') else 0
    features['contains_at'] = 1 if '@' in s else 0
    features['num_subdomains'] = max(0, len([p for p in host.split('.') if p]) - 2)
    digits = sum(c.isdigit() for c in s)
    features['ratio_digits'] = digits / len(s) if len(s) else 0.0
    features['count_encoded'] = s.count('%')
    parts = host.split('.')
    features['tld_len'] = len(parts[-1]) if len(parts) > 1 else 0
    return features

# ---------- 1) load dataset ----------
csv_path = "phish.csv"   # adjust if file name differs
if not os.path.exists(csv_path):
    raise FileNotFoundError(f"{csv_path} not found in current folder: {os.getcwd()}")

df = pd.read_csv(csv_path, low_memory=False)
print("\n--- Preview (first 5 rows) ---")
print(df.head().to_string())

print("\n--- Shape & columns ---")
print("shape:", df.shape)
print("columns:", list(df.columns))

print("\n--- dtypes ---")
print(df.dtypes)

# ---------- 2) find URL and label columns ----------
# common URL column names: 'url','URL','URL_of_website','web','host'
# common label column names: 'label','Result','Class','status'
possible_url_cols = [c for c in df.columns if 'url' in c.lower() or 'website' in c.lower() or 'link' in c.lower() or 'domain' in c.lower() or 'host' in c.lower()]
possible_label_cols = [c for c in df.columns if c.lower() in ('label','result','class','status') or 'label' in c.lower() or 'result' in c.lower()]

print("\nPossible URL columns found:", possible_url_cols)
print("Possible label columns found:", possible_label_cols)

# if you see the correct column names in the printout above, set them here:
# e.g. URL_COL = 'URL' ; LABEL_COL = 'Result'
# otherwise auto-pick the first guesses:
URL_COL = possible_url_cols[0] if possible_url_cols else None
LABEL_COL = possible_label_cols[0] if possible_label_cols else None

if URL_COL is None:
    raise ValueError("Couldn't identify URL column automatically. Edit first.py and set URL_COL to the column name that contains URLs.")
if LABEL_COL is None:
    print("Warning: couldn't clearly identify label column. The dataset may be unlabeled. Continuing without label mapping.")
else:
    print(f"\nUsing URL column: {URL_COL}")
    print(f"Using Label column: {LABEL_COL}")

# ---------- 3) quick label inspection and mapping ----------
if LABEL_COL:
    unique_labels = df[LABEL_COL].unique().tolist()
    print("\nLabel unique values (raw):", unique_labels)

    # Map common patterns to 0/1
    def map_label(v):
        if pd.isna(v):
            return None
        if isinstance(v, (int, float)):
            # e.g. -1/1 or 0/1
            if v in (-1, '-1'):
                return 1  # treat -1 as phishing if your dataset uses -1 for phishing
            if v == 1 or v == '1':
                return 1
            if v == 0 or v == '0':
                return 0
            # fallback numeric threshold
            return 1 if v > 0 else 0
        s = str(v).strip().lower()
        if s in ('phishing','phish','malicious','bad','1','-1'):
            return 1
        if s in ('benign','legitimate','legit','good','0','safe','normal'):
            return 0
        # unknown -> return None
        return None

    df['_label_mapped'] = df[LABEL_COL].apply(map_label)
    print("\nMapped label value counts (after mapping):")
    print(df['_label_mapped'].value_counts(dropna=False))

    print("\nRows with unmapped labels (if any):")
    print(df[df['_label_mapped'].isna()].head())

# ---------- 4) clean: drop rows with missing URL or missing label (optional) ----------
before = len(df)
df = df.dropna(subset=[URL_COL])   # must have a URL
after_url = len(df)
print(f"\nDropped {before-after_url} rows with missing URL.")

if LABEL_COL:
    # if you want to drop rows where label mapping failed:
    before2 = len(df)
    df = df.dropna(subset=['_label_mapped'])
    after_label = len(df)
    print(f"Dropped {before2-after_label} rows with unmapped labels (if any).")

# drop exact duplicate URLs
before_dup = len(df)
df = df.drop_duplicates(subset=[URL_COL])
after_dup = len(df)
print(f"Dropped {before_dup-after_dup} duplicate URLs.")

# ---------- 5) extract features for every URL ----------
print("\nExtracting features (this may take a few seconds)...")
rows = []
for idx, row in df.iterrows():
    url = row[URL_COL]
    f = extract_features(url)
    # keep label if exists
    if LABEL_COL:
        f['label'] = int(row['_label_mapped'])
    rows.append(f)

X = pd.DataFrame(rows)
out_path = "processed_features.csv"
X.to_csv(out_path, index=False)
print(f"Saved processed features to {out_path}. Shape: {X.shape}")

# ---------- 6) save small sample for parity testing ----------
sample_path = "parity_sample.csv"
X.sample(min(200, len(X))).to_csv(sample_path, index=False)
print(f"Saved small sample for parity tests to {sample_path}")

# ---------- 7) show quick stats ----------
if 'label' in X.columns:
    print("\nLabel distribution in processed features:")
    print(X['label'].value_counts())

print("\nFeature preview:")
print(X.head().to_string())

# ---------- 8) optional: produce simple histograms (requires matplotlib) ----------
try:
    import matplotlib.pyplot as plt
    numeric_cols = [c for c in X.columns if X[c].dtype.kind in 'fi' and c!='label']
    for col in ['length','count_dots','ratio_digits'][:3]:
        if col in X.columns:
            plt.figure()
            X[col].hist(bins=50)
            plt.title(col)
            plt.savefig(f'hist_{col}.png')
            plt.close()
    print("Saved example histograms: hist_length.png, hist_count_dots.png, hist_ratio_digits.png")
except Exception as e:
    print("matplotlib not available or failed - skipping plots.", str(e))

print("\nDone.")
