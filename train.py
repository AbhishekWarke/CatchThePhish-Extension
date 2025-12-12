# train.py
import os
import json
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, roc_auc_score
import joblib
from src.py.features import extract_lexical_features

DATA_PATH = "data/data.csv"   # your raw dataset (url,label)
MODEL_DIR = "models"
MODEL_PATH = os.path.join(MODEL_DIR, "rf_model.joblib")
JSON_PATH = os.path.join("site", "model_rules.json")

# stable feature order (must match JS)
FEATURE_ORDER = [
    'length','hostname_length','count_dots','count_slashes','count_hyphens',
    'has_ip','count_query','starts_with_https','contains_at','num_subdomains',
    'ratio_digits','count_encoded','tld_len'
]

def build_feature_matrix(urls):
    rows = []
    for u in urls:
        feats = extract_lexical_features(u)
        rows.append([feats[k] for k in FEATURE_ORDER])
    return pd.DataFrame(rows, columns=FEATURE_ORDER)

def export_forest_to_json(rf, feature_names, out_file):
    from sklearn.tree import _tree
    forest = []
    for estimator in rf.estimators_:
        tree_ = estimator.tree_
        def recurse(node):
            if tree_.feature[node] != _tree.TREE_UNDEFINED:
                return {
                    'node_type': 'internal',
                    'feature': feature_names[int(tree_.feature[node])],
                    'threshold': float(tree_.threshold[node]),
                    'left': recurse(int(tree_.children_left[node])),
                    'right': recurse(int(tree_.children_right[node]))
                }
            else:
                # leaf
                counts = tree_.value[node][0].tolist()
                total = sum(counts)
                prob_phish = float(counts[1] / total) if total > 0 else 0.0
                return {'node_type': 'leaf', 'prob_phish': prob_phish}
        forest.append(recurse(0))
    payload = {'features': feature_names, 'trees': forest}
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, 'w') as f:
        json.dump(payload, f)
    print("Exported model JSON to", out_file)

def main():
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"{DATA_PATH} not found. Place your data.csv there ({os.getcwd()})")

    df = pd.read_csv(DATA_PATH)
    if 'url' not in df.columns or 'label' not in df.columns:
        raise ValueError("data.csv must have 'url' and 'label' columns (label: 0=benign,1=phish)")

    df = df.dropna(subset=['url','label'])
    df['label'] = df['label'].astype(int)

    print("Loaded dataset rows:", len(df))

    X = build_feature_matrix(df['url'].tolist())
    y = df['label'].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    clf = RandomForestClassifier(n_estimators=100, class_weight='balanced', random_state=42)
    clf.fit(X_train, y_train)
    print("Model trained.")

    y_pred = clf.predict(X_test)
    y_proba = clf.predict_proba(X_test)[:,1]
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print("AUC:", roc_auc_score(y_test, y_proba))
    print("Classification report:\n", classification_report(y_test, y_pred))

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(clf, MODEL_PATH)
    print("Saved model to", MODEL_PATH)

    # export client-side model JSON
    export_forest_to_json(clf, FEATURE_ORDER, JSON_PATH)

if __name__ == "__main__":
    main()
