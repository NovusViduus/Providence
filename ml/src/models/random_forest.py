"""Random Forest model wrapper."""

import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier


class RandomForestModel:
    """Providence model wrapper for scikit-learn RandomForest."""

    def __init__(self, model: RandomForestClassifier | None = None, feature_names: list[str] | None = None):
        self.model = model
        self.feature_names = feature_names or []

    def train(self, X: np.ndarray, y: np.ndarray, feature_names: list[str]) -> None:
        self.feature_names = feature_names
        self.model = RandomForestClassifier(
            n_estimators=200,
            class_weight="balanced",
            n_jobs=-1,
            random_state=42,
        )
        self.model.fit(X, y)

    def predict(self, features: np.ndarray) -> tuple[str, float, dict[str, float]]:
        """Returns (category, confidence, feature_importances)."""
        proba = self.model.predict_proba(features.reshape(1, -1))[0]
        idx = np.argmax(proba)
        category = self.model.classes_[idx]
        confidence = float(proba[idx])
        importances = dict(zip(self.feature_names, self.model.feature_importances_))
        top10 = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10])
        return category, confidence, top10

    def save(self, path: str) -> None:
        joblib.dump({"model": self.model, "feature_names": self.feature_names}, path)

    @classmethod
    def load(cls, path: str) -> "RandomForestModel":
        data = joblib.load(path)
        return cls(model=data["model"], feature_names=data["feature_names"])
