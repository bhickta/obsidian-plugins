const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIG = 0x02014b50;
const ZIP_DATA_DESCRIPTOR_SIG = 0x08074b50;
const PLUGIN_FOLDER_ROOT = '.obsidian/plugins';

function default_request_url() {
  throw new Error('fetch_zip_from_url requires an Obsidian request function.');
}

/**
 * Attempt Node zlib in Obsidian desktop with window.require("zlib").
 * @returns {any|null}
 */
export function try_get_zlib() {
  if (typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      return window.require('zlib');
    } catch {}
  }
  return null;
}

/**
 * If compressionMethod=8, do deflate inflation with zlib.inflateRawSync.
 * @param {Uint8Array} compressed
 * @returns {Uint8Array}
 * @throws {Error} if zlib not available or inflation fails
 */
export function inflate_deflate_data(compressed) {
  const zlib = try_get_zlib();
  if (!zlib) {
    throw new Error('zlib not available (maybe Obsidian mobile?).');
  }
  const buf = Buffer.from(compressed);
  const out = zlib.inflateRawSync(buf);
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
}

/**
 * Keep plugin folder names compatible with Obsidian adapter paths.
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitize_plugin_id(value, fallback = 'smart-plugin') {
  const safe = String(value || fallback)
    .trim()
    .replace(/[\\/]+/g, '_')
    .replace(/[^\w-]/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || fallback;
}

/**
 * Convert an adapter path to a predictable slash-separated path.
 *
 * @param {...string} parts
 * @returns {string}
 */
export function join_adapter_path(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .map((part) => String(part).replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

/**
 * Normalize a ZIP entry path and reject entries that would escape the plugin
 * folder when written to the vault adapter.
 *
 * @param {string} file_name
 * @returns {string}
 */
export function normalize_zip_file_path(file_name) {
  const normalized = String(file_name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const parts = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      throw new Error(`Unsafe ZIP entry path: ${file_name}`);
    }
    parts.push(part);
  }
  return parts.join('/');
}

/**
 * GitHub release zips often wrap files in a single root folder. Strip that
 * folder only when it contains the plugin manifest.
 *
 * @param {{fileName:string, data:Uint8Array}[]} files
 * @returns {{fileName:string, data:Uint8Array}[]}
 */
export function strip_common_archive_root(files) {
  if (!files.length) return files;
  if (files.some(({ fileName }) => fileName === 'manifest.json')) return files;

  const first_parts = files[0].fileName.split('/');
  if (first_parts.length < 2) return files;
  const root = first_parts[0];
  const has_common_root = files.every(({ fileName }) => fileName.startsWith(root + '/'));
  const has_manifest_under_root = files.some(({ fileName }) => fileName === `${root}/manifest.json`);
  if (!has_common_root || !has_manifest_under_root) return files;

  return files
    .map(({ fileName, data }) => ({
      fileName: fileName.slice(root.length + 1),
      data,
    }))
    .filter(({ fileName }) => fileName.length > 0);
}

function normalize_archive_files(files) {
  const normalized_files = [];
  for (const { fileName, data } of files) {
    if (String(fileName || '').endsWith('/')) continue;
    const safe_file_name = normalize_zip_file_path(fileName);
    if (!safe_file_name) continue;
    normalized_files.push({ fileName: safe_file_name, data });
  }
  return strip_common_archive_root(normalized_files);
}

function parse_plugin_manifest(files) {
  const manifest_file = files.find(({ fileName }) => fileName === 'manifest.json');
  if (!manifest_file) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(manifest_file.data));
  } catch {
    return null;
  }
}

/**
 * Minimal ZIP parser that handles bit 3 data descriptor for local file headers.
 * Returns { files, pluginManifest } where:
 *  - files is an array of { fileName, data }
 *  - pluginManifest is parsed from top-level "manifest.json" if found
 *
 * @param {ArrayBuffer} zipBuffer
 * @returns {Promise<{ files: { fileName: string, data: Uint8Array }[], pluginManifest: any }>}
 */
