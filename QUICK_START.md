# 🚀 QUICK START: Push Tests to GitHub Automatically

## ⚡ 30-Second Setup

### 1️⃣ Get Your GitHub Token

```
→ Go to: https://github.com/settings/tokens
→ Click "Generate new token (classic)"
→ Name it: "Test Push Script"
→ Select scope: ✓ repo
→ Click "Generate token"
→ Copy the token (you'll need it next)
```

### 2️⃣ Set Your Token

**Windows (CMD):**

```cmd
set GITHUB_TOKEN=ghp_your_token_here
PUSH_TESTS_API.bat
```

**Windows (PowerShell):**

```powershell
$env:GITHUB_TOKEN = "ghp_your_token_here"
.\PUSH_TESTS_API.ps1
```

**macOS/Linux (Bash):**

```bash
export GITHUB_TOKEN="ghp_your_token_here"
./PUSH_TESTS_API.sh
```

**Or skip the token step and the script will prompt you:**

```bash
./PUSH_TESTS_API.sh          # Will ask for token
```

### 3️⃣ Watch the Magic Happen ✨

The script will:

- ✓ Read all 10 test files from `tests/unit/`
- ✓ Create individual commits for each file
- ✓ Upload to GitHub REST API
- ✓ Show you the progress
- ✓ Give you next steps

---

## 📋 What Gets Pushed

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

---

## 🎯 After It's Done

Once all files are pushed:

1. **Review on GitHub:**

   ```
   https://github.com/JbmbAb/Milj-beslut-V1.2/tree/main/tests/unit
   ```

2. **Create a Pull Request:**
   - Visit the repo above
   - Click "Compare & pull request"
   - Review the changes
   - Assign reviewers
   - Submit PR

3. **(Optional) Squash Commits Locally:**
   ```bash
   git fetch origin main
   git rebase -i HEAD~10
   # Change "pick" to "squash" for commits 2-10
   # Edit final message to something like:
   # "test: add 10 unit tests for security/repository/services layer"
   ```

---

## ❓ Common Questions

### Q: Is my token safe?

**A:** Yes! The script:

- Never commits the token to git
- Only uses it for this API call
- Uses GitHub's official REST API (HTTPS)
- Token is sent via Authorization header, not in URL

### Q: What if the script fails?

**A:** Check:

