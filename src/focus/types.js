// Type definitions for the focus nudge system

/**
 * @typedef {Object} Sample
 * @property {number} ts - Timestamp in epoch ms
 * @property {string} appId - Bundle ID or process name
 * @property {string} [windowTitle] - Window title if available
 * @property {string} [urlDomain] - URL domain for browsers
 * @property {string} [docId] - Document ID or file path
 * @property {string[]} entities - Extracted entities (≤12 items, 3-40 chars each)
 * @property {string} [recentSnippet] - Recent text snippet (1-2 sentences or 5-10 lines of code)
 */

/**
 * @typedef {Object} CurrentMeta
 * @property {string} appId
 * @property {string} [windowTitle]
 * @property {string} [urlDomain]
 * @property {string} [docId]
 */

/**
 * @typedef {'HIGH'|'MEDIUM'|'LOW'} ConfidenceLevel
 */

module.exports = {};
