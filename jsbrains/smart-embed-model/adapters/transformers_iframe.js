import { SmartEmbedIframeAdapter } from "./iframe.js";
import { transformers_connector } from "../connectors/transformers_iframe.js";
import {
  transformers_defaults,
  transformers_settings_config, // DEPRECATED
  transformers_models,
  settings_config,
  get_configured_transformers_batch_size,
  get_transformers_auto_batch_size,
} from "./transformers.js";
/**
 * Adapter for running transformer models in an iframe
 * Combines transformer model capabilities with iframe isolation
 * @extends SmartEmbedIframeAdapter
 */
export class SmartEmbedTransformersIframeAdapter extends SmartEmbedIframeAdapter {
  static defaults = transformers_defaults;
  /**
   * Create transformers iframe adapter instance
   */
  constructor(model) {
    super(model);
    /** @type {string} Connector script content */
    this.connector = transformers_connector
      .replace('@huggingface/transformers', 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0')
    ;
    console.debug('transformers iframe connector', this.model);
  }

  /** @returns {Object} Settings configuration for transformers adapter */
  get settings_config() {
    return {
      ...super.settings_config,
      ...transformers_settings_config
    };
  }
  /**
   * Get available models (hardcoded list)
   * @returns {Promise<Object>} Map of model objects
   */
  get_models() { return Promise.resolve(this.models); }
  get models() {
    return transformers_models;
  }

  get batch_size() {
    return get_configured_transformers_batch_size(this.model)
      || get_transformers_auto_batch_size(this.gpu_likely_available)
    ;
  }

  get gpu_likely_available() {
    if (this.model?.data?.use_gpu === false) return false;
    return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
  }
}
export { settings_config };
export default {
  class: SmartEmbedTransformersIframeAdapter,
  settings_config,
}
