# Stremio for Spool

An original, independently maintained [Spool](https://github.com/spool-player/spool) provider,
not a fork of an existing media-server provider. It speaks the Stremio add-on HTTP protocol
and delegates torrents to an external Stremio-compatible streaming server that you run.
No default add-ons, accounts, embedded torrent engine or on-device encoding are included.

## Connect and use

Install from `https://github.com/spool-player/spool-stremio` in Spool's provider settings.
The provider's own screen accepts up to eight full manifest URLs, one per line, such as
`https://v3-cinemeta.strem.io/manifest.json` (a catalogue/metadata add-on, not a stream source).
Configured URLs may contain private keys in their path: keep them private. Query strings,
fragments, embedded username/password credentials and non-HTTP(S) URLs are rejected.
Add a stream add-on appropriate to content you have permission to access.

Before **Allow listed origins and save**, review every manifest/server address and optional
trusted additional add-on/image/media origin. The initial login button is explicit consent;
subsequent origin additions use Spool's host-owned permission dialog. Onboarding inspects each
manifest's first usable catalogue without contacting unapproved redirected hosts. Discovered
origins (for example Cinemeta's companion catalogue host) appear in a separate review, requiring
**Allow these additional origins and save** before any request to that origin. No CDN hostname
needs to be guessed for Cinemeta. Manifests are validated before saving.
Add-ons are ordered: edit their line order to change catalogue/stream order and metadata priority.
Delete a line to remove an add-on; saving also refreshes its manifest. Settings can change/test/remove
the streaming server by editing its address and saving.

The multiline URL/origin editors explicitly use Spool's dark field/focus/selection palette,
wrap long addresses, and use Tab/Shift+Tab to move between controls rather than insert tabs.
Up/Down edit within multiline text; at the first/last displayed line they leave the field.
Back exits multiline editing before closing the provider screen.

Browse libraries supplied by non-required catalogues; search uses catalogues advertising the
`search` extra. Optional `skip` is respected, IDs stay opaque, and series metadata supplies
seasons and episode IDs. Required-extra catalogues that cannot be called without configuration
are not advertised. A stream-only add-on supplies nothing to browse; add a catalogue add-on.

Playing opens the provider-owned stream picker. Unsupported external-player/browser/YouTube
streams and torrents without a server remain visible with an actionable explanation. HTTP
streams play directly with the add-on's `behaviorHints.proxyHeaders.request`. Torrent selection
creates the torrent through your server, reads its actual file list and asks which video to
play (the add-on's `fileIdx` recommendation is marked). Retry is available when metadata has
not yet arrived. Only an enumerated file index is accepted, never arbitrary paths or indices.

## External streaming server

Use a Stremio service URL such as `http://127.0.0.1:11470` on the same computer, or the literal
LAN IP of a server reachable from the device. `localhost` on a TV/phone means that device, not
your computer. HTTPS is required for public endpoints and DNS hostnames; unencrypted HTTP is
allowed only for localhost and literal loopback/private/link-local/ULA addresses.
A reachable server must return Stremio `GET /settings` with `values.serverVersion`.

The supported torrent protocol is `POST /<infoHash>/create` with `{torrent:{infoHash},
guessFileIdx:false,peerSearch?}`, then `GET /<infoHash>/stats.json` with an actual `files` array
(`name`, `length`). Playback/download uses the original-byte `/<infoHash>/<fileIndex>` endpoint.
Sources/announce trackers are passed to the server's peer search; Spool itself connects only to
the server. Server-side P2P access and legal responsibility remain with the user.
These endpoints follow [Stremio's video implementation](https://github.com/Stremio/stremio-video/tree/master/src/withStreamingServer).
No HLS/transcode route is substituted when the server is missing or fails.

## Permissions and limitations

The manifest has **no wildcard or pre-approved origins**. Add-on/server fetches are gated by
Spool's exact account allowlist. This provider independently omits unapproved artwork URLs and
requests exact media-origin consent before returning playback/download URLs. Add optional image
origins in settings to load artwork; unknown image hosts result in no artwork request.
Removing an add-on does not revoke Spool's already-granted native permission: remove the account
to discard its native grants. Editing trusted image/media origins also restricts this provider's
own returned URLs. Origin approval allows any account request to that exact origin, not merely
one file.
Add-on GET redirects are bounded to three hops and follow only same-origin or already explicitly
approved exact origins. Unapproved destinations are never fetched. Later destinations not found
by the first-catalogue inspection remain denied; review the add-on's trusted extra origins in
settings. Media preflight redirects are handled more strictly, as below.

Media is preflighted with HEAD and redirects are rejected rather than silently authorizing a new
host. Servers rejecting HEAD return an explicit unsupported-preflight error; select another
stream. This is not a security sandbox or proof of mpv redirect containment: a destination can
change after preflight, and HLS/DASH can contain additional destinations. Install only trusted
provider code and add-ons. Spool's reviewed in-process provider model is documented in the SDK.

**Downloads:** only original finite media-file negotiation is declared. The same stream/torrent
picker chooses the endpoint, headers and original container; HEAD checks reject redirects and
playlist/text responses. A known positive file size is required from HEAD or torrent metadata.
HLS/DASH, unknown filename containers, unknown sizes and expired links are not offered as
downloaded files. Native Spool owns transfer, cancellation and storage. No `downloadTranscode`,
quality-control, preview, speed-test or watch-state capability is claimed. Direct HTTP media and
external-server original torrent files are supported; no fake server transcoding is implemented.

Provider logging uses shared `host.log` and records only stable messages, counts and error codes:
never configured URLs, header values, metadata bodies, infohashes or tokens.

The curated registry marks `appleAppStore: false`; this provider is excluded from Apple App Store
builds. That is registry/build policy, not a provider manifest capability.

## Contract, package and release

The pinned Spool SDK is in `sdk/`, with upstream revision and SHA-256 values in `sdk.lock.json`.

```sh
python3 tools/check-sdk.py
cmake -S sdk -B build/sdk -G Ninja && cmake --build build/sdk
build/sdk/provider-contract-runner tests/contract.mjs
QV4_FORCE_INTERPRETER=1 build/sdk/provider-contract-runner tests/contract.mjs
node tests/network-smoke.mjs --live
VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
python3 sdk/spool-provider.py build . --output "dist/spool.stremio-$VERSION.szo"
python3 sdk/spool-provider.py validate "dist/spool.stremio-$VERSION.szo"
```

Future packages use `.szo` (Spool Zstandard Object), with the same format-3 zstd USTAR
bytes. The pinned SDK is unchanged; pass `--output` explicitly rather than using
its historical default filename. Existing published package URLs remain unchanged.

The Qt contract drives the public provider operations against scripted protocol responses,
including consent, paging, series, headers, real file choice and finite download rejection.
The network smoke drives HTTP through a local legal-content add-on/server protocol fixture,
consumes the negotiated bytes, and with `--live` checks Cinemeta's real manifest/catalog/meta/search.
It is a protocol fixture, not a claim that a torrent engine or mpv was tested.

For native account/QML/download testing, keep the same fixture running:

```sh
node tests/network-smoke.mjs --serve --port 11472 --media /path/to/legal.mp4
```

It prints the exact manifest/server URL, account origins, `createSource` configuration and item
ID. Configure the native provider through its real onboarding using those URLs. `--media` supplies
actual locally owned/legal MP4 bytes, including Range support; without it the fixture intentionally
serves deterministic wire-test bytes, not a playable video. Stop with SIGINT/SIGTERM. Torrent
create/stats/file endpoints are protocol fixtures only, never a claim of P2P engine verification.

Push a tag matching the manifest (`v0.1.1`) after the final SDK pin is tested. The release workflow
checks the pin, runs Qt JIT/interpreter contracts and local HTTP smoke, validates the reproducible
archive and publishes the archive plus its real `spool-provider.json` feed. Curated entries must
use the published asset URL, exact archive size and SHA-256, never placeholders.

## License

Provider code: 0BSD. Vendored SDK: see its SPDX notices and `sdk/LICENSE`.

## Current capability contract

Packages use manifest format 3, with no `api` or `extensions` fields.
`capabilities` declares supported operations; `describe().capabilities` offers
strict boolean account availability. Host declarations are not authorization:
origin approval and operation-specific policy checks remain required. The copied
SDK is pinned by `sdk.lock.json`; releases must use those exact host SDK bytes.
