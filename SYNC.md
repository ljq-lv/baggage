# Cross-device Sync

Run the built-in sync server:

```bash
npm start
```

Open `http://localhost:8082` on the server computer.

On Mac, Windows, iPhone, or Android devices on the same network, open:

```text
http://<server LAN IP>:8082
```

All devices that use the same server URL share one data file:

```text
data/sync-data.json
```

Directly opening `index.html` still works, but that mode only uses the current browser's local storage and cannot sync across devices.
