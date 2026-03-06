#!/bin/bash
BRANCH=$1
if [ -z "$BRANCH" ]; then
  echo "Usage: bash merge-check.sh [darby|brian]"
  exit 1
fi

echo "Running pre-merge checks for $BRANCH branch..."

# Check for syntax errors in JS files
for f in $BRANCH/*.js; do
  node --check "$f" 2>&1
  if [ $? -ne 0 ]; then
    echo "SYNTAX ERROR in $f - merge blocked"
    exit 1
  fi
done

echo "All checks passed. Safe to merge $BRANCH into main."
