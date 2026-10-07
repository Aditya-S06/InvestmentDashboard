"""Offline fixture entry point: no production CLI can select these overrides."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from desk_supervisor import supervise

supervise(Path(sys.argv[1]), graph_script=Path(__file__).with_name('desk_fixture_graph.py'), budget=float(sys.argv[2]))
