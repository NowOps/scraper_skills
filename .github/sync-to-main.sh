#!/bin/bash
source ~/.openclaw/.env
export GH_TOKEN=$GITHUB_TOKEN

BRANCH=$1
if [ -z "$BRANCH" ]; then
  echo "Usage: bash sync-to-main.sh [darby|brian]"
  exit 1
fi

REPO_PATH=/Users/macmini2026/.openclaw/workspaces/darby/scraper_skills

cd $REPO_PATH

echo "Step 1: Running pre-merge checks..."
bash .github/merge-check.sh $BRANCH
if [ $? -ne 0 ]; then
  echo "Pre-merge checks failed. Aborting."
  exit 1
fi

echo "Step 2: Creating PR on GitHub..."
gh pr create \
  --base main \
  --head $BRANCH \
  --title "merge: $BRANCH -> main $(date '+%Y-%m-%d')" \
  --body "Automated merge from $BRANCH branch to main. Pre-merge checks passed." \
  2>/dev/null || echo "PR may already exist"

echo "Step 3: Merging into main..."
git checkout main
git pull origin main
git checkout $BRANCH -- $BRANCH/
git add $BRANCH/
git commit -m "sync: update $BRANCH/ folder from $BRANCH branch - $(date '+%Y-%m-%d %H:%M')"
git push origin main

echo "Step 4: Updating README..."
bash /Users/macmini2026/.openclaw/workspaces/darby/scripts/update-readme.sh $BRANCH

echo "Done. $BRANCH synced to main/$BRANCH/ folder."
