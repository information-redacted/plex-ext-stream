// ==UserScript==
// @name         Plex - External Streaming (VLC, VRChat, ChilloutVR, Resonite)
// @author       [information redacted] <redacted@selfhost.services>
// @homepage     https://selfhost.services
// @description  Allows Plex-accessible media to be played in external players without leaking the user's authentication token.
// @version      Beta-v1
// @namespace    https://selfhost.services/
// @match        https://app.plex.tv/*
// @match        https://*.plex.direct/*
// @match        https://clients.plex.tv/api/v2/resources
// @match        *://*/video/:/transcode/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.js
// ==/UserScript==

let window = unsafeWindow;

// I don't know how to do this better in JS. Have a global <3
let _global = {
    hostingServer: null,
    hostingPassword: null,
    prefersRemoteUrl: false,
    allowPlexRelay: false,

    lastUrl: null,
    lastResponse: null,
    lastMode: null,

    localAddressToRemoteMapping: {},
};

let gmc = new GM_config({
    'id': 'Plex.ExternalStreaming',
    'title': 'Plex - External Streaming Settings',
    'css': 'body { background-color: #ffffff; }',
    'fields': {
        'server': {
            'label': 'Server hosting your links',
            'type': 'text',
            'default': 'https://kaori.cbt.li/mediaserve.php'
        },
        'password': {
            'label': 'The upload password to use when hosting a link',
            'type': 'text',
            'default': ''
        },
        'prefersRemote': {
            'label': 'Should a remote-first URL be forced?',
            'type': 'checkbox',
            'default': false
        },
        'allowPlexRelay': {
            'label': 'Should Plex relays be allowed to be used as remote URLs?',
            'type': 'checkbox',
            'default': false
        }
    },
    'events': {
        'init': function() {
            _global.hostingServer = this.get('server');
            _global.hostingPassword = this.get('password');
            _global.prefersRemoteUrl = this.get('prefersRemote');
            _global.allowPlexRelay = this.get('allowPlexRelay');
        },
        'save': function() {
            _global.hostingServer = this.get('server');
            _global.hostingPassword = this.get('password');
            _global.prefersRemoteUrl = this.get('prefersRemote');
            _global.allowPlexRelay = this.get('allowPlexRelay');
        }
    }
});

GM_registerMenuCommand("Configure External Streaming", () => {
    gmc.open();
});

// modifySegmentTemplate replaces the `initialization` and `media` URL format strings
// to be absolute URLs to the source media server in the MPEG-DASH manifest
//
// Normally, when a Plex server responds to the MPEG-DASH manifest request,
// the URLs are relative (`initialization="session/..."`).
function modifySegmentTemplate(_xml, _url) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(_xml, "application/xml");
    const baseUrl = _url.substring(0, _url.lastIndexOf('/') + 1);
    if (_global.prefersRemoteUrl) {
        for (const [local, remote] of Object.entries(_global.localAddressToRemoteMapping)) {
            if (baseUrl.startsWith(local)) {
                _url = baseUrl.replace(local, remote) + _url.substring(baseUrl.length);
                break;
            }
        }
    }

    const segmentTemplates = xmlDoc.getElementsByTagName("SegmentTemplate");
    for (let segmentTemplate of segmentTemplates) {
        if (segmentTemplate.hasAttribute("initialization")) {
            const initialization = segmentTemplate.getAttribute("initialization");
            if (initialization.startsWith("session/")) {
                segmentTemplate.setAttribute("initialization", baseUrl + initialization);
            }
        }

        if (segmentTemplate.hasAttribute("media")) {
            const media = segmentTemplate.getAttribute("media");
            if (media.startsWith("session/")) {
                segmentTemplate.setAttribute("media", baseUrl + media);
            }
        }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(xmlDoc);
}

function modifyM3U8Playlist(_m3u8, _url) {
    const baseUrl = _url.substring(0, _url.lastIndexOf('/') + 1);
    return _m3u8.split('\n').map(line => {
        if (
            line && !line.startsWith('#') &&
            !line.startsWith('http') &&
            !line.startsWith('/')
        ) {
            return baseUrl + line;
        }
        if (line.startsWith('#EXT-X-MAP:')) {
            return line.replace(/URI="([^"]+)"/, (match, uri) => {
                if (!uri.startsWith('http') && !uri.startsWith('/')) {
                    return `URI="${baseUrl + uri}"`;
                }
                return match;
            });
        }
        return line;
    }).join('\n');
}

// postToServer sends a POST request containing a URL-encoded form to the server
// that hosts the .mpd files.
function postToServer(_url, _data) {
    if (_url == '' || _url === null) {
        // users can opt to always use the fallback of not using an autoupload server
        return new Promise((resolve, reject) => {
            throw new Error("URL was empty!");
        });
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', _url, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error(`Request failed with status ${xhr.status}:\n${xhr.responseText}\n\n`));
                }
            }
        };

        const urlEncodedData = Object.keys(_data)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(_data[key]))
            .join('&');
        xhr.send(urlEncodedData);
    });
}

