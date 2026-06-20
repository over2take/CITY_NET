# CITY_NET // MapSystem

Welcome to the MapSystem project. This is a full-stack real-time 3D interactive mapping application built with React, Three.js, Node.js, and SQLite.

## Setup & Deployment Instructions

### 1. Security Configuration (Required)
Before running the application in a production or public environment, you must securely configure the backend server. The application uses JSON Web Tokens (JWT) to secure administrative actions like creating, editing, and deleting map objects.

**Instructions:**
1. Navigate to the `backend` folder.
2. Locate the `.env.example` file.
3. Make a copy of `.env.example` and rename the copy to exactly `.env` (it should have no file extension).
4. Open the new `.env` file in a text editor and change the `JWT_SECRET` value to a secure, random string (like a long password). 
5. In that same `.env` file, change `ADMIN_USER` and `ADMIN_PASS` to your desired primary administrator login credentials. 

*Note: Do not commit the `.env` file to public repositories. If you do not configure your credentials, the system will use the default (`admin` / `cyberpunk_password`) which is insecure for production.*

### 2. Running the Servers
We use simple batch files to handle dependencies, booting, and tunneling.

**Local Development:**
Double-click `run_map.bat` or `run_map_local.bat` to install any missing dependencies and boot the servers for local use.

**Production Deployment:**
Double-click `start_prod.bat`. This will automatically:
1. Pull the latest code from GitHub (`main` branch).
2. Install any missing dependencies.
3. Build the highly-optimized frontend production bundle.
4. Start the Node.js backend server on Port 5000.
5. Initialize Cloudflare/Ngrok persistent tunnels to securely broadcast your server to the internet.
