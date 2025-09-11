/**
 * Post-check validation for nudge messages
 */

const FORBIDDEN = /\b(think about|consider|brainstorm|plan|continue|improve|work on|review|revisit)\b/i;

/**
 * Validate nudge output against strict rules
 * @param {string} output - Generated nudge message
 * @param {string[]} entities - Available entities from context
 * @param {'HIGH'|'MEDIUM'|'LOW'} confidence - Confidence level
 * @returns {boolean} True if output passes all checks
 */
function postCheck(output, entities, confidence) {
  if (!output || typeof output !== 'string') {
    console.warn('❌ PostCheck: Invalid output type');
    return false;
  }

  const prefix = "Your attention score is decreasing, you can try to ";
  
  // Check prefix
  if (!output.startsWith(prefix)) {
    console.warn('❌ PostCheck: Missing required prefix');
    return false;
  }

  // Extract action part
  const tail = output.slice(prefix.length).trim();
  if (!tail) {
    console.warn('❌ PostCheck: Empty action part');
    return false;
  }

  // Check word count (≤15 words after "try to")
  const words = tail.split(/\s+/).filter(Boolean);
  if (words.length > 15) {
    console.warn(`❌ PostCheck: Too many words (${words.length} > 15)`);
    return false;
  }

  // Check for forbidden phrases
  if (FORBIDDEN.test(output)) {
    console.warn('❌ PostCheck: Contains forbidden phrases');
    return false;
  }

  // For HIGH/MEDIUM confidence, must contain at least one entity
  if (confidence !== 'LOW' && entities && entities.length > 0) {
    const hasEntity = entities.some(entity => {
      if (entity.length < 3) return false;
      return output.toLowerCase().includes(entity.toLowerCase());
    });
    
    if (!hasEntity) {
      console.warn(`❌ PostCheck: No entity found in output (confidence: ${confidence})`);
      return false;
    }
  }

  console.log(`✅ PostCheck: Passed (${words.length} words, confidence: ${confidence})`);
  return true;
}

/**
 * Get fallback message for when generation fails
 * @returns {string}
 */
function getFallbackMessage() {
  return "Your attention score is decreasing, you can try to re-read the last line and add one detail.";
}

/**
 * Extract action verbs from text for validation
 * @param {string} text 
 * @returns {string[]}
 */
function extractActionVerbs(text) {
  const actionVerbs = [
    'add', 'cite', 'define', 'compute', 'refactor', 'write', 'test', 
    'summarize', 'compare', 'outline', 'link', 'format', 'create',
    'update', 'fix', 'implement', 'document', 'analyze', 'optimize'
  ];
  
  const words = text.toLowerCase().split(/\s+/);
  return actionVerbs.filter(verb => words.includes(verb));
}

/**
 * Validate that the message uses concrete doing verbs
 * @param {string} output 
 * @returns {boolean}
 */
function hasConcreteVerbs(output) {
  const actionVerbs = extractActionVerbs(output);
  return actionVerbs.length > 0;
}

/**
 * Enhanced post-check with detailed validation
 * @param {string} output 
 * @param {string[]} entities 
 * @param {'HIGH'|'MEDIUM'|'LOW'} confidence 
 * @returns {{passed: boolean, issues: string[]}}
 */
function detailedPostCheck(output, entities, confidence) {
  const issues = [];

  if (!output || typeof output !== 'string') {
    issues.push('Invalid output type');
    return { passed: false, issues };
  }

  const prefix = "Your attention score is decreasing, you can try to ";
  
  if (!output.startsWith(prefix)) {
    issues.push('Missing required prefix');
  }

  const tail = output.slice(prefix.length).trim();
  if (!tail) {
    issues.push('Empty action part');
  }

  const words = tail.split(/\s+/).filter(Boolean);
  if (words.length > 15) {
    issues.push(`Too many words (${words.length} > 15)`);
  }

  if (FORBIDDEN.test(output)) {
    issues.push('Contains forbidden phrases');
  }

  if (!hasConcreteVerbs(output)) {
    issues.push('No concrete action verbs found');
  }

  if (confidence !== 'LOW' && entities && entities.length > 0) {
    const hasEntity = entities.some(entity => {
      if (entity.length < 3) return false;
      return output.toLowerCase().includes(entity.toLowerCase());
    });
    
    if (!hasEntity) {
      issues.push(`No entity found (confidence: ${confidence})`);
    }
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

module.exports = {
  postCheck,
  getFallbackMessage,
  extractActionVerbs,
  hasConcreteVerbs,
  detailedPostCheck,
  FORBIDDEN
};
