import test from 'ava';

import { provider_options } from './smart-models/provider_options.js';
import {
  install_plugin_from_zip,
  normalize_zip_file_path,
  resolve_plugin_install_target,
  write_files_with_adapter,
} from './smart_plugins.js';

function create_store_zip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];

  for (const entry of entries) {
    const file_name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const header = new Uint8Array(30 + file_name.length);
    const dv = new DataView(header.buffer);

    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint32(10, 0, true);
    dv.setUint32(14, 0, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, file_name.length, true);
    dv.setUint16(28, 0, true);
    header.set(file_name, 30);

    chunks.push(header, data);
  }

  const total_length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const zip = new Uint8Array(total_length);
  let offset = 0;
  for (const chunk of chunks) {
    zip.set(chunk, offset);
    offset += chunk.length;
  }
  return zip.buffer;
}

function create_adapter() {
  const folders = new Set();
  const writes = [];
  return {
    folders,
    writes,
    async exists(path) {
      return folders.has(path);
    },
    async mkdir(path) {
      folders.add(path);
    },
    async writeBinary(path, data) {
      writes.push({ path, text: new TextDecoder().decode(data) });
    },
  };
}

test('normalize_zip_file_path rejects traversal entries', (t) => {
  t.throws(() => normalize_zip_file_path('../manifest.json'), {
    message: /Unsafe ZIP entry path/,
  });
  t.throws(() => normalize_zip_file_path('plugin/../../main.js'), {
    message: /Unsafe ZIP entry path/,
  });
  t.is(normalize_zip_file_path('/plugin/./main.js'), 'plugin/main.js');
});

test('write_files_with_adapter creates nested plugin folders', async (t) => {
  const adapter = create_adapter();

  await write_files_with_adapter(adapter, '.obsidian/plugins/demo-plugin', [
    { fileName: 'manifest.json', data: new TextEncoder().encode('{"id":"demo-plugin"}') },
    { fileName: 'nested/main.js', data: new TextEncoder().encode('console.log("ok");') },
  ]);

  t.true(adapter.folders.has('.obsidian'));
  t.true(adapter.folders.has('.obsidian/plugins'));
  t.true(adapter.folders.has('.obsidian/plugins/demo-plugin'));
  t.true(adapter.folders.has('.obsidian/plugins/demo-plugin/nested'));
  t.deepEqual(adapter.writes.map((write) => write.path), [
    '.obsidian/plugins/demo-plugin/manifest.json',
    '.obsidian/plugins/demo-plugin/nested/main.js',
  ]);
});

test('install_plugin_from_zip strips release folder and enables manifest id', async (t) => {
  const adapter = create_adapter();
  const enabled = [];
  const zip = create_store_zip([
    {
      name: 'smart-demo-1.0.0/manifest.json',
      text: JSON.stringify({ id: 'smart-demo', name: 'Smart Demo', version: '1.0.0' }),
    },
    {
      name: 'smart-demo-1.0.0/main.js',
      text: 'module.exports = {};',
    },
  ]);

  const app = {
    vault: { adapter, configDir: '.obsidian' },
    plugins: {
      manifests: {},
      enabledPlugins: new Set(),
      async loadManifests() {
        this.manifests['smart-demo'] = { name: 'Smart Demo', version: '1.0.0' };
      },
      async enablePlugin(plugin_id) {
        enabled.push(plugin_id);
      },
      async requestSaveConfig() {},
    },
  };

  const result = await install_plugin_from_zip(app, zip, {
    fallback_plugin_id: 'fallback-demo',
  });

  t.is(result.plugin_id, 'smart-demo');
  t.is(result.folder_name, 'smart-demo');
  t.is(result.base_folder, '.obsidian/plugins/smart-demo');
  t.deepEqual(enabled, ['smart-demo']);
  t.deepEqual(adapter.writes.map((write) => write.path), [
    '.obsidian/plugins/smart-demo/manifest.json',
    '.obsidian/plugins/smart-demo/main.js',
  ]);
});

test('resolve_plugin_install_target falls back safely when metadata is sparse', (t) => {
  t.deepEqual(resolve_plugin_install_target({ fallback_plugin_id: 'fallback-demo' }), {
    plugin_id: 'fallback-demo',
    folder_name: 'fallback-demo',
  });

  t.deepEqual(resolve_plugin_install_target({
    item: { manifest_id: 'demo/plugin' },
    fallback_plugin_id: 'fallback-demo',
  }), {
    plugin_id: 'demo_plugin',
    folder_name: 'demo_plugin',
  });
});

test('direct model providers are selectable without account-gated flags', (t) => {
  const chat_values = provider_options.chat_completion_models.map((option) => option.value);
  const embedding_values = provider_options.embedding_models.map((option) => option.value);

  for (const value of ['google', 'groq', 'openai', 'open_router', 'ollama', 'lm_studio']) {
    t.true(chat_values.includes(value));
  }

  for (const value of ['gemini', 'openai', 'open_router', 'ollama', 'lm_studio']) {
    t.true(embedding_values.includes(value));
  }

  const selectable_options = [
    ...provider_options.chat_completion_models,
    ...provider_options.embedding_models,
    ...provider_options.ranking_models,
  ];

  t.false(selectable_options.some((option) => option.disabled === true));
});
