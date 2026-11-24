#!/usr/bin/env python3
import os
from pathlib import Path
import sys

os.execvp('node', ['node', '--experimental-strip-types', str(Path(__file__).with_suffix('.ts')), *sys.argv[1:]])
