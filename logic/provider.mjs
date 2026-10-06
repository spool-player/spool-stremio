// SPDX-License-Identifier: 0BSD
// Qt ES2020: account state belongs to this closure, never to module globals.
const video = /\.(mkv|mp4|m4v|mov|avi|webm|ogv|ts|m2ts|mpeg|mpg)$/i;
const finiteContainers = ['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ogv', 'ts', 'm2ts', 'mpeg', 'mpg'];
function fail(code) { throw new Error(code); }
function parseUrl(value) {
    const text = String(value || '').trim();
    const match = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?$/.exec(text);
    if (!match || /[\s\\@*]/.test(match[2]) || /[\u0000-\u0020\\]/.test(text)) fail('invalid_url');
    const authority = match[2].toLowerCase();
    const host = authority.replace(/:\d+$/, '');
    if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])$/.test(host)) fail('invalid_url');
    const port = /:(\d+)$/.exec(authority);
    if (port && (Number(port[1]) < 1 || Number(port[1]) > 65535)) fail('invalid_url');
    const octets = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : [];
    if (octets.length && octets.some(value => value > 255)) fail('invalid_url');
    const local = host === 'localhost' || host === '[::1]' || (octets.length === 4
        && (octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168
            || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 169 && octets[1] === 254))
        || /^\[(?:fc|fd)[a-f0-9:]+\]$/.test(host) || /^\[fe80:[a-f0-9:]+\]$/.test(host);
    if (match[1] === 'http' && !local) fail('https_required');
    const normalized = authority.replace(match[1] === 'https' ? /:443$/ : /:80$/, '');
    return { url: match[1] + '://' + normalized + (match[3] || '/') + (match[4] || ''),
        origin: match[1] + '://' + normalized, path: match[3] || '/', query: match[4] || '' };
}
function manifestUrl(value) {
    const url = parseUrl(value);
    if (url.query || !url.path.endsWith('/manifest.json')) fail('invalid_manifest_url');
    return url.url;
}
function serverUrl(value) {
    if (!String(value || '').trim()) return '';
    const url = parseUrl(value);
    if (url.query) fail('invalid_server_url');
    return url.url.replace(/\/$/, '');
}
function key(parts) { return JSON.stringify(parts); }
function unpack(id, length) {
    let parts;
    try { parts = JSON.parse(id); } catch (_) { fail('invalid_item_id'); }
    if (!Array.isArray(parts) || (parts.length !== length && !(length === 2 && parts.length === 3)) || parts.some(part => typeof part !== 'string')) fail('invalid_item_id');
    return parts;
}
function bounded(value, maximum, fallback) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 0 || number > maximum) fail('invalid_pagination');
    return number;
}
function supports(addon, resource, type, id) {
    return addon.manifest.resources.some(entry => {
        if (typeof entry === 'string') return entry === resource && addon.manifest.types.indexOf(type) >= 0
            && (!addon.manifest.idPrefixes || addon.manifest.idPrefixes.some(prefix => id.startsWith(prefix)));
        return entry && entry.name === resource && (!entry.types || entry.types.indexOf(type) >= 0)
            && (!entry.idPrefixes || entry.idPrefixes.some(prefix => id.startsWith(prefix)));
    });
}
function extras(catalog) {
    return (catalog.extra || []).map(extra => typeof extra === 'string' ? { name: extra } : extra);
}
function validateManifest(manifest) {
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id || typeof manifest.name !== 'string'
        || !Array.isArray(manifest.resources) || !Array.isArray(manifest.types) || !Array.isArray(manifest.catalogs || [])) fail('invalid_manifest');
    if (manifest.types.some(type => typeof type !== 'string') || (manifest.catalogs || []).length > 32) fail('invalid_manifest');
    if (manifest.idPrefixes && (!Array.isArray(manifest.idPrefixes) || manifest.idPrefixes.some(prefix => typeof prefix !== 'string'))) fail('invalid_manifest');
    if (manifest.resources.some(entry => typeof entry !== 'string' && (!entry || typeof entry.name !== 'string'
        || entry.types && (!Array.isArray(entry.types) || entry.types.some(type => typeof type !== 'string'))
        || entry.idPrefixes && (!Array.isArray(entry.idPrefixes) || entry.idPrefixes.some(prefix => typeof prefix !== 'string'))))) fail('invalid_manifest');
    if (manifest.behaviorHints && manifest.behaviorHints.configurationRequired) fail('addon_configuration_required');
    if (!manifest.resources.some(entry => ['catalog', 'meta', 'stream'].indexOf(typeof entry === 'string' ? entry : entry && entry.name) >= 0))
        fail('unsupported_addon_resources');
    (manifest.catalogs || []).forEach(catalog => {
        if (!catalog || typeof catalog.type !== 'string' || typeof catalog.id !== 'string'
            || extras(catalog).some(extra => !extra || typeof extra.name !== 'string')) fail('invalid_manifest');
    });
    return manifest;
}
function endpoint(addon, resource, type, id, extra) {
    return addon.url.slice(0, -'manifest.json'.length) + [resource, type, id].map(encodeURIComponent).join('/')
        + (extra ? '/' + extra : '') + '.json';
}
function redirectUrl(url, location) {
    if (typeof location !== 'string' || !location) fail('invalid_redirect');
    const base = parseUrl(url);
    const destination = /^https?:\/\//.test(location) ? location : location.startsWith('//')
        ? base.origin.split(':')[0] + ':' + location : location.startsWith('/')
            ? base.origin + location : base.origin + base.path.slice(0, base.path.lastIndexOf('/') + 1) + location;
    return parseUrl(destination);
}
function json(host, url, options, allowed, redirects) {
    return host.http(url, options).then(response => {
        if (response.status >= 300 && response.status < 400) {
            if (options && options.method && options.method !== 'GET') fail('redirect_not_allowed');
            if ((redirects || 0) >= 3) fail('redirect_limit');
            const destination = redirectUrl(url, response.location);
            if (destination.origin !== parseUrl(url).origin && (allowed || []).indexOf(destination.origin) < 0) fail('redirect_origin_not_allowed');
            return json(host, destination.url, options, allowed, (redirects || 0) + 1);
        }
        if (response.status < 200 || response.status >= 300) fail('http_' + response.status);
        let result;
        try { result = JSON.parse(response.body); } catch (_) { fail('invalid_response'); }
        if (!result || typeof result !== 'object' || result.error) fail('addon_error');
        return result;
    });
}
function seriesType(type) { return type === 'series' ? 'Series' : type === 'movie' ? 'Movie' : 'Video'; }
function container(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || '').split(/[?#]/)[0]);
    return match ? match[1].toLowerCase() : '';
}
function log(host, level, message, fields) { host.log(level, message, fields); }

export function createSource(configuration, sourceHost) {
    let config = { addons: configuration.addons || [], server: configuration.server || '', approvedOrigins: configuration.approvedOrigins || [] };
    const streams = {};
    const torrents = {};
    const metadata = {};
    let streamGeneration = 0;
    function requestJson(host, url, options) { return json(host, url, options, config.approvedOrigins); }
    function approved(url) {
        try { return config.approvedOrigins.indexOf(parseUrl(url).origin) >= 0; } catch (_) { return false; }
    }
    function image(url) { return typeof url === 'string' && approved(url) ? url : undefined; }
    function item(meta, type) {
        if (!meta || typeof meta.id !== 'string' || typeof (meta.name || meta.title) !== 'string') fail('invalid_metadata');
        const result = { id: key([type || meta.type || 'movie', meta.id]), title: meta.name || meta.title,
            type: seriesType(type || meta.type), overview: meta.description || '', posterTag: image(meta.poster),
            backdropTag: image(meta.background), logoTag: image(meta.logo), genres: Array.isArray(meta.genres) ? meta.genres : [] };
        const year = parseInt(meta.releaseInfo || meta.year, 10);
        if (year > 1800 && year < 3000) result.year = year;
        const rating = Number(meta.imdbRating);
        if (rating > 0 && rating <= 10) result.communityRating = rating;
        return result;
    }
    function catalogs(search) {
        const rows = [];
        config.addons.forEach(addon => (addon.manifest.catalogs || []).forEach(catalog => {
            const required = extras(catalog).filter(extra => extra.isRequired && extra.name !== 'skip');
            if (search ? extras(catalog).some(extra => extra.name === 'search') && required.every(extra => extra.name === 'search') : !required.length)
                rows.push({ addon: addon, catalog: catalog });
        }));
        return rows;
    }
    function catalogId(row) { return key([String(config.addons.indexOf(row.addon)), row.catalog.type, row.catalog.id]); }
    function catalogPage(args, host, search) {
        const all = catalogs(search);
        let index = 0, offset = 0;
        if (args.cursor) {
            let cursor;
            try { cursor = JSON.parse(args.cursor); } catch (_) { fail('invalid_pagination'); }
            if (!Array.isArray(cursor) || cursor.length !== 2) fail('invalid_pagination');
            index = bounded(cursor[0], all.length, 0); offset = bounded(cursor[1], 1000000, 0);
        }
        const selected = args.parentId ? all.filter(row => catalogId(row) === args.parentId) : all;
        if (args.parentId && !selected.length) fail('catalog_unavailable');
        if (index >= selected.length) return { items: [], exhausted: true, cursor: null };
        const row = selected[index];
        const skip = extras(row.catalog).some(extra => extra.name === 'skip');
        const extra = [];
        if (search) extra.push('search=' + encodeURIComponent(String(args.query || '')));
        if (skip && offset) extra.push('skip=' + offset);
        return requestJson(host, endpoint(row.addon, 'catalog', row.catalog.type, row.catalog.id, extra.join('&'))).then(response => {
            if (!Array.isArray(response.metas)) fail('invalid_catalog');
            const limit = Math.max(1, bounded(args.limit, 100, 50));
            const rows = skip ? response.metas : response.metas.slice(offset);
            const slice = rows.slice(0, limit);
            const more = skip ? rows.length >= limit && slice.length > 0 : rows.length > limit;
            const next = more ? [index, offset + slice.length] : [index + 1, 0];
            const exhausted = next[0] >= selected.length;
            return { items: slice.map(meta => item(meta, row.catalog.type)), exhausted: exhausted,
                cursor: exhausted ? null : JSON.stringify(next) };
        });
    }
    function meta(args, host) {
        const parts = unpack(args.itemId, 2);
        if (metadata[args.itemId]) return Promise.resolve(metadata[args.itemId]);
        const addons = config.addons.filter(addon => supports(addon, 'meta', parts[0], parts[1]));
        function next(index) {
            if (index >= addons.length) fail('metadata_unavailable');
            return requestJson(host, endpoint(addons[index], 'meta', parts[0], parts[1])).then(response => {
                if (!response.meta) return next(index + 1);
                item(response.meta, parts[0]);
                metadata[args.itemId] = response.meta;
                return response.meta;
            });
        }
        return next(0);
    }
    function episodeItem(entry, parent, parentId) {
        return { id: key(['series', entry.id, unpack(parentId, 2)[1]]),
            title: entry.title || entry.name || 'Episode ' + entry.episode, type: 'Episode',
            seriesId: parentId, seriesName: parent.name, season: entry.season, episode: entry.episode,
            overview: entry.overview || '', thumbTag: image(entry.thumbnail), posterTag: image(parent.poster),
            premiereDate: entry.released };
    }
    function detail(args, host) {
        const parts = unpack(args.itemId, 2);
        if (parts.length === 3) {
            const parentId = key([parts[0], parts[2]]);
            return meta({ itemId: parentId }, host).then(parent => {
                const entry = (parent.videos || []).find(video => video.id === parts[1]);
                if (!entry) fail('metadata_unavailable');
                return episodeItem(entry, parent, parentId);
            });
        }
        return meta(args, host).then(value => item(value, parts[0]));
    }
    function streamList(args, host, refresh) {
        const parts = unpack(args.itemId, 2);
        if (!refresh && streams[args.itemId]) return Promise.resolve(streams[args.itemId].rows);
        const addons = config.addons.filter(addon => supports(addon, 'stream', parts[0], parts[1]));
        const rows = []; const errors = [];
        const generation = String(++streamGeneration);
        let chain = Promise.resolve();
        addons.forEach((addon, addonIndex) => { chain = chain.then(() => requestJson(host, endpoint(addon, 'stream', parts[0], parts[1])).then(response => {
            if (!Array.isArray(response.streams)) fail('invalid_streams');
            response.streams.forEach((stream, index) => {
                const torrent = !stream.url && typeof stream.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(stream.infoHash);
                let direct = false;
                try { direct = typeof stream.url === 'string' && !!parseUrl(stream.url); } catch (_) { }
                let reason = '';
                if (torrent && !config.server) reason = 'streaming_server_required';
                else if (!torrent && !direct) reason = 'unsupported_stream';
                rows.push({ id: key([String(addonIndex), generation, String(index)]), title: stream.name || stream.title || 'Stream ' + (index + 1),
                    detail: stream.description || stream.title || '', addon: addon.manifest.name,
                    kind: torrent ? 'Torrent' : direct ? 'HTTP' : 'Unsupported', disabled: !!reason, reason: reason, stream: stream });
            });
        }).catch(error => { errors.push(error.message); log(host, 'warn', 'Add-on stream request failed', { code: error.message }); })); });
        return chain.then(() => {
            if (!rows.length) fail(errors.length ? errors[0] : 'nothing_to_play');
            streams[args.itemId] = { rows: rows };
            log(host, 'debug', 'Loaded stream choices', { count: rows.length, failedAddons: errors.length });
            return rows;
        });
    }
    function chosen(args, host) {
        return streamList(args, host).then(rows => {
            const choice = rows.find(row => row.id === args.stream);
            if (!choice) fail('selected_variant_unavailable');
            if (choice.disabled) fail(choice.reason);
            return choice;
        });
    }
    function torrentFiles(choice, host) {
        if (!config.server) fail('streaming_server_required');
        const stream = choice.stream;
        const hash = stream.infoHash.toLowerCase();
        const cacheKey = config.server + '/' + hash;
        if (torrents[cacheKey]) return Promise.resolve(torrents[cacheKey]);
        const sources = (stream.sources || stream.announce || []).filter(value => typeof value === 'string').map(value =>
            /^(tracker:|dht:)/.test(value) ? value : 'tracker:' + value);
        const body = { torrent: { infoHash: hash }, guessFileIdx: false };
        if (sources.length) body.peerSearch = { sources: ['dht:' + hash].concat(sources), min: 40, max: 200 };
        return requestJson(host, config.server + '/' + hash + '/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(() => requestJson(host, config.server + '/' + hash + '/stats.json')).then(stats => {
                if (!Array.isArray(stats.files)) fail('torrent_metadata_unavailable');
                const rows = [];
                stats.files.forEach((file, index) => {
                    if (file && typeof file.name === 'string' && video.test(file.name)) rows.push({ id: String(index), title: file.name,
                        size: Number(file.length) || 0, recommended: stream.fileIdx === index, container: container(file.name) });
                });
                if (!rows.length) fail('torrent_no_video_files');
                torrents[cacheKey] = rows;
                return rows;
            });
    }
    function target(args, host) {
        return chosen(args, host).then(choice => {
            if (choice.kind === 'Torrent') return torrentFiles(choice, host).then(files => {
                const file = files.find(row => row.id === String(args.file));
                if (!file) fail('selected_variant_unavailable');
                const url = config.server + '/' + choice.stream.infoHash.toLowerCase() + '/' + file.id;
                return { url: url, origin: parseUrl(url).origin, container: file.container, size: file.size, variantId: choice.id + ':' + file.id };
            });
            const stream = choice.stream;
            const parsed = parseUrl(stream.url);
            const hints = stream.behaviorHints || {};
            const headers = hints.proxyHeaders && hints.proxyHeaders.request || {};
            if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).some(name =>
                !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof headers[name] !== 'string' || /[\r\n]/.test(headers[name]))) fail('invalid_stream_headers');
            return { url: parsed.url, origin: parsed.origin, container: container(hints.filename || parsed.path),
                headers: headers, variantId: choice.id };
        });
    }
    function resolve(args, host, download) {
        if (download && args.mode !== 'original') fail('download_transcode_unavailable');
        if (!download && args.forceTranscode) fail('transcode_unavailable');
        if (!args.stream) return Promise.resolve({ pick: { kind: 'stream', itemId: args.itemId, download: !!download } });
        return chosen(args, host).then(choice => {
            if (choice.kind === 'Torrent' && args.file === undefined) return { pick: { kind: 'torrent', itemId: args.itemId,
                stream: args.stream, download: !!download } };
            return target(args, host).then(result => {
                if (!approved(result.url)) return { pick: { kind: 'consent', itemId: args.itemId, stream: args.stream,
                    file: args.file === undefined ? null : args.file, origin: result.origin, download: !!download } };
                return host.http(result.url, { method: 'HEAD', headers: result.headers,
                    responseHeaders: ['content-type', 'content-length'] }).then(response => {
                    if (response.status >= 300 && response.status < 400) fail('redirect_not_allowed');
                    if (response.status === 405 || response.status === 501) fail('media_head_unsupported');
                    if (response.status < 200 || response.status >= 300) fail('http_' + response.status);
                    if (download) {
                        const contentType = String((response.headers || {})['content-type'] || '').toLowerCase();
                        if (finiteContainers.indexOf(result.container) < 0 || /mpegurl|dash\+xml|text\/|json/.test(contentType)) fail('download_not_finite');
                        const length = Number((response.headers || {})['content-length']);
                        const size = result.size || (Number.isSafeInteger(length) && length > 0 ? length : 0);
                        if (!size) fail('download_not_finite');
                        return { url: result.url, headers: result.headers, container: result.container, size: size };
                    }
                    return { url: result.url, headers: result.headers, container: result.container, variantId: result.variantId, playMethod: 'DirectPlay' };
                });
            });
        });
    }
    return {
        describe: () => ({ extensions: { 'spool.origin-grants': 1 } }),
        configuration: () => ({ configuration: config }),
        validateUrls: args => ({ addons: (args.addons || []).map(url => ({ url: manifestUrl(url), origin: parseUrl(url).origin })),
            server: serverUrl(args.server), serverOrigin: args.server ? parseUrl(args.server).origin : '',
            imageOrigins: (args.imageOrigins || []).map(value => { const parsed = parseUrl(value); if (parsed.query || parsed.path !== '/') fail('invalid_origin'); return parsed.origin; }) }),
        inspectConnections: (args, host) => {
            const urls = (args.addons || []).map(manifestUrl);
            if (!urls.length || urls.length > 8) fail('addons_required');
            const allowed = urls.map(url => parseUrl(url).origin).concat((args.imageOrigins || []).map(url => parseUrl(url).origin));
            const origins = [], addons = [], connections = [];
            function inspect(url, depth, name) {
                return host.http(url).then(response => {
                    if (response.status < 300 || response.status >= 400) return;
                    if (depth >= 3) fail('redirect_limit');
                    const target = redirectUrl(url, response.location);
                    if (target.origin !== parseUrl(url).origin && allowed.indexOf(target.origin) < 0) {
                        if (origins.indexOf(target.origin) < 0) {
                            origins.push(target.origin);
                            connections.push({ origin: target.origin, addon: name, purpose: 'Companion catalogue' });
                        }
                        return;
                    }
                    return inspect(target.url, depth + 1, name);
                });
            }
            let chain = Promise.resolve();
            urls.forEach(url => { chain = chain.then(() => json(host, url, undefined, allowed).then(manifest => {
                validateManifest(manifest);
                addons.push({ name: manifest.name, resources: manifest.resources.map(entry => typeof entry === 'string' ? entry : entry.name) });
                const catalog = (manifest.catalogs || []).find(entry => !extras(entry).some(extra => extra.isRequired && extra.name !== 'skip'));
                if (catalog) return inspect(endpoint({ url: url }, 'catalog', catalog.type, catalog.id), 0, manifest.name);
            })); });
            return chain.then(() => ({ origins: origins, addons: addons, connections: connections }));
        },
        configure: (args, host) => {
            if (!Array.isArray(args.addons) || !args.addons.length || args.addons.length > 8) fail('addons_required');
            const urls = args.addons.map(manifestUrl);
            if (new Set(urls).size !== urls.length) fail('duplicate_addon');
            const allowed = urls.map(url => parseUrl(url).origin).concat((args.imageOrigins || []).map(url => parseUrl(url).origin));
            const addons = []; let chain = Promise.resolve();
            urls.forEach(url => { chain = chain.then(() => json(host, url, undefined, allowed).then(manifest => { addons.push({ url: url, manifest: validateManifest(manifest) }); })); });
            const server = serverUrl(args.server);
            if (server) chain = chain.then(() => json(host, server + '/settings').then(settings => {
                if (!settings.values || typeof settings.values.serverVersion !== 'string') fail('invalid_streaming_server');
            }));
            return chain.then(() => {
                config = { addons: addons, server: server, approvedOrigins: urls.map(url => parseUrl(url).origin)
                    .concat(server ? [parseUrl(server).origin] : []).concat((args.imageOrigins || []).map(url => parseUrl(url).origin)) };
                Object.keys(streams).forEach(id => delete streams[id]); Object.keys(torrents).forEach(id => delete torrents[id]);
                Object.keys(metadata).forEach(id => delete metadata[id]);
                sourceHost.emit('configuration', config);
                sourceHost.emit('changed', {});
                return { account: 'stremio', label: 'Stremio', detail: addons.length + ' add-ons', configuration: config };
            });
        },
        approveOrigin: args => {
            const parsed = parseUrl(args.origin);
            if (parsed.path !== '/' || parsed.query) fail('invalid_origin');
            if (config.approvedOrigins.indexOf(parsed.origin) < 0) config.approvedOrigins = config.approvedOrigins.concat([parsed.origin]);
            sourceHost.emit('configuration', { approvedOrigins: config.approvedOrigins });
            return {};
        },
        libraries: () => ({ items: catalogs(false).map(row => ({ id: catalogId(row), title: row.addon.manifest.name + ' · '
            + (row.catalog.name || row.catalog.id), collectionType: row.catalog.type === 'series' ? 'tvshows' : 'movies' })) }),
        browse: (args, host) => catalogPage(args, host, false),
        search: (args, host) => catalogPage(args, host, true),
        details: (args, host) => detail(args, host).then(value => ({ item: value })),
        items: (args, host) => {
            const rows = []; let chain = Promise.resolve();
            (args.ids || []).forEach(id => { chain = chain.then(() => detail({ itemId: id }, host).then(value => rows.push(value))); });
            return chain.then(() => ({ items: rows, cursor: null, exhausted: true }));
        },
        seasons: (args, host) => meta({ itemId: args.seriesId }, host).then(value => {
            const numbers = [];
            (value.videos || []).forEach(entry => { if (Number.isInteger(entry.season) && numbers.indexOf(entry.season) < 0) numbers.push(entry.season); });
            return { items: numbers.sort((a, b) => a - b).map(number => ({ id: key([args.seriesId, String(number)]), title: number === 0 ? 'Specials' : 'Season ' + number,
                type: 'Season', season: number, seriesId: args.seriesId })), cursor: null, exhausted: true };
        }),
        episodes: (args, host) => meta({ itemId: args.seriesId }, host).then(value => {
            const season = args.seasonId ? unpack(args.seasonId, 2) : null;
            if (season && season[0] !== args.seriesId) fail('invalid_item_id');
            const videos = (value.videos || []).filter(entry => !season || String(entry.season) === season[1]);
            const offset = bounded(args.cursor, 1000000, 0), limit = Math.max(1, bounded(args.limit, 100, 50));
            const exhausted = offset + limit >= videos.length;
            return { items: videos.slice(offset, offset + limit).map(entry => episodeItem(entry, value, args.seriesId)), exhausted: exhausted,
                cursor: exhausted ? null : String(offset + limit) };
        }),
        streams: (args, host) => streamList(args, host, true).then(rows => ({ items: rows.map(row => ({ id: row.id, title: row.title,
            detail: row.detail, addon: row.addon, kind: row.kind, disabled: row.disabled, reason: row.reason })) })),
        files: (args, host) => chosen(args, host).then(choice => torrentFiles(choice, host)).then(rows => ({ items: rows })),
        prepare: (args, host) => target(args, host).then(result => ({ origin: result.origin, approved: approved(result.url), container: result.container })),
        resolve: (args, host) => resolve(args, host, false),
        download: (args, host) => resolve(args, host, true)
    };
}
