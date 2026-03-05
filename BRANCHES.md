# Scraper Skills Repository - Branch Strategy

## Repository Structure

**Repository:** NowOps/scraper_skills  
**Main branch:** `main` (production/stable)  
**Agent branches:** `darby`, `brian`

## Branch Purpose

### main
- Production-ready, stable code
- Merged PRs from agent branches
- Protected branch (requires PR approval)

### darby
- Darby's working branch
- All Darby's scraper development happens here
- Push directly, no PR needed for this branch

### brian
- Brian's working branch
- All Brian's code development happens here
- Push directly, no PR needed for this branch

## Workflow for Darby

### 1. Switch to your branch
```bash
cd /Users/macmini2026/.openclaw/workspaces/darby/scraper_skills
git checkout darby
```

### 2. Pull latest changes
```bash
git pull origin darby
```

### 3. Work on your code
Make changes to scraper scripts, add new files, etc.

### 4. Commit and push
```bash
git add -A
git commit -m "feat: description of what you did"
git push origin darby
```

### 5. Create PR to main (when ready for production)
```bash
gh pr create --base main --head darby --title "Darby: Feature name" --body "Description of changes"
```

## Workflow for Brian

Brian follows the same workflow but uses the `brian` branch:

```bash
cd /path/to/scraper_skills
git checkout brian
git pull origin brian
# ... make changes ...
git add -A
git commit -m "feat: description"
git push origin brian
```

## Quick Commands

### Switch between branches
```bash
git checkout darby    # Switch to Darby's branch
git checkout brian    # Switch to Brian's branch
git checkout main     # Switch to main branch
```

### See which branch you're on
```bash
git branch
```

### See all branches (local and remote)
```bash
git branch -a
```

## Collaboration

- Each agent works independently on their own branch
- No conflicts between agents during development
- Merge to `main` via PR when features are complete and tested
- Other agents can review PRs before merging

## Current Status

✓ All branches created and pushed to GitHub:
- `main` (origin/main)
- `darby` (origin/darby)
- `brian` (origin/brian)

## Getting Started

**For Darby:**
```bash
cd /Users/macmini2026/.openclaw/workspaces/darby/scraper_skills
git checkout darby
# You're now on your branch, ready to work!
```

**For Brian:**
When Brian needs to work on scraper_skills:
```bash
cd /Users/macmini2026/.openclaw/workspaces/brian  # or wherever Brian's workspace is
git clone https://github.com/NowOps/scraper_skills.git
cd scraper_skills
git checkout brian
# Now ready to work!
```
