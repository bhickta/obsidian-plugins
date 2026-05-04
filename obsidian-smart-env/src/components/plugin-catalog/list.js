import styles from './style.css';

const PLUGINS_DESC = `Install and manage Smart Plugins. Advanced configuration, local/cloud model providers, inline/footer connections, and context tooling are available without account login.`;
const PLUGINS_FOOTER = `These entries use direct Obsidian/community links. Provider integrations use your own API keys with the selected platform.`;

function derive_builtin_plugins() {
  return [
    {
      name: 'Smart Chat',
      description: 'Configure chat to use Local and Cloud API providers (Ollama, LM Studio, OpenAI, Gemini, Anthropic, Open Router, and more).',
      manifest_id: 'smart-chatgpt',
      core_id: 'smart-chatgpt',
      url: 'https://smartconnections.app/smart-chat/',
      docs_url: 'https://smartconnections.app/smart-chat/',
    },
    {
      name: 'Smart Connections',
      description: 'AI-powered connections with graph, inline, footer, configurable algorithms, and additional embedding model providers.',
      manifest_id: 'smart-connections',
      core_id: 'smart-connections',
      url: 'https://smartconnections.app/smart-connections/',
      docs_url: 'https://smartconnections.app/smart-connections/',
    },
    {
      name: 'Smart Context',
      description: 'Advanced tools for context engineering. Utilize Bases, images, and external sources (great for coders!) in your contexts.',
      manifest_id: 'smart-context',
      core_id: 'smart-context',
      url: 'https://smartconnections.app/smart-context/',
      docs_url: 'https://smartconnections.app/smart-context/',
    },
  ];
}

export function build_html(env, params = {}) {
  return `
    <div class="plugins-catalog-container setting-item-heading">
      <div class="setting-group">
        <div class="setting-item setting-item-heading">
          <div class="setting-item-name plugins-catalog-heading">Smart Plugins</div>
        </div>
        <p>${PLUGINS_DESC}</p>
        <div class="setting-items plugins-catalog-list">
        </div>
        <p>${PLUGINS_FOOTER}</p>
      </div>
    </div>
  `;
}

export async function render(env, params = {}) {
  this.apply_style_sheet(styles);
  const html = build_html.call(this, env, params);
  const frag = this.create_doc_fragment(html);
  const container = frag.firstElementChild;
  await post_process.call(this, env, container, params);
  return container;
}

export async function post_process(env, container, params = {}) {
  const plugin = env.plugin || null;
  const app = plugin?.app || window.app;
  const list_el = container.querySelector('.plugins-catalog-list');

  const empty_container = (el) => {
    if (!el) return;
    if (typeof this.empty === 'function') {
      this.empty(el);
      return;
    }
    el.innerHTML = '';
  };

  const get_installed_info = async () => {
    const installed_map = {};
    let { manifests } = app.plugins;
    while (Object.keys(manifests).length === 0) {
      manifests = app.plugins.manifests;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const plugin_id in manifests) {
      if (!Object.prototype.hasOwnProperty.call(manifests, plugin_id)) continue;
      const { name, version } = manifests[plugin_id];
      installed_map[plugin_id] = { name, version };
    }
    return installed_map;
  };

  const render_catalog_section = async () => {
    empty_container(list_el);
    const installed_map = await get_installed_info();
    const list = derive_builtin_plugins();

    for (const item of list) {
      const row = await env.smart_components.render_component("plugin_catalog_list_item", item, {
        env,
        app,
        installed_map,
        on_installed: render_catalog_section,
      });
      list_el.appendChild(row);
    }
  };

  await render_catalog_section();
  return container;
}