export async function parse_zip_into_files(zipBuffer) {
  const dv = new DataView(zipBuffer);
  let offset = 0;
  const length = dv.byteLength;
  const files = [];

  while (offset + 4 <= length) {
    // local file header signature => 0x04034b50
    const localSig = dv.getUint32(offset, true);
    if (localSig === ZIP_CENTRAL_DIRECTORY_SIG || localSig === ZIP_DATA_DESCRIPTOR_SIG) {
      break;
    }
    if (localSig !== ZIP_LOCAL_FILE_HEADER_SIG) {
      break;
    }
    offset += 4;

    // [2] versionNeeded, [2] generalPurposeBitFlag, [2] compressionMethod
    const versionNeeded = dv.getUint16(offset, true);
    const generalPurposeBitFlag = dv.getUint16(offset + 2, true);
    const compressionMethod = dv.getUint16(offset + 4, true);
    offset += 6;

    // [4] lastModTimeDate
    const lastModTimeDate = dv.getUint32(offset, true);
    offset += 4;

    // [4] CRC, [4] compressedSize, [4] uncompressedSize => 12 bytes
    let crc32 = dv.getUint32(offset, true);
    let compressedSize = dv.getUint32(offset + 4, true);
    let uncompressedSize = dv.getUint32(offset + 8, true);
    offset += 12;

    // [2] fileNameLen, [2] extraLen => 4 bytes
    const fileNameLen = dv.getUint16(offset, true);
    const extraLen = dv.getUint16(offset + 2, true);
    offset += 4;

    const fileNameBytes = new Uint8Array(zipBuffer.slice(offset, offset + fileNameLen));
    const fileName = new TextDecoder('utf-8').decode(fileNameBytes);
    offset += fileNameLen;
    offset += extraLen;

    const hasDataDescriptor = (generalPurposeBitFlag & 0x0008) !== 0;

    let compDataStart = offset;
    let compDataEnd;
    if (!hasDataDescriptor) {
      compDataEnd = compDataStart + compressedSize;
    } else {
      // bit 3 => must search for next signature
      let scanPos = compDataStart;
      let foundSig = false;
      while (scanPos + 4 <= length) {
        const sig = dv.getUint32(scanPos, true);
        if (
          sig === ZIP_DATA_DESCRIPTOR_SIG ||
          sig === ZIP_LOCAL_FILE_HEADER_SIG ||
          sig === ZIP_CENTRAL_DIRECTORY_SIG
        ) {
          foundSig = true;
          break;
        }
        scanPos++;
      }
      compDataEnd = foundSig ? scanPos : length;
    }
    if (compDataEnd > length) {
      break;
    }

    const fileDataCompressed = new Uint8Array(zipBuffer.slice(compDataStart, compDataEnd));
    offset = compDataEnd;

    // optional data descriptor
    if (hasDataDescriptor) {
      if (offset + 4 <= length) {
        const ddSig = dv.getUint32(offset, true);
        if (ddSig === ZIP_DATA_DESCRIPTOR_SIG) {
          offset += 4;
        }
        if (offset + 12 <= length) {
          crc32 = dv.getUint32(offset, true);
          compressedSize = dv.getUint32(offset + 4, true);
          uncompressedSize = dv.getUint32(offset + 8, true);
          offset += 12;
        } else {
          break;
        }
      }
    }

    // decompress if needed
    let rawData;
    if (compressionMethod === 0) {
      rawData = fileDataCompressed;
    } else if (compressionMethod === 8) {
      rawData = inflate_deflate_data(fileDataCompressed);
    } else {
      // unsupported compression => skip
      continue;
    }

    files.push({ fileName, data: rawData });
  }

  const normalized_files = normalize_archive_files(files);
  return {
    files: normalized_files,
    pluginManifest: parse_plugin_manifest(normalized_files),
  };
}

