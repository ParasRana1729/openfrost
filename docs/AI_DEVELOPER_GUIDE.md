# 🚀 Beginner's Guide: Building OpenFrost with AI Coding Tools

> **Welcome to the OpenFrost team!** 👋  
> If you are new to GitHub, Git, or coding with AI, this step-by-step guide will walk you through completing your assigned issues from start to finish using **Antigravity**, **Cursor**, or **VS Code + AI**.

---

## 🎯 The 7-Step Workflow at a Glance

```text
[1. Clone Repo] ➡️ [2. Make Branch] ➡️ [3. Prompt AI] ➡️ [4. Verify Code] ➡️ [5. Push to GitHub] ➡️ [6. Open PR] ➡️ [7. Leader Merges]
```

---

## 🛠️ Step 1: One-Time Setup on Your Computer

1. **Install Node.js**: Download and install **Node.js LTS (v20+)** from [nodejs.org](https://nodejs.org/).
2. **Install pnpm**: Open your terminal (PowerShell or Command Prompt) and run:
   ```bash
   npm install -g pnpm
   ```
3. **Install Git**: Download and install from [git-scm.com](https://git-scm.com/).
4. **Clone the OpenFrost Repository**:
   Open your terminal in the folder where you keep projects (e.g. `Documents`) and run:
   ```bash
   git clone https://github.com/ParasRana1729/openfrost.git
   cd openfrost
   ```
5. **Open in Your AI Editor**:
   - If using **Antigravity**: Open the `openfrost` folder in Antigravity.
   - If using **Cursor** or **VS Code**: Open the `openfrost` folder (`code .` or `cursor .`).

---

## 🌿 Step 2: Create a New Branch for Your Issue

Before making changes, always create a separate branch for your task. Never code directly on `main`!

1. Make sure you have the latest code:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Create and switch to your feature branch (replace `3` and `monorepo-scaffold` with your issue number and topic):
   ```bash
   git checkout -b feat/issue-3-monorepo-scaffold
   ```

---

## 🤖 Step 3: Prompting Your AI Assistant

Open the AI chat panel in your editor (Antigravity, Cursor, Copilot, or Claude Code) and give it this exact prompt:

### 📋 Copy-Paste Prompt Template:

```text
I am working on OpenFrost.
Please read AGENTS.md and docs/ai-os-project-spec.md for repository rules, architecture, and coding standards.

I am assigned to implement Issue #<YOUR_ISSUE_NUMBER> (found in backlog/<YOUR_ISSUE_NUMBER>-<TITLE>.md).

Please:
1. Review the context and all acceptance criteria in the issue file.
2. Implement all required code and files adhering strictly to the architecture in AGENTS.md.
3. Write/update unit tests to verify the implementation.
4. Ensure all code is strictly typed with TypeScript.
```

> **Example for Issue #7:**
> *"I am working on OpenFrost. Please read AGENTS.md and docs/ai-os-project-spec.md. I am assigned to implement Issue #7 (backlog/007-domain-schema.md). Please implement all domain entities with Zod schemas and tests."*

---

## 🧪 Step 4: Verify Your Code

After the AI finishes writing the code, test it by running these commands in your terminal:

```bash
# 1. Install dependencies
pnpm install

# 2. Check for linting & formatting errors
pnpm lint

# 3. Run all unit tests
pnpm test

# 4. Ensure the project builds without errors
pnpm build
```

👉 **If any command shows an error**, simply copy-paste the error message back to the AI and say:
> *"The tests/build failed with this error: [paste error here]. Please fix it."*

---

## 📤 Step 5: Save & Push Your Code to GitHub

Once everything passes (`pnpm test` and `pnpm build` are green):

1. **Stage and commit your changes**:
   ```bash
   git add .
   git commit -m "feat(<area>): describe what you built (#<issue_number>)"
   ```
   *(Example: `git commit -m "feat(platform): setup monorepo pnpm workspaces (#3)"`)*

2. **Push your branch to GitHub**:
   ```bash
   git push -u origin feat/issue-3-monorepo-scaffold
   ```

---

## 🔀 Step 6: Open a Pull Request (PR)

1. Open your browser and go to [github.com/ParasRana1729/openfrost](https://github.com/ParasRana1729/openfrost).
2. You will see a green button: **"Compare & pull request"**. Click it!
3. **Fill out the PR description** (it will load our automated template):
   - In `Related Issue`, write: `Closes #3` (replace `3` with your issue number).
   - Check off the acceptance criteria boxes with `[x]`.
   - Ensure the checkboxes for tests and security are checked.
4. Click **"Create pull request"**.
5. Request a review from **@ParasRana1729** (Leader).

---

## 🎉 Step 7: After Your PR is Merged

Once the Leader reviews and merges your Pull Request:

1. Switch back to `main` and pull the latest merged code:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Pick up your next assigned issue and repeat from **Step 2**!

---

## 🆘 Quick Troubleshooting & FAQ

| Problem | Solution |
|---|---|
| *The AI is trying to use Docker or Postgres* | Remind the AI: *"Per AGENTS.md, OpenFrost uses SQLite with Drizzle ORM and runs natively on Windows. Do not use Docker or PostgreSQL."* |
| *Git says "fatal: not a git repository"* | Make sure your terminal is inside the `openfrost` folder (`cd openfrost`). |
| *I have merge conflicts with `main`* | Run `git pull origin main` and ask your AI: *"Help me resolve these git merge conflicts."* |
| *I don't know what to build next* | Check your assigned issues on [GitHub Issues](https://github.com/ParasRana1729/openfrost/issues) or consult the [Engineering Roadmap](../README.md). |
