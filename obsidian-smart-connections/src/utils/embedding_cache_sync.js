import { Notice, Platform, Setting } from 'obsidian';

const CACHE_DIR_NAME = 'smart-connections-cache';
const CACHE_ENV_DIR_NAME = 'smart-env';
const CACHE_MANIFEST_FILE = 'manifest.json';
const BACKUP_DIR_NAME = '.smart-env-backups';
const EXCLUDED_ENV_ROOT_NAMES = new Set([
  'event_logs',
]);

export const EMBEDDING_CACHE_SYNC_ROLES = {
  DISABLED: 'disabled',
  SOURCE: 'source',
  REPLICA: 'replica',
};

export const DEFAULT_EMBEDDING_CACHE_SYNC_SETTINGS = {
  device_role: EMBEDDING_CACHE_SYNC_ROLES.DISABLED,
  sync_folder: '',
  device_label: '',
  auto_pull_on_startup: false,
  backup_before_pull: true,
  reload_after_manual_pull: true,
  last_pushed_manifest_created_at: '',
  last_pulled_manifest_created_at: '',
};

const ROLE_OPTIONS = [
  {
    value: EMBEDDING_CACHE_SYNC_ROLES.DISABLED,
    label: 'No cache sync',
  },
  {
    value: EMBEDDING_CACHE_SYNC_ROLES.SOURCE,
    label: 'Source device (pushes cache)',
  },
  {
    value: EMBEDDING_CACHE_SYNC_ROLES.REPLICA,
    label: 'Replica device (pulls cache)',
  },
];

export async function load_embedding_cache_sync_settings(plugin) {
  const data = (await plugin.loadData()) || {};
  plugin.embedding_cache_sync_settings = normalize_settings(data.embedding_cache_sync);
  return plugin.embedding_cache_sync_settings;
}

export function get_embedding_cache_sync_settings(plugin) {
  if (!plugin.embedding_cache_sync_settings) {
    plugin.embedding_cache_sync_settings = normalize_settings();
  }
  return plugin.embedding_cache_sync_settings;
}

export async function save_embedding_cache_sync_settings(plugin, patch = {}) {
  const data = (await plugin.loadData()) || {};
  const settings = normalize_settings({
    ...data.embedding_cache_sync,
    ...get_embedding_cache_sync_settings(plugin),
    ...patch,
  });
  data.embedding_cache_sync = settings;
  plugin.embedding_cache_sync_settings = settings;
  await plugin.saveData(data);
  return settings;
}

export async function maybe_auto_pull_embedding_cache(plugin) {
  const settings = get_embedding_cache_sync_settings(plugin);
  if (settings.device_role !== EMBEDDING_CACHE_SYNC_ROLES.REPLICA) return;
  if (!settings.auto_pull_on_startup) return;
  if (!settings.sync_folder?.trim()) return;

  try {
    const { fs, path } = get_node_modules();
    const manifest = await read_remote_manifest(plugin, fs, path);
    const local_env_path = get_local_env_path(plugin, path);
    const local_env_exists = await path_exists(fs, local_env_path);
    if (
      local_env_exists
      && manifest.created_at
      && manifest.created_at === settings.last_pulled_manifest_created_at
    ) {
      return;
    }

    new Notice('Smart Connections: pulling embedding cache before startup...');
    await run_pull_embedding_cache(plugin, { auto: true });
  } catch (error) {
    console.warn('Smart Connections: startup cache pull skipped', error);
    new Notice(`Smart Connections cache pull skipped: ${error.message}`);
  }
}

export async function push_embedding_cache(plugin) {
  try {
    return await run_push_embedding_cache(plugin);
  } catch (error) {
    new Notice(`Embedding cache push failed: ${error.message}`);
    throw error;
  }
}