function onButtonClickHandler(_data) {
    if (_data.content === null || _data.content === '') {
        alert('You have not started a stream.')
        return;
    }

    if (_data.mode === 'm3u8' && _global.prefersRemoteUrl) {
        for (const [local, remote] of Object.entries(_global.localAddressToRemoteMapping)) {
            if (_data.content.startsWith(local)) {
                _data.content = _data.content.replace(local, remote);
                break;
            }
        }
    }

    postToServer(_global.hostingServer, _data)
        .then(response => {
            navigator.clipboard.writeText(response);
            alert("Copied to clipboard!\n" + response);
        })
        .catch(error => {
            alert(`Failed to send to server for hosting (error: ${error}), please host your own file:\n${_data.content}`);
        });
}

function placeButtonInPlayerBar() {
    // Select the div that holds the settings-related buttons on the right side of
    // the player.
    const rightPlayerControlsDiv = document.querySelector('div[class*="PlayerControls-buttonGroupRight"]');

    if (rightPlayerControlsDiv) {
        // get a reference to any button in the group so we can copy it
        const buttonTemplate = rightPlayerControlsDiv.querySelector('button');
        if (buttonTemplate) {
            const streamExternallyButton = buttonTemplate.cloneNode(true);
            streamExternallyButton.id = 'userjs-streamExtButton';
            streamExternallyButton.title = 'Watch outside of Plex';
            streamExternallyButton.setAttribute('aria-label', 'Watch outside of Plex');

            // clean up plex-specific properties that are useless to us
            streamExternallyButton.setAttribute('data-testid', '');
            streamExternallyButton.setAttribute('data-uid', '');

            streamExternallyButton.addEventListener('click', function() {
                onButtonClickHandler({
                    'password': _global.hostingPassword,
                    'content': _global.lastResponse,
                    'mode': _global.lastMode,
                })
            });

            // Replace SVG in button
            const svgTemplate = streamExternallyButton.querySelector('svg');
            if (svgTemplate) {
                // SVG for Cast icon: Google, Inc., CC BY 3.0 <https://creativecommons.org/licenses/by/3.0>, via Wikimedia Commons
                // https://commons.wikimedia.org/wiki/File:Chromecast_cast_button_icon.svg
                // Modified to be minified and use currentColor instead of #000000
                const newSvgHtml = `<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd"><path d="M1 18v3h3c0-1.66-1.34-3-3-3Zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7Zm0-4v2a9 9 0 0 1 9 9h2c0-6.08-4.93-11-11-11Zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Z" fill="currentColor"/><path d="M0 0h24v24H0z"/></g></svg>`;
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = newSvgHtml;

                const newSvg = tempContainer.querySelector('svg');
                streamExternallyButton.replaceChild(newSvg, svgTemplate);
            }

            const lastChild = rightPlayerControlsDiv.lastElementChild;
            rightPlayerControlsDiv.insertBefore(streamExternallyButton, lastChild);
        } else {
            throw new Error(`Could not find a button to base ours off of in the right player controls div`);
        }
    } else {
        throw new Error(`placeButtonInPlayerBar was called but a div matching PlayerControls-buttonGroupRight could not be found`)
    }
}

function checkForMissingButton() {
    const bottomBars = document.querySelectorAll("div[class^='BottomBar-bottomBar']");

    bottomBars.forEach(div => {
        const button = div.querySelector("button[id='userjs-streamExtButton']");
        if (!button) {
            placeButtonInPlayerBar();
        }
    });
}

