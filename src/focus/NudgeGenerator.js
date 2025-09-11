const { postCheck, getFallbackMessage, detailedPostCheck } = require('./postCheck');

/**
 * NudgeGenerator - Generate context-aware nudge messages using LLM
 */
class NudgeGenerator {
  constructor(aiCaller) {
    this.aiCaller = aiCaller; // Function to call AI (from main process)
    this.maxRetries = 2;
    this.lastNudgeTime = 0;
    this.cooldownMinutes = process.env.FOCUS_NUDGE_COOLDOWN_MINUTES || 4;
    this.maxNudgesPerSession = process.env.FOCUS_MAX_NUDGE_PER_SESSION || 1;
    this.sessionNudgeCount = 0;
  }

  /**
   * Generate a nudge message
   * @param {string} workContext - User's work context
   * @param {EntityCache} cache - Entity cache instance
   * @param {CurrentMeta} currentMeta - Current app/window metadata
   * @returns {Promise<string>}
   */
  async generate(workContext, cache, currentMeta) {
    try {
      // Check cooldown
      if (!this.canGenerateNudge()) {
        console.log('🚫 Nudge generation blocked by cooldown or session limit');
        return null;
      }

      console.log('🎯 Generating nudge message...');
      
      // Get confidence and most recent sample
      const { confidence, sample } = cache.matchConfidence(currentMeta);
      
      console.log(`📊 Context confidence: ${confidence}`);
      if (sample) {
        console.log(`📝 Using sample: ${sample.entities.length} entities from ${sample.appId}`);
      }

      // Generate with retries
      let nudgeMessage = null;
      let attempts = 0;
      
      while (attempts <= this.maxRetries && !nudgeMessage) {
        attempts++;
        console.log(`🔄 Generation attempt ${attempts}/${this.maxRetries + 1}`);
        
        try {
          const generated = await this.generateWithAI(workContext, sample, confidence);
          
          if (this.validateNudge(generated, sample?.entities || [], confidence)) {
            nudgeMessage = generated;
            break;
          } else {
            console.warn(`❌ Attempt ${attempts} failed validation`);
          }
        } catch (error) {
          console.error(`❌ Generation attempt ${attempts} failed:`, error.message);
        }
      }

      // Use fallback if all attempts failed
      if (!nudgeMessage) {
        console.log('🔄 All attempts failed, using fallback message');
        nudgeMessage = getFallbackMessage();
      }

      // Update tracking
      this.lastNudgeTime = Date.now();
      this.sessionNudgeCount++;

      console.log(`✅ Generated nudge: "${nudgeMessage}"`);
      return nudgeMessage;

    } catch (error) {
      console.error('❌ Nudge generation failed:', error);
      return getFallbackMessage();
    }
  }

  /**
   * Generate nudge using AI
   * @param {string} workContext 
   * @param {Sample|null} sample 
   * @param {'HIGH'|'MEDIUM'|'LOW'} confidence 
   * @returns {Promise<string>}
   */
  async generateWithAI(workContext, sample, confidence) {
    const systemPrompt = `You output exactly ONE sentence in this format:
Your attention score is decreasing, you can try to [ACTION]
[ACTION] ≤ 15 words and, when CONFIDENCE is HIGH or MEDIUM, MUST include at least ONE exact phrase from ENTITIES.
Use concrete doing verbs only: add, cite, define, compute, refactor, write, test, summarize, compare, outline, link, format.
Forbidden verbs/phrases: think about, consider, brainstorm, plan, continue, improve, work on, review, revisit.
Do NOT mention images, screenshots, analysis, user, or document. No explanations. No quotes. No extra text.`;

    const userPrompt = `Work context: ${workContext}
CONFIDENCE: ${confidence}
ENTITIES: ${JSON.stringify(sample?.entities || [])}
RECENT_SNIPPET: ${sample?.recentSnippet || ""}`;

    console.log('🤖 Calling AI for nudge generation...');
    console.log(`📝 Entities available: ${sample?.entities?.length || 0}`);
    console.log(`🎯 Confidence level: ${confidence}`);

    // Call AI through the provided function
    const response = await this.aiCaller([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    if (!response || !response.content) {
      throw new Error('AI returned empty response');
    }

    let generated = response.content.trim();
    
    // Clean up common AI response artifacts
    generated = generated.replace(/^["']|["']$/g, ''); // Remove quotes
    generated = generated.replace(/\n.*$/s, ''); // Take only first line
    
    console.log(`🤖 AI generated: "${generated}"`);
    return generated;
  }

  /**
   * Validate generated nudge
   * @param {string} nudge 
   * @param {string[]} entities 
   * @param {'HIGH'|'MEDIUM'|'LOW'} confidence 
   * @returns {boolean}
   */
  validateNudge(nudge, entities, confidence) {
    const validation = detailedPostCheck(nudge, entities, confidence);
    
    if (!validation.passed) {
      console.warn('❌ Nudge validation failed:');
      validation.issues.forEach(issue => console.warn(`  - ${issue}`));
      return false;
    }

    return true;
  }

  /**
   * Check if we can generate a nudge (cooldown and session limits)
   * @returns {boolean}
   */
  canGenerateNudge() {
    const now = Date.now();
    const timeSinceLastNudge = (now - this.lastNudgeTime) / (1000 * 60); // minutes

    // Check session limit
    if (this.sessionNudgeCount >= this.maxNudgesPerSession) {
      return false;
    }

    // Check cooldown
    if (timeSinceLastNudge < this.cooldownMinutes) {
      return false;
    }

    return true;
  }

  /**
   * Reset session counters
   */
  resetSession() {
    this.sessionNudgeCount = 0;
    this.lastNudgeTime = 0;
    console.log('🔄 NudgeGenerator session reset');
  }

  /**
   * Get generation statistics
   * @returns {Object}
   */
  getStats() {
    const now = Date.now();
    const timeSinceLastNudge = this.lastNudgeTime > 0 ? 
      Math.round((now - this.lastNudgeTime) / (1000 * 60)) : null;

    return {
      sessionNudgeCount: this.sessionNudgeCount,
      maxNudgesPerSession: this.maxNudgesPerSession,
      canGenerateNow: this.canGenerateNudge(),
      minutesSinceLastNudge: timeSinceLastNudge,
      cooldownMinutes: this.cooldownMinutes
    };
  }

  /**
   * Force generate a nudge (bypass cooldown for testing)
   * @param {string} workContext 
   * @param {EntityCache} cache 
   * @param {CurrentMeta} currentMeta 
   * @returns {Promise<string>}
   */
  async forceGenerate(workContext, cache, currentMeta) {
    const originalCooldown = this.cooldownMinutes;
    const originalCount = this.sessionNudgeCount;
    
    // Temporarily bypass limits
    this.cooldownMinutes = 0;
    this.sessionNudgeCount = 0;
    
    try {
      const result = await this.generate(workContext, cache, currentMeta);
      return result;
    } finally {
      // Restore original limits
      this.cooldownMinutes = originalCooldown;
      this.sessionNudgeCount = originalCount;
    }
  }
}

module.exports = NudgeGenerator;
