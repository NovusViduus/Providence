"""Gradient boosted model wrappers (XGBoost and LightGBM)."""

import numpy as np
import joblib


class XGBoostModel:
    """Providence model wrapper for XGBoost."""

    def __init__(self, model=None, feature_names: list[str] | None = None, classes: list[str] | None = None):
        self.model = model
        self.feature_names = feature_names or []
        self.classes = classes or []

    def train(self, X: np.ndarray, y: np.ndarray, feature_names: list[str]) -> None:
        import xgboost as xgb
        from sklearn.preprocessing import LabelEncoder

        self.feature_names = feature_names
        le = LabelEncoder()
        y_enc = le.fit_transform(y)
        self.classes = list(le.classes_)

        # Compute sample weights for class imbalance
        class_counts = np.bincount(y_enc)
        weights = len(y_enc) / (len(class_counts) * class_counts[y_enc])

        dtrain = xgb.DMatrix(X, label=y_enc, weight=weights, feature_names=feature_names)

        # Split for early stopping validation
        from sklearn.model_selection import train_test_split as _split
        X_tr, X_val, y_tr, y_val, w_tr, w_val = _split(X, y_enc, weights, test_size=0.1, random_state=42, stratify=y_enc)
        dtrain = xgb.DMatrix(X_tr, label=y_tr, weight=w_tr, feature_names=feature_names)
        dval = xgb.DMatrix(X_val, label=y_val, weight=w_val, feature_names=feature_names)

        params = {
            "objective": "multi:softprob",
            "num_class": len(self.classes),
            "max_depth": 6,
            "learning_rate": 0.1,
            "eval_metric": "mlogloss",
            "verbosity": 0,
            "nthread": -1,
        }
        self.model = xgb.train(params, dtrain, num_boost_round=300,
                               evals=[(dval, "val")], early_stopping_rounds=20, verbose_eval=False)

    def predict(self, features: np.ndarray) -> tuple[str, float, dict[str, float]]:
        import xgboost as xgb
        dm = xgb.DMatrix(features.reshape(1, -1), feature_names=self.feature_names)
        proba = self.model.predict(dm)[0]
        idx = int(np.argmax(proba))
        category = self.classes[idx]
        confidence = float(proba[idx])
        scores = self.model.get_score(importance_type="gain")
        top10 = dict(sorted(scores.items(), key=lambda x: x[1], reverse=True)[:10])
        return category, confidence, top10

    def save(self, path: str) -> None:
        joblib.dump({"model": self.model, "feature_names": self.feature_names, "classes": self.classes}, path)

    @classmethod
    def load(cls, path: str) -> "XGBoostModel":
        data = joblib.load(path)
        return cls(model=data["model"], feature_names=data["feature_names"], classes=data["classes"])


class LightGBMModel:
    """Providence model wrapper for LightGBM."""

    def __init__(self, model=None, feature_names: list[str] | None = None, classes: list[str] | None = None):
        self.model = model
        self.feature_names = feature_names or []
        self.classes = classes or []

    def train(self, X: np.ndarray, y: np.ndarray, feature_names: list[str]) -> None:
        import lightgbm as lgb
        from sklearn.preprocessing import LabelEncoder

        self.feature_names = feature_names
        le = LabelEncoder()
        y_enc = le.fit_transform(y)
        self.classes = list(le.classes_)

        dtrain = lgb.Dataset(X, label=y_enc, feature_name=feature_names)

        # Split for early stopping validation
        from sklearn.model_selection import train_test_split as _split
        X_tr, X_val, y_tr, y_val = _split(X, y_enc, test_size=0.1, random_state=42, stratify=y_enc)
        dtrain = lgb.Dataset(X_tr, label=y_tr, feature_name=feature_names)
        dval = lgb.Dataset(X_val, label=y_val, feature_name=feature_names, reference=dtrain)

        params = {
            "objective": "multiclass",
            "num_class": len(self.classes),
            "is_unbalance": True,
            "max_depth": 6,
            "learning_rate": 0.1,
            "metric": "multi_logloss",
            "verbosity": -1,
            "num_threads": -1,
        }
        self.model = lgb.train(params, dtrain, num_boost_round=300,
                               valid_sets=[dval], callbacks=[lgb.early_stopping(20, verbose=False)])

    def predict(self, features: np.ndarray) -> tuple[str, float, dict[str, float]]:
        proba = self.model.predict(features.reshape(1, -1))[0]
        idx = int(np.argmax(proba))
        category = self.classes[idx]
        confidence = float(proba[idx])
        importances = dict(zip(self.feature_names, self.model.feature_importance(importance_type="gain")))
        top10 = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10])
        return category, confidence, top10

    def save(self, path: str) -> None:
        joblib.dump({"model": self.model, "feature_names": self.feature_names, "classes": self.classes}, path)

    @classmethod
    def load(cls, path: str) -> "LightGBMModel":
        data = joblib.load(path)
        return cls(model=data["model"], feature_names=data["feature_names"], classes=data["classes"])
