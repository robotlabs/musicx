---
name: pcloud-music
description: Roberto's music library setup — pCloud served over local HTTP via rclone (no filesystem mount!), custom web player, .m3u playlists. Use this skill whenever Roberto mentions his music, playlists, the player, VLC, pCloud, rclone, audio not loading, or anything about listening to / organizing his music library, even if he doesn't name the tools explicitly.
---

# pCloud Music Setup (Roberto)

## Architecture (and its history — important)

Roberto's music lives on pCloud (EU account). Two approaches were tried and REJECTED because they freeze processes at the kernel level on macOS:

1. **pCloud Drive** (official app) — crashed Finder repeatedly.
2. **rclone nfsmount** at `~/pCloud-Music` — the macOS NFS client wedged, freezing VLC into an unkillable zombie. Removed.

Current architecture — **no filesystem mount, HTTP only**: `rclone serve http pcloud:rob/music` on `127.0.0.1:8620`, run by launchd at login. A custom single-file web player (`player.html` in the musicx folder) browses and streams from it. If anything stalls, requests just time out with an error — nothing can freeze.

**Never suggest going back to any mount-based approach (pCloud Drive, nfsmount, macFUSE, FUSE-T, WebDAV mounts). Roberto has suffered enough.**

## Key facts

| Thing | Value |
|---|---|
| Music URL | `http://127.0.0.1:8620/` (serves `pcloud:rob/music`, read-only) |
| rclone remote | `pcloud` (type: pcloud, hostname `eapi.pcloud.com` — EU, never api.pcloud.com) |
| launchd label | `com.roberto.rclone-music-http` |
| plist | `~/Library/LaunchAgents/com.roberto.rclone-music-http.plist` |
| Logs | `~/Library/Logs/rclone/music-http.log` |
| VFS cache | mode `full`, max 10G |
| Player | `player.html` in the musicx workspace folder — open in browser |
| Playlists folder | `/Users/roberto/io/musicx/playlists` |
| Setup script | `switch-to-http.sh` in musicx (re-runnable, also removes old NFS remnants) |

## Player (player.html)

Single-file vanilla JS app. Browses the library by parsing rclone's HTML directory listings (GET, no CORS preflight), streams via `<audio>` with `src = http://127.0.0.1:8620/<path>`. Playlists live in localStorage (browser-bound — exported .m3u files in the playlists folder are the backup); export/import as `.m3u`. On track error it skips to the next instead of stopping. Right-click on any track (browser list or playlist) opens a context menu: play, download local copy (fetch → blob → Downloads folder; there is no "reveal in Finder" because files only exist on pCloud), add to any playlist, remove. Roberto is happy with this setup — no native app needed.

## Playlist conventions

- `.m3u` files live in `/Users/roberto/io/musicx/playlists`, kebab-case names (`late-night-dub.m3u`).
- Entries are URLs: `http://127.0.0.1:8620/<percent-encoded-path>` — also playable directly in VLC.
- Format: `#EXTM3U` header, `#EXTINF:-1,<title>` before each URL.
- Exported playlists land in Downloads; move them into the playlists folder.
- When Claude creates a playlist: browse the library via `curl http://127.0.0.1:8620/<dir>/` (only works on Roberto's Mac — give him commands) or ask for the file list, then write the .m3u into the playlists folder.

## Troubleshooting

Server not responding (player says "server non raggiungibile"):
1. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8620/` → expect 200
2. Restart: `launchctl kickstart -k gui/$(id -u)/com.roberto.rclone-music-http`
3. Log: `tail -30 ~/Library/Logs/rclone/music-http.log`
4. Not loaded at all: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.roberto.rclone-music-http.plist`

Auth errors (401 in log): remote must keep `hostname = eapi.pcloud.com`. Fix: `rclone config update pcloud hostname eapi.pcloud.com`; token expired → `rclone config reconnect pcloud:`.

Leftover NFS zombie (only if old mount somehow returns): `launchctl bootout gui/$(id -u)/com.roberto.rclone-pcloud`, then `sudo umount -f ~/pCloud-Music`. Force-unmounting is what releases frozen processes; a stuck process in state `E` dies on its own once the mount is freed. Worst case: reboot, it's fine.

## Things to remember when helping

- Claude's sandbox cannot run commands on Roberto's Mac: give him Terminal commands to paste, or scripts to run.
- Roberto speaks Italian; answer in Italian unless he switches.
- The pCloud API is available for building more tooling: `eapi.pcloud.com`, methods `listfolder`, `getaudiolink` (mp3 transcode stream), `getfilelink` (original). The rclone OAuth token in `~/.config/rclone/rclone.conf` can be reused as `access_token`.
