'use strict';
// 运行：node --test deploy/scf-cos-forwarder
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { test } = require('node:test');
const { _internal } = require('./index.js');

const KEY = 'feedback/com.example.app/20261016/0192f3c4-7a1b-7c3d-9e8f-1a2b3c4d5e6f/manifest.json';
const record = (key) => ({ cos: { cosObject: { key } } });

test('strips the /appid/bucket prefix from COS trigger keys', () => {
  assert.equal(_internal.objectKey(`/1250000000/feedback/${KEY}`), KEY);
});

test('forwards only manifest events, signed with HMAC', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, text: async () => '' };
  };
  const result = await _internal.forward(
    [record(`/1250000000/feedback/${KEY}`), record('/1250000000/feedback/feedback/x/logs.zip')],
    {
      platformUrl: 'https://defects.example.com/',
      secret: 's3cret',
      fetchImpl,
      now: () => 1_700_000_000_000,
    },
  );
  assert.deepEqual(result, { forwarded: 1 });
  assert.equal(captured.url, 'https://defects.example.com/api/v1/ingest/cos-event');
  assert.deepEqual(JSON.parse(captured.init.body), { events: [{ key: KEY }] });
  const expected = nodeCrypto
    .createHmac('sha256', 's3cret')
    .update(`1700000000.${captured.init.body}`)
    .digest('hex');
  assert.equal(captured.init.headers['X-Signature'], expected);
});

test('throws on platform errors so SCF retries', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'down' });
  await assert.rejects(
    _internal.forward([record(`/1/b/${KEY}`)], {
      platformUrl: 'https://x',
      secret: 's',
      fetchImpl,
    }),
    /503/,
  );
});
