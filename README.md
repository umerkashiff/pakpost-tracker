# 🇵🇰 Pakistan Post Automated Tracker (EMTTS)

An automated parcel tracker for **Pakistan Post** that runs **24/7 in the cloud on Vercel** — no need to keep your laptop on or manually visit the website and type tracking IDs. It queries the official Pakistan Post Express Mail Track & Trace System (EMTTS) and dispatches automated **Discord Webhook** notifications daily.

![Pakistan Post Tracker](https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Pakistan_Post_logo.svg/320px-Pakistan_Post_logo.svg.png)

---

## ✨ Features

- ⚡ **No Website Visit Needed**: Automated tracking via Pakistan Post's official EMTTS engine (`ep.gov.pk`).
- 🤖 **Discord Webhook Notifications**: Rich Discord embeds with status colors, checkpoints history, timestamps, and direct portal links.
- ⏰ **Daily Automated Checks**: Pre-configured Vercel Cron job (`0 4 * * *` = 09:00 AM PKT / 04:00 UTC) runs without keeping your computer running.
- 📦 **Multi-Parcel Support**: Track multiple domestic and international packages simultaneously (e.g. `LT...NL`, `EP...PK`, `RR...PK`, UMS).
- 💻 **Web Dashboard**: Modern, responsive Next.js interface with live timeline visualization, one-click manual tracking, and Discord test triggers.
- ☁️ **100% Free Cloud Hosting on Vercel**: Deployable in 2 minutes with zero cost.

---

## 🚀 2-Minute Deployment Guide (Vercel)

### Step 1: Push to GitHub
If you haven't pushed yet:
```bash
git remote add origin git@github.com:umerkashiff/pakpost-tracker.git
git branch -M main
git push -u origin main
```

### Step 2: Import into Vercel
1. Go to [vercel.com/new](https://vercel.com/new) and log in.
2. Select your repository: `umerkashiff/pakpost-tracker`.
3. Before clicking **Deploy**, open **Environment Variables** and add:
   - **`DISCORD_WEBHOOK_URL`**: `https://discord.com/api/webhooks/1375514718797824110/4VSkCKl1NxUEhbHbkNKxVZT4OOsU9l1E6LONKBwu_Moe6BP0Pn4YrmN1X7W6lOq1vMv7`
   - **`TRACKING_IDS`**: `LT880952265NL:Netherlands Shipment` *(or comma-separated for multiple: `ID1:Label1,ID2:Label2`)*
4. Click **Deploy**!

That's it! Vercel Cron will now trigger every day at 09:00 AM PKT automatically.

---

## ⚙️ Configuration Options

You can add or update parcels in two ways:

### Option A: `parcels.json` (Recommended for Git tracking)
Edit `parcels.json` directly in the repository:
```json
[
  {
    "id": "LT880952265NL",
    "label": "Netherlands Shipment",
    "enabled": true
  },
  {
    "id": "EP123456789PK",
    "label": "Karachi Express",
    "enabled": true
  }
]
```

### Option B: Environment Variable `TRACKING_IDS`
In your Vercel Project Settings > Environment Variables:
```env
TRACKING_IDS=LT880952265NL:Netherlands Shipment,EP123456789PK:Islamabad Doc
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/cron` | `GET`, `POST` | The automated job invoked by Vercel Cron. Checks all parcels and posts embeds to Discord. |
| `/api/track?id=LT880952265NL` | `GET` | Fetches live tracking data for any tracking number in JSON format. |
| `/api/notify-test` | `POST` | Dispatches an instant test embed to verify Discord Webhook connectivity. |
| `/api/parcels` | `GET` | Returns list of currently scheduled parcels. |

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛡️ License
MIT
