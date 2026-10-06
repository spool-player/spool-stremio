// SPDX-License-Identifier: 0BSD
import QtQuick
import QtQuick.Layouts
import Spool

FocusScope {
    id: root
    property var provider
    property string stage: provider ? provider.arguments.kind : "stream"
    property string stream: provider ? provider.arguments.stream || "" : ""
    property var file: provider ? provider.arguments.file : null
    property bool busy: false
    property string error: ""
    property string destination: provider ? provider.arguments.origin || "" : ""
    property bool destinationApproved: false

    function message(code) {
        const messages = {
            "streaming_server_required": "This torrent needs a streaming server. Set one in Manage Stremio add-ons, then try again.",
            "unsupported_stream": "This add-on returned an external player, browser or unsupported stream. Choose an HTTP stream or torrent.",
            "nothing_to_play": "No streams were returned. Check that your add-ons support this title.",
            "torrent_metadata_unavailable": "The server has not returned the torrent file list yet. Wait a moment and retry, or choose another stream.",
            "torrent_no_video_files": "This torrent contains no supported video files. Choose another stream.",
            "selected_variant_unavailable": "This choice expired or is no longer available. Go back and choose again.",
            "origin_denied": "Connection permission was not granted. Choose another stream.",
            "redirect_not_allowed": "This media address redirects. Redirected destinations cannot be safely approved here. Choose a direct stream.",
            "redirect_origin_not_allowed": "An add-on requested an unapproved server. Open Manage Stremio add-ons and review its additional connections before retrying.",
            "media_head_unsupported": "This server rejects HEAD preflight (HTTP 405/501). This provider cannot safely preflight that stream; choose another.",
            "download_not_finite": "This is not a downloadable complete media file. Choose a stream with a supported video filename, not HLS/DASH.",
            "network_error": "Could not reach the add-on or streaming server. Check the connection and retry."
        };
        return messages[code] || (String(code).startsWith("http_") ? "The server returned HTTP " + String(code).slice(5) + ". The link may have expired; choose another stream." : "Could not load this choice. Retry or choose another stream.");
    }
    function args() {
        const result = {
            "itemId": provider.arguments.itemId,
            "stream": stream
        };
        if (file !== null && file !== undefined)
            result.file = file;
        return result;
    }
    function load() {
        busy = true;
        error = "";
        if (stage === "consent") {
            busy = false;
            return;
        }
        provider.requestList(stage === "torrent" ? "files" : "streams", args()).then(() => {
            busy = false;
            InputKeys.focus(list);
        }, code => {
            busy = false;
            error = message(code);
        });
    }
    function prepare() {
        busy = true;
        error = "";
        provider.request("prepare", args()).then(result => {
            busy = false;
            destination = result.origin;
            destinationApproved = result.approved;
            stage = "consent";
        }, code => {
            busy = false;
            error = message(code);
        });
    }
    function select(record) {
        if (record.disabled) {
            error = message(record.reason);
            return;
        }
        if (stage === "stream") {
            stream = record.id;
            if (record.kind === "Torrent") {
                stage = "torrent";
                file = null;
                load();
            } else
                prepare();
        } else {
            file = record.id;
            prepare();
        }
    }
    function finish() {
        busy = true;
        error = "";
        const grant = destinationApproved ? Promise.resolve() : provider.allowOrigin(destination).then(() => provider.request("approveOrigin", {
                "origin": destination
            }));
        grant.then(() => {
            busy = false;
            provider.complete(args());
        }, code => {
            busy = false;
            error = message(code);
        });
    }
    function back() {
        stage = "stream";
        stream = "";
        file = null;
        destination = "";
        load();
    }
    function size(bytes) {
        if (!bytes)
            return "Size unknown";
        let value = Number(bytes), unit = 0;
        const units = ["B", "KB", "MB", "GB", "TB"];
        while (value >= 1000 && unit < units.length - 1) {
            value /= 1000;
            unit++;
        }
        return value.toFixed(unit > 1 ? 1 : 0) + " " + units[unit];
    }
    Component.onCompleted: load()
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Metrics.pageMarginPx
        spacing: Metrics.scaled(12)
        AppText {
            text: root.stage === "torrent" ? "Choose a file from this torrent" : root.stage === "consent" ? "Confirm connection" : "Choose a stream"
            font.pixelSize: Metrics.titleSizePx
            font.weight: Font.DemiBold
        }
        SecondaryText {
            Layout.fillWidth: true
            text: root.busy ? (root.stage === "torrent" ? "Fetching the file list from your server…" : "Loading…") : root.error || (root.stage === "torrent" ? "Choose the actual video file. The add-on's recommended file is marked." : root.stage === "consent" ? "Connects to " + root.destination : "Stream details come from your add-ons. HTTP plays directly; torrents use your configured server.")
            wrapMode: Text.WordWrap
        }
        SecondaryText {
            Layout.fillWidth: true
            visible: root.stage === "consent"
            text: "Only use content and add-ons you trust and have permission to access. Torrents may connect your external server to peers and trackers. Spool does not run a torrent engine."
            wrapMode: Text.WordWrap
        }
        ListView {
            id: list
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: root.stage !== "consent"
            clip: true
            focus: true
            keyNavigationEnabled: true
            model: root.provider ? root.provider.rows : null
            delegate: MenuRow {
                required property var record
                required property int index
                width: list.width
                label: record.title
                detail: root.stage === "torrent" ? root.size(record.size) + (record.recommended ? " · Recommended by add-on" : "") : [record.addon, record.kind, record.detail, record.disabled ? root.message(record.reason) : ""].filter(part => part).join(" · ")
                iconName: record.disabled ? "block" : record.kind === "Torrent" ? "folder" : "play_arrow"
                highlighted: ListView.isCurrentItem && list.activeFocus
                onHovered: list.currentIndex = index
                onActivated: if (!root.busy)
                    root.select(record)
            }
            function activate() {
                if (currentItem)
                    currentItem.activated();
            }
        }
        Item {
            Layout.fillHeight: true
            visible: root.stage === "consent"
        }
        RowLayout {
            Layout.alignment: Qt.AlignRight
            ActionButton {
                text: "Cancel"
                kind: "flat"
                onClicked: root.provider.close()
            }
            ActionButton {
                text: "Other streams"
                kind: "flat"
                visible: root.stage !== "stream"
                enabled: !root.busy
                onClicked: root.back()
            }
            ActionButton {
                text: "Retry"
                visible: root.error.length > 0 && root.stage !== "consent"
                enabled: !root.busy
                onClicked: root.load()
            }
            ActionButton {
                text: root.provider && root.provider.arguments.download ? "Allow and download original" : "Allow and play"
                visible: root.stage === "consent"
                enabled: !root.busy
                onClicked: root.finish()
            }
        }
    }
}
