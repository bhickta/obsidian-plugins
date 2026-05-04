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
    this.collection = env.smart_sources;
    this._queue_load = true;
    this._queue_import = true;
    this.loaded_at = 0;
  }

  queue_import() {
    this._queue_import = true;
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

test('load clears import queue after cached data loads', async (t) => {
  const { adapter, items } = create_parse_adapter();
  const item = new TestItem(adapter.item.env, {
    key: 'cached.md',
    path: 'cached.md',
    last_import: { mtime: 1000 },
    blocks: { '#Cached': [0, 1] },
  });
  item.should_import_after_load = () => false;
  items.set(item.key, item);
  adapter.item = item;
  item.collection.data_adapter = { get_item_data_path: () => 'cached.ajson' };
  item.collection.data_fs = {
    adapter: {
      read: async () => '"smart_sources:cached.md": {"path":"cached.md","last_import":{"mtime":1000},"blocks":{"#Cached":[0,1]}},',
    },
    write: async () => {},
    remove: async () => {},
  };

  await adapter.load();

  t.false(item._queue_import);
  t.false(item._queue_load);
});

test('load re-queues import when item reports stale cached data', async (t) => {
  const { adapter, items } = create_parse_adapter();
  const item = new TestItem(adapter.item.env, {
    key: 'stale.md',
    path: 'stale.md',
    last_import: { mtime: 1000 },
    blocks: { '#Stale': [0, 1] },
  });
  item.should_import_after_load = () => true;
  items.set(item.key, item);
  adapter.item = item;
  item.collection.data_adapter = { get_item_data_path: () => 'stale.ajson' };
  item.collection.data_fs = {
    adapter: {
      read: async () => '"smart_sources:stale.md": {"path":"stale.md","last_import":{"mtime":1000},"blocks":{"#Stale":[0,1]}},',
    },
    write: async () => {},
    remove: async () => {},
  };

  await adapter.load();

  t.true(item._queue_import);
  t.false(item._queue_load);
});
