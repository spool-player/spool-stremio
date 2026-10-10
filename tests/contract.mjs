// SPDX-License-Identifier: 0BSD
import { createSource } from '../logic/provider.mjs';
function check(value, message) { if (!value) throw new Error('contract: ' + message); }
function rejection(operation, code) {
    return Promise.resolve().then(operation).then(() => { throw new Error('contract: expected ' + code); }, error => {
        check(error.message === code, 'expected ' + code + ', received ' + error.message);
    });
}
const hash = '0123456789abcdef0123456789abcdef01234567';
const origin = 'https://addon.example';
const server = 'http://127.0.0.1:11470';
const meta = { id: 'tt001', name: 'Legal Test Film', type: 'movie', poster: 'https://images.example/poster.jpg', releaseInfo: '2020' };
const series = { id: 'tt002', name: 'Legal Test Series', type: 'series', videos: [
    { id: 'tt002:1:1', season: 1, episode: 1, title: 'First episode' }, { id: 'tt002:1:2', season: 1, episode: 2, title: 'Second episode' }
] };
const manifest = { id: 'test.addon', name: 'Test Add-on', version: '1.0.0', resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [
        { type: 'movie', id: 'top', extra: [{ name: 'skip' }, { name: 'search' }] },
        { type: 'series', id: 'series', extra: [] },
        { type: 'movie', id: 'search-only', extra: [{ name: 'search', isRequired: true }] },
        { type: 'movie', id: 'genre-required', extra: [{ name: 'genre', isRequired: true }] }
    ] };
