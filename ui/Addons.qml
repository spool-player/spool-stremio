// SPDX-License-Identifier: 0BSD
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Spool

FocusScope {
    id: root
    property var provider
    property bool busy: false
    property string error: ""
    property var reviewOrigins: []
    property string reviewDescription: ""
    readonly property var listedOrigins: visibleOrigins()

    function message(code) {
        const messages = {
            "addons_required": "Add at least one manifest URL (up to eight).",
            "duplicate_addon": "Each add-on can be added once.",
            "invalid_manifest_url": "Use the full add-on URL ending in /manifest.json, without a query or fragment.",
            "invalid_url": "Enter an HTTP(S) URL without embedded credentials or a fragment.",
            "https_required": "Public servers require HTTPS. HTTP is allowed only on a local network or this device.",
            "invalid_origin": "Additional permissions need an origin only, such as https://images.example.org.",
            "invalid_manifest": "The add-on did not return a compatible Stremio manifest.",
            "addon_configuration_required": "Configure this add-on in your browser first, then paste the full manifest link it provides.",
            "unsupported_addon_resources": "This add-on provides no catalogue, metadata or stream resources Spool can use.",
            "invalid_streaming_server": "This server did not return Stremio streaming-server settings.",
            "origin_denied": "Connection permission was not granted. Nothing was saved.",
            "redirect_not_allowed": "Redirects are not followed. Enter the final manifest or server address.",
            "redirect_origin_not_allowed": "An add-on requested another server. Review discovered connections, or add its trusted origin below before saving.",
            "network_error": "Could not connect. Check the address and that the server is running."
        };
        return messages[code] || (String(code).startsWith("http_") ? "The server returned HTTP " + String(code).slice(5) + ". Check its URL and access settings." : "Could not validate these settings. Check the URLs and try again.");
    }
    function lines(text) {
        return text.split(/\n/).map(value => value.trim()).filter(value => value.length > 0);
    }
    function visibleOrigins() {
        const urls = lines(addons.text).concat(serverField.text ? [serverField.text] : []).concat(lines(images.text));
        const origins = urls.map(url => {
            const match = /^https?:\/\/[^/?#]+/i.exec(url);
            return match ? match[0].toLowerCase().replace(/^https:\/\/(.*):443$/, "https://$1").replace(/^http:\/\/(.*):80$/, "http://$1") : "";
        }).filter(origin => origin.length > 0);
        return origins.filter((origin, index) => origins.indexOf(origin) === index);
    }
    function save() {
        busy = true;
        error = "";
        const input = {
            "addons": lines(addons.text),
            "server": serverField.text.trim(),
            "imageOrigins": lines(images.text).concat(reviewOrigins)
        };
        provider.request("validateUrls", input).then(result => {
            const origins = result.addons.map(addon => addon.origin).concat(result.serverOrigin ? [result.serverOrigin] : []).concat(result.imageOrigins);
            let chain = Promise.resolve();
            origins.filter((origin, index) => origins.indexOf(origin) === index).forEach(origin => {
                chain = chain.then(() => provider.allowOrigin(origin));
            });
            return chain.then(() => {
                images.text = input.imageOrigins.join("\n");
                return provider.request("inspectConnections", input);
            }).then(inspected => {
                if (inspected.origins.length > 0) {
                    reviewOrigins = inspected.origins;
                    reviewDescription = inspected.connections.map(connection => connection.addon + ": " + connection.origin + " (" + connection.purpose + ")").join("\n");
                    busy = false;
                    return null;
                }
                return provider.request("configure", input);
            });
        }).then(result => {
            if (!result)
                return;
            busy = false;
            provider.complete(provider.role === "login" ? result : {
                "configuration": result.configuration
            });
        }, code => {
            busy = false;
            error = message(code);
        });
    }
    Component.onCompleted: {
        if (provider.role === "settings") {
            busy = true;
            provider.request("configuration", {}).then(result => {
                addons.text = result.configuration.addons.map(addon => addon.url).join("\n");
                serverField.text = result.configuration.server || "";
                const serviceOrigins = result.configuration.addons.map(addon => addon.url.match(/^https?:\/\/[^/]+/)[0]);
                if (serverField.text)
                    serviceOrigins.push(serverField.text.match(/^https?:\/\/[^/]+/)[0]);
                images.text = result.configuration.approvedOrigins.filter(origin => serviceOrigins.indexOf(origin) < 0).join("\n");
                busy = false;
            }, code => {
                busy = false;
                error = message(code);
            });
        }
    }
    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        ColumnLayout {
            width: parent.width
            spacing: Metrics.scaled(12)
            AppText {
                text: root.provider && root.provider.role === "settings" ? "Manage Stremio add-ons" : "Connect Stremio add-ons"
                font.pixelSize: Metrics.titleSizePx
                font.weight: Font.DemiBold
            }
            SecondaryText {
                Layout.fillWidth: true
                text: "Add trusted add-ons to browse and search their catalogues. No add-ons are installed by default, and Spool does not run a torrent engine."
                wrapMode: Text.WordWrap
            }
            AppText {
                text: "Add-on manifest URLs — one per line"
            }
            TextArea {
                id: addons
                Layout.fillWidth: true
                Layout.preferredHeight: Metrics.scaled(130)
                placeholderText: "https://your-addon.example/manifest.json"
                enabled: !root.busy
                onTextChanged: root.reviewOrigins = []
                wrapMode: TextEdit.Wrap
                selectByMouse: true
                color: Theme.textPrimary
            }
            SecondaryText {
                Layout.fillWidth: true
                text: "Reorder lines to change priority; delete a line to remove an add-on. Existing native connection permissions stay until the account is removed. URLs may contain private configuration: do not share them."
                wrapMode: Text.WordWrap
            }
            TextFieldRow {
                id: serverField
                Layout.fillWidth: true
                label: "Streaming server (optional)"
                placeholderText: "http://localhost:11470"
                enabled: !root.busy
                onTextChanged: root.reviewOrigins = []
            }
            SecondaryText {
                Layout.fillWidth: true
                text: "HTTP streams play directly. Torrents require your external Stremio-compatible streaming server. On a TV or phone, localhost means that device, not your computer."
                wrapMode: Text.WordWrap
            }
            AppText {
                text: "Additional trusted add-on/image/media origins — optional, one per line"
            }
            TextArea {
                id: images
                Layout.fillWidth: true
                Layout.preferredHeight: Metrics.scaled(85)
                placeholderText: "https://images.example.org"
                enabled: !root.busy
                onTextChanged: root.reviewOrigins = []
                selectByMouse: true
                color: Theme.textPrimary
            }
            SecondaryText {
                Layout.fillWidth: true
                text: "Only approved origins can be contacted. Artwork from other hosts is omitted. Selecting a stream asks permission for its media host if needed. Approval covers this account's requests to that origin, not every website."
                wrapMode: Text.WordWrap
            }
            SecondaryText {
                Layout.fillWidth: true
                text: "Before continuing, allow this account to connect to these exact origins:\n" + root.listedOrigins.join("\n")
                wrapMode: Text.WordWrap
            }
            SecondaryText {
                Layout.fillWidth: true
                visible: root.reviewOrigins.length > 0
                text: "More connections needed\n" + root.reviewDescription + "\nSpool has not connected to these new hosts. Allowing them exposes your IP address and what you browse to them. Other hosts stay blocked. Cancel keeps previous provider settings; any already-approved connection permissions remain until you remove this account."
                wrapMode: Text.WordWrap
            }
            SecondaryText {
                Layout.fillWidth: true
                visible: root.error.length > 0
                text: root.error
                wrapMode: Text.WordWrap
            }
            SecondaryText {
                visible: root.busy
                text: "Granting connections and validating add-ons…"
            }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                ActionButton {
                    text: "Cancel"
                    kind: "flat"
                    onClicked: root.provider.close()
                }
                ActionButton {
                    text: root.reviewOrigins.length > 0 ? "Allow these additional origins and save" : "Allow listed origins and save"
                    enabled: !root.busy
                    onClicked: root.save()
                }
            }
        }
    }
}
