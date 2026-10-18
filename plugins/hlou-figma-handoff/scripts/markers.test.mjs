import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { parseFigmaMarkers } from './lib/markers.mjs';
import { CONTRACT_FIXTURES } from './lib/testing.mjs';

const casesFile = CONTRACT_FIXTURES && path.join(CONTRACT_FIXTURES, 'markers.json');
const hasCases = Boolean(casesFile && existsSync(casesFile));

describe('parseFigmaMarkers', () => {
  it('reads the common markers', () => {
    assert.deepEqual(parseFigmaMarkers('page/Our_Rooms Nos chambres'), {
      kind: 'page',
      key: 'our-rooms',
      n: null,
      flags: [],
      label: 'Nos chambres',
    });
    assert.deepEqual(parseFigmaMarkers('Flow:Check-In/3'), {
      kind: 'flow',
      key: 'check_in',
      n: 3,
      flags: [],
      label: '',
    });
    assert.deepEqual(parseFigmaMarkers('Carte @collection:Rooms @slider @slider'), {
      kind: null,
      key: null,
      n: null,
      flags: [{ name: 'collection', arg: 'rooms' }, { name: 'slider' }],
      label: 'Carte',
    });
    assert.equal(parseFigmaMarkers(undefined).label, '');
  });

  it(
    'matches every case of the contract fixture',
    { skip: hasCases ? false : 'markers.json is not here (published copy)' },
    () => {
      const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
      assert.ok(cases.length >= 40);
      for (const { name, expected } of cases)
        assert.deepEqual(parseFigmaMarkers(name), expected, name);
    }
  );
});