1. Token is valid (hasn't expired)
2. Token has `repo` scope
3. Network connection is stable
4. Node.js is installed: `node --version`

### Q: Do I need to run `git add` or `git commit`?

**A:** No! The script does it all via GitHub API. This is actually **better** because:

- Faster (no local git operations)
- Cleaner (no local changes to manage)
- Individual commits created on GitHub directly

### Q: Can I squash the commits later?

**A:** Yes! After they're on GitHub, you can:

```bash
git fetch origin main
git rebase -i HEAD~10  # Squash to 1 commit
```

### Q: What's the token expiration?

**A:** Default is 30 days. You can set it when creating the token at https://github.com/settings/tokens

---

## 🔧 Troubleshooting

### "Node.js is not installed"

```bash
# Install from https://nodejs.org/
# Or use:
brew install node     # macOS
choco install nodejs  # Windows
apt install nodejs    # Linux
```

### "HTTP 401 Unauthorized"

- Token expired → Regenerate at https://github.com/settings/tokens
- Token invalid → Check you copied it correctly
- Scope missing → Regenerate with ✓ repo scope

### "HTTP 404 Not Found"

- Repository doesn't exist (check spelling)
- Token doesn't have access to this repo
- Run script from repo root directory

### "File not found"

- Run from repository root: `cd Milj-beslut-V1.2/`
- Check files exist: `ls tests/unit/server.*.test.ts`

### Script is slow

- Normal! 800ms delay between requests prevents rate limiting
- For 10 files: ~8-10 seconds total
- GitHub limit: 5000 requests/hour (plenty for this)

---

## 📚 File Locations

```
your-repo/
├── tests/
│   └── unit/
│       ├── server.security.rateLimit.test.ts
│       ├── server.security.rateLimitDb.test.ts
│       ├── server.security.auditTrail.test.ts
│       ├── server.security.auditSanitization.test.ts
│       ├── server.security.projectAccess.test.ts
│       ├── server.repositories.projectAccessRepository.test.ts
│       ├── server.repositories.userRepository.test.ts
│       ├── server.repositories.requirementsRepository.test.ts
│       ├── server.services.completionService.test.ts
│       └── server.services.bankIdService.test.ts
├── scripts/
│   └── push-tests-github-api.mjs  ← Main script
├── PUSH_TESTS_API.bat             ← Windows batch wrapper
├── PUSH_TESTS_API.ps1             ← PowerShell wrapper
├── PUSH_TESTS_API.sh              ← Bash wrapper
└── PUSH_TESTS_GITHUB_API.md       ← Full documentation
```

---

## 🚀 Different Ways to Run

### Interactive (Prompts for Token)

```bash
./PUSH_TESTS_API.sh
# or
.\PUSH_TESTS_API.ps1
# or
PUSH_TESTS_API.bat
```

### With Environment Variable

```bash
GITHUB_TOKEN=ghp_xyz ./PUSH_TESTS_API.sh
GITHUB_TOKEN=ghp_xyz .\PUSH_TESTS_API.ps1
set GITHUB_TOKEN=ghp_xyz && PUSH_TESTS_API.bat
```

### Direct Node (Advanced)

```bash
node scripts/push-tests-github-api.mjs
```

### Add to package.json

```json
{
  "scripts": {
    "push:tests:api": "node scripts/push-tests-github-api.mjs"
  }
}
```

Then: `npm run push:tests:api`

---

## 📊 Expected Output

```
🚀 GitHub Test Files Push Script
═════════════════════════════════════════════════════════════════════════
Repository: JbmbAb/Milj-beslut-V1.2
Branch: main
Files to push: 10
═════════════════════════════════════════════════════════════════════════

📤 Starting push of 10 test files...
─────────────────────────────────────────────────────────────────────────

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
─────────────────────────────────────────────────────────────────────────
   ✓ Successful: 10/10
   ✗ Failed: 0/10

✅ Successfully pushed files:
   • server.security.rateLimit.test.ts
   • server.security.rateLimitDb.test.ts
   [... etc ...]

📝 NEXT STEPS:
─────────────────────────────────────────────────────────────────────────
   1. Review on GitHub:
      → https://github.com/JbmbAb/Milj-beslut-V1.2/tree/main/tests/unit

   2. Create a Pull Request to review these test files

   3. Optional - Squash commits locally:
      → git rebase -i HEAD~10

   4. Squash commit message template:
      test: add 149 unit tests for security/repository/services layer
```

---

## ✅ Checklist

- [ ] Token created at https://github.com/settings/tokens
- [ ] Token has `repo` scope
- [ ] Token is ready (not expired)
- [ ] Running from repo root directory
- [ ] Node.js installed: `node --version`
- [ ] Test files exist: `ls tests/unit/*.test.ts`
- [ ] Ready to run script!

---

## 🎓 Learning Resources

- **GitHub API**: https://docs.github.com/en/rest
- **Personal Access Tokens**: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- **Git Rebase**: https://git-scm.com/docs/git-rebase
- **Creating PRs**: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request

---

## 💡 Pro Tips

1. **Test locally first:**

   ```bash
   npm run test -- --run  # Verify tests pass
   ```

2. **Check what's different:**

   ```bash
   git diff tests/unit/
   ```

3. **Revert if needed:**

   ```bash
   git reset --hard HEAD~10  # Undo last 10 commits
   ```

4. **Monitor GitHub Actions:**
   After PR is merged, watch for test runs at:
   https://github.com/JbmbAb/Milj-beslut-V1.2/actions

---

## 🆘 Need Help?

1. Check the full docs: `PUSH_TESTS_GITHUB_API.md`
2. Verify token: https://github.com/settings/tokens
3. Check repo access: https://github.com/JbmbAb/Milj-beslut-V1.2
4. Review error message from script output

---

**Status:** ✅ Ready to use!  
**Last Updated:** 2024  
**Created by:** GitHub Copilot Agent