function catalogPaginationContract() {
    let sequence = Promise.resolve();
    for (const operation of ['browse', 'search']) {
        for (const scenario of [
            { skip: { name: 'skip', isRequired: true }, backendLimit: 20, total: 40, offsets: [0, 20, 40] },
            { skip: { name: 'skip' }, backendLimit: 80, total: 80, offsets: [0, 50, 80] },
            { skip: null, backendLimit: 80, total: 80, offsets: [0, 0] }
        ]) {
            sequence = sequence.then(() => {
            const offsets = [], delivered = [];
            const metas = Array.from({ length: scenario.total }, (_, index) => ({ id: 'page-' + index, name: 'Film ' + index }));
            const pagingManifest = Object.assign({}, manifest, { catalogs: [
                { type: 'movie', id: 'paged', extra: [{ name: 'search' }].concat(scenario.skip ? [scenario.skip] : []) },
                { type: 'movie', id: 'next', extra: [{ name: 'search' }] },
                { type: 'movie', id: 'unavailable', extra: [{ name: 'search' }, { name: 'genre', isRequired: true }] }
            ] });
            const host = { http: url => {
                check(url.indexOf('/unavailable') < 0, 'required unsupported extras stay filtered');
                let rows;
                if (url.indexOf('/paged') >= 0) {
                    const match = /skip=(\d+)/.exec(url);
                    check(!scenario.skip || !!match, 'declared skip is sent even at zero');
                    const offset = match ? Number(match[1]) : 0;
                    offsets.push(offset);
                    rows = metas.slice(offset, offset + scenario.backendLimit);
                } else rows = [{ id: 'next-film', name: 'Next catalogue film' }];
                return Promise.resolve({ status: 200, body: JSON.stringify({ metas: rows }) });
            } };
            const source = createSource({ addons: [{ url: origin + '/manifest.json', manifest: pagingManifest }] }, host);
            let cursor = null, pages = 0;
            function nextPage() {
                check(++pages <= 5, operation + ' catalog pagination terminates');
                return source[operation]({ query: 'film', limit: 50, cursor: cursor }, host).then(result => {
                    check(result.items.length <= 50, 'host page limit is respected');
                    result.items.forEach(item => delivered.push(JSON.parse(item.id)[1]));
                    cursor = result.cursor;
                    check(result.exhausted ? cursor === null : !!cursor, 'continuation remains available until all catalogs finish');
                    return result.exhausted ? undefined : nextPage();
                });
            }
            return nextPage().then(() => {
            check(JSON.stringify(offsets) === JSON.stringify(scenario.offsets), operation + ' advances by emitted items until empty');
            check(delivered.length === scenario.total + 1 && delivered[scenario.total] === 'next-film', operation + ' advances to the next catalog');
            for (let index = 0; index < scenario.total; ++index)
                check(delivered[index] === 'page-' + index, operation + ' delivers every backend item once in order');
            });
            });
        }
    }
    return sequence;
}
export function run() {
    const requests = [], events = [], logs = [];
    let headStatus = 200, contentType = 'video/mp4';
    const host = {
        capabilities: { 'originGrants': true, 'httpMetadata': true },
        emit: (type, payload) => events.push({ type: type, payload: payload }),
        log: (level, message, fields) => logs.push({ level: level, message: message, fields: fields }),
        isLogEnabled: () => true,
        http: (url, options) => {
            requests.push({ url: url, options: options || {} });
            if (options && options.method === 'HEAD') return Promise.resolve({ status: headStatus, body: '', headers: {
                'content-type': contentType, 'content-length': '1234' } });
            let body;
            if (url === origin + '/private-config/manifest.json') body = manifest;
            else if (url === server + '/settings') body = { values: { serverVersion: '4.20.8' } };
            else if (url.endsWith('/catalog/movie/top.json') || url.endsWith('/catalog/movie/top/skip=0.json')) return Promise.resolve({ status: 307, body: '',
                location: 'https://catalog.example/catalog/movie/top/first.json' });
            else if (url.indexOf('/catalog/movie/top/') >= 0 && /skip=[1-9]/.test(url)) body = { metas: [] };
            else if (url.indexOf('/catalog/movie/') >= 0) body = { metas: [meta, { id: 'tt003', name: 'Second Film' }] };
            else if (url.indexOf('/catalog/series/') >= 0) body = { metas: [series] };
            else if (url.endsWith('/meta/movie/tt001.json')) body = { meta: meta };
            else if (url.endsWith('/meta/series/tt002.json')) body = { meta: series };
            else if (url.indexOf('/stream/') >= 0) body = { streams: [
                { name: 'HTTP original', url: 'https://media.example/film.mp4?token=private', behaviorHints: { proxyHeaders: { request: { Authorization: 'Bearer private' } } } },
                { name: 'Torrent original', infoHash: hash, fileIdx: 1, sources: ['udp://tracker.example:80'] },
                { name: 'Browser', externalUrl: 'https://browser.example/watch' },
                { name: 'HLS', url: 'https://media.example/live.m3u8' }
            ] };
            else if (url === server + '/' + hash + '/create') {
                const request = JSON.parse(options.body);
                check(request.torrent.infoHash === hash && request.guessFileIdx === false, 'real create protocol');
                check(request.peerSearch.sources[1] === 'tracker:udp://tracker.example:80', 'tracker normalization');
                body = { success: true };
            } else if (url === server + '/' + hash + '/stats.json') body = { files: [
                { name: 'readme.nfo', length: 20 }, { name: 'Legal Film.mp4', length: 1234 }, { name: 'sample.mkv', length: 80 }
            ] };
            else return Promise.resolve({ status: 404, body: '{}' });
            return Promise.resolve({ status: 200, body: JSON.stringify(body) });
        }
    };
    const source = createSource({}, host);
    const setup = { addons: [origin + '/private-config/manifest.json'], server: server, imageOrigins: [] };
    let itemId, directId, torrentId, hlsId, seriesId;
    return source.inspectConnections(setup, host).then(inspected => {
        check(inspected.origins.length === 1 && inspected.origins[0] === 'https://catalog.example', 'discover exact catalogue destination');
        check(!requests.some(request => request.url.startsWith('https://catalog.example')), 'discovery never contacts unapproved redirect destination');
        return rejection(() => source.validateUrls({ addons: ['http://public.example/manifest.json'] }), 'https_required');
    })
        .then(() => rejection(() => source.validateUrls({ addons: ['http://10.evil.example/manifest.json'] }), 'https_required'))
        .then(() => rejection(() => source.validateUrls({ addons: ['https://name:password@example.org/manifest.json'] }), 'invalid_url'))
        .then(() => rejection(() => source.validateUrls({ addons: ['https://example.org/manifest.json?key=x'] }), 'invalid_manifest_url'))
        .then(() => source.configure(setup, host)).then(result => {
            check(result.configuration.addons.length === 1 && result.configuration.server === server, 'configured add-on and server');
            check(events.some(event => event.type === 'configuration'), 'configuration persists through host');
            const libraries = source.libraries({});
            check(libraries.items.length === 2, 'required-extra catalogs not falsely advertised');
            return rejection(() => source.browse({ parentId: libraries.items[0].id, limit: 1 }, host), 'redirect_origin_not_allowed').then(() => {
                source.approveOrigin({ origin: 'https://catalog.example' });
                return source.browse({ parentId: libraries.items[0].id, limit: 1 }, host);
            });
        }).then(result => {
            itemId = result.items[0].id;
            check(result.items[0].title === 'Legal Test Film' && !result.items[0].posterTag, 'unapproved image omitted');
            check(!result.exhausted && !!result.cursor, 'opaque catalog continuation');
            const library = source.libraries({}).items[0];
            return source.browse({ parentId: library.id, limit: 1, cursor: result.cursor }, host);
        }).then(result => {
            check(result.exhausted && result.items.length === 0, 'empty skip page terminates');
            check(requests.some(request => request.url.endsWith('/skip=1.json')), 'skip wire protocol');
            return source.search({ query: 'a/b & c', limit: 5 }, host);
        }).then(result => {
            check(result.items.length === 2 && requests.some(request => request.url.indexOf('search=a%2Fb%20%26%20c') >= 0), 'search escaping');
            return source.details({ itemId: itemId }, host);
        }).then(result => {
            check(result.item.year === 2020 && result.item.type === 'Movie', 'metadata normalization');
            source.approveOrigin({ origin: 'https://images.example' });
            return source.details({ itemId: itemId }, host);
        }).then(result => {
            check(result.item.posterTag === meta.poster, 'approved artwork enabled');
            seriesId = JSON.stringify(['series', 'tt002']);
            return source.seasons({ seriesId: seriesId, limit: 10 }, host);
        }).then(result => {
            check(result.items.length === 1 && result.items[0].season === 1, 'actual seasons');
            return source.episodes({ seriesId: seriesId, seasonId: result.items[0].id, limit: 1 }, host);
        }).then(result => {
            check(result.items[0].episode === 1 && !result.exhausted, 'episode metadata and paging');
            return source.details({ itemId: result.items[0].id }, host);
        }).then(result => {
            check(result.item.type === 'Episode' && result.item.title === 'First episode', 'episode details from owning series');
            return source.resolve({ itemId: itemId }, host);
        }).then(result => {
            check(result.pick.kind === 'stream', 'provider-owned stream picker requested');
            return source.streams({ itemId: itemId }, host);
        }).then(result => {
            directId = result.items[0].id; torrentId = result.items[1].id; hlsId = result.items[3].id;
            check(result.items[2].disabled && result.items[2].reason === 'unsupported_stream', 'unsupported streams visible and unavailable');
            check(directId.indexOf('private') < 0, 'choice IDs never expose configured URLs');
            return source.resolve({ itemId: itemId, stream: directId }, host);
        }).then(result => {
            check(result.pick.kind === 'consent' && result.pick.origin === 'https://media.example', 'new media origin requires consent');
            check(!requests.some(request => request.options.method === 'HEAD'), 'unapproved media not fetched');
            source.approveOrigin({ origin: 'https://media.example' });
            return source.resolve({ itemId: itemId, stream: directId }, host);
        }).then(result => {
            check(result.url === 'https://media.example/film.mp4?token=private' && result.headers.Authorization === 'Bearer private', 'direct playback and private headers');
            check(result.playMethod === 'DirectPlay', 'no fake transcode');
            return source.download({ itemId: itemId, stream: directId, mode: 'original' }, host);
        }).then(result => {
            check(result.container === 'mp4' && result.size === 1234, 'finite original download');
            return rejection(() => source.download({ itemId: itemId, stream: hlsId, mode: 'original' }, host), 'download_not_finite');
        }).then(() => rejection(() => source.download({ itemId: itemId, mode: 'transcoded' }, host), 'download_transcode_unavailable'))
        .then(() => source.resolve({ itemId: itemId, stream: torrentId }, host)).then(result => {
            check(result.pick.kind === 'torrent', 'torrent file picker requested even with recommendation');
            return source.files({ itemId: itemId, stream: torrentId }, host);
        }).then(result => {
            check(result.items.length === 2 && result.items[0].id === '1' && result.items[0].recommended, 'actual playable file indices and recommendation');
            return rejection(() => source.resolve({ itemId: itemId, stream: torrentId, file: '99' }, host), 'selected_variant_unavailable');
        }).then(() => source.download({ itemId: itemId, stream: torrentId, file: '1', mode: 'original' }, host)).then(result => {
            check(result.url === server + '/' + hash + '/1' && result.size === 1234 && result.container === 'mp4', 'server original download endpoint');
            headStatus = 302;
            return rejection(() => source.resolve({ itemId: itemId, stream: directId }, host), 'redirect_not_allowed');
        }).then(() => {
            headStatus = 405;
            return rejection(() => source.resolve({ itemId: itemId, stream: directId }, host), 'media_head_unsupported');
        }).then(() => {
            headStatus = 200; contentType = 'application/vnd.apple.mpegurl';
            return rejection(() => source.download({ itemId: itemId, stream: directId, mode: 'original' }, host), 'download_not_finite');
        }).then(() => {
            check(JSON.stringify(logs).indexOf('private') < 0 && JSON.stringify(logs).indexOf(hash) < 0, 'operational logging excludes secrets and hashes');
        }).then(() => catalogPaginationContract());
}
