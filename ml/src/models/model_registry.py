"""Model registry for versioned model management."""

import json
import logging
from pathlib import Path

from src.data.preprocessor import Preprocessor

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent.parent.parent / "models" / "saved"
ACTIVE_MODEL_FILE = MODELS_DIR / "active_model.json"

# Model class mapping
MODEL_CLASSES = {
    "random_forest": "src.models.random_forest.RandomForestModel",
    "xgboost": "src.models.gradient_boosted.XGBoostModel",
    "lightgbm": "src.models.gradient_boosted.LightGBMModel",
}


def _import_model_class(class_path: str):
    module_path, class_name = class_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


class ModelRegistry:
    """Manages versioned model files in ml/models/saved/."""

    def __init__(self, models_dir: str | Path | None = None):
        self.models_dir = Path(models_dir) if models_dir else MODELS_DIR
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def load(self, model_name: str, version: str = "v1", feature_set: str | None = None) -> tuple:
        """Load a model and its preprocessor.

        Args:
            model_name: Model name (e.g., "xgboost_intersection")
            version: Model version (e.g., "v1")
            feature_set: Explicit feature set override. If None, inferred from
                         active_model.json first, then from filename convention.

        Returns: (model_instance, preprocessor, feature_set_name)
        """
        # Determine model type
        model_type = model_name.split("_")[0]
        if model_type == "random":
            model_type = "random_forest"

        # Determine feature set: explicit > active_model.json > filename convention
        if feature_set is None:
            active = self._read_active_config()
            if active.get("model_name") == model_name and "feature_set" in active:
                feature_set = active["feature_set"]
            else:
                feature_set = "full" if "_full" in model_name else "intersection"
        model_file = self.models_dir / f"{model_name}_{version}.joblib"
        preprocessor_file = self.models_dir / f"preprocessor_{feature_set}_{version}.joblib"

        if not model_file.exists():
            raise FileNotFoundError(f"Model file not found: {model_file}")
        if not preprocessor_file.exists():
            raise FileNotFoundError(f"Preprocessor file not found: {preprocessor_file}")

        class_path = MODEL_CLASSES.get(model_type)
        if not class_path:
            raise ValueError(f"Unknown model type: {model_type}")

        model_cls = _import_model_class(class_path)
        model = model_cls.load(str(model_file))
        preprocessor = Preprocessor.load(str(preprocessor_file))

        logger.info("Loaded model %s (feature_set=%s)", model_name, feature_set)
        return model, preprocessor, feature_set

    def list_models(self) -> list[dict]:
        """List available models with metadata."""
        models = []
        for f in sorted(self.models_dir.glob("*.joblib")):
            if f.name.startswith("preprocessor"):
                continue
            name = f.stem
            parts = name.rsplit("_", 1)
            version = parts[-1] if len(parts) > 1 else "v1"
            base_name = parts[0] if len(parts) > 1 else name
            feature_set = "full" if "_full_" in name else "intersection"
            models.append({
                "name": base_name,
                "version": version,
                "feature_set": feature_set,
                "file": str(f),
            })
        return models

    def _read_active_config(self) -> dict:
        """Read active_model.json without defaults."""
        config_file = self.models_dir / "active_model.json"
        if config_file.exists():
            with open(config_file) as f:
                return json.load(f)
        return {}

    def get_active(self) -> dict:
        """Get the currently active model config."""
        active = self._read_active_config()
        if active:
            return active
        # Default: first available intersection model
        models = [m for m in self.list_models() if m["feature_set"] == "intersection"]
        if models:
            return {"model_name": models[0]["name"], "version": models[0]["version"], "feature_set": "intersection"}
        return {"model_name": "xgboost_intersection", "version": "v1", "feature_set": "intersection"}

    def set_active(self, model_name: str, version: str = "v1", feature_set: str = "intersection") -> None:
        """Set the active model. Stores feature_set explicitly to avoid filename parsing."""
        config_file = self.models_dir / "active_model.json"
        with open(config_file, "w") as f:
            json.dump({"model_name": model_name, "version": version, "feature_set": feature_set}, f, indent=2)
        logger.info("Active model set to %s %s (feature_set=%s)", model_name, version, feature_set)
