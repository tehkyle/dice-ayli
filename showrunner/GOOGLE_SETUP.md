# Google Sheets Setup

This app exports show data to a Google Sheet after each performance. It uses Google OAuth2 — stage managers log in with their own Google account rather than a shared service account.

This is a one-time setup per deployment. Once done, stage managers use the gear icon in the app to connect their account and pick a spreadsheet.

---

## What you'll need

- A Google account with access to [Google Cloud Console](https://console.cloud.google.com)
- About 10 minutes
- The URL where the app is running (e.g. `http://localhost:3000` or your deployed address)

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top of the page (it may say "Select a project" or show an existing project name)
3. Click **New Project**
4. Give it a name — something like `Showrunner` or `AYLI`
5. Click **Create**
6. Wait a moment, then make sure your new project is selected in the top dropdown

---

## Step 2 — Enable the required APIs

You need to enable two APIs: Google Sheets (for writing rows) and Google Drive (for listing the user's spreadsheets).

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for **Google Sheets API** → click it → click **Enable**
3. Go back to the library, search for **Google Drive API** → click it → click **Enable**

---

## Step 3 — Configure the OAuth consent screen

Before creating credentials, Google needs to know what this app is and who can use it.

1. In the left sidebar, go to **APIs & Services → OAuth consent screen**
2. Select **Internal** if everyone who will use this app has a Google Workspace account under the same organisation — this skips Google's app review process entirely.
   - If users have regular Gmail accounts (not Workspace), choose **External** instead.
3. Click **Create**
4. Fill in the required fields:
   - **App name**: `Showrunner` (or whatever you like — this is shown on the Google login screen)
   - **User support email**: your email
   - **Developer contact information**: your email
5. Click **Save and Continue**
6. On the **Scopes** screen, click **Save and Continue** (no changes needed — the app requests scopes at login time)
7. If you chose **External**: on the **Test users** screen, add the email addresses of anyone who will use the app. Click **Save and Continue**.
8. Click **Back to Dashboard**

---

## Step 4 — Create OAuth credentials

1. In the left sidebar, go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. For **Application type**, choose **Web application**
4. Give it a name, e.g. `Showrunner Web`
5. Under **Authorized redirect URIs**, click **+ Add URI** and add:
   ```
   http://localhost:3000/api/auth/google/callback
   ```
   If the app is also accessed from other addresses (e.g. a local network IP or a deployed domain), add each one:
   ```
   http://192.168.1.50:3000/api/auth/google/callback
   https://yourshowdomain.com/api/auth/google/callback
   ```
   > The redirect URI must match **exactly** — including protocol (`http` vs `https`), host, port, and path. Add all addresses stage managers might use.
6. Click **Create**
7. A dialog appears showing your **Client ID** and **Client Secret** — copy both now. You can also download them as a JSON file for reference.

---

## Step 5 — Add credentials to the app

Open `showrunner/.env` (create it from `.env.example` if it doesn't exist yet) and fill in:

```
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-your-secret-here
```

If you're deploying via GitHub Actions, add these as repository secrets (`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`) and have your workflow write them into `.env` on the server.

Restart the app after changing `.env`.

---

## Step 6 — Connect from the app

1. Open the app in a browser and click the **gear icon** (top right of the welcome screen)
2. Click **Connect Google Account**
3. Log in with the Google account that owns or has editor access to the target spreadsheet
4. After redirecting back, pick the spreadsheet from the dropdown
5. Pick the sheet tab to write rows to
6. Click **Save** — the badge turns green

The app will now append a row to that tab every time the `/show/end` cue fires in QLab.

---

## Notes

**Who needs to be logged in?**
Whoever logs in via the gear icon must have at least Editor access to the target spreadsheet. The tokens are stored on the server (`sheets-config.json`) and persist across restarts.

**What if someone logs in with a different account later?**
Clicking Connect again (after disconnecting) replaces the stored tokens entirely.

**External app and unverified warning**
If you chose External consent screen and haven't submitted the app for Google's review, users will see a "Google hasn't verified this app" warning screen. Click **Advanced → Go to [App Name] (unsafe)** to proceed — this is expected for internal tools that haven't gone through verification.

**Token refresh**
Access tokens expire after one hour. The app refreshes them automatically using the stored refresh token — no re-login needed.
