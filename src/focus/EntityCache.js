/**
 * EntityCache - Ring buffer for recent context samples with confidence scoring
 */
class EntityCache {
  constructor() {
    this.samples = [];
    this.maxSamples = process.env.FOCUS_SAMPLE_RING || 8;
    this.confidenceHigh = parseFloat(process.env.FOCUS_CONFIDENCE_HIGH) || 0.7;
    this.confidenceMedium = parseFloat(process.env.FOCUS_CONFIDENCE_MEDIUM) || 0.4;
    this.maxAgeMinutes = 12; // Samples older than 12 minutes are considered stale
  }

  /**
   * Add a new sample to the cache
   * @param {Sample} sample 
   */
  addSample(sample) {
    if (!sample || !sample.appId) {
      console.warn('⚠️ Invalid sample provided to EntityCache');
      return;
    }

    // Check if we should merge with existing sample from same source
    const existingIndex = this.findSimilarSample(sample);
    
    if (existingIndex !== -1) {
      // Merge entities with existing sample
      const existing = this.samples[existingIndex];
      const mergedEntities = this.mergeEntities(existing.entities, sample.entities);
      
      this.samples[existingIndex] = {
        ...sample,
        entities: mergedEntities,
        mergedCount: (existing.mergedCount || 0) + 1
      };
      
      console.log(`🔗 Merged sample with existing (${mergedEntities.length} entities)`);
    } else {
      // Add new sample
      this.samples.unshift(sample);
      
      // Keep only maxSamples
      if (this.samples.length > this.maxSamples) {
        this.samples = this.samples.slice(0, this.maxSamples);
      }
      
      console.log(`📝 Added new sample to cache (${this.samples.length}/${this.maxSamples})`);
    }

    this.cleanStaleEntries();
  }

  /**
   * Get the most recent sample
   * @returns {Sample|null}
   */
  getMostRecent() {
    this.cleanStaleEntries();
    return this.samples.length > 0 ? this.samples[0] : null;
  }

  /**
   * Get all recent samples
   * @returns {Sample[]}
   */
  getAllRecent() {
    this.cleanStaleEntries();
    return [...this.samples];
  }

  /**
   * Calculate confidence level for current context vs cached samples
   * @param {CurrentMeta} currentMeta 
   * @returns {{confidence: 'HIGH'|'MEDIUM'|'LOW', score: number, sample: Sample|null}}
   */
  matchConfidence(currentMeta) {
    if (!currentMeta || this.samples.length === 0) {
      return { confidence: 'LOW', score: 0, sample: null };
    }

    const mostRecent = this.getMostRecent();
    if (!mostRecent) {
      return { confidence: 'LOW', score: 0, sample: null };
    }

    // Check if sample is too old
    const ageMinutes = (Date.now() - mostRecent.ts) / (1000 * 60);
    if (ageMinutes > this.maxAgeMinutes) {
      return { confidence: 'LOW', score: 0, sample: mostRecent };
    }

    const score = this.calculateSimilarityScore(currentMeta, mostRecent);
    
    let confidence;
    if (score >= this.confidenceHigh) {
      confidence = 'HIGH';
    } else if (score >= this.confidenceMedium) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }

    console.log(`🎯 Confidence: ${confidence} (score: ${score.toFixed(2)})`);
    
    return { confidence, score, sample: mostRecent };
  }

  /**
   * Calculate similarity score between current context and cached sample
   * @param {CurrentMeta} current 
   * @param {Sample} sample 
   * @returns {number} Score between 0 and 1
   */
  calculateSimilarityScore(current, sample) {
    let score = 0;

    // App ID match (50% weight)
    if (current.appId === sample.appId) {
      score += 0.5;
    }

    // Title similarity (30% weight)
    if (current.windowTitle && sample.windowTitle) {
      const titleSim = this.calculateTextSimilarity(current.windowTitle, sample.windowTitle);
      score += 0.3 * titleSim;
    }

    // URL domain match (20% weight)
    if (current.urlDomain && sample.urlDomain) {
      if (current.urlDomain === sample.urlDomain) {
        score += 0.2;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Calculate text similarity using token Jaccard similarity
   * @param {string} text1 
   * @param {string} text2 
   * @returns {number} Similarity score between 0 and 1
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;

    const tokens1 = new Set(this.tokenize(text1.toLowerCase()));
    const tokens2 = new Set(this.tokenize(text2.toLowerCase()));

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Tokenize text into words
   * @param {string} text 
   * @returns {string[]}
   */
  tokenize(text) {
    return text.match(/\b\w+\b/g) || [];
  }

  /**
   * Find similar sample in cache
   * @param {Sample} sample 
   * @returns {number} Index of similar sample, or -1 if not found
   */
  findSimilarSample(sample) {
    return this.samples.findIndex(existing => {
      // Same app and similar window title/URL
      if (existing.appId !== sample.appId) return false;
      
      if (sample.windowTitle && existing.windowTitle) {
        const similarity = this.calculateTextSimilarity(sample.windowTitle, existing.windowTitle);
        if (similarity > 0.7) return true;
      }
      
      if (sample.urlDomain && existing.urlDomain) {
        return sample.urlDomain === existing.urlDomain;
      }
      
      if (sample.docId && existing.docId) {
        return sample.docId === existing.docId;
      }
      
      return false;
    });
  }

  /**
   * Merge entities from two samples, removing duplicates
   * @param {string[]} entities1 
   * @param {string[]} entities2 
   * @returns {string[]}
   */
  mergeEntities(entities1, entities2) {
    const merged = new Set([...entities1, ...entities2]);
    return Array.from(merged).slice(0, 12); // Limit to 12 entities
  }

  /**
   * Remove stale entries from cache
   */
  cleanStaleEntries() {
    const now = Date.now();
    const maxAge = this.maxAgeMinutes * 60 * 1000;
    
    const beforeCount = this.samples.length;
    this.samples = this.samples.filter(sample => (now - sample.ts) < maxAge);
    
    if (this.samples.length < beforeCount) {
      console.log(`🧹 Cleaned ${beforeCount - this.samples.length} stale entries from cache`);
    }
  }

  /**
   * Clear all cached samples
   */
  clear() {
    this.samples = [];
    console.log('🗑️ EntityCache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    this.cleanStaleEntries();
    
    const totalEntities = this.samples.reduce((sum, sample) => sum + sample.entities.length, 0);
    const appTypes = new Set(this.samples.map(s => s.appId));
    
    return {
      sampleCount: this.samples.length,
      totalEntities,
      uniqueApps: appTypes.size,
      oldestSampleAge: this.samples.length > 0 ? 
        Math.round((Date.now() - this.samples[this.samples.length - 1].ts) / (1000 * 60)) : 0
    };
  }

  /**
   * Debug: Print current cache state
   */
  debug() {
    console.log('📊 EntityCache Debug:');
    console.log(`  Samples: ${this.samples.length}/${this.maxSamples}`);
    
    this.samples.forEach((sample, i) => {
      const age = Math.round((Date.now() - sample.ts) / (1000 * 60));
      console.log(`  [${i}] ${sample.appId} (${age}min ago) - ${sample.entities.length} entities`);
      if (sample.entities.length > 0) {
        console.log(`      Entities: ${sample.entities.slice(0, 3).join(', ')}${sample.entities.length > 3 ? '...' : ''}`);
      }
    });
  }
}

module.exports = EntityCache;