async function run_push_embedding_cache(plugin) {
  const settings = get_embedding_cache_sync_settings(plugin);
  assert_role(settings, EMBEDDING_CACHE_SYNC_ROLES.SOURCE, 'push');

  const { fs, path, os } = get_node_modules();
  const local_env_path = get_local_env_path(plugin, path);
  const sync_root_path = get_sync_root_path(plugin, path);
  assert_sync_path_is_safe(path, local_env_path, sync_root_path);

  if (!(await path_exists(fs, local_env_path))) {
    throw new Error(`Smart Env cache not found at ${local_env_path}`);
  }

  const parent_path = path.dirname(sync_root_path);
  const tmp_path = path.join(parent_path, `${CACHE_DIR_NAME}.tmp-${Date.now()}`);
  await remove_path(fs, tmp_path);

  try {
    await fs.mkdir(tmp_path, { recursive: true });
    const tmp_env_path = path.join(tmp_path, CACHE_ENV_DIR_NAME);
    await copy_path(fs, path, local_env_path, tmp_env_path, {
      exclude_root_names: EXCLUDED_ENV_ROOT_NAMES,
    });

    const stats = await collect_stats(fs, path, tmp_env_path);
    if (!stats.file_count) {
      throw new Error('No cache files were found to push.');
    }

    const manifest = build_manifest(plugin, settings, stats, os);
    await fs.writeFile(
      path.join(tmp_path, CACHE_MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );

    await remove_path(fs, sync_root_path);
    await fs.rename(tmp_path, sync_root_path);
    await save_embedding_cache_sync_settings(plugin, {
      last_pushed_manifest_created_at: manifest.created_at,
    });

    new Notice(`Pushed embedding cache: ${format_bytes(stats.total_size)} in ${stats.file_count} files.`);
    return manifest;
  } catch (error) {
    await remove_path(fs, tmp_path);
    throw error;
  }
}

export async function pull_embedding_cache(plugin, opts = {}) {
  try {
    return await run_pull_embedding_cache(plugin, opts);
  } catch (error) {
    new Notice(`Embedding cache pull failed: ${error.message}`);
    throw error;
  }
}

async function run_pull_embedding_cache(plugin, opts = {}) {
  const settings = get_embedding_cache_sync_settings(plugin);
  assert_role(settings, EMBEDDING_CACHE_SYNC_ROLES.REPLICA, 'pull');

  const { fs, path } = get_node_modules();
  const sync_root_path = get_sync_root_path(plugin, path);
  const remote_env_path = path.join(sync_root_path, CACHE_ENV_DIR_NAME);
  const local_env_path = get_local_env_path(plugin, path);
  const local_env_parent_path = path.dirname(local_env_path);
  const tmp_path = path.join(local_env_parent_path, `.smart-env-pull-${Date.now()}`);

  await validate_remote_cache(plugin, fs, path);
  await remove_path(fs, tmp_path);

  try {
    await copy_path(fs, path, remote_env_path, tmp_path);
    const manifest = await read_remote_manifest(plugin, fs, path);
    const tmp_stats = await collect_stats(fs, path, tmp_path);
    assert_stats_match_manifest(tmp_stats, manifest);

    if (settings.backup_before_pull && await path_exists(fs, local_env_path)) {
      await create_local_backup(plugin, fs, path, local_env_path, manifest);
    }

    await remove_path(fs, local_env_path);
    await fs.rename(tmp_path, local_env_path);
    await save_embedding_cache_sync_settings(plugin, {
      last_pulled_manifest_created_at: manifest.created_at,
    });

    const message = `Pulled embedding cache: ${format_bytes(tmp_stats.total_size)} in ${tmp_stats.file_count} files.`;
    new Notice(message);
    if (!opts.auto && settings.reload_after_manual_pull && typeof plugin.restart_plugin === 'function') {
      new Notice('Reloading Smart Connections to use the pulled cache...');
      await plugin.restart_plugin();
    }
    return manifest;
  } catch (error) {
    await remove_path(fs, tmp_path);
    throw error;
  }
}

export async function restore_latest_embedding_cache_backup(plugin) {
  try {
    return await run_restore_latest_embedding_cache_backup(plugin);
  } catch (error) {
    new Notice(`Embedding cache restore failed: ${error.message}`);
    throw error;
  }
}

async function run_restore_latest_embedding_cache_backup(plugin) {
  const { fs, path } = get_node_modules();
  const vault_base_path = get_vault_base_path(plugin);
  const backups_root_path = path.join(vault_base_path, BACKUP_DIR_NAME);
  if (!(await path_exists(fs, backups_root_path))) {
    new Notice('No Smart Env cache backups found.');
    return null;
  }

  const entries = await fs.readdir(backups_root_path, { withFileTypes: true });
  const backup_names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const latest_backup_name = backup_names[0];
  if (!latest_backup_name) {
    new Notice('No Smart Env cache backups found.');
    return null;
  }

  const latest_backup_env_path = path.join(backups_root_path, latest_backup_name, CACHE_ENV_DIR_NAME);
  if (!(await path_exists(fs, latest_backup_env_path))) {
    throw new Error(`Latest backup is missing ${CACHE_ENV_DIR_NAME}: ${latest_backup_name}`);
  }

  const local_env_path = get_local_env_path(plugin, path);
  const tmp_path = path.join(path.dirname(local_env_path), `.smart-env-restore-${Date.now()}`);
  await remove_path(fs, tmp_path);

  try {
    await copy_path(fs, path, latest_backup_env_path, tmp_path);
    await remove_path(fs, local_env_path);
    await fs.rename(tmp_path, local_env_path);
    new Notice(`Restored Smart Env cache backup: ${latest_backup_name}`);
    if (get_embedding_cache_sync_settings(plugin).reload_after_manual_pull && typeof plugin.restart_plugin === 'function') {
      new Notice('Reloading Smart Connections to use the restored cache...');
      await plugin.restart_plugin();
    }
    return latest_backup_name;
  } catch (error) {
    await remove_path(fs, tmp_path);
    throw error;
  }
}

export async function render_embedding_cache_sync_settings(plugin, container) {
  const settings = get_embedding_cache_sync_settings(plugin);

  const role_setting = new Setting(container)
    .setName('This device')
    .setDesc('Choose Source on the GPU PC and Replica on slower PCs. The role is saved only on this device.')
    .addDropdown((dropdown) => {
      for (const option of ROLE_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(settings.device_role);
      dropdown.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { device_role: value });
      });
    });
  role_setting.settingEl.addClass('sc-embedding-cache-sync-role');

  new Setting(container)
    .setName('Sync folder')
    .setDesc(`Absolute path to a Dropbox, Google Drive, OneDrive, or other cloud folder. Smart Connections creates ${CACHE_DIR_NAME} inside it.`)
    .addText((text) => {
      text.setPlaceholder('/home/user/Dropbox/ObsidianCache');
      text.setValue(settings.sync_folder || '');
      text.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { sync_folder: value.trim() });
      });
    });

  new Setting(container)
    .setName('Device label')
    .setDesc('Optional name written into the cache manifest so replicas can see which PC pushed it.')
    .addText((text) => {
      text.setPlaceholder('Home GPU PC');
      text.setValue(settings.device_label || '');
      text.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { device_label: value.trim() });
      });
    });

  new Setting(container)
    .setName('Pull on startup')
    .setDesc('Replica devices pull the newest cache before Smart Env starts loading.')
    .addToggle((toggle) => {
      toggle.setValue(Boolean(settings.auto_pull_on_startup));
      toggle.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { auto_pull_on_startup: value });
      });
    });

  new Setting(container)
    .setName('Keep backup before pull')
    .setDesc(`Copies the current local cache into ${BACKUP_DIR_NAME} before replacing it.`)
    .addToggle((toggle) => {
      toggle.setValue(settings.backup_before_pull !== false);
      toggle.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { backup_before_pull: value });
      });
    });

  new Setting(container)
    .setName('Reload after manual pull')
    .setDesc('Reloads Smart Connections after a manual pull or restore so the copied cache is used immediately.')
    .addToggle((toggle) => {
      toggle.setValue(settings.reload_after_manual_pull !== false);
      toggle.onChange(async (value) => {
        await save_embedding_cache_sync_settings(plugin, { reload_after_manual_pull: value });
      });
    });

  new Setting(container)
    .setName('Push cache now')
    .setDesc('Available only when this device is Source.')
    .addButton((button) => {
      button
        .setButtonText('Push')
        .onClick(async () => {
          await push_embedding_cache(plugin);
        });
    });

  new Setting(container)
    .setName('Pull cache now')
    .setDesc('Available only when this device is Replica.')
    .addButton((button) => {
      button
        .setButtonText('Pull')
        .onClick(async () => {
          await pull_embedding_cache(plugin);
        });
    });

  new Setting(container)
    .setName('Restore latest backup')
    .setDesc(`Restores the newest local backup from ${BACKUP_DIR_NAME}.`)
    .addButton((button) => {
      button
        .setButtonText('Restore')
        .onClick(async () => {
          await restore_latest_embedding_cache_backup(plugin);
        });
    });
}

