import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { EVAL_BUNDLES } from './lib/testing.mjs';
import { metadataText, parseMetadataXml, surveyMetadata } from './survey.mjs';
import { validateBundle } from './validate.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const xml = readFileSync(path.join(here, '__fixtures__', 'maison-exemple.xml'), 'utf8');
const expected = JSON.parse(
  readFileSync(path.join(here, '__fixtures__', 'maison-exemple.survey.json'), 'utf8')
);

describe('survey', () => {
  it('turns the example metadata into the expected survey', () => {
    assert.deepEqual(surveyMetadata(xml), expected);
  });

  it('finds the flow, the overlay, the slides, the logo, the cards and the strays', () => {
    const survey = surveyMetadata(xml);
    assert.deepEqual(
      survey.flowCandidates[0].steps.map((step) => step.frameId),
      ['20:1', '21:1']
    );
    assert.equal(survey.flowCandidates[0].sharedHeader, true);
    assert.deepEqual(
      survey.overlayCandidates.map((o) => o.frameId),
      ['30:1']
    );
    assert.deepEqual(survey.duplicateNames, [{ name: 'accueil', ids: ['10:1', '40:1'] }]);
    assert.deepEqual(
      survey.outside.map((node) => node.id),
      ['9:1']
    );
    const home = survey.frames[0];
    assert.deepEqual(home.hiddenSiblings[0].hidden, ['10:3', '10:4']);
    assert.deepEqual(
      home.vectorGroups.map((group) => group.id),
      ['10:5']
    );
    assert.deepEqual(home.icons, ['10:9 32×32']);
    assert.deepEqual(home.repeated[0].ids, ['10:11', '10:14', '10:17']);
    assert.equal(home.bands[0].header, true);
  });

  it('decodes entities and reads a saved tool result', () => {
    const [canvas] = parseMetadataXml(
      '<canvas id="0:1" name="A &amp; B &#39;C&#39; &#xE9;"></canvas>'
    );
    assert.equal(canvas.name, "A & B 'C' é");
    const saved = JSON.stringify([
      { type: 'text', text: 'Currently selected nodes: none' },
      { type: 'text', text: xml },
    ]);
    assert.equal(metadataText(saved), xml);
    assert.deepEqual(surveyMetadata(saved), expected);
  });
});

const bundles =
  EVAL_BUNDLES && existsSync(EVAL_BUNDLES)
    ? readdirSync(EVAL_BUNDLES, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(path.join(EVAL_BUNDLES, entry.name, 'hlou-handoff.json'))
        )
        .map((entry) => path.join(EVAL_BUNDLES, entry.name))
    : [];

describe('the eval bundles produced by this skill', () => {
  it('validate', { skip: bundles.length ? false : 'no eval bundle here (published copy)' }, () => {
    for (const dir of bundles) assert.deepEqual(validateBundle(dir), [], path.basename(dir));
  });
});
