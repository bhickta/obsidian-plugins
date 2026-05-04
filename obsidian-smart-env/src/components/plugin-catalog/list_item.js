import { Setting, Notice, requestUrl } from 'obsidian';
import {
  fetch_zip_from_url,
  install_plugin_from_zip,
  is_server_version_newer,
  sanitize_plugin_id,
} from '../../utils/smart_plugins.js';

export function build_html(item, params = {}) {
  return `<div class="plugins-catalog-list-item"></div>`;
}

function get_item_plugin_id(item = {}) {
  return sanitize_plugin_id(
    item.manifest_id || item.core_id || item.plugin_id || item.id || item.repo || item.name,
    'smart-plugin'
  );
}

function get_item_display_name(item = {}, local_info = null) {
  return local_info?.name || item.name || item.title || item.repo || get_item_plugin_id(item);
}

function has_install_source(item = {}) {
  return Boolean(item.download_url || item.resolve_download_url);
}

function get_docs_url(item = {}) {
  return item.docs_url || item.url || item.homepage || item.repository_url || '';
}

export function compute_display_state(item, local_info) {
  const plugin_id = get_item_plugin_id(item);
  const server_version = item.version || 'unknown';
  const local_version = local_info?.version || null;
  const display_name = get_item_display_name(item, local_info);

  let desc = server_version === 'unknown' ? '' : `Available version: ${server_version}`;
  let button_label = has_install_source(item) ? 'Install' : 'Open';
  let is_disabled = false;

  if (local_version) {
    desc = desc ? `${desc} | Installed version: ${local_version}` : `Installed version: ${local_version}`;
    const is_update = is_server_version_newer(local_version, server_version);
    if (is_update && has_install_source(item)) {
      button_label = 'Update';
    } else {
      button_label = 'Installed';
      is_disabled = true;
    }
  }

  if (item.description) {
    desc = desc ? `${desc}\n${item.description}` : item.description;
  }

  return {
    plugin_id,
    display_name,
    desc,
    button_label,
    is_disabled,
    server_version,
    local_version,
  };
}

export async function render(item, params = {}) {
  const html = build_html(item, params);
  const frag = this.create_doc_fragment(html);
  const container = frag.firstElementChild;
  await post_process.call(this, item, container, params);
  return container;
}

async function post_process(item, container, params = {}) {
  const { app, installed_map = {}, on_installed } = params;
  const plugin_id = get_item_plugin_id(item);
  const local = installed_map[plugin_id] || null;
  const state = compute_display_state(item, local);

  const row = new Setting(container)
    .setName(state.display_name)
    .setDesc(state.desc || 'Smart Plugin');

  row.addButton((btn) => {
    btn.setButtonText(state.button_label);
    btn.setDisabled(state.is_disabled);
    btn.onClick(() => {
      if (has_install_source(item)) {
        install_plugin(item, { app, on_installed });
      } else {
        open_plugin_page(item);
      }
    });
  });

  row.addButton((btn) => {
    btn.setButtonText('Docs');
    btn.onClick(() => open_docs(item, { app, display_name: state.display_name }));
  });

  return container;
}

function open_plugin_page(item = {}) {
  const plugin_id = item.core_id || item.manifest_id || item.plugin_id || item.id;
  if (plugin_id) {
    window.open(`obsidian://show-plugin?id=${encodeURIComponent(plugin_id)}`, '_external');
    return;
  }

  const docs_url = get_docs_url(item);
  if (docs_url) {
    window.open(docs_url, '_external');
  }
}

const download_plugin_zip = async (item) => {
  const resolved_download_url = typeof item.resolve_download_url === 'function'
    ? await item.resolve_download_url()
    : item.download_url;

  if (resolved_download_url) {
    return fetch_zip_from_url(resolved_download_url, requestUrl);
  }

  throw new Error('This plugin does not provide a direct download URL.');
};

const install_plugin = async (item, params = {}) => {
  const { app, on_installed } = params;
  try {
    new Notice(`Installing "${item.name || item.repo || get_item_plugin_id(item)}" ...`);

    const zip_data = await download_plugin_zip(item);
    const result = await install_plugin_from_zip(app, zip_data, {
      item,
      fallback_plugin_id: get_item_plugin_id(item),
    });

    new Notice(`${item.name || result.plugin_id} installed successfully.`);
    if (typeof on_installed === 'function') {
      await on_installed();
    }
  } catch (err) {
    console.error('[plugins:list_item] Install error:', err);
    new Notice(`Install failed: ${err.message}`);
  }
};

const open_docs = async (item, params = {}) => {
  const { app, display_name } = params;
  const docs_url = get_docs_url(item);
  if (docs_url) {
    window.open(docs_url, '_external');
    return;
  }

  new Notice('No documentation link is available for this plugin.');
};
