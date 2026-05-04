import { ConnectionsItemView } from '../views/connections_item_view.js';
import { filter_hidden_results } from './filter_hidden_results.js';

export function create_smart_connections_api(plugin) {
  return {
    version: 1,
    getVisibleConnectionResults: (opts = {}) => get_visible_connection_results(plugin, opts),
    getVisibleConnectionPaths: async (opts = {}) => {
      const results = await get_visible_connection_results(plugin, opts);
      return results.map((result) => result.path).filter(Boolean);
    },
  };
}

async function get_visible_connection_results(plugin, opts = {}) {
  const leaves = plugin.app?.workspace?.getLeavesOfType?.(ConnectionsItemView.view_type) || [];
  const all_results = [];
  const seen = new Set();

  for (const leaf of leaves) {
    const view = leaf?.view;
    if (!view?.current) continue;
    const results = await get_connection_results_for_item(plugin, view.current, opts);
    for (const result of results) {
      if (!result.path || seen.has(result.path)) continue;
      seen.add(result.path);
      all_results.push(result);
    }
  }

  return all_results;
}

async function get_connection_results_for_item(plugin, source_item, opts = {}) {
  const env = plugin.env;
  if (!env?.connections_lists || !source_item) return [];

  const connections_list = source_item.connections || env.connections_lists.new_item(source_item);
  let results = Array.isArray(connections_list.results)
    ? connections_list.results
    : await connections_list.get_results({ ...(opts.results_params || {}) })
  ;

  if (!opts.include_hidden) {
    results = filter_hidden_results(results, source_item.data?.connections || {});
  }

  return results
    .map((result) => serialize_connection_result(result, source_item))
    .filter((result) => result.path)
  ;
}

function serialize_connection_result(result, source_item) {
  const item = result?.item;
  if (!item) return {};

  return {
    path: normalize_markdown_path(item.path),
    raw_path: item.path || '',
    link: item.link || '',
    key: item.key || '',
    collection_key: item.collection_key || '',
    score: Number(result.score) || 0,
    source_path: source_item?.path || '',
    source_key: source_item?.key || '',
  };
}

function normalize_markdown_path(path) {
  if (!path || typeof path !== 'string') return '';
  return path.endsWith('.md') ? path : `${path}.md`;
}
