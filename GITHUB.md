# GitHub Access for Darby

## Setup Complete ✓

- **Git version:** 2.53.0
- **GitHub CLI:** 2.86.0
- **Git user:** Darby (darby@nowops.ai)
- **Token:** Configured in ~/.openclaw/.env

## Usage

Run GitHub operations using the CLI wrapper:

```bash
bash /Users/macmini2026/.openclaw/workspaces/darby/scripts/github-cli.sh [command] [args]
```

Or from workspace root:
```bash
bash scripts/github-cli.sh [command] [args]
```

## Available Commands

### Repository Management
```bash
# List all repositories
bash github-cli.sh list-repos

# Create a new private repository
bash github-cli.sh create-repo "repo-name" "Repository description"

# Clone a repository
bash github-cli.sh clone "https://github.com/user/repo.git"
```

### Working with Code
```bash
# Check status
bash github-cli.sh status

# Pull latest changes
bash github-cli.sh pull

# Commit and push changes
bash github-cli.sh push "feat: add new feature"

# Create a new branch
bash github-cli.sh create-branch "feature/new-feature"
```

### Pull Requests
```bash
# Create a pull request
bash github-cli.sh pr "PR Title" "PR description goes here"
```

### Issues
```bash
# List issues
bash github-cli.sh issues

# Create a new issue
bash github-cli.sh create-issue "Issue title" "Issue description"
```

## Examples

### Pushing Subway scraper updates
```bash
cd /Users/macmini2026/.openclaw/workspaces/darby
bash scripts/github-cli.sh push "feat: update subway scraper with category fix"
```

### Creating a new repository for automation scripts
```bash
bash scripts/github-cli.sh create-repo "darby-automation" "Darby's automation and scraping scripts"
```

### Working on a feature branch
```bash
bash scripts/github-cli.sh create-branch "fix/scraper-cleanup"
# ... make changes ...
bash scripts/github-cli.sh push "fix: clean up old test scripts"
bash scripts/github-cli.sh pr "Clean up test scripts" "Removed 19 old test/debug scripts from workspace"
```

## Notes

- All commits are made as user "Darby"
- Repositories created via CLI are private by default
- Token is loaded from ~/.openclaw/.env automatically
- Brian can use the same script from his workspace

## Sharing with Brian

Brian can either:
1. Use the same script: `/Users/macmini2026/.openclaw/workspaces/darby/scripts/github-cli.sh`
2. Copy it to his workspace: `/Users/macmini2026/.openclaw/workspaces/brian/scripts/github-cli.sh`

Both agents will use the same GitHub token and can collaborate on the same repositories.

---

## Scraper Skills Repository

**Your branch:** `darby`  
**Location:** `/Users/macmini2026/.openclaw/workspaces/darby/scraper_skills`

### Quick Workflow

```bash
# Navigate to repo
cd /Users/macmini2026/.openclaw/workspaces/darby/scraper_skills

# Make sure you're on your branch
git checkout darby

# Pull latest changes
git pull origin darby

# Make your changes, then commit and push
git add -A
git commit -m "feat: your change description"
git push origin darby

# When ready to merge to production
gh pr create --base main --head darby --title "Feature name" --body "Description"
```

### Branch Details

- **darby** - Your independent working branch
- **brian** - Brian's independent working branch  
- **main** - Production/stable code (requires PR to merge)

See `scraper_skills/BRANCHES.md` for full workflow documentation.
