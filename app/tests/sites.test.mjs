// The contact helpers: phone numbers into tel: and WhatsApp links, and the map link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dialDigits, telHref, whatsappHref, mapsHref, CHURCH, FUNDS, SITES } from '../js/sites.js';

describe('phone numbers', () => {
  it('adds the Singapore code to an 8-digit local number and keeps an international one', () => {
    assert.equal(dialDigits('6123 4567'), '6561234567');
    assert.equal(dialDigits('+65 9123-4567'), '6591234567');
    assert.equal(dialDigits('(65) 6123 4567'), '6561234567');
    assert.equal(dialDigits('+44 20 7946 0958'), '442079460958');
  });
  it('gives nothing for an empty or unusable number', () => {
    for (const bad of ['', '   ', null, undefined, 'call us', '12345', '1234567890123456']) {
      assert.equal(dialDigits(bad), '', String(bad));
      assert.equal(telHref(bad), '');
      assert.equal(whatsappHref(bad), '');
    }
  });
  it('builds tel and WhatsApp links', () => {
    assert.equal(telHref('6123 4567'), 'tel:+6561234567');
    assert.equal(whatsappHref('9123 4567'), 'https://wa.me/6591234567');
  });
});

describe('map link', () => {
  it('searches Google Maps for the address, encoded', () => {
    assert.equal(mapsHref(SITES.yishun.address), 'https://www.google.com/maps/search/?api=1&query=3%20Yishun%20Street%2011%2C%20Singapore%20768645');
    assert.ok(mapsHref('A & B #1').endsWith('A%20%26%20B%20%231'));
  });
});

describe('church details', () => {
  it('has a main site that exists and the church email', () => {
    assert.ok(SITES[CHURCH.mainSite]);
    assert.equal(CHURCH.email, 'hello@lifecentre.sg');
  });
  it('lists the two PayNow accounts from the design', () => {
    assert.deepEqual(FUNDS.map((f) => [f.id, f.uen]), [['tithe', 'S87SS0049C'], ['build', 'S87SS0049CBLD']]);
  });
});
