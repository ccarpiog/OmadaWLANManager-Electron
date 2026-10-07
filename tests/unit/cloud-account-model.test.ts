// Tests for the TP-Link cloud account model (src/main/cloud-account-model.ts):
// the strict organization-row validator, the renderer DTO (exactly six keys,
// never deviceId / serverHost / deviceType), every "not connectable" reason
// and their order, the cloud route target, the omadacId rule, and the error
// type's redaction. Fixtures: the guide's example and the four-organization
// account of tests/fixtures/cloud/.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CloudAccountError,
  cloudControllerReason,
  cloudControllerTarget,
  isOmadacId,
  toCloudController,
  validateCloudOrganization
} from '../../src/main/cloud-account-model';
import { REDACTED } from '../../src/main/redact';
import guide from '../fixtures/cloud/account-guide.json';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';

// A connectable organization row (overridden per test)
const ROW = {
  orgName: 'OC200 Planta 4',
  online: true,
  deviceId: '4A1B2C3D4E5F60718293A4B5C6D7E8F901234D',
  omadacId: '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d',
  orgVersion: '6.3.0.45',
  deviceType: 'SMB.OMADA.HARDWARECONTROLLER',
  serverHost: 'https://euw1-omada-northbound.tplinkcloud.com'
};

/**
 * Validates a row with overrides and returns its DTO.
 * @param {Record<string, unknown>} overrides - Fields to change (undefined removes one).
 * @returns {ReturnType<typeof toCloudController>} The DTO.
 */
function dtoOf(overrides: Record<string, unknown>): ReturnType<typeof toCloudController> {
  const row: Record<string, unknown> = { ...ROW, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete row[key];
    }
  }
  return toCloudController(validateCloudOrganization(row));
} // End of function dtoOf()

describe('validateCloudOrganization()', () => {
  test('the guide\'s example row keeps every field; its 6.2 version is listed but not connectable', () => {
    const organization = validateCloudOrganization(guide.organizationsPage.result.data[0]);
    assert.deepEqual(organization, {
      omadacId: '5ffc0460d2816b0d09b531cd27c106a8',
      name: 'Omada Controller_9E81B9',
      online: true,
      deviceId: '7B069516D97677D0BCA8E643F334A1A3F182A1',
      version: '6.2.0.9',
      deviceType: 'SMB.OMADA.SOFTWARECONTROLLER',
      serverOrigin: 'https://aps1-omada-northbound.tplinkcloud.com'
    });
    assert.equal(cloudControllerReason(organization), 'versionTooOld');
  });

  test('a row that is not an object, or has no usable omadacId, refuses the listing (malformedResponse)', () => {
    for (const entry of [null, 'x', 42, [], [ROW], { ...ROW, omadacId: undefined }, { ...ROW, omadacId: '' }, { ...ROW, omadacId: 'local' }, { ...ROW, omadacId: '__proto__' }, { ...ROW, omadacId: 'a/b' }, { ...ROW, omadacId: 'x'.repeat(65) }, { ...ROW, omadacId: 7 }]) {
      assert.throws(() => validateCloudOrganization(entry), (error: unknown) => error instanceof CloudAccountError && error.code === 'malformedResponse', JSON.stringify(entry));
    }
  });

  test('insane optional fields become unknown (null / false), never a guess; the name falls back to the omadacId and loses control characters', () => {
    const organization = validateCloudOrganization({
      omadacId: 'abc123',
      orgName: '‮\u0007  ',
      online: 'true',
      deviceId: 'bad/id',
      orgVersion: 6.3,
      deviceType: 'SMB OMADA',
      serverHost: 'https://evil.example'
    });
    assert.deepEqual(organization, { omadacId: 'abc123', name: 'abc123', online: false, deviceId: null, version: null, deviceType: null, serverOrigin: null });
    assert.equal(validateCloudOrganization({ ...ROW, orgName: '  Planta\u0000 4‮ ' }).name, 'Planta 4');
    assert.equal(validateCloudOrganization({ ...ROW, orgName: 'x'.repeat(300) }).name.length, 128);
  });
});

