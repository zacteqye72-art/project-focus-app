const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * ContextSampler - Lightweight context sampling without frequent screenshots
 */
class ContextSampler {
  constructor() {
    this.lastSampleTime = 0;
    this.isActive = false;
    this.heartbeatInterval = null;
    this.HEARTBEAT_MINUTES = process.env.FOCUS_HEARTBEAT_MINUTES || 7;
    this.IDLE_SECONDS = process.env.FOCUS_IDLE_SECONDS || 45;
  }

  /**
   * Start context sampling
   */
  start() {
    this.isActive = true;
    this.setupHeartbeat();
    console.log('🔍 ContextSampler started');
  }

  /**
   * Stop context sampling
   */
  stop() {
    this.isActive = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    console.log('🔍 ContextSampler stopped');
  }

  /**
   * Setup periodic heartbeat sampling
   */
  setupHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(async () => {
      if (this.isActive) {
        try {
          await this.sampleContext('heartbeat');
        } catch (error) {
          console.warn('⚠️ Heartbeat sampling failed:', error.message);
        }
      }
    }, this.HEARTBEAT_MINUTES * 60 * 1000);
  }

  /**
   * Sample context at milestone events
   * @param {string} trigger - Event trigger type
   * @returns {Promise<Sample|null>}
   */
  async sampleContext(trigger = 'manual') {
    if (!this.isActive) return null;

    try {
      console.log(`🔍 Sampling context (trigger: ${trigger})`);
      
      // Get current app and window info
      const appInfo = await this.getCurrentAppInfo();
      if (!appInfo) return null;

      // Extract entities from available text
      const entities = await this.extractEntities(appInfo);
      
      const sample = {
        ts: Date.now(),
        appId: appInfo.appId,
        windowTitle: appInfo.windowTitle,
        urlDomain: appInfo.urlDomain,
        docId: appInfo.docId,
        entities: entities,
        recentSnippet: appInfo.recentSnippet,
        trigger: trigger
      };

      this.lastSampleTime = sample.ts;
      console.log(`✅ Context sampled: ${entities.length} entities from ${appInfo.appId}`);
      
      return sample;
    } catch (error) {
      console.error('❌ Context sampling failed:', error);
      return null;
    }
  }

  /**
   * Get current application and window information
   * @returns {Promise<Object|null>}
   */
  async getCurrentAppInfo() {
    try {
      // Get frontmost app info
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set appId to bundle identifier of frontApp
          try
            set windowTitle to name of front window of frontApp
          on error
            set windowTitle to ""
          end try
          return appId & "|||" & appName & "|||" & windowTitle
        end tell
      `;

      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [appId, appName, windowTitle] = stdout.trim().split('|||');

      const appInfo = {
        appId: appId || appName,
        appName,
        windowTitle: windowTitle || '',
      };

      // Get browser-specific info if it's a browser
      if (this.isBrowser(appId)) {
        const browserInfo = await this.getBrowserInfo(appId);
        if (browserInfo) {
          appInfo.urlDomain = browserInfo.domain;
          appInfo.docId = browserInfo.url;
          appInfo.recentSnippet = browserInfo.title;
        }
      }

      // Try to get document path for editors/IDEs
      if (this.isEditor(appId)) {
        appInfo.docId = await this.getDocumentPath(windowTitle);
      }

      return appInfo;
    } catch (error) {
      console.warn('⚠️ Failed to get app info:', error.message);
      return null;
    }
  }

  /**
   * Get browser-specific information
   * @param {string} appId - Browser app ID
   * @returns {Promise<Object|null>}
   */
  async getBrowserInfo(appId) {
    try {
      let script = '';
      
      if (appId.includes('chrome') || appId.includes('Chrome')) {
        script = `
          tell application "Google Chrome"
            if (count of windows) > 0 then
              set activeTab to active tab of front window
              return URL of activeTab & "|||" & title of activeTab
            end if
          end tell
        `;
      } else if (appId.includes('safari') || appId.includes('Safari')) {
        script = `
          tell application "Safari"
            if (count of windows) > 0 then
              set activeTab to current tab of front window
              return URL of activeTab & "|||" & name of activeTab
            end if
          end tell
        `;
      } else {
        return null;
      }

      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [url, title] = stdout.trim().split('|||');
      
      if (url && url !== 'missing value') {
        const urlObj = new URL(url);
        return {
          url: url,
          domain: urlObj.hostname,
          title: title || ''
        };
      }
    } catch (error) {
      console.warn('⚠️ Failed to get browser info:', error.message);
    }
    
    return null;
  }

  /**
   * Extract document path from window title
   * @param {string} windowTitle 
   * @returns {Promise<string|null>}
   */
  async getDocumentPath(windowTitle) {
    if (!windowTitle) return null;
    
    // Common patterns for file paths in window titles
    const pathPatterns = [
      /([\/~][^\s]+\.[a-zA-Z0-9]+)/, // Unix-style paths with extensions
      /([A-Z]:\\[^\s]+\.[a-zA-Z0-9]+)/, // Windows paths
      /([^\/\s]+\.[a-zA-Z0-9]+)/, // Just filename with extension
    ];

    for (const pattern of pathPatterns) {
      const match = windowTitle.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract entities from app info
   * @param {Object} appInfo 
   * @returns {Promise<string[]>}
   */
  async extractEntities(appInfo) {
    const entities = new Set();
    
    // Extract from window title
    if (appInfo.windowTitle) {
      const titleEntities = this.extractFromText(appInfo.windowTitle);
      titleEntities.forEach(entity => entities.add(entity));
    }

    // Extract from URL domain
    if (appInfo.urlDomain) {
      entities.add(appInfo.urlDomain);
    }

    // Extract from document path
    if (appInfo.docId) {
      const pathEntities = this.extractFromText(appInfo.docId);
      pathEntities.forEach(entity => entities.add(entity));
    }

    // Try to get more context via accessibility API
    try {
      const accessibilityText = await this.getAccessibilityText();
      if (accessibilityText) {
        const textEntities = this.extractFromText(accessibilityText);
        textEntities.forEach(entity => entities.add(entity));
        
        // Store snippet for context
        appInfo.recentSnippet = accessibilityText.slice(0, 200);
      }
    } catch (error) {
      console.warn('⚠️ Accessibility text extraction failed:', error.message);
    }

    // Filter and limit entities
    const filteredEntities = Array.from(entities)
      .filter(entity => entity.length >= 3 && entity.length <= 40)
      .slice(0, 12);

    return filteredEntities;
  }

  /**
   * Extract entities from text using patterns
   * @param {string} text 
   * @returns {string[]}
   */
  extractFromText(text) {
    if (!text) return [];
    
    const entities = new Set();
    
    // Patterns for different entity types
    const patterns = [
      // Camel case (variables, functions)
      /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g,
      // Snake case
      /\b[a-z][a-z0-9_]*[a-z0-9]\b/g,
      // Function calls
      /\b[a-zA-Z_][a-zA-Z0-9_]*\(/g,
      // File extensions
      /\b[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,4}\b/g,
      // Capitalized words (titles, headers)
      /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
      // URLs/domains
      /\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    ];

    patterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      matches.forEach(match => {
        const cleaned = match.replace(/[()]/g, '').trim();
        if (cleaned.length >= 3 && cleaned.length <= 40) {
          entities.add(cleaned);
        }
      });
    });

    return Array.from(entities);
  }

  /**
   * Get text via macOS Accessibility API
   * @returns {Promise<string|null>}
   */
  async getAccessibilityText() {
    try {
      const script = `
        tell application "System Events"
          try
            set focusedElement to focused element of (first application process whose frontmost is true)
            set elementValue to value of focusedElement
            if elementValue is not missing value then
              return elementValue as string
            end if
          on error
            return ""
          end try
        end tell
      `;

      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const text = stdout.trim();
      
      return text && text !== 'missing value' ? text : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if app is a browser
   * @param {string} appId 
   * @returns {boolean}
   */
  isBrowser(appId) {
    const browserIds = [
      'com.google.Chrome',
      'com.apple.Safari',
      'org.mozilla.firefox',
      'com.microsoft.edgemac',
      'com.operasoftware.Opera'
    ];
    return browserIds.some(id => appId.includes(id));
  }

  /**
   * Check if app is an editor/IDE
   * @param {string} appId 
   * @returns {boolean}
   */
  isEditor(appId) {
    const editorIds = [
      'com.microsoft.VSCode',
      'com.apple.dt.Xcode',
      'com.jetbrains',
      'com.sublimetext',
      'com.github.atom',
      'org.vim.MacVim'
    ];
    return editorIds.some(id => appId.includes(id));
  }

  /**
   * Sample context on milestone events
   * @param {string} eventType - Type of milestone event
   */
  async onMilestoneEvent(eventType) {
    console.log(`🎯 Milestone event: ${eventType}`);
    return await this.sampleContext(eventType);
  }

  /**
   * Sample context on idle to active transition
   */
  async onIdleToActive() {
    console.log('🔄 Idle to active transition');
    return await this.sampleContext('idle_to_active');
  }
}

module.exports = ContextSampler;
