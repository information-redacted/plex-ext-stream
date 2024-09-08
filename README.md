# Plex External Streaming Userscript

### Overview
This userscript allows you to play media hosted on a Plex Media Server in third-party players, such as those used in social VR platforms like VRChat, ChilloutVR, and Resonite, without exposing your Plex authentication token. It's also useful for devices that lack official Plex support but can handle MPEG-DASH playback.

### Important Notices
**⚠️ This userscript is in its early stages of development. It has no guarantees to work in your specific setup.**

**⚠️ This userscript requires a server-side component to function.**  
A reference implementation of this server component is included in the `server/` directory of this repository.

A default server is included in the script, but an access token is required. [Read more](https://selfhost.services/plex.external-media-playback.access-token-request)

**⚠️ You must keep the Plex web player tab open while streaming.**  
This is because the transcode session relies on periodic keep-alive requests. If you close the tab, the session will terminate, stopping the media playback.

**⚠️ Changing any video-related settings (audio language, subtitles, quality) will create a new transcode session.**  
This means the temporary session key used to access the stream will be invalidated, and you’ll need to refresh the stream to continue playback.

**⚠️ Plex's Fallback mode is not supported.**  
Support for the fallback method which relies on M3U8 playlists is currently not implemented. See #1 for more info.

### How It Works
When a media item is requested from Plex, the server initiates a transcode session by issuing an MPEG-DASH Manifest request. This request contains your Plex authentication token, which is sensitive information you don't want exposed.

However, the response to the manifest request does not include the token; instead, it provides a temporary session key used to access the media stream. 

The userscript intercepts this manifest request and temporarily re-hosts the response on your server, enabling the safe sharing of media streams (with the session key, not your token) in external players or social VR environments.

### Subtitles
As we rely on transcoding, it's possible to burn subtitles directly into the video stream. However, at this time, only non-SRT subtitle formats (e.g., ASS or embedded subtitles) are supported for this feature. SRT subtitles seem to be soft-loaded by the client, which means they will not be burned into the video and might not display properly in all external players.

**SRT support is being looked into (see #2).**

### Use Cases
- Sharing Plex media in social-VR platforms (VRChat, ChilloutVR, Resonite)
- Streaming Plex media to devices without native Plex app support but that can handle MPEG-DASH streams.

### Setup
#### Prerequisites
You will need to either be able to host your own server (see reference in `server/`), or have access to an existing one;
The existing reference implementation can be hosted on any PHP-capable server, including shared hosts (cPanel/Plesk/DirectAdmin).

#### Step 1: Install Tampermonkey
If you haven't already, you'll need to install the Tampermonkey extension for your browser. You can find it here:

- [Tampermonkey for Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Tampermonkey for Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Tampermonkey for Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

#### Step 2: Install the Userscript
Once Tampermonkey is installed, follow these steps:

1. Open the `.user.js` file in this repo.
2. Click the "raw" button.
3. Tampermonkey should automatically detect the userscript and prompt you to install it. Click the **Install** button.

#### Step 3: Script settings
By default, the script comes with my link-hosting server, which requires an access token. You have to configure the script to have an access token, or use a different server.

Depending on your browser, the steps here may differ, but generally:
- Go to Plex
- Click on the Tampermonkey icon in your browser's addon bar
- Click `Configure External Streaming`

From here, you can configure the server and upload password used.