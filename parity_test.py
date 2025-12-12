# parity_test.py
import pandas as pd
import joblib
from src.py.features import extract_lexical_features

MODEL_PATH = "models/rf_model.joblib"
SAMPLE_OUT = "parity_sample.csv"

clf = joblib.load(MODEL_PATH)
df = pd.read_csv("data/data.csv").dropna(subset=['url','label']).sample(min(200, len(pd.read_csv("data/data.csv"))), random_state=42)

rows = []
for _, r in df.iterrows():
    u = r['url']
    feats = extract_lexical_features(u)
    X = [[feats[f] for f in [
        'length','hostname_length','count_dots','count_slashes','count_hyphens',
        'has_ip','count_query','starts_with_https','contains_at','num_subdomains',
        'ratio_digits','count_encoded','tld_len'
    ]]]
    prob = float(clf.predict_proba(X)[0][1])
    rows.append({'url': u, 'py_prob': prob, 'label': int(r['label'])})

pd.DataFrame(rows).to_csv(SAMPLE_OUT, index=False)
print("Saved sample with python probs to", SAMPLE_OUT)