/**
 * Ensure a response buffer contains a valid ZIP signature.
 *
 * @param {ArrayBuffer} zip_buffer
 * @param {string} source_label
 * @returns {ArrayBuffer}
 */
export function validate_zip_buffer(zip_buffer, source_label = 'Response') {
  if (!zip_buffer || zip_buffer.byteLength < 4) {
    throw new Error(`${source_label} returned too few bytes, not a valid ZIP.`);
  }
  const dv = new DataView(zip_buffer);
  if (dv.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER_SIG) {
    const txt = new TextDecoder().decode(new Uint8Array(zip_buffer));
    throw new Error(`${source_label} did not return a valid ZIP. Text:\n${txt}`);
  }
  return zip_buffer;
}

async function ensure_adapter_folder(adapter, folder_path) {
  if (!adapter?.exists || !adapter?.mkdir) return;
  const parts = join_adapter_path(folder_path).split('/').filter(Boolean);
  let current_path = '';
  for (const part of parts) {
    current_path = current_path ? `${current_path}/${part}` : part;
    if (!(await adapter.exists(current_path))) {
      await adapter.mkdir(current_path);
    }
  }
}

function bytes_to_base64(data) {
  let binary = '';
  const chunk_size = 0x8000;
  for (let i = 0; i < data.length; i += chunk_size) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk_size));
  }
  return btoa(binary);
}

/**
 * Writes {fileName, data} to vault's baseFolder. Creates subfolders as needed.
 * @param {import('obsidian').DataAdapter} adapter
 * @param {string} baseFolder
 * @param {{fileName:string, data:Uint8Array}[]} files
 */
export async function write_files_with_adapter(adapter, baseFolder, files) {
  const hasWriteBinary = typeof adapter.writeBinary === 'function';
  await ensure_adapter_folder(adapter, baseFolder);
  for (const { fileName, data } of files) {
    const safe_file_name = normalize_zip_file_path(fileName);
    if (!safe_file_name) continue;
    const fullPath = join_adapter_path(baseFolder, safe_file_name);
    const parent_folder = fullPath.split('/').slice(0, -1).join('/');
    if (parent_folder) {
      await ensure_adapter_folder(adapter, parent_folder);
    }
    if (hasWriteBinary) {
      await adapter.writeBinary(fullPath, data);
    } else {
      await adapter.write(fullPath, bytes_to_base64(data));
    }
  }
}

/**
 * Resolve the Obsidian plugin id and folder name from server metadata and the
 * downloaded manifest.
 *
 * @param {object} params
 * @param {object} [params.item]
 * @param {object} [params.plugin_manifest]
 * @param {string} [params.fallback_plugin_id]
 * @returns {{plugin_id:string, folder_name:string}}
 */
export function resolve_plugin_install_target({
  item = {},
  plugin_manifest = null,
  fallback_plugin_id = 'smart-plugin',
} = {}) {
  const repo_name = String(item.repo || '').replace(/[\\/]+/g, '_');
  const manifest_id = plugin_manifest?.id || '';
  const folder_name = sanitize_plugin_id(
    item.plugin_id || manifest_id || item.manifest_id || repo_name,
    fallback_plugin_id
  );
  const plugin_id = sanitize_plugin_id(
    manifest_id || item.manifest_id || item.plugin_id || repo_name || folder_name,
    folder_name
  );
  return { plugin_id, folder_name };
}

/**
 * Build the vault adapter path for an installed plugin folder.
 *
 * @param {string} folder_name
 * @param {string} [config_dir]
 * @returns {string}
 */
export function build_plugin_folder_path(folder_name, config_dir = PLUGIN_FOLDER_ROOT.split('/')[0]) {
  return join_adapter_path(config_dir, 'plugins', sanitize_plugin_id(folder_name));
}

function resolve_loaded_plugin_id(app, plugin_id, folder_name) {
  const manifests = app?.plugins?.manifests || {};
  if (manifests[plugin_id]) return plugin_id;
  if (manifests[folder_name]) return folder_name;
  return plugin_id;
}

