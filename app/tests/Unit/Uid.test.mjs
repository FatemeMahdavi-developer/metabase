import test from 'node:test';
import assert from 'node:assert/strict';
import { uid } from '../../resources/js/analytics/uid.js';

const canonicalV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function withCrypto(value, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
    try {
        callback();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        else delete globalThis.crypto;
    }
}

test('native randomUUID keeps its Crypto receiver and is preferred to getRandomValues', () => {
    const expected = '12345678-1234-4567-89ab-123456789abc';
    const crypto = {
        randomUUID() { assert.strictEqual(this, crypto); return expected; },
        getRandomValues() { assert.fail('native UUID should be preferred'); },
    };
    withCrypto(crypto, () => assert.equal(uid(), expected));
});

test('HTTP browsers without randomUUID use getRandomValues and set the version and variant bits', () => {
    let calls = 0;
    const crypto = {
        getRandomValues(bytes) {
            assert.strictEqual(this, crypto);
            assert.ok(bytes instanceof Uint8Array);
            assert.equal(bytes.length, 16);
            bytes.fill(255);
            calls++;
            return bytes;
        },
    };
    withCrypto(crypto, () => {
        assert.equal(uid(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
        assert.equal(calls, 1);
    });
});

test('non-function randomUUID also falls back to getRandomValues', () => {
    withCrypto({ randomUUID: true, getRandomValues: bytes => bytes.fill(0) }, () => {
        assert.equal(uid(), '00000000-0000-4000-8000-000000000000');
    });
});

test('missing Crypto APIs produce canonical UI IDs without changing global crypto', () => {
    for (const crypto of [undefined, null, {}, { randomUUID: 'unavailable', getRandomValues: true }]) {
        withCrypto(crypto, () => {
            assert.match(uid(), canonicalV4);
            assert.strictEqual(globalThis.crypto, crypto);
        });
    }
});

test('fallback UI IDs and their leading alias keys stay unique when time and random values repeat', context => {
    context.mock.method(Date, 'now', () => 1792220000000);
    context.mock.method(Math, 'random', () => 0.25);
    withCrypto(undefined, () => {
        const ids = Array.from({ length: 20000 }, () => uid());
        assert.ok(ids.every(id => canonicalV4.test(id)));
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(new Set(ids.map(id => id.slice(0, 8))).size, ids.length);
    });
});