describe('toCloudController(): the renderer DTO and its reasons', () => {
  test('the four-organization account maps to exactly the expected DTOs (six keys each, no deviceId / serverHost / deviceType)', () => {
    const dtos = fourOrganizations.page.result.data.map((row) => toCloudController(validateCloudOrganization(row)));
    assert.deepEqual(dtos, fourOrganizations.expected);
    for (const dto of dtos) {
      assert.deepEqual(Object.keys(dto).sort(), ['connectable', 'name', 'omadacId', 'online', 'reason', 'version']);
      const serialized = JSON.stringify(dto);
      assert.ok(!serialized.includes('tplinkcloud') && !serialized.includes('SMB.OMADA') && !/[0-9A-F]{38}/.test(serialized), serialized);
    }
  });

  test('each reason, alone', () => {
    assert.deepEqual(dtoOf({}), { omadacId: ROW.omadacId, name: ROW.orgName, online: true, version: '6.3.0.45', connectable: true, reason: null });
    assert.equal(dtoOf({ online: false }).reason, 'offline');
    assert.equal(dtoOf({ orgVersion: '6.2.0.9' }).reason, 'versionTooOld');
    assert.equal(dtoOf({ orgVersion: '5.15.24.18' }).reason, 'versionTooOld');
    assert.equal(dtoOf({ orgVersion: '6.4.0.1' }).reason, null);
    assert.equal(dtoOf({ orgVersion: '7.0' }).reason, null);
    for (const orgVersion of [undefined, '', 'v6.3', '6.3-beta', '6', 'unknown', null]) {
      assert.equal(dtoOf({ orgVersion }).reason, 'versionUnknown', String(orgVersion));
    }
    for (const serverHost of [undefined, '', 'https://evil.example', 'https://euw1-omada-northbound.tplinkcloud.com:8443', 'https://euw1-omada-northbound.tplinkcloud.com/v1']) {
      assert.equal(dtoOf({ serverHost }).reason, 'unsupportedHost', String(serverHost));
    }
    for (const deviceType of ['SMB.OMADA.SWITCH', 'SMB.OMADA.ORGANIZATION', 'OMADA.CONTROLLER']) {
      assert.equal(dtoOf({ deviceType }).reason, 'notController', deviceType);
    }
    assert.equal(dtoOf({ deviceType: 'SMB.OMADA.SOFTWARECONTROLLER' }).reason, null);
    assert.equal(dtoOf({ deviceType: 'smb.omada.hardwarecontroller' }).reason, null);
    assert.equal(dtoOf({ deviceType: undefined }).reason, 'incompleteEntry');
    assert.equal(dtoOf({ deviceId: undefined }).reason, 'incompleteEntry');
    assert.equal(dtoOf({ deviceId: '../x' }).reason, 'incompleteEntry');
  }); // End of test "each reason, alone"

  test('the order: notController, incompleteEntry, unsupportedHost, versionUnknown, versionTooOld, offline (permanent before transient)', () => {
    const all = { deviceType: 'SMB.OMADA.SWITCH', deviceId: undefined, serverHost: 'https://evil.example', orgVersion: 'x', online: false };
    assert.equal(dtoOf(all).reason, 'notController');
    assert.equal(dtoOf({ ...all, deviceType: ROW.deviceType }).reason, 'incompleteEntry');
    assert.equal(dtoOf({ ...all, deviceType: ROW.deviceType, deviceId: ROW.deviceId }).reason, 'unsupportedHost');
    assert.equal(dtoOf({ online: false, orgVersion: 'x' }).reason, 'versionUnknown');
    assert.equal(dtoOf({ online: false, orgVersion: '6.2.0.9' }).reason, 'versionTooOld');
    const offline = dtoOf({ online: false });
    assert.deepEqual([offline.reason, offline.connectable, offline.online], ['offline', false, false]);
  });

  test('cloudControllerTarget(): only for a connectable organization, with its omadacId, deviceId and allowlisted origin', () => {
    assert.deepEqual(cloudControllerTarget(validateCloudOrganization(ROW)), {
      omadacId: ROW.omadacId,
      deviceId: ROW.deviceId,
      serverOrigin: 'https://euw1-omada-northbound.tplinkcloud.com'
    });
    for (const overrides of [{ online: false }, { orgVersion: '6.2.0.9' }, { serverHost: 'https://evil.example' }, { deviceId: undefined }]) {
      assert.equal(cloudControllerTarget(validateCloudOrganization({ ...ROW, ...overrides })), null, JSON.stringify(overrides));
    }
  });
});

describe('isOmadacId() and CloudAccountError', () => {
  test('omadacIds: letters, digits, _ and -, 1–64 characters, never a reserved word', () => {
    for (const value of ['5ffc0460d2816b0d09b531cd27c106a8', 'c0ffee00c0ffee00c0ffee00', 'A_b-1']) {
      assert.equal(isOmadacId(value), true, value);
    }
    for (const value of ['', 'local', '__proto__', 'constructor', 'prototype', 'a b', 'a/b', 'x'.repeat(65), null, 5]) {
      assert.equal(isOmadacId(value), false, String(value));
    }
  });

  test('a CloudAccountError redacts and cuts its diagnostic', () => {
    const error = new CloudAccountError('apiError', `failed client_secret=abc Authorization: AccessToken=a1-AT-AucoLyP4jpuCwriaOQpGvV2pdkG7YDDB ${'x'.repeat(400)}`, { apiErrorCode: -1 });
    assert.ok(!error.message.includes('abc') && !error.message.includes('AucoLyP4'), error.message);
    assert.ok(error.diagnostic.includes(REDACTED));
    assert.ok(error.diagnostic.length <= 200);
    assert.equal(error.apiErrorCode, -1);
    assert.equal(error.httpStatus, null);
  });
});
