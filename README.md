<p align="center">
  <img src="icons/icon128.png" width="96" alt="LeetPush">
</p>

<h1 align="center">LeetPush</h1>

<p align="center">Push every accepted LeetCode solution to GitHub automatically.</p>

LeetPush is a Chrome extension (Manifest V3) that commits your accepted LeetCode solutions to a
GitHub repository, one tidy commit per problem.

## Two modes

- **Manual** (default): nothing runs on LeetCode. When you want, open a problem and press **Push**
  in the popup or hit `Alt+Shift+P`. On a submission page it pushes that submission; on a problem
  page it pushes your latest accepted solution.
- **Auto**: every accepted submission is pushed right after you submit. A tiny script is added to
  leetcode.com only while Auto is on, and removed again when you switch back to Manual.

## Features

- **One commit per problem**: the statement, your code and your notes are committed together.
- **Clean layout**: one folder per problem, numbered so they sort in order.
- **Private by design**: your GitHub token stays in the extension's background worker and is
  never exposed to the LeetCode page. No servers, no analytics.
- **Lightweight**: no timers, no polling, no growing cache. It only stores your settings and the
  latest push.
- **Safe to repeat**: pushing the same solution again creates no new commit.

## Repository layout

```
0001-two-sum/
├── README.md       # problem statement, difficulty, tags, runtime and memory
├── two-sum.py      # your accepted code
└── NOTES.md        # only if you wrote notes on LeetCode
0015-3sum/
└── ...
```

You can also put everything under a subfolder, for example `leetcode/0001-two-sum/`.

## Install

1. Download this repository (`git clone` or **Code → Download ZIP** and unzip it)
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the repository folder
4. Pin the LeetPush icon to the toolbar

## Connect GitHub

1. Create a repository for your solutions (an empty one is fine)
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access**: *Only select repositories* → your solutions repository
   - **Permissions → Contents**: *Read and write*
3. Open the LeetPush popup, paste the token, enter the repository as `owner/name`, and click **Connect**

That's it. Solve a problem on [leetcode.com](https://leetcode.com/problemset/), then press **Push**
(or switch to **Auto**). Change the shortcut at `chrome://extensions/shortcuts`.

## Development

```
node --test 'tests/*.test.mjs'
```

| Path | Purpose |
|---|---|
| `lib/leetcode.js` | Runs in the LeetCode tab when pushing and loads the submission details |
| `inject/auto.js` | Auto mode only: notices new submissions and shows the on-page toast |
| `background.js` | Modes, holds the token, pushes to GitHub |
| `lib/github.js` | GitHub API: one commit per push through the Git Data API |
| `lib/format.js` | Builds the files and commit message |
| `popup.*` | Settings, mode, Push button and the latest push |

---

© 2026 [AnhEmSoftware](https://anhemsoftware.com)