function normalize_settings(settings = {}) {
  const normalized = {
    ...DEFAULT_EMBEDDING_CACHE_SYNC_SETTINGS,
    ...(settings || {}),
  };
  if (!Object.values(EMBEDDING_CACHE_SYNC_ROLES).includes(normalized.device_role)) {
    normalized.device_role = EMBEDDING_CACHE_SYNC_ROLES.DISABLED;
  }
  normalized.auto_pull_on_startup = Boolean(normalized.auto_pull_on_startup);
  normalized.backup_before_pull = normalized.backup_before_pull !== false;
  normalized.reload_after_manual_pull = normalized.reload_after_manual_pull !== false;
  return normalized;
}

function assert_role(settings, expected_role, action) {
  if (settings.device_role === expected_role) return;
  const expected_label = expected_role === EMBEDDING_CACHE_SYNC_ROLES.SOURCE
    ? 'Source device'
    : 'Replica device';
  throw new Error(`Set "This device" to "${expected_label}" before running cache ${action}.`);
}

function get_node_modules() {
  if (Platform.isMobile) {
    throw new Error('Embedding cache sync requires Obsidian desktop because it copies local filesystem folders.');
  }
  const req = get_require();
  if (!req) {
    throw new Error('Embedding cache sync could not access the desktop filesystem.');
  }
  return {
    fs: req('fs/promises'),
    path: req('path'),
    os: req('os'),
  };
}

