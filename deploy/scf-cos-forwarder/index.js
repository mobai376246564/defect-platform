'use strict';
/**
 * 腾讯云 SCF：把 COS 上传事件转发给缺陷平台（方案 5.4 ③）。
 *
 * 部署：运行环境 Node.js 18 及以上；触发器选择 COS，事件 cos:ObjectCreated:*，
 *       前缀 feedback/，后缀 manifest.json；与存储桶同地域。
 * 环境变量：
 *   PLATFORM_URL        平台地址，如 https://defects.example.com（或 VPC 内网地址）
 *   INGEST_HMAC_SECRET  与平台 INGEST_HMAC_SECRET 相同
 * 平台返回非 2xx 时抛错，交给 SCF 的异步重试；平台侧按 reportId 幂等，并有定时对账兜底。
 */
const nodeCrypto = require('node:crypto');

/** COS 触发器事件里的 key 形如 /{appid}/{bucket 短名}/{对象路径}，去掉前两段得到对象 key */
function objectKey(cosObjectKey) {
  return decodeURIComponent(String(cosObjectKey).replace(/^\/\d+\/[^/]+\//, ''));
}

function sign(secret, timestamp, body) {
  return nodeCrypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function forward(records, { platformUrl, secret, fetchImpl = fetch, now = Date.now }) {
  const events = records
    .map((r) => r && r.cos && r.cos.cosObject && r.cos.cosObject.key)
    .filter(Boolean)
    .map((k) => ({ key: objectKey(k) }))
    .filter((e) => e.key.startsWith('feedback/') && e.key.endsWith('/manifest.json'));
  if (events.length === 0) return { forwarded: 0 };

  const body = JSON.stringify({ events });
  const timestamp = String(Math.floor(now() / 1000));
  const res = await fetchImpl(`${platformUrl.replace(/\/$/, '')}/api/v1/ingest/cos-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timestamp': timestamp,
      'X-Signature': sign(secret, timestamp, body),
    },
    body,
  });
  if (!res.ok) throw new Error(`平台返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  return { forwarded: events.length };
}

exports.main_handler = async (event) => {
  const platformUrl = process.env.PLATFORM_URL;
  const secret = process.env.INGEST_HMAC_SECRET;
  if (!platformUrl || !secret) throw new Error('缺少环境变量 PLATFORM_URL 或 INGEST_HMAC_SECRET');
  return forward((event && event.Records) || [], { platformUrl, secret });
};

exports._internal = { objectKey, sign, forward };
