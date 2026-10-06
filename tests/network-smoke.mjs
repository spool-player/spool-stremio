// SPDX-License-Identifier: 0BSD
// Drives public operations through actual HTTP; local data is legal test content, not a torrent engine.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSource } from '../logic/provider.mjs';
const hash = '0123456789abcdef0123456789abcdef01234567';
const bytes = Buffer.from('Spool original legal-content HTTP protocol fixture\n');
let origin;
const manifest = { id: 'legal.fixture', name: 'Legal fixture', version: '1.0.0', types: ['movie'],
    resources: ['catalog', 'meta', 'stream'], catalogs: [{ id: 'legal', type: 'movie', extra: [{ name: 'search' }] }] };
const meta = { id: 'legal-film', type: 'movie', name: 'Legal protocol film' };
let torrentCreated = false;
const fixture = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
        const path = request.url;
        let value;
        if (path === '/manifest.json') value = manifest;
        else if (path === '/settings') value = { values: { serverVersion: 'legal-fixture-1' } };
        else if (path.startsWith('/catalog/movie/legal')) value = { metas: [meta] };
        else if (path === '/meta/movie/legal-film.json') value = { meta };
        else if (path === '/stream/movie/legal-film.json') value = { streams: [
            { name: 'Original HTTP', url: origin + '/original.mp4' }, { name: 'Original torrent file', infoHash: hash, fileIdx: 0 }
        ] };
        else if (path === '/' + hash + '/create' && request.method === 'POST') {
            const input = JSON.parse(body);
            assert.equal(input.torrent.infoHash, hash);
            assert.equal(input.guessFileIdx, false);
            torrentCreated = true;
            value = { success: true };
        } else if (path === '/' + hash + '/stats.json') {
            assert.equal(torrentCreated, true);
            value = { files: [{ name: 'Legal-film.mp4', length: bytes.length }, { name: 'license.txt', length: 20 }] };
        } else if (path === '/original.mp4' || path === '/' + hash + '/0') {
            response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length });
            response.end(request.method === 'HEAD' ? undefined : bytes);
            return;
        } else {
            response.writeHead(404, { 'Content-Type': 'application/json' }); response.end('{}'); return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
    });
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + fixture.address().port;
function hostFor(allowed) {
    return {
        extensions: { 'spool.origin-grants': 1, 'spool.http-metadata': 1 },
        emit() {}, log() {}, isLogEnabled() { return false; },
        async http(url, options = {}) {
            assert(allowed.has(new URL(url).origin), 'transport denied unapproved origin');
            const response = await fetch(url, { method: options.method || 'GET', headers: options.headers, body: options.body,
                redirect: 'manual', signal: AbortSignal.timeout(12000) });
            const headers = {};
            for (const name of options.responseHeaders || []) headers[name] = response.headers.get(name) || '';
            return { status: response.status, body: await response.text(), location: response.headers.get('location'), headers };
        }
    };
}
try {
    const host = hostFor(new Set([origin]));
    const source = createSource({}, host);
    await source.configure({ addons: [origin + '/manifest.json'], server: origin, imageOrigins: [] }, host);
    const library = source.libraries({}).items[0];
    const page = await source.browse({ parentId: library.id, limit: 10 }, host);
    const itemId = page.items[0].id;
    assert.equal((await source.details({ itemId }, host)).item.title, meta.name);
    assert.equal((await source.search({ query: 'legal', limit: 10 }, host)).items[0].id, itemId);
    assert.equal((await source.resolve({ itemId }, host)).pick.kind, 'stream');
    const streams = (await source.streams({ itemId }, host)).items;
    const direct = await source.resolve({ itemId, stream: streams[0].id }, host);
    assert.equal(direct.playMethod, 'DirectPlay');
    assert.deepEqual(Buffer.from(await (await fetch(direct.url)).arrayBuffer()), bytes);
    const download = await source.download({ itemId, mode: 'original', stream: streams[0].id }, host);
    assert.equal(download.size, bytes.length);
    assert.deepEqual(Buffer.from(await (await fetch(download.url)).arrayBuffer()), bytes);
    assert.equal((await source.resolve({ itemId, stream: streams[1].id }, host)).pick.kind, 'torrent');
    const files = (await source.files({ itemId, stream: streams[1].id }, host)).items;
    assert.equal(files.length, 1);
    const torrent = await source.download({ itemId, mode: 'original', stream: streams[1].id, file: files[0].id }, host);
    assert.equal(torrent.url, origin + '/' + hash + '/0');
    assert.deepEqual(Buffer.from(await (await fetch(torrent.url)).arrayBuffer()), bytes);
    console.log('Local HTTP add-on/server smoke passed: manifest, catalog, meta, search, picker, HEAD, original bytes and torrent-file selection');
    if (process.argv.includes('--live')) {
        const liveOrigin = 'https://v3-cinemeta.strem.io';
        const allowed = new Set([liveOrigin]);
        const liveHost = hostFor(allowed);
        const live = createSource({}, liveHost);
        const input = { addons: [liveOrigin + '/manifest.json'], imageOrigins: [] };
        for (let round = 0; round < 4; round++) {
            const inspected = await live.inspectConnections(input, liveHost);
            if (!inspected.origins.length) break;
            // Simulate the user's explicit review/approval before any destination request.
            for (const origin of inspected.origins) {
                assert(!allowed.has(origin));
                allowed.add(origin);
                input.imageOrigins.push(origin);
            }
        }
        await live.configure(input, liveHost);
        const libraries = live.libraries({}).items;
        assert(libraries.length > 0);
        const movies = libraries.find(row => row.collectionType === 'movies');
        const catalog = await live.browse({ parentId: movies.id, limit: 2 }, liveHost);
        assert.equal(catalog.items.length, 2);
        const details = await live.details({ itemId: catalog.items[0].id }, liveHost);
        assert(details.item.title.length > 0);
        const search = await live.search({ query: 'Sintel', limit: 2 }, liveHost);
        assert(Array.isArray(search.items));
        console.log('Live Cinemeta smoke passed: manifest, libraries, movie catalog, meta and search; no stream capability claimed');
    }
} finally {
    await new Promise(resolve => fixture.close(resolve));
}