function get_require() {
  if (typeof require === 'function') return require;
  if (typeof window !== 'undefined' && typeof window.require === 'function') return window.require;
  if (typeof globalThis !== 'undefined' && typeof globalThis.require === 'function') return globalThis.require;
  return null;
}

function get_vault_base_path(plugin) {
  const base_path = plugin.app?.vault?.adapter?.basePath;
  if (!base_path) {
    throw new Error('Embedding cache sync requires an Obsidian desktop vault with a local filesystem path.');
  }
  return base_path;
}

function get_local_env_path(plugin, path) {
  const vault_base_path = get_vault_base_path(plugin);
  const env_data_dir = plugin.env?.env_data_dir || '.smart-env';
  return path.resolve(vault_base_path, env_data_dir);
}

function get_sync_root_path(plugin, path) {
  const settings = get_embedding_cache_sync_settings(plugin);
  const sync_folder = settings.sync_folder?.trim();
  if (!sync_folder) {
    throw new Error('Set a Sync folder before using embedding cache sync.');
  }
  const vault_base_path = get_vault_base_path(plugin);
  const resolved_sync_folder = path.isAbsolute(sync_folder)
    ? sync_folder
    : path.resolve(vault_base_path, sync_folder);
  return path.join(resolved_sync_folder, CACHE_DIR_NAME);
}

function assert_sync_path_is_safe(path, local_env_path, sync_root_path) {
  if (is_same_or_child_path(path, sync_root_path, local_env_path)) {
    throw new Error('Sync folder cannot be inside the local Smart Env cache folder.');
  }
}

async function validate_remote_cache(plugin, fs, path) {
  const manifest = await read_remote_manifest(plugin, fs, path);
  const remote_env_path = path.join(get_sync_root_path(plugin, path), CACHE_ENV_DIR_NAME);
  if (!(await path_exists(fs, remote_env_path))) {
    throw new Error(`Remote cache is missing ${CACHE_ENV_DIR_NAME}.`);
  }
  const stats = await collect_stats(fs, path, remote_env_path);
  assert_stats_match_manifest(stats, manifest);
  return { manifest, stats };
}

