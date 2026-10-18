/*
 * A hand validator for exactly the JSON Schema (draft 2020-12) keywords the
 * handoff schema uses. Zero-install on purpose. An unknown keyword is an
 * error, so a future schema cannot pass silently.
 */

/** Keywords that only describe; never checked. */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default']);

const KEYWORDS = new Set([
  ...ANNOTATIONS,
  'type',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'enum',
  'const',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'anyOf',
  'minimum',
  'maximum',
]);

const FORMATS = new Set(['date-time']);

/** RFC 3339 date-time with a mandatory offset (`Z` or `±hh:mm`). */
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

function isDateTime(value) {
  const m = DATE_TIME.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d >= 1 && d <= days && !Number.isNaN(Date.parse(value));
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Every keyword the schema uses that this validator does not know, as
 * `{ code: 'schemaKeyword', path, message }` (`path` points into the schema).
 */
export function unknownKeywords(schema, path = []) {
  const found = [];
  if (schema === true || schema === false) return found;
  if (typeof schema !== 'object' || schema === null) {
    return [{ code: 'schemaKeyword', path, message: 'A schema is an object or a boolean' }];
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (!KEYWORDS.has(keyword)) {
      found.push({
        code: 'schemaKeyword',
        path: [...path, keyword],
        message: `The validator does not know « ${keyword} »; update scripts/lib/json-schema.mjs`,
      });
      continue;
    }
    if (keyword === 'properties') {
      for (const [name, sub] of Object.entries(value)) {
        found.push(...unknownKeywords(sub, [...path, 'properties', name]));
      }
    } else if (
      keyword === 'items' ||
      keyword === 'additionalProperties' ||
      keyword === 'propertyNames'
    ) {
      found.push(...unknownKeywords(value, [...path, keyword]));
    } else if (keyword === 'anyOf') {
      value.forEach((sub, i) => found.push(...unknownKeywords(sub, [...path, 'anyOf', i])));
    } else if (keyword === 'format' && !FORMATS.has(value)) {
      found.push({
        code: 'schemaKeyword',
        path: [...path, keyword],
        message: `The validator does not know the format « ${value} »`,
      });
    }
  }
  return found;
}

/**
 * `value` against `schema` → `{ code: 'schema', path, message }[]`, empty when
 * valid. Call `unknownKeywords` first: this one skips what it does not know.
 */
export function validateJson(schema, value, path = []) {
  if (schema === true) return [];
  if (schema === false) return [{ code: 'schema', path, message: 'No value is allowed here' }];
  const issues = [];
  const add = (message, at = path) => issues.push({ code: 'schema', path: at, message });

  if (schema.anyOf) {
    const passes = schema.anyOf.some((sub) => validateJson(sub, value, path).length === 0);
    if (!passes) add('Matches none of the allowed shapes');
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      add(`Expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return issues;
    }
  }
  if ('const' in schema && !equal(value, schema.const)) {
    add(`Expected ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((option) => equal(option, value))) {
    add(`Expected one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }

  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      add(`At least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      add(`At most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      add(`Does not match ${schema.pattern.length > 60 ? 'the expected format' : schema.pattern}`);
    }
    if (schema.format === 'date-time' && !isDateTime(value)) {
      add('Expected an ISO 8601 date-time with an offset');
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) add(`At least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`At most ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      add(`At least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      add(`At most ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => issues.push(...validateJson(schema.items, item, [...path, i])));
    }
  }

  if (typeOf(value) === 'object') {
    for (const name of schema.required ?? []) {
      if (!(name in value)) add(`« ${name} » is required`, [...path, name]);
    }
    const properties = schema.properties ?? {};
    for (const [name, item] of Object.entries(value)) {
      if (schema.propertyNames !== undefined) {
        for (const issue of validateJson(schema.propertyNames, name, [...path, name])) {
          issues.push({ ...issue, message: `Property name: ${issue.message}` });
        }
      }
      if (name in properties) {
        issues.push(...validateJson(properties[name], item, [...path, name]));
      } else if (schema.additionalProperties !== undefined) {
        issues.push(...validateJson(schema.additionalProperties, item, [...path, name]));
      }
    }
  }

  return issues;
}
