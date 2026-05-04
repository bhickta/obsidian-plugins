import test from 'ava';

import {
  AjsonMultiFileItemDataAdapter,
  normalize_ajson_to_json_object_string,
} from './ajson_multi_file.js';

class TestItem {
  constructor(env, data) {
    this.env = env;
    this.data = data;
    this.key = data.key;
    this._queue_load = true;
    this.loaded_at = 0;
  }
}

function create_parse_adapter() {
  const items = new Map();
  const collection = {
    item_type: TestItem,
    get(key) {
      return items.get(key);
    },
    set(item) {
      items.set(item.key, item);
    },
  };
  const env = { smart_sources: collection };
  const adapter = Object.create(AjsonMultiFileItemDataAdapter.prototype);
  adapter.item = { env };
  return { adapter, items };
}

test('normalize_ajson_to_json_object_string ignores blank and comma-only lines', (t) => {
  const raw = [
    '"smart_sources:a.md": {"key":"a.md"},',
    '',
    ',',
    '   ',
    '"smart_sources:b.md": {"key":"b.md"},,',
    '"smart_sources:c.md": {"key":"c.md"}',
  ].join('\n');

  const normalized = normalize_ajson_to_json_object_string(raw);

  t.true(normalized.changed);
  t.is(normalized.entry_count, 3);
  t.deepEqual(JSON.parse(normalized.json_str), {
    'smart_sources:a.md': { key: 'a.md' },
    'smart_sources:b.md': { key: 'b.md' },
    'smart_sources:c.md': { key: 'c.md' },
  });
});

test('_parse repairs missing and extra trailing commas without throwing', (t) => {
  const { adapter, items } = create_parse_adapter();
  const raw = [
    '"smart_sources:a.md": {"path":"a.md"}',
    '',
    '"smart_sources:b.md": {"path":"b.md"},,',
  ].join('\n');

  const result = adapter._parse(raw);

  t.true(result.rewrite);
  t.true(items.has('a.md'));
  t.true(items.has('b.md'));
  t.is(items.get('a.md').data.key, 'a.md');
  t.regex(result.file_data, /"smart_sources:a\.md"/);
  t.regex(result.file_data, /"smart_sources:b\.md"/);
});
