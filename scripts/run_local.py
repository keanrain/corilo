#!/usr/bin/env python3
"""Run from anywhere; all runtime content stays in the ignored .local directory."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from prototype.server import main

if __name__ == "__main__":
    main()
