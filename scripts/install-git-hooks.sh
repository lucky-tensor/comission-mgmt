#!/bin/bash
set -e

echo "Installing git hooks from .githooks/ ..."
git config core.hooksPath .githooks
echo "Done. Git hooks path set to .githooks/"
