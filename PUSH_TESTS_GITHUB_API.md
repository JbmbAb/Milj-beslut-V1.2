# 🚀 Automated Test Push Script

This script automatically pushes 10 security/repository/services test files to GitHub using the GitHub REST API.

## Files Being Pushed

```
✓ server.security.rateLimit.test.ts
✓ server.security.rateLimitDb.test.ts
✓ server.security.auditTrail.test.ts
✓ server.security.auditSanitization.test.ts
✓ server.security.projectAccess.test.ts
✓ server.repositories.projectAccessRepository.test.ts
✓ server.repositories.userRepository.test.ts
✓ server.repositories.requirementsRepository.test.ts
✓ server.services.completionService.test.ts
✓ server.services.bankIdService.test.ts
```

## Prerequisites

1. **Node.js** (v18+)
2. **GitHub Personal Access Token** with `repo` scope
   - Create token: https://github.com/settings/tokens
   - Requires: `repo` (full control), `workflow` (optional)

## Setup

### Option 1: Using Environment Variable (Recommended)

```bash
# Windows (PowerShell)
$env:GITHUB_TOKEN = "ghp_your_token_here"
node scripts/push-tests-github-api.mjs

# Windows (CMD)
set GITHUB_TOKEN=ghp_your_token_here
node scripts/push-tests-github-api.mjs

# macOS/Linux
export GITHUB_TOKEN="ghp_your_token_here"
node scripts/push-tests-github-api.mjs
```

### Option 2: Interactive Prompt

```bash
node scripts/push-tests-github-api.mjs
# Script will prompt for token interactively
```

## Running the Script

### From Repository Root

```bash
# Using Node directly
node scripts/push-tests-github-api.mjs

# Using npm (if added to package.json)
npm run push:tests:api
```

### Add to package.json

Add this script to `package.json`:

```json
{
  "scripts": {
    "push:tests:api": "node scripts/push-tests-github-api.mjs"
  }
}
```

Then run:

```bash
npm run push:tests:api
```

## What the Script Does

1. **Reads Files**: Loads all 10 test files from `tests/unit/`
2. **Checks Existence**: Verifies each file exists on GitHub (to get SHA if updating)
3. **Encodes Content**: Converts files to Base64 for API transmission
4. **Creates Commits**: Uses GitHub API `PUT /repos/{owner}/{repo}/contents/{path}` to:
   - Create individual commits for each file
   - Update existing files (using SHA)
   - Create new files
5. **Reports Status**: Shows success/failure for each file
6. **Provides Next Steps**: Guides you through squashing commits and creating a PR

## Expected Output

```
🚀 GitHub Test Files Push Script
═══════════════════════════════════════════════════════════════════════════
Repository: JbmbAb/Milj-beslut-V1.2
Branch: main
Files to push: 10
═══════════════════════════════════════════════════════════════════════════

📤 Starting push of 10 test files...
───────────────────────────────────────────────────────────────────────────

[1/10] ⏳ server.security.rateLimit.test.ts... ✓
[2/10] ⏳ server.security.rateLimitDb.test.ts... ✓
[3/10] ⏳ server.security.auditTrail.test.ts... ✓
[4/10] ⏳ server.security.auditSanitization.test.ts... ✓
[5/10] ⏳ server.security.projectAccess.test.ts... ✓
[6/10] ⏳ server.repositories.projectAccessRepository.test.ts... ✓
[7/10] ⏳ server.repositories.userRepository.test.ts... ✓
[8/10] ⏳ server.repositories.requirementsRepository.test.ts... ✓
[9/10] ⏳ server.services.completionService.test.ts... ✓
[10/10] ⏳ server.services.bankIdService.test.ts... ✓

📊 PUSH SUMMARY
───────────────────────────────────────────────────────────────────────────
   ✓ Successful: 10/10
   ✗ Failed: 0/10

✅ Successfully pushed files:
   • server.security.rateLimit.test.ts
     Commit: abc1234
   • server.security.rateLimitDb.test.ts
     Commit: def5678
   [... etc ...]

📝 NEXT STEPS:
───────────────────────────────────────────────────────────────────────────
   1. Review on GitHub:
      → https://github.com/JbmbAb/Milj-beslut-V1.2/tree/main/tests/unit

   2. Create a Pull Request to review these test files

   3. Optional - Squash commits locally:
      → git fetch origin main
      → git log --oneline origin/main | head -11
      → git rebase -i HEAD~10

   4. Squash commit message template:
      test: add 149 unit tests for security/repository/services layer

      - Added 10 test files covering:
        • Security: rateLimit, auditTrail, projectAccess
        • Repositories: projectAccess, user, requirements
        • Services: completion, bankId

      Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
───────────────────────────────────────────────────────────────────────────
```