/**
 * Install a downloaded plugin ZIP into the vault and enable it.
 *
 * @param {import('obsidian').App} app
 * @param {ArrayBuffer} zip_buffer
 * @param {object} [options]
 * @param {object} [options.item]
 * @param {string} [options.fallback_plugin_id]
 * @returns {Promise<{plugin_id:string, folder_name:string, base_folder:string, pluginManifest:any, files:{fileName:string,data:Uint8Array}[]}>}
 */
export async function install_plugin_from_zip(app, zip_buffer, options = {}) {
  if (!app?.vault?.adapter) {
    throw new Error('Cannot install plugin without an Obsidian vault adapter.');
  }

  const { files, pluginManifest } = await parse_zip_into_files(zip_buffer);
  if (!files.length) {
    throw new Error('Plugin ZIP did not contain any installable files.');
  }

  const { plugin_id, folder_name } = resolve_plugin_install_target({
    item: options.item || {},
    plugin_manifest: pluginManifest,
    fallback_plugin_id: options.fallback_plugin_id,
  });
  const base_folder = build_plugin_folder_path(folder_name, app.vault.configDir || '.obsidian');

  await write_files_with_adapter(app.vault.adapter, base_folder, files);
  await app.plugins.loadManifests?.();

  const loaded_plugin_id = resolve_loaded_plugin_id(app, plugin_id, folder_name);
  if (app.plugins.enabledPlugins?.has?.(loaded_plugin_id)) {
    await app.plugins.disablePlugin?.(loaded_plugin_id);
  }
  await enable_plugin(app, loaded_plugin_id);

  return {
    plugin_id: loaded_plugin_id,
    folder_name,
    base_folder,
    pluginManifest,
    files,
  };
}

/**
 * Naive semver comparison: returns true if serverVer > localVer.
 * @param {string} localVer
 * @param {string} serverVer
 * @returns {boolean}
 */
export function is_server_version_newer(localVer, serverVer) {
  if (!serverVer || serverVer === 'unknown') return false;
  const lv = localVer.replace(/[^\d.]/g, '');
  const sv = serverVer.replace(/[^\d.]/g, '');

  const la = lv.split('.').map(Number);
  const sa = sv.split('.').map(Number);
  for (let i = 0; i < Math.max(la.length, sa.length); i++) {
    const l = la[i] || 0;
    const s = sa[i] || 0;
    if (s > l) return true;
    if (s < l) return false;
  }
  return false;
}

/**
 * Fetch a plugin zip from an arbitrary URL (e.g., GitHub releases).
 *
 * @param {string} download_url
 * @param {Function} request_fn
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetch_zip_from_url(download_url, request_fn = default_request_url) {
  console.log(`[smart_plugins] download plugin from URL: ${download_url}`);
  const resp = await request_fn({
    url: download_url,
    method: 'GET',
    headers: { Accept: 'application/zip' },
  });

  if (resp.status && resp.status !== 200) {
    throw new Error(`Download error ${resp.status}: ${resp.text || ''}`);
  }

  return validate_zip_buffer(resp.arrayBuffer, 'Download');
}

/**
 * Persists the current enabled plugins to the configuration file.
 *
 * The configuration file is assumed to be "app.json" in the vault root. Its structure is:
 *
 * {
 *   "enabled_plugins": [ "plugin_id1", "plugin_id2", ... ]
 * }
 *
 * @param {object} app - The Obsidian app instance.
 * @param {string} plugin_id
 * @returns {Promise<void>}
 */
export async function enable_plugin(app, plugin_id) {
  if (!plugin_id) {
    throw new Error('Cannot enable plugin without a plugin id.');
  }
  await app.plugins.enablePlugin(plugin_id);
  app.plugins.enabledPlugins?.add?.(plugin_id);
  await app.plugins.requestSaveConfig?.();
  await app.plugins.loadManifests?.();
}
