# Publishing the dashboard: a step-by-step guide

This guide assumes no GitHub experience. It takes about 30–45 minutes the first time, most of it waiting for things to switch on. When you're done:

- the dashboard is live at `https://shortages.paul-bruno.com` (or another address you choose),
- the national data refresh themselves twice a week with no action from you,
- you update the state data about once a year by editing one file.

**What GitHub is, in one paragraph.** GitHub stores a project's files online along with their full history. Every saved change is a *commit*, and *pushing* sends your commits up to GitHub. GitHub offers two free services this project uses. **GitHub Pages** serves the files as a website. **GitHub Actions** runs a small program on a schedule; here, the data refresh. You'll use the **GitHub Desktop** app, so you never need the command line.

---

## Part 1. One-time setup (about 10 minutes)

### 1. Where the files live (already done)

Google Drive's syncing can corrupt the hidden history folder that Git keeps (`.git`), so the website lives in an ordinary local folder that nothing syncs:

```
C:\Users\paulb\projects\staff-shortages          ← the website; this becomes the Git repository
```

Working materials that should *not* be published stay in Google Drive, outside Git:

```
C:\GoogleDrive\UIUC\Projects\staffshortagesdashboard\
├── baselineattempt\   the original workbook and brief
└── sources\           state reports you download by hand each year (Arizona, Tennessee, and Virginia block automated downloads)
```

Once the repository is published, GitHub holds a full copy of the website files and their history, so they're backed up there.

### 2. Create a GitHub account

Go to <https://github.com/signup> and create a free account. Your **username** becomes part of the default web address (`https://USERNAME.github.io/staff-shortages/`), so choose one you're happy to have public.

### 3. Install GitHub Desktop and sign in

Download it from <https://desktop.github.com>, install it, and choose **Sign in to GitHub.com** when it opens. It will hand off to your browser to authorize; approve it there.

---

## Part 2. Put the project on GitHub (about 5 minutes)

### 4. Turn the folder into a repository

1. In GitHub Desktop: **File → Add local repository…**
2. Choose the folder from step 1 (`C:\Users\paulb\projects\staff-shortages`).
3. Desktop will say the folder "does not appear to be a Git repository". Click **create a repository** in that message.
4. In the form, set **Name** to `staff-shortages`. Leave **Git ignore** as *None* and **License** as *None* (the project already has a `.gitignore`). Click **Create repository**.

This records everything in the folder as the first commit. Your original workbook and brief aren't in this folder (they stay in Google Drive), so they won't be published.

### 5. Publish it to GitHub

1. Click **Publish repository** (top bar).
2. **Uncheck "Keep this code private."** Free GitHub Pages sites must come from a public repository. Nothing in the project is private: it is the website's own files and public data.
3. Click **Publish repository**.

---

## Part 3. Switch on the website and the data refresh (about 5 minutes, then wait)

Open your repository in the browser: in GitHub Desktop, **Repository → View on GitHub**.

### 6. Turn on GitHub Pages

1. Click **Settings** (top of the repository page) → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, choose **main** and **/ (root)**, then **Save**.
4. Wait a minute or two, then refresh the page. A banner will show the site address, `https://USERNAME.github.io/staff-shortages/`. Open it to check the dashboard loads.

### 7. Allow the automatic data refresh to save its updates

1. **Settings → Actions → General** (left sidebar).
2. Scroll to **Workflow permissions**, choose **Read and write permissions**, and click **Save**.

### 8. Run the data refresh once by hand

1. Click the **Actions** tab. If GitHub asks whether to enable workflows, click the green button to enable them.
2. Click **Update national data** in the left list, then **Run workflow → Run workflow**.
3. After a minute or so, a green check means it worked. A red X means it failed. Click it to see the log; failures are usually a temporary BLS or NCES outage, and the site keeps its previous data either way.

From now on it runs every Tuesday and Friday on its own. If a run fails, GitHub emails you.

### 9. Add a free BLS key (recommended)

Without a key, BLS allows 25 requests a day per internet address, and GitHub's servers share addresses with many other users, so that allowance can already be used up when the refresh runs (each run makes 8 requests). A free key raises the limit to 500 a day, tied to your key.

