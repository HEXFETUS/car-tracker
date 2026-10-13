import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkServerIdentity } from 'node:tls';
import pg from 'pg';
import { getDatabaseConfig } from './database.js';

test('tracker pools retain verified TLS for the configured IP', () => {
  const previous = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://app:example@95.111.243.14:16432/car_tracker';
    process.env.DATABASE_CA_CERT = 'first\\nsecond';
    const config = getDatabaseConfig();
    const client = new pg.Client(config);
    assert.equal(client.host, '95.111.243.14');
    assert.equal(client.port, 16432);
    assert.equal(client.database, 'car_tracker');
    assert.equal(client.ssl.host, '95.111.243.14');
    assert.equal(client.ssl.ca, 'first\nsecond');
    assert.equal(client.ssl.rejectUnauthorized, true);
    const certificate = { subjectaltname: 'IP Address:95.111.243.14' };
    assert.equal(checkServerIdentity(client.ssl.host, certificate), undefined);
    assert.equal(checkServerIdentity('localhost', certificate)?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    assert.equal(checkServerIdentity(client.ssl.host, { subjectaltname: 'IP Address:127.0.0.1' })?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    delete process.env.DATABASE_CA_CERT;
    assert.throws(getDatabaseConfig, /DATABASE_CA_CERT is required/);
    process.env.NODE_ENV = 'development';
    assert.equal(getDatabaseConfig().ssl, undefined);
    delete process.env.DATABASE_URL;
    assert.throws(getDatabaseConfig, /DATABASE_URL is not set/);
  } finally {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'DATABASE_CA_CERT']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
