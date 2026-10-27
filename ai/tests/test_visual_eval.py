"""Round 3 acceptance test for VisualGuard, on the 30 held-out synthetic images (see scripts/visual_eval.py and
eval/visual/). The held-out set was never used to tune a threshold."""
import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location("visual_eval", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "visual_eval.py")
visual_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual_eval)


def test_heldout_recall_is_at_least_85_percent_and_false_flags_at_most_10_percent():
    r = visual_eval.evaluate("heldout", verbose=False)
    assert r["recall"] >= 0.85, f"recall {r['recall']:.0%}"
    assert r["false_rate"] <= 0.10, f"false flags {r['false_rate']:.0%}"