async function read_remote_manifest(plugin, fs, path) {
  const manifest_path = path.join(get_sync_root_path(plugin, path), CACHE_MANIFEST_FILE);
  if (!(await path_exists(fs, manifest_path))) {
    throw new Error('No pushed embedding cache was found in the Sync folder.');
  }
  const text = await fs.readFile(manifest_path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Remote cache manifest is not valid JSON: ${error.message}`);
  }
}

function assert_stats_match_manifest(stats, manifest) {
  if (Number(manifest.file_count) !== stats.file_count) {
    throw new Error(`Remote cache file count mismatch: manifest has ${manifest.file_count}, folder has ${stats.file_count}.`);
  }
  if (Number(manifest.total_size) !== stats.total_size) {
    throw new Error(`Remote cache size mismatch: manifest has ${format_bytes(manifest.total_size)}, folder has ${format_bytes(stats.total_size)}.`);
  }
}

function build_manifest(plugin, settings, stats, os) {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    plugin_id: plugin.manifest?.id || 'smart-connections',
    plugin_version: plugin.manifest?.version || null,
    device_label: settings.device_label || get_default_device_label(plugin, os),
    source_count: count_items(plugin.env?.smart_sources?.items),
    embedding_model_key: get_embedding_model_key(plugin),
    env_data_dir: plugin.env?.env_data_dir || '.smart-env',
    file_count: stats.file_count,
    total_size: stats.total_size,
  };
}

function get_default_device_label(plugin, os) {
  try {
    return os?.hostname?.() || plugin.app?.vault?.getName?.() || '';
  } catch {
    return plugin.app?.vault?.getName?.() || '';
  }
}

function get_embedding_model_key(plugin) {
  return plugin.env?.smart_sources?.embed_model_key
    || plugin.env?.smart_sources?.settings?.embed_model_key
    || plugin.env?.settings?.smart_sources?.embed_model_key
    || null;
}

function count_items(items) {
  if (!items) return 0;
  if (items instanceof Map) return items.size;
  if (Array.isArray(items)) return items.length;
  return Object.keys(items).length;
}

async function create_local_backup(plugin, fs, path, local_env_path, remote_manifest) {
  const vault_base_path = get_vault_base_path(plugin);
  const backup_name = timestamp_for_path();
  const backup_path = path.join(vault_base_path, BACKUP_DIR_NAME, backup_name);
  const backup_env_path = path.join(backup_path, CACHE_ENV_DIR_NAME);
  await fs.mkdir(backup_path, { recursive: true });
  await copy_path(fs, path, local_env_path, backup_env_path, {
    exclude_root_names: EXCLUDED_ENV_ROOT_NAMES,
  });
  await fs.writeFile(
    path.join(backup_path, CACHE_MANIFEST_FILE),
    JSON.stringify({
      backup_created_at: new Date().toISOString(),
      restored_from_manifest: remote_manifest,
    }, null, 2),
    'utf8',
  );
  return backup_path;
}

async function copy_path(fs, path, source_path, target_path, opts = {}, depth = 0) {
  const stat = await fs.lstat(source_path);
  const name = path.basename(source_path);
  if (depth === 1 && opts.exclude_root_names?.has?.(name)) return;
  if (should_skip_name(name)) return;

  if (stat.isDirectory()) {
    await fs.mkdir(target_path, { recursive: true });
    const entries = await fs.readdir(source_path, { withFileTypes: true });
    for (const entry of entries) {
      await copy_path(
        fs,
        path,
        path.join(source_path, entry.name),
        path.join(target_path, entry.name),
        opts,
        depth + 1,
      );
    }
    return;
  }

  if (stat.isFile()) {
    await fs.mkdir(path.dirname(target_path), { recursive: true });
    await fs.copyFile(source_path, target_path);
  }
}

async function collect_stats(fs, path, dir_path) {
  const stat = await fs.lstat(dir_path);
  if (stat.isFile()) {
    return { file_count: 1, total_size: stat.size };
  }
  if (!stat.isDirectory()) {
    return { file_count: 0, total_size: 0 };
  }

  let file_count = 0;
  let total_size = 0;
  const entries = await fs.readdir(dir_path, { withFileTypes: true });
  for (const entry of entries) {
    const entry_path = path.join(dir_path, entry.name);
    if (entry.isDirectory()) {
      const child_stats = await collect_stats(fs, path, entry_path);
      file_count += child_stats.file_count;
      total_size += child_stats.total_size;
    } else if (entry.isFile()) {
      const child_stat = await fs.lstat(entry_path);
      file_count += 1;
      total_size += child_stat.size;
    }
  }
  return { file_count, total_size };
}

async function path_exists(fs, file_path) {
  try {
    await fs.access(file_path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    return false;
  }
}

async function remove_path(fs, target_path) {
  await fs.rm(target_path, { recursive: true, force: true });
}

function should_skip_name(name) {
  return name === '.DS_Store'
    || name.endsWith('.tmp')
    || name.endsWith('.temp')
    || name.endsWith('.part')
    || name.endsWith('.crdownload');
}

function is_same_or_child_path(path, candidate_path, parent_path) {
  const relative_path = path.relative(parent_path, candidate_path);
  return relative_path === '' || (relative_path && !relative_path.startsWith('..') && !path.isAbsolute(relative_path));
}

function timestamp_for_path() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function format_bytes(bytes) {
  const size = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit_index = 0;
  while (value >= 1024 && unit_index < units.length - 1) {
    value /= 1024;
    unit_index += 1;
  }
  const digits = value >= 10 || unit_index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit_index]}`;
}
