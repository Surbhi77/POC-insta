<<<<<<< HEAD
# Social Publisher POC

Basic React + Node.js proof of concept for connecting Facebook Pages and Instagram professional accounts, then publishing posts through Meta APIs.

This intentionally avoids a database and file storage. Connected accounts and tokens live only in server memory.

## What This POC Supports

- Connect Facebook Pages using Facebook Login.
- Discover Instagram professional accounts linked to connected Facebook Pages.
- Connect Instagram directly using Instagram Login.
- Show connected accounts in the React UI.
- Publish a Facebook Page post with message and optional link.
- Publish an Instagram image post using a public image URL.

## Requirements

- Node.js 18 or newer.
- A Meta Developer app.
- Facebook Page access for the test user.
- Instagram Business or Creator account for Instagram publishing.

## Meta Setup

In your Meta app, configure these redirect URLs:

```text
http://localhost:5000/api/auth/facebook/callback
http://localhost:5000/api/auth/instagram/callback
```

For local OAuth testing, Meta may require HTTPS depending on your app/product settings. If localhost is blocked, expose the API with ngrok and update the redirect URLs:

```text
https://your-ngrok-domain.ngrok-free.app/api/auth/facebook/callback
https://your-ngrok-domain.ngrok-free.app/api/auth/instagram/callback
```

Then set `API_BASE_URL`, `FACEBOOK_REDIRECT_URI`, `INSTAGRAM_REDIRECT_URI`, and `VITE_API_BASE_URL` to the ngrok origin.

## Install

```bash
npm install
```

## Configure

Copy the env template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then fill in:

```text
META_APP_ID=
META_APP_SECRET=
```

The POC is already wired to these login configuration IDs from your Meta app:

```text
FACEBOOK_CONFIG_ID_PUBLISHING=1304153965041291
INSTAGRAM_WITH_FACEBOOK_CONFIG_ID=965975182701009
```

The messaging, leads, and engagement configuration IDs are intentionally not used in this POC.

Direct Instagram Login does not use a Facebook Login configuration ID. It uses the `https://www.instagram.com/oauth/authorize` endpoint with `INSTAGRAM_SCOPES`. If your Meta dashboard shows a separate Instagram App ID and App Secret, set `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` in `.env`.

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Publishing Notes

Facebook posting works only for Pages, not personal profiles.

Instagram publishing requires a professional account. For this POC, paste a publicly reachable image URL in the publish form. Meta fetches the media from that URL when creating the Instagram media container.

Instagram direct integration uses `graph.instagram.com`. Instagram via Facebook uses `graph.facebook.com`.

## Important POC Limitations

- Tokens are not encrypted.
- Tokens are lost when the server restarts.
- No refresh-token job is implemented.
- No scheduler is implemented.
- No upload pipeline is implemented.
- Meta App Review may be required for accounts outside your own app roles/test users.