## Troubleshooting

### 401 Unauthorized

**Problem**: `Error: HTTP 401`

**Solution**:

- Verify GitHub token is valid: https://github.com/settings/tokens
- Check token has `repo` scope
- Regenerate token if expired

### 404 Not Found

**Problem**: Repository doesn't exist or token doesn't have access

**Solution**:

- Verify repository URL: `https://github.com/JbmbAb/Milj-beslut-V1.2`
- Check token has access to the repository
- Verify repository is not archived

### File Not Found

**Problem**: `File not found: ...`

**Solution**:

- Run script from repository root
- Verify test files exist in `tests/unit/`
- Check file names match exactly (case-sensitive on GitHub)

### Rate Limit

**Problem**: Script slows down after several files

**Solution**:

- Normal behavior - script has 800ms delay between requests
- GitHub API limit: 5000 requests/hour
- Current script uses ~1 request per 1-2 seconds

## Advanced: Local Git Push Alternative

If you prefer using `git` directly instead of the API:

```bash
# Verify files are staged
git status

# Commit each file
git add tests/unit/server.security.rateLimit.test.ts
git commit -m "test: add server.security.rateLimit.test.ts"

# Or commit all at once
git add tests/unit/*.test.ts
git commit -m "test: add 10 unit test files"

# Push to GitHub
git push origin main
```

## GitHub API Reference

### Endpoint Used

```
PUT /repos/{owner}/{repo}/contents/{path}
```

### Request Body

```json
{
  "message": "test: add filename.test.ts",
  "content": "base64-encoded-file-content",
  "branch": "main",
  "sha": "existing-commit-sha" // Only if updating existing file
}
```

### Response

```json
{
  "content": {
    "name": "filename.test.ts",
    "path": "tests/unit/filename.test.ts",
    "sha": "abc123def456",
    "size": 1234,
    "url": "...",
    "html_url": "...",
    "git_url": "...",
    "download_url": "..."
  },
  "commit": {
    "sha": "commit-sha-abc123",
    "url": "...",
    "html_url": "...",
    "message": "test: add filename.test.ts",
    "tree": {...},
    "parents": [...]
  }
}
```

## Security Notes

1. **Token Safety**:
   - Never commit `GITHUB_TOKEN` to repository
   - Use environment variables or `.env` (with .gitignore)
   - Regenerate token immediately if exposed

2. **Scopes Required**:
   - `repo` - Full control of private repositories
   - `public_repo` - Access to public repositories only
   - `workflow` - GitHub Actions (optional)

3. **Best Practices**:
   - Create a dedicated token for automation
   - Set expiration date on token
   - Review token access periodically
   - Use separate tokens per application

## Creating a PR After Push

Once files are pushed:

1. Go to: https://github.com/JbmbAb/Milj-beslut-V1.2
2. Click "Compare & pull request"
3. Set:
   - **Title**: `test: add 10 security/repository/services unit tests`
   - **Description**: See template above
   - **Base branch**: `main`
   - **Compare branch**: `main` (or new branch if desired)
4. Add reviewers
5. Submit PR

## Timeline for Squashing Commits

After all files are pushed, you can squash them:

```bash
# Update local repository
git fetch origin main

# View commits
git log --oneline origin/main | head -15

# Squash last 10 commits
git rebase -i HEAD~10

# In editor: change "pick" to "squash" for all but first commit
# Save and close editor to combine messages

# Edit final commit message (paste template from above)

# Force push (only if branch hasn't been shared)
git push origin main --force
```

## Questions?

- GitHub API Docs: https://docs.github.com/en/rest
- Troubleshooting: Check HTTP status codes and error messages
- Manual push: Use git command line as alternative

---

**Created by**: GitHub Copilot Agent  
**Last Updated**: 2024  
**Status**: ✅ Ready to use
