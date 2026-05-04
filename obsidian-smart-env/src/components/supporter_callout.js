import { getIcon } from "obsidian";
export function build_html(plugin, opts={}) {
  const {plugin_name = plugin.manifest.name} = opts;
  return `<div class="wrapper">
    <div id="footer-callout" data-callout-metadata="" data-callout-fold="" data-callout="info" class="callout" style="mix-blend-mode: unset;">
      <div class="callout-title" style="align-items: center;">
        <div class="callout-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-info">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
          </svg>
        </div>
        <div class="callout-title-inner"><strong>Support Smart Plugins</strong></div>
      </div>
      <div class="callout-content">
        <p>All Smart Plugin features are available without a paid unlock. Contributions help maintain direct provider integrations, documentation, and compatibility with Obsidian releases.</p>
        <p>Supporter community benefits:
          <ul>
            <li>Private discussions</li>
            <li>Share workflows</li>
            <li>Help prioritize maintenance and improvements</li>
          </ul>
        </p>
        <p><i>Your support shapes the future of ${plugin_name}.</i></p>
        <p>
          <a href="https://smartconnections.app/community-supporters?utm_source=obsidian-${plugin_name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}" class="button" target="_external">Support the project</a>
        </p>
      </div>
    </div>
  </div>`;
}

export function render(plugin, opts={}) {
  const html = build_html.call(this, plugin, opts);
  const frag = this.create_doc_fragment(html);
  const container = frag.querySelector('.wrapper');
  post_process.call(this, plugin, container, opts);
  return container;
}

async function post_process(plugin, container) {
  const icon_container = container.querySelector('.callout-icon');
  const icon = getIcon('hand-heart');
  if (icon) {
    this.empty(icon_container);
    icon_container.appendChild(icon);
  }
  await this.render_setting_components(container, { scope: plugin.env });
}