(function() {
    'use strict';

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            checkForMissingButton();
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Override the open and send methods of XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        this._url = url;
        originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        this.addEventListener('load', function() {
            if (this._url && this._url.includes('clients.plex.tv/api/v2/resources')) {
                console.log("%c[XHR - DEBUG - Plex->External - RESOURCES]: START", 'background: #222; color: #bada55');
                let availablePlexServers = JSON.parse(this.responseText);
                availablePlexServers.forEach(srv => {
                    console.log("%c[XHR - DEBUG - Plex->External - RESOURCES]: SRV -> Name=%s (%O)", 'background: #222; color: #bada55', srv.name, srv);
                    let serverLocalAddresses = [];
                    let serverRemoteAddr = "";
                    let hasOwnAddress = false;
                    let hasRelayAddress = false;

                    srv.connections.forEach(conn => {
                        console.log("%c[XHR - DEBUG - Plex->External - RESOURCES]: SRV -> Name=%s, Conn=%s", 'background: #222; color: #bada55', srv.name, conn.uri);
                        if (conn.local && !serverLocalAddresses.includes(conn.uri)) {
                            serverLocalAddresses.push(conn.uri);
                            return;
                        }

                        if (!conn.local && !hasOwnAddress) {
                            if (_global.allowPlexRelay && conn.relay && !hasOwnAddress) {
                                serverRemoteAddr = conn.uri;
                                hasRelayAddress = true;
                                return;
                            }

                            if (!conn.relay) {
                                serverRemoteAddr = conn.uri;
                                hasOwnAddress = true;
                            }
                        }
                    });

                    if (serverRemoteAddr != "") {
                        serverLocalAddresses.forEach(la => {
                            _global.localAddressToRemoteMapping[la] = serverRemoteAddr;
                        });
                    }
                })

                console.log("%c[XHR - DEBUG - Plex->External - RESOURCES]: Mapping list: %O", 'background: #222; color: #bada55', _global.localAddressToRemoteMapping);
            }

            if (this._url && this._url.includes('/start.mpd')) {
                console.log("%c[XHR - DEBUG - Plex->External - MPD]: Captured request!\n\tReqURL: %s\n\tResponse: %s", 'background: #222; color: #bada55', this._url, this.responseText);
                const modifiedResponse = modifySegmentTemplate(this.responseText, this._url);
                console.log("%c[XHR - DEBUG - Plex->External - MPD]: Altered response: %s", 'background: #222; color: #bada55', modifiedResponse);

                _global.lastUrl = this._url;
                _global.lastResponse = modifiedResponse;
                _global.lastMode = "mpd";
            } else if (this._url && this._url.includes('/base/index.m3u8')) {
                console.log("%c[XHR - DEBUG - Plex->External - M3U8]: Captured request!\n\tReqURL: %s\n\tResponse: %s", 'background: #222; color: #bada55', this._url, this.responseText);
                const modifiedResponse = modifyM3U8Playlist(this.responseText, this._url);
                console.log("%c[XHR - DEBUG - Plex->External - M3U8]: Altered response: %s", 'background: #222; color: #bada55', modifiedResponse);

                _global.lastUrl = this._url;
                _global.lastResponse = _global.lastUrl;
                _global.lastMode = "m3u8";
            }
        });
        originalXHRSend.apply(this, arguments);
    };

    // Depending on the browser, window.fetch is used for the MPEG-DASH manifests
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input.url;

        if (url && url.includes('clients.plex.tv/api/v2/resources')) {
            return originalFetch.apply(this, arguments).then(response => {
                return response.clone().text().then(text => {
                    let availablePlexServers = JSON.parse(text);
                    availablePlexServers.forEach(srv => {
                        let serverLocalAddresses = [];
                        let serverRemoteAddr = "";
                        let hasOwnAddress = false;
                        let hasRelayAddress = false;

                        srv.connections.forEach(conn => {
                            if (conn.local && !serverLocalAddresses.includes(conn.uri)) {
                                serverLocalAddresses.push(conn.uri);
                                return;
                            }

                            if (!conn.local && !hasOwnAddress) {
                                if (_global.allowPlexRelay && conn.relay && !hasOwnAddress) {
                                    serverRemoteAddr = conn.uri;
                                    hasRelayAddress = true;
                                    return;
                                }

                                if (!conn.relay) {
                                    serverRemoteAddr = conn.uri;
                                    hasOwnAddress = true;
                                }
                            }
                        });

                        if (serverRemoteAddr != "") {
                            serverLocalAddresses.forEach(la => {
                                _global.localAddressToRemoteMapping[la] = serverRemoteAddr;
                            });
                        }
                    })

                    console.log("%c[FETCH - DEBUG - Plex->External - RESOURCES]: Mapping list: %O", 'background: #222; color: #bada55', _global.localAddressToRemoteMapping);
                });
            });
        }

        if (url.includes('/start.mpd')) {
            return originalFetch.apply(this, arguments).then(response => {
                return response.clone().text().then(text => {
                    console.log("%c[FETCH - DEBUG - Plex->External - MPD]: Captured request!\n\tReqURL: %s\n\tResponse: %s", 'background: #222; color: #bada55', url, text);
                    const modifiedResponse = modifySegmentTemplate(text, url);
                    console.log("%c[FETCH - DEBUG - Plex->External - MPD]: Altered response: %s", 'background: #222; color: #bada55', modifiedResponse);

                    _global.lastUrl = url;
                    _global.lastResponse = modifiedResponse;
                    _global.lastMode = "mpd";

                    return response;
                });
            });
        } else if (url.includes('/base/index.m3u8')) {
            return originalFetch.apply(this, arguments).then(response => {
                return response.clone().text().then(text => {
                    console.log("%c[FETCH - DEBUG - Plex->External - M3U8]: Captured request!\n\tReqURL: %s\n\tResponse: %s", 'background: #222; color: #bada55', url, text);
                    const modifiedResponse = modifyM3U8Playlist(text, url);
                    console.log("%c[FETCH - DEBUG - Plex->External - M3U8]: Altered response: %s", 'background: #222; color: #bada55', modifiedResponse);

                    _global.lastUrl = url;
                    _global.lastResponse = _global.lastUrl;
                    _global.lastMode = "m3u8";

                    return response;
                });
            });
        }
        return originalFetch.apply(this, arguments);
    };
})();