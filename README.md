<p align="center">
  <img src="icons/icon128.png" width="96" alt="LeetPush">
</p>

<h1 align="center">LeetPush</h1>

<p align="center">Push every accepted LeetCode solution to GitHub automatically.</p>

LeetPush is a Chrome extension (Manifest V3). Submit a problem on LeetCode, and as soon as the
judge says **Accepted** your solution lands in your GitHub repository as a single, tidy commit.

## Features

- **Instant**: reacts to LeetCode's own judge result, no polling or fixed delays.
- **One commit per problem**: the statement, your code and your notes are committed together.
- **Clean layout**: one folder per problem, numbered so they sort in order.
- **Private by design**: your GitHub token stays in the extension's background worker and is
  never exposed to the LeetCode page. No servers, no analytics.
- **Progress at a glance**: totals by difficulty, current streak and your latest pushes in the popup.
- **Retry**: if a push fails, the popup shows why and lets you push it again with one click.

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

That's it. Solve a problem on [leetcode.com](https://leetcode.com/problemset/) and watch it appear on GitHub.

## Development

```
node --test 'tests/*.test.mjs'
```

| Path | Purpose |
|---|---|
| `inject/page-hook.js` | Runs in the page and notices when a submission is accepted |
| `inject/leetcode.js` | Loads the submission details and shows the on-page toast |
| `background.js` | Holds the token, pushes to GitHub, keeps stats |
| `lib/github.js` | GitHub API: one commit per push through the Git Data API |
| `lib/format.js` | Builds the files and commit message |
| `popup.*` | Settings and progress |

---

© 2026 [AnhEmSoftware](https://anhemsoftware.com)
