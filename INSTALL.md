# Install CITY_NET, Step by Step

This guide assumes you have never used Docker or a tunnel. If a step doesn't go the way it says here, look in [When something goes wrong](#when-something-goes-wrong), or ask on the [Discord](https://discord.gg/Zc3GVztTAD).

You only need to do this if you're the GM hosting the game. **Players don't install anything.** They just open a link in their browser.

**The two pieces, in plain words:**

- **Docker** runs CITY_NET on your computer. You install it once, and it does the rest.
- **A tunnel** gives you a web link your players can open from anywhere. Without one, only people on your home network can reach the game.

**Contents**

1. [Install Docker Desktop](#1-install-docker-desktop)
2. [Download CITY_NET](#2-download-city_net)
3. [Run the guided setup](#3-run-the-guided-setup)
4. [Open the game](#4-open-the-game)
5. [Give your players a link](#5-give-your-players-a-link)
6. [Day to day](#6-day-to-day)
7. [When something goes wrong](#when-something-goes-wrong)

---

## 1. Install Docker Desktop

1. Download [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your computer, and run the installer.
2. Accept the defaults. On Windows it may ask you to restart your computer, which is normal.
3. **Open Docker Desktop** from your Start menu or Applications folder. The first time, it asks you to accept its terms. You can skip signing in.
4. Wait until it says the engine is running.

**Docker Desktop has to be open whenever you run the game.** In its settings you can turn on starting it when you sign in to your computer, so you never have to think about it.

## 2. Download CITY_NET

The simple way, with no other tools:

1. Go to [github.com/over2take/CITY_NET](https://github.com/over2take/CITY_NET).
2. Press the green **Code** button, then **Download ZIP**.
3. Find the ZIP in your Downloads folder and unzip it. On Windows, right-click it and choose **Extract All**.
4. Move the unzipped folder somewhere you'll keep it, such as your Documents folder. Your game's data lives in this folder, so don't delete it.

If you already use Git, this does the same thing:

```bash
git clone https://github.com/over2take/CITY_NET.git
```

## 3. Run the guided setup

> **Only run this script if you got it from the link above.** A setup script can do anything your user account can.

- **Windows:** open the CITY_NET folder and double-click **`setup.bat`**. If Windows shows a blue "protected your PC" warning, choose **More info**, then **Run anyway**.
- **Mac or Linux:** open a terminal in the CITY_NET folder and run `bash setup.sh`.

A window opens and asks a few questions. Type an answer and press Enter. **The value in `[brackets]` is the default, which you get by just pressing Enter.**

| It asks | What to do |
|---|---|
| `Use Docker? (recommended)` | Press Enter. You only see this if you also have Node.js installed. |
| `Admin username [admin]` | Press Enter, or type a name. This is your GM login. |
| `Admin password` | Type a password and press Enter. **Nothing shows as you type, which is normal.** Pick a real one and write it down. |
| `App port [8080]` | Press Enter. This guide uses 8080 from here on. If you chose another number, use yours instead. |
| `Enable Secure Mode? [y/N]` | Off, players just type a name to join, which is simplest. On (`y`), players need an account you approve. **If you'll share a link over the internet, we suggest `y`,** because anyone with the link can get in otherwise. |
| `Set up DuckDNS now? [y/N]` | Press Enter to skip it. A tunnel is easier, and you can come back to this. |
| `Build and start City_Net now? [Y/n]` | Press Enter. |

The first start can take several minutes while it downloads and builds everything. When it's done it says **CITY_NET IS RUNNING**, and shows your addresses.

## 4. Open the game

1. In your browser, go to **http://localhost:8080**.
2. Enter a name to get onto the map. With Secure Mode on, enter your admin username and password on that first screen instead, and you're done.
3. Press **ADMIN_LOGIN** in the top bar, and enter your admin username and password. That gives you the GM's tools.

The setup window also showed an address like `http://192.168.1.20:8080`. Anyone on your home network can open that one.

`localhost` means "this computer", so that address won't work for your players. For them, you need the next step.

## 5. Give your players a link

### The quick way: a Cloudflare quick tunnel

This is free, needs no account, and doesn't touch your router. The catch is **you get a different link every time you start it**, and it only works while the window stays open. That's fine for trying things out or for a one-off session.

**Install it, once.** Open a terminal: on Windows, right-click the Start button and choose **Terminal** (or **PowerShell**). Then run the line for your computer:

```powershell
winget install --id Cloudflare.cloudflared
```

```bash
brew install cloudflared
```

The first is for Windows and the second is for Mac. For Linux, or if those don't work, use [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). **Close the terminal and open a new one afterward,** or it won't find the command.

**Start the tunnel.** Make sure the game is running, then run:

```bash
cloudflared tunnel --url http://localhost:8080
```

A lot of text scrolls by. Look for a box with a link ending in **`trycloudflare.com`**:

```
Your quick Tunnel has been created! Visit it at:
https://some-random-words.trycloudflare.com
```

**Send that link to your players.** Try it yourself first on your phone, with Wi-Fi off.

**Leave that window open** for as long as you play. Closing it ends the link. To stop, press `Ctrl+C` in it.

### The permanent way: a named Cloudflare tunnel

This gives you a link that never changes, like `game.yourdomain.com`, and it starts by itself with your computer. **You need your own domain name, added to a free Cloudflare account.** If you don't have one, use the quick tunnel or DuckDNS.

As of November 2026 the steps are as follows, though Cloudflare does move its menus around. If these don't match, see [their current guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/).

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and go to **Networking**, then **Tunnels**.
2. Press **Create a tunnel**, give it a name like `citynet`, and press **Create Tunnel**.
3. Choose your operating system. Cloudflare shows a command. **Copy it and run it in a terminal on the computer hosting the game.** Treat that command like a password, as it holds your tunnel's key.
4. Wait for it to connect, then press **Continue**.
5. On your tunnel's **Routes** tab, press **Add route**, then **Published application**.
6. Enter a subdomain such as `game`, and pick your domain.
7. For **Service URL**, enter `http://localhost:8080`.
8. Press **Add route**. The tunnel should show as **Healthy**.

Your players' link is now `https://game.yourdomain.com`.

### The DuckDNS way

DuckDNS gives you a free name like `yourcity.duckdns.org`. **It needs port forwarding on your router, and it doesn't give you HTTPS on its own,** so try a tunnel first if you can.

1. Sign in at [duckdns.org](https://www.duckdns.org), add a subdomain, and copy your **token**. Treat the token like a password.
2. Run the setup again and answer `y` to both `Overwrite it?` and `Set up DuckDNS now?`. Give it your subdomain (only the part before `.duckdns.org`) and your token.
3. On your router, forward **port 8080** to the computer hosting the game. Every router's menus are different, so search for your router's model and "port forwarding". Your computer's address is the `192.168.x.x` one the setup showed.
4. Allow port 8080 through your computer's firewall. On Windows, that's **Windows Defender Firewall**, then **Advanced Settings**, then **Inbound Rules**.
5. Your players' link is `http://yourcity.duckdns.org:8080`. Test it from your phone with Wi-Fi off, as many routers won't let you test it from inside your own home.

## 6. Day to day

**Starting it:** open Docker Desktop. The game comes back by itself. If you use a quick tunnel, start that again too, and send your players the new link.

**Stopping it:** in Docker Desktop, open **Containers** and press stop on the group named after your CITY_NET folder. Your game is saved.

**Updating it:** see [UPGRADE.md](UPGRADE.md). When you're signed in as GM, the app can check for a new version and update itself.

**Backing it up:** your city, characters and uploads live in the `backend/data` and `backend/uploads` folders, inside the CITY_NET folder. Copy those somewhere safe now and then.

The `docker compose` commands only work from inside the CITY_NET folder. To open a terminal there on Windows, open the folder, right-click an empty spot, and choose **Open in Terminal**.

## When something goes wrong

**First, check that it's running.** In a terminal in the CITY_NET folder, run:

```bash
docker compose ps
```

You should see `backend` and `frontend` listed as running. If not, this usually says why:

```bash
docker compose logs backend
```

| What you see | What it means | What to do |
|---|---|---|
| `Neither Docker nor Node.js ... was found` | Docker isn't installed, or that window opened before it was. | Install Docker Desktop, restart your computer, and run the setup again. |
| `docker` is "not recognized" | The same thing. | Same as above. |
| `failed to connect to the docker API`, or anything about `dockerDesktopLinuxEngine` | **Docker Desktop isn't open.** This is the most common one. | Open it, wait for the engine to start, and try again. |
| `port is already allocated`, or the setup warns the port is in use | Another program already has that port. NVIDIA Broadcast often takes 8080. | Run the setup again and choose another port, like `8081`. Use that number everywhere this guide says 8080. |
| The page at `localhost:8080` won't load, or shows some other app | It's still starting, or another program has that port. | Wait a minute and refresh. Then run `docker compose ps`. If another app appears, it's the port problem above. |
| `cloudflared` is "not recognized" | That terminal opened before it was installed. | Close it and open a new one. |
| The tunnel link shows a Cloudflare error page, like 502 | The tunnel is up, but it can't reach the game. | Check the game opens at `localhost:8080`, and that the tunnel command has your port. |
| The tunnel link worked yesterday, and now doesn't | Quick tunnel links change every time. | Start it again and send the new link, or set up a named tunnel. |
| Players can reach the link, but it says the name or password is wrong | Your admin login is only for you. | With Secure Mode on, each player registers on the login screen, and you approve them. |
| You forgot your admin password | It's saved in a settings file. | Open `backend/.env` in Notepad, change the `ADMIN_PASS=` line, save it, and run `docker compose up -d`. |
| The `duckdns` container shows errors, and you aren't using DuckDNS | It runs either way, with no name to update. | You can ignore it. The game doesn't depend on it. |

**Asking for help?** On the [Discord](https://discord.gg/Zc3GVztTAD), say which step you're on and paste the exact message. **Never post your `backend/.env` file, your DuckDNS token, or a Cloudflare tunnel command,** because those are your keys.