1. Register at <https://data.bls.gov/registrationEngine/>. The key arrives by email.
2. In the repository: **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `BLS_API_KEY`. Secret: paste the key. Click **Add secret**.

---

## Part 4. Use a paul-bruno.com address (about 10 minutes, then up to an hour of waiting)

The DNS for paul-bruno.com is managed at **GoDaddy**. That's where you add the subdomain, even though the main site sits behind Cloudflare.

### 10. Add a DNS record at GoDaddy

1. Sign in at <https://dcc.godaddy.com/control/portfolio> (or **My Products** → find *paul-bruno.com* → **DNS**).
2. Click **Add New Record** and enter:
   - **Type:** `CNAME`
   - **Name:** `shortages`
   - **Value / Points to:** `USERNAME.github.io` (your GitHub username, with no `https://` and no `/staff-shortages`)
   - **TTL:** leave the default
3. Save.

### 11. Tell GitHub about the address

1. Back in the repository: **Settings → Pages → Custom domain**. Enter `shortages.paul-bruno.com` and click **Save**.
2. GitHub checks the DNS record. This can take from a few minutes to an hour. When it succeeds, tick **Enforce HTTPS**. That box may stay greyed out for up to an hour while GitHub issues the security certificate.
3. GitHub will have made a small commit to your repository (a file called `CNAME`). Before you next edit anything, click **Fetch origin**, then **Pull origin**, in GitHub Desktop.

The dashboard is now at **https://shortages.paul-bruno.com**.

*Optional, for extra safety:* in your GitHub account settings (your profile picture → **Settings → Pages**), you can **verify** `paul-bruno.com`. This stops anyone else's GitHub Pages site from claiming a paul-bruno.com subdomain. GitHub shows a TXT record to add at GoDaddy, the same way as step 10.

---

## Part 5. Link it from your WordPress site

Pick one or both:

- **A link** (simplest; readers get the full-width dashboard). In WordPress, add a menu item: **Appearance → Menus** (or, in the block-theme editor, **Appearance → Editor → Navigation**). Add a **Custom Link** to `https://shortages.paul-bruno.com/` with text like "School staff shortages dashboard".
- **Embedded in a page.** Add a **Custom HTML** block to any page and paste:

  ```html
  <iframe id="ssd-frame" src="https://shortages.paul-bruno.com/?embed=1"
          title="School staff shortages dashboard" loading="lazy"
          style="width:100%;border:0;min-height:1400px"></iframe>
  <script>
  window.addEventListener('message', function (e) {
    if (e.origin === 'https://shortages.paul-bruno.com' && e.data && e.data.type === 'ssd-height') {
      document.getElementById('ssd-frame').style.height = e.data.height + 'px';
    }
  });
  </script>
  ```

  `?embed=1` hides the dashboard's own header and footer, and the script makes the frame grow to fit. Some WordPress hosts strip `<script>` tags from Custom HTML blocks. If the frame stays at a fixed height, either raise `min-height` or just use the link.

---

## Part 6. Everyday upkeep

### Before you edit anything: pull

The automatic refresh commits to the repository on its own. Before you change a file, open GitHub Desktop and click **Fetch origin**, then **Pull origin** if offered, so you're working on the latest version.

### Updating state data (about once a year)

1. Pull (above).
2. Open `data/states.json` in a text editor. VS Code is free and checks JSON for mistakes as you type.
3. Add the new year's point to the right state, following the instructions at the top of the file and the "Keeping it current" section of `README.md`. Record what you verified in that state's `verification` text, and update `"updated"` and `"verified"` at the top.
4. Preview locally if you like (see `README.md`), or just check the live site after publishing.
5. In GitHub Desktop: type a short summary in the box at the bottom left (e.g., "Add Virginia 2026-27"), click **Commit to main**, then **Push origin**.
6. The live site updates within a minute or two.

### If something goes wrong

- **The site shows "Could not load data"** after an edit: almost always a JSON typo (a missing comma or quote) in `states.json`. Open the file in VS Code, which highlights the error, fix it, commit, and push.
- **You want to undo a change:** in GitHub Desktop, open **History**, right-click the commit, and choose **Revert changes in commit**. Then push.
- **The Action fails repeatedly:** open the failed run under **Actions** to read the error. A change at BLS or NCES (a renamed series or moved file) would need a small fix to the scripts in `scripts/`.
