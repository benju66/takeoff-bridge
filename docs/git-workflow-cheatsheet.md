# Git Workflow Cheat-Sheet (plain English)

You never type git. You just say the word and the agent does it. This page is what the
words mean and what happens across a plan.

## The 4 words that matter

| Word | What it really is | Analogy |
|------|-------------------|---------|
| **Commit** | A saved snapshot of the work, *on your computer*. | A save point in a video game. |
| **Push** | Uploading your save points to GitHub (the cloud). | Backing up your saves to the cloud. |
| **Branch** | A separate workspace so risky work doesn't touch the real version. `main` is the real version. | A rough-draft copy you edit before touching the master document. |
| **Merge / PR** | Folding a branch's finished work into `main`. A "PR" is just a merge *with a review screen*. | Accepting the draft's changes into the master document. |

Two things to remember:
- A **commit lives only on your machine until you push.** Commit = local save; push = cloud backup.
- **Branches and PRs are optional ceremony.** We use a branch per plan so multi-phase work stays
  isolated; PRs stay off unless you ask.

## Your rhythm — one branch per implementation plan

1. **Start a plan** → the agent creates a branch off `main`. You say *"start phase 1"* (or just *"go"*).
2. **Each phase** → the agent runs tests / types / build / review, then commits the phase to the
   branch and backs it up. You just read the report — nothing to do.
3. **Plan finished** → you say *"land it"* / *"merge it"* → the agent merges the branch into `main`
   and pushes. **This is the only step that asks you to confirm — that one prompt is your safety gate.**

## Things you can say (plain English — intent is translated generously)

- **"go" / "start phase N"** — begin the work
- **"back it up"** — push the current branch to GitHub
- **"land it" / "merge it" / "ship it"** — merge the finished plan into `main` (you'll get one confirm prompt)
- **"undo that"** (or press **/rewind**) — revert the last change
- **"make a PR"** — only when you want the cloud deep-review (`/code-review ultra`) or CI before landing

## Safety nets (these always stop and ask first)

- **Pushing to `main`** — guarded; you get one confirmation prompt.
- **Database schema changes (DDL)** — guarded; always asks before touching the live database.
- **Force-pushes** — never done without explicit approval.
- **Undo** — `/rewind` restores files; *"undo that commit"* reverts a saved snapshot.
