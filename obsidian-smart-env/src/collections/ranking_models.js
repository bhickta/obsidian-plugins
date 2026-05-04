import base from 'smart-models/collections/ranking_models.js';
import cohere from 'smart-models/adapters/ranking/cohere.js';

base.providers = {
  cohere,
};

export default base;
