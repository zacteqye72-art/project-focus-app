const { app, BrowserWindow, nativeTheme, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const { execFile, exec } = require('child_process');
const Store = require('electron-store');
const https = require('https');
const fs = require('fs');

// 尝试加载本地配置文件
let defaultConfig = {};
try {
  const configPath = path.join(__dirname, '..', 'config.js');
  delete require.cache[configPath]; // 清除缓存，确保重新加载
  defaultConfig = require(configPath);
  console.log('✅ 配置文件加载成功:', defaultConfig);
} catch (e) {
  console.log('⚠️ 配置文件不存在，使用空配置:', e.message);
}

let dynamicIslandWindow = null;
let distractionAlertWindow = null;

function showDistractionAlert() {
  try {
    if (distractionAlertWindow && !distractionAlertWindow.isDestroyed()) {
      distractionAlertWindow.show();
      distractionAlertWindow.focus();
      return;
    }
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    distractionAlertWindow = new BrowserWindow({
      width: 420,
      height: 180,
      x: Math.round((sw - 420) / 2),
      y: Math.round((sh - 180) / 2),
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      backgroundColor: '#FFFFFF',
      show: true,
      // Prevent focusing main window when alert closes
      parent: null, // Don't set parent to avoid focus transfer
      modal: false, // Not modal to avoid blocking
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    distractionAlertWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    distractionAlertWindow.setAlwaysOnTop(true, 'screen-saver');
    distractionAlertWindow.loadFile(path.join(__dirname, '..', 'src', 'alert.html'));
    
    // Handle window close to prevent main window activation
    distractionAlertWindow.on('closed', () => {
      distractionAlertWindow = null;
      
      // Prevent main window from gaining focus
      setTimeout(() => {
        const mainWindow = BrowserWindow.getAllWindows().find(win => 
          win !== dynamicIslandWindow && !win.isDestroyed()
        );
        if (mainWindow && mainWindow.isFocused()) {
          // If main window somehow got focus, blur it
          mainWindow.blur();
          console.log('🔇 Prevented main window from gaining focus after alert dismissal');
        }
      }, 100);
    });
    
    // Handle blur events to prevent unwanted focus changes
    distractionAlertWindow.on('blur', () => {
      // Keep alert focused when it loses focus unless it's being closed
      if (distractionAlertWindow && !distractionAlertWindow.isDestroyed()) {
        setTimeout(() => {
          if (distractionAlertWindow && !distractionAlertWindow.isDestroyed()) {
            distractionAlertWindow.focus();
          }
        }, 50);
      }
    });
    
  } catch (e) {
    console.warn('⚠️ Failed to show always-on-top alert window:', e?.message || e);
  }
}

function createDynamicIslandWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  
  dynamicIslandWindow = new BrowserWindow({
    width: 320,
    height: 50,
    x: Math.round(screenWidth / 2 - 160), // Center horizontally
    y: 10, // Top of screen
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Create a separate HTML file for the Dynamic Island
  dynamicIslandWindow.loadFile(path.join(__dirname, '..', 'src', 'island.html'));
  
  // Make window click-through initially
  dynamicIslandWindow.setIgnoreMouseEvents(false);
  
  return dynamicIslandWindow;
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 880,
    minHeight: 560,
    title: 'Project Focus',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Only open dev tools if explicitly requested via environment variable
  if (!app.isPackaged && process.env.OPEN_DEV_TOOLS === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  return mainWindow;
}

app.setName('Project Focus');
app.setAppUserModelId('com.projectfocus.app');

app.whenReady().then(() => {
  createMainWindow();
  createDynamicIslandWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createDynamicIslandWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('🔄 All windows closed, cleaning up...');
  cleanupAllMonitoring();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Activity monitoring (macOS via AppleScript) ---
let monitoringInterval = null;
const monitoringState = {
  privacy: false,
  rules: { keywords: [] },
  lastClassification: 'unknown',
};

function runAppleScript(lines, callback) {
  const args = [];
  for (const line of lines) args.push('-e', line);
  execFile('osascript', args, { timeout: 2500 }, (err, stdout) => {
    if (err) return callback(err);
    callback(null, stdout);
  });
}

function getFrontmostInfo(callback) {
  const script = [
    'tell application "System Events"',
    'set frontApp to name of first application process whose frontmost is true',
    'set windowTitle to ""',
    'try',
    'tell application process frontApp to set windowTitle to name of front window',
    'end try',
    'end tell',
    'return frontApp & "\n" & windowTitle'
  ];
  runAppleScript(script, (err, out) => {
    if (err) return callback(err);
    const lines = out.split('\n');
    const appName = (lines[0] || '').trim();
    const windowTitle = (lines[1] || '').trim();
    callback(null, { appName, windowTitle });
  });
}

function classifyActivity(info, rules) {
  const name = `${info.appName} ${info.windowTitle}`.toLowerCase();
  const keywords = (rules.keywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
  const containsKeyword = keywords.some(k => name.includes(k));
  const distractors = ['facebook', 'instagram', 'tiktok', 'twitter', 'x.com', 'youtube', 'bilibili', 'netflix', 'steam'];
  const assistive = ['music', 'spotify', 'apple music'];
  if (containsKeyword) return 'focus';
  if (distractors.some(d => name.includes(d))) return 'distracted';
  if (assistive.some(a => name.includes(a))) return 'assistive';
  // Default: if dev/docs/editing tools, consider focus-ish
  const focusApps = ['code', 'vscode', 'visual studio', 'xcode', 'pages', 'keynote', 'numbers', 'notes', 'notion', 'obsidian', 'word', 'excel', 'powerpoint', 'google docs', 'docs.google'];
  if (focusApps.some(f => name.includes(f))) return 'focus';
  return 'neutral';
}

function startMonitoring() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || monitoringInterval) return;
  monitoringInterval = setInterval(() => {
    if (monitoringState.privacy) return; // respect privacy mode
    
    // Check if window still exists and is not destroyed
    const currentWin = BrowserWindow.getAllWindows()[0];
    if (!currentWin || currentWin.isDestroyed()) {
      stopMonitoring(); // Stop monitoring if no valid window
      return;
    }
    
    getFrontmostInfo((err, info) => {
      if (err || !info) return;
      
      // Double-check window validity before sending IPC messages
      if (currentWin.isDestroyed()) {
        stopMonitoring();
        return;
      }
      
      const classification = classifyActivity(info, monitoringState.rules);
      
      try {
        currentWin.webContents.send('activity:update', { ...info, classification });
        if (classification === 'distracted' && monitoringState.lastClassification !== 'distracted') {
          currentWin.webContents.send('activity:distraction', info);
        }
      } catch (error) {
        console.warn('⚠️ Failed to send activity update (window may be destroyed):', error.message);
        stopMonitoring();
        return;
      }
      
      monitoringState.lastClassification = classification;
    });
  }, 4000);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

app.on('browser-window-created', () => startMonitoring());

// Prevent main window from being activated when alert windows close
app.on('browser-window-focus', (event, window) => {
  // Check if this is the main window and if there's an active distraction alert
  const isMainWindow = window !== dynamicIslandWindow && 
                      window !== distractionAlertWindow;
  
  if (isMainWindow && distractionAlertWindow && !distractionAlertWindow.isDestroyed()) {
    // If main window tries to focus while alert is open, blur it
    setTimeout(() => {
      if (window && !window.isDestroyed()) {
        window.blur();
        console.log('🔇 Prevented main window focus while distraction alert is active');
      }
    }, 50);
  }
});
app.on('before-quit', () => {
  console.log('🔄 App is quitting, cleaning up...');
  cleanupAllMonitoring();
});

// Note: window-all-closed handler is defined earlier in the file

ipcMain.on('rules:update', (evt, payload) => {
  monitoringState.rules = { ...monitoringState.rules, ...payload };
});

ipcMain.on('preferences:update', (evt, payload) => {
  if (typeof payload?.privacy === 'boolean') monitoringState.privacy = payload.privacy;
});

// --- Persistent session history using electron-store ---
const store = new Store({ name: 'project-focus', defaults: { history: [] } });

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

ipcMain.handle('history:list', () => {
  return store.get('history', []);
});

ipcMain.handle('history:add', (evt, entry) => {
  const list = store.get('history', []);
  const withId = { id: generateId(), ...entry };
  list.unshift(withId);
  store.set('history', list);
  return withId;
});

ipcMain.handle('history:clear', () => {
  store.set('history', []);
  return [];
});

ipcMain.handle('config:get-default', () => {
  return defaultConfig?.ai || {};
});

// Dynamic Island IPC handlers
ipcMain.on('island:update', (event, data) => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.webContents.send('island:update', data);
  }
});

ipcMain.on('island:show', (event) => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.show();
  }
});

ipcMain.on('island:hide', (event) => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.hide();
  }
});

ipcMain.on('island:action', (event, action) => {
  // Send island actions back to main window
  const mainWindow = BrowserWindow.getAllWindows().find(win => 
    win !== dynamicIslandWindow && !win.isDestroyed()
  );
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('island:action', action);
    } catch (error) {
      console.warn('⚠️ Failed to send island action (window may be destroyed):', error.message);
    }
  }
});

// Window Monitoring IPC handlers
ipcMain.on('window-monitoring:start', (event) => {
  startWindowMonitoring();
});

ipcMain.on('window-monitoring:stop', (event) => {
  stopWindowMonitoring();
});

ipcMain.handle('window-monitoring:get-current', async () => {
  try {
    const currentWindow = await getCurrentActiveWindow();
    return { success: true, window: currentWindow };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('window-monitoring:test-screenshot', async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-screenshot-${timestamp}.png`;
    const screenshotPath = await takeScreenshotToFile(filename);
    return { success: true, path: screenshotPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// AI Analysis IPC handlers
ipcMain.on('ai-analysis:enable', (event, { workContext }) => {
  enableAIAnalysis(workContext);
});

ipcMain.on('ai-analysis:disable', (event) => {
  disableAIAnalysis();
});

// --- Window Monitoring and Screenshot Capture ---
let windowMonitoringInterval = null;
let lastActiveWindow = null;
let screenshotCounter = 0;
let currentWorkContext = '';
let aiAnalysisEnabled = false;

// Status stabilization
let lastAnalysisResult = null;
let lastAnalysisTime = 0;
let statusHistory = []; // Keep last 3 results for consensus
const ANALYSIS_COOLDOWN = 2000; // 2 seconds
const STATUS_CONSENSUS_COUNT = 1; // Immediate update on next analysis

// Screenshot management
let currentSessionScreenshots = [];

// Cleanup screenshots function
function cleanupScreenshots() {
  console.log('🧹 Cleaning up screenshots from current session...');
  
  currentSessionScreenshots.forEach(screenshotPath => {
    try {
      if (fs.existsSync(screenshotPath)) {
        fs.unlinkSync(screenshotPath);
        console.log(`🗑️ Deleted: ${path.basename(screenshotPath)}`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete ${screenshotPath}:`, error.message);
    }
  });
  
  // Clear the list
  currentSessionScreenshots = [];
  console.log('✅ Screenshot cleanup completed');
}

function getCurrentActiveWindow() {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        try
          set windowName to name of front window of frontApp
          return appName & " - " & windowName
        on error
          return appName & " - No Window"
        end try
      end tell
    `;
    
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to get active window:', error);
        reject(error);
        return;
      }
      
      const windowInfo = stdout.trim();
      resolve(windowInfo);
    });
  });
}

function takeScreenshotToFile(filename) {
  return new Promise((resolve, reject) => {
    // Create screenshots directory if it doesn't exist
    const screenshotsDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshotPath = path.join(screenshotsDir, filename);
    
    // Add to current session screenshots for cleanup
    currentSessionScreenshots.push(screenshotPath);
    
    // Use macOS screencapture command
    exec(`screencapture -x "${screenshotPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Screenshot failed:', error);
        reject(error);
        return;
      }
      
      console.log('📸 Screenshot saved:', screenshotPath);
      resolve(screenshotPath);
    });
  });
}

function startWindowMonitoring() {
  console.log('👁️ Starting window monitoring...');
  
  if (windowMonitoringInterval) {
    clearInterval(windowMonitoringInterval);
  }
  
  windowMonitoringInterval = setInterval(async () => {
    try {
      const currentWindow = await getCurrentActiveWindow();
      
      if (currentWindow !== lastActiveWindow) {
        console.log(`🔄 Window changed: ${lastActiveWindow} → ${currentWindow}`);
        
        // Take screenshot when window changes
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        screenshotCounter++;
        const filename = `window-change-${screenshotCounter}-${timestamp}.png`;
        
        try {
          const screenshotPath = await takeScreenshotToFile(filename);
          
          // Send window change event to renderer
          const mainWindow = BrowserWindow.getAllWindows().find(win => 
            win !== dynamicIslandWindow && !win.isDestroyed()
          );
          
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.webContents.send('window:changed', {
                previousWindow: lastActiveWindow,
                currentWindow: currentWindow,
                screenshotPath: screenshotPath,
                timestamp: Date.now()
              });
            } catch (error) {
              console.warn('⚠️ Failed to send window change event (window may be destroyed):', error.message);
            }
          }
          
          // If AI analysis is enabled, analyze the screenshot with cooldown
          if (aiAnalysisEnabled && currentWorkContext) {
            const now = Date.now();
            if (now - lastAnalysisTime >= ANALYSIS_COOLDOWN) {
              lastAnalysisTime = now;
              analyzeScreenshotForFocus(screenshotPath);
            } else {
              console.log(`⏳ Analysis cooldown active, skipping (${Math.round((ANALYSIS_COOLDOWN - (now - lastAnalysisTime)) / 1000)}s remaining)`);
            }
          }
        } catch (screenshotError) {
          console.error('Failed to take screenshot:', screenshotError);
        }
        
        lastActiveWindow = currentWindow;
      }
    } catch (error) {
      console.error('Window monitoring error:', error);
    }
  }, 1000); // Check every second
}

function stopWindowMonitoring() {
  if (windowMonitoringInterval) {
    clearInterval(windowMonitoringInterval);
    windowMonitoringInterval = null;
    aiAnalysisEnabled = false;
    console.log('🛑 Stopped window monitoring');
  }
}

// Enhanced cleanup function for app shutdown
function cleanupAllMonitoring() {
  console.log('🧹 Cleaning up all monitoring and timers...');
  
  // Stop window monitoring
  stopWindowMonitoring();
  
  // Stop activity monitoring
  stopMonitoring();
  
  // Disable AI analysis
  disableAIAnalysis();
  
  console.log('✅ All monitoring cleaned up');
}

function enableAIAnalysis(workContext) {
  currentWorkContext = workContext;
  aiAnalysisEnabled = true;
  console.log('🤖 AI analysis enabled for work context:', workContext);
}

function disableAIAnalysis() {
  aiAnalysisEnabled = false;
  currentWorkContext = '';
  console.log('🤖 AI analysis disabled');
  
  // Clean up screenshots when session ends
  if (currentSessionScreenshots.length > 0) {
    cleanupScreenshots();
  }
}

async function analyzeScreenshotForFocus(screenshotPath) {
  try {
    console.log('🤖 Analyzing screenshot for focus:', screenshotPath);
    
    // Read screenshot file and convert to base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    
    // Get AI provider and key from config
    const provider = defaultConfig?.ai?.provider || 'bailian';
    const apiKey = defaultConfig?.ai?.apiKey || '';
    
    if (!apiKey) {
      console.error('❌ No AI API key available for analysis');
      return;
    }
    
    // Analyze with AI
    const focusAnalysis = await analyzeScreenshotWithAI(base64Image, currentWorkContext, provider, apiKey);
    
    // Handle structured response
    const currentStatus = typeof focusAnalysis === 'object' ? focusAnalysis.status : focusAnalysis;
    const currentReason = typeof focusAnalysis === 'object' ? focusAnalysis.reason : '未提供理由';
    
    // Add to status history for consensus-based filtering (only status, not reason)
    statusHistory.push(currentStatus);
    if (statusHistory.length > 3) {
      statusHistory.shift(); // Keep only last 3 results
    }
    
    // Check if we should send update (require consensus for status changes)
    let shouldUpdate = false;
    let finalResult = focusAnalysis;
    
    if (lastAnalysisResult === null) {
      // First analysis, always send
      shouldUpdate = true;
    } else if (currentStatus === (typeof lastAnalysisResult === 'object' ? lastAnalysisResult.status : lastAnalysisResult)) {
      // Same status as last result, always send (but update reason)
      shouldUpdate = true;
      finalResult = focusAnalysis; // Use new reason
    } else {
      // Different status, immediate update
      shouldUpdate = true;
      console.log(`✅ Status change: ${typeof lastAnalysisResult === 'object' ? lastAnalysisResult.status : lastAnalysisResult} → ${currentStatus}`);
      finalResult = focusAnalysis;
    }
    
    // Store sameCount for later use
    const consensusCount = statusHistory.filter(r => r === currentStatus).length;
    
    if (shouldUpdate) {
      lastAnalysisResult = finalResult;
      
      // Send result to main window
      const mainWindow = BrowserWindow.getAllWindows().find(win => 
        win !== dynamicIslandWindow && !win.isDestroyed()
      );
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        const resultToSend = typeof finalResult === 'object' ? finalResult : { status: finalResult, reason: '未提供理由' };
        const rawToSend = typeof focusAnalysis === 'object' ? focusAnalysis : { status: focusAnalysis, reason: '未提供理由' };
        
        // If distracted, show system-level alert window
        try {
          const statusText = resultToSend.status || '';
          if (statusText.includes('分心')) {
            showDistractionAlert();
          }
        } catch (e) {
          console.warn('⚠️ Failed to show distraction alert:', e?.message || e);
        }

        try {
          mainWindow.webContents.send('focus:analysis', {
            result: resultToSend.status,
            reason: resultToSend.reason,
            workContext: currentWorkContext,
            screenshotPath: screenshotPath,
            timestamp: Date.now(),
            rawResult: rawToSend.status,
            rawReason: rawToSend.reason,
            consensus: consensusCount
          });
        } catch (error) {
          console.warn('⚠️ Failed to send focus analysis (window may be destroyed):', error.message);
        }
      }
    }
    
    console.log('🎯 Focus analysis result:', currentStatus, '→', finalResult);
    
  } catch (error) {
    console.error('❌ Failed to analyze screenshot for focus:', error);
  }
}

async function analyzeScreenshotWithAI(base64Image, workContext, provider, apiKey) {
  const analysisPrompt = `根据用户的屏幕截图判断用户正在进行的活动与其工作目标的相关性，从而推导出用户目前的专注状态。工作目标："${workContext}"

判断标准：
• 专注中：屏幕显示的大部分内容，尤其是最优先的窗口与工作目标高度相关
• 半分心：调整电脑设置、播放背景音乐、运用效率类软件、阅读回复邮件等过渡性行为
• 分心中：屏幕显示的大部分内容，尤其是最优先的窗口与工作目标不相关

格式：
状态: [专注中/半分心/分心中]
理由: [简短原因，50字内]`;

  try {
    // For vision analysis, we need to use a vision-capable model
    const visionPayload = {
      model: 'qwen-vl-max', // Upgraded to Qwen's most powerful vision model
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: analysisPrompt },
            { 
              type: 'image_url', 
              image_url: { url: `data:image/png;base64,${base64Image}` }
            }
          ]
        }
      ],
      max_tokens: 80, // Reduced for faster response
      temperature: 0.0 // Set to 0 for fastest, most deterministic response
    };

    console.log('🔗 Calling AI with provider:', provider);
    console.log('🔗 Payload:', JSON.stringify(visionPayload, null, 2));
    
    const result = await callAIWithVision(provider, apiKey, visionPayload, base64Image, analysisPrompt);
    console.log('🔗 Raw AI result:', JSON.stringify(result, null, 2));
    
    const response = result?.content?.trim() || 'UNCLEAR';
    
    console.log('🔍 AI Vision Analysis Raw Response:', response);
    
    // Parse the structured response
    const parsed = parseAIResponse(response);
    return parsed;
  } catch (error) {
    console.error('❌ AI analysis failed with error:', error);
    console.error('❌ Error stack:', error.stack);
    return 'UNCLEAR';
  }
}

function parseAIResponse(response) {
  try {
    // Try to parse structured response first
    const statusMatch = response.match(/状态:\s*(.+)/);
    const reasonMatch = response.match(/理由:\s*(.+)/);
    
    if (statusMatch && reasonMatch) {
      let status = statusMatch[1].trim();
      const reason = reasonMatch[1].trim();
      
      // Clean up status - remove brackets and extra formatting
      status = status.replace(/[\[\]]/g, '').trim();
      
      return {
        status: status,
        reason: reason,
        raw: response
      };
    }
    
    // Fallback: try to extract just the status from old format
    const cleanResponse = response.toLowerCase().trim();
    let status = 'UNCLEAR';
    
    if (cleanResponse.includes('专注中') || cleanResponse.includes('专注')) {
      status = '专注中';
    } else if (cleanResponse.includes('半分心')) {
      status = '半分心';
    } else if (cleanResponse.includes('分心中') || cleanResponse.includes('分心')) {
      status = '分心中';
    }
    
    return {
      status: status,
      reason: '未提供详细理由',
      raw: response
    };
  } catch (error) {
    console.error('❌ Failed to parse AI response:', error);
    return {
      status: 'UNCLEAR',
      reason: '解析失败',
      raw: response
    };
  }
}

async function callAIWithVision(provider, apiKey, payload, base64Image, analysisPrompt) {
  let url;
  let headers;
  
  switch (provider) {
    case 'bailian':
    case 'dashscope':
      url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
      headers = {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      };
      // Adapt payload for DashScope - special format for multimodal
      const dashScopePayload = {
        model: 'qwen-vl-plus',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { text: analysisPrompt },
                { image: `data:image/png;base64,${base64Image}` }
              ]
            }
          ]
        },
        parameters: {
          max_tokens: payload.max_tokens,
          temperature: payload.temperature
        }
      };
      console.log('🔗 DashScope URL:', url);
      console.log('🔗 DashScope headers:', headers);
      console.log('🔗 DashScope payload:', JSON.stringify(dashScopePayload, null, 2));
      
      const dashResult = await postJsonCustom(url, headers, dashScopePayload);
      console.log('🔗 DashScope raw result:', JSON.stringify(dashResult, null, 2));
      
      // DashScope multimodal response format is different
      const content = dashResult?.output?.choices?.[0]?.message?.content?.[0]?.text || 
                     dashResult?.output?.text || 
                     'UNCLEAR';
      console.log('🔗 Extracted content:', content);
      
      return { content: content };
      
    case 'openai':
      url = 'https://api.openai.com/v1/chat/completions';
      payload.model = 'gpt-4-vision-preview';
      return await postJson(url, apiKey, payload);
      
    case 'openrouter':
      url = 'https://openrouter.ai/api/v1/chat/completions';
      payload.model = 'anthropic/claude-3-haiku:beta';
      return await postJson(url, apiKey, payload);
      
    default:
      throw new Error(`Vision analysis not supported for provider: ${provider}`);
  }
}

// Old monitoring functions removed - replaced by window monitoring with AI analysis

// --- Simple AI proxy using fetch-like HTTPS (OpenRouter/OpenAI compatible) ---
function postJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = Buffer.from(JSON.stringify(payload));
      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
          'authorization': `Bearer ${apiKey}`,
        },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve({ error: 'invalid_json', raw: body }); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) { reject(e); }
  });
}

function postJsonCustom(url, headers, payload) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = Buffer.from(JSON.stringify(payload));
      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
        headers: {
          ...headers,
          'content-length': data.length,
        },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve({ error: 'invalid_json', raw: body }); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) { reject(e); }
  });
}

ipcMain.handle('ai:chat', async (evt, { messages, provider, apiKey }) => {
  try {
    if (!apiKey) {
      // No-key fallback: rule-based nudge
      const last = messages[messages.length - 1]?.content || '';
      const reply = `Got it. I'll keep you on task. Outline your next 3 concrete steps for: "${last.slice(0,120)}"`;
      return { role: 'assistant', content: reply };
    }

    let url, model, headers;
    
    switch (provider) {
      case 'bailian':
        // 阿里云百炼使用 DashScope 的 API 端点
        url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
        const bailianPayload = {
          model: 'qwen-plus',
          input: { messages },
          parameters: { temperature: 0.3, result_format: 'message' }
        };
        const bailianHeaders = {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`
        };
        const bailianResult = await postJsonCustom(url, bailianHeaders, bailianPayload);
        const bailianContent = bailianResult?.output?.text || bailianResult?.output?.choices?.[0]?.message?.content || bailianResult?.message || 'Bailian API error';
        return { role: 'assistant', content: bailianContent };
        break;
        
      case 'dashscope':
        url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
        const dashPayload = {
          model: 'qwen-turbo',
          input: { messages },
          parameters: { temperature: 0.3 }
        };
        const dashHeaders = {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        };
        return await postJsonCustom(url, dashHeaders, dashPayload);
        
      case 'siliconflow':
        url = 'https://api.siliconflow.cn/v1/chat/completions';
        model = 'Qwen/Qwen2.5-7B-Instruct';
        break;
        
      case 'deepseek':
        url = 'https://api.deepseek.com/chat/completions';
        model = 'deepseek-chat';
        break;
        
      case 'openrouter':
        url = 'https://openrouter.ai/api/v1/chat/completions';
        model = 'qwen/qwen-2.5-7b-instruct:free'; // Free Qwen model
        break;
        
      default: // openai
        url = 'https://api.openai.com/v1/chat/completions';
        model = 'gpt-4o-mini';
        break;
    }
    
    const payload = { model, messages, temperature: 0.3 };
    const json = await postJson(url, apiKey, payload);
    
    // Handle DashScope response format
    if (provider === 'dashscope') {
      const content = json?.output?.text || json?.output?.choices?.[0]?.message?.content || 'DashScope error';
      return { role: 'assistant', content };
    }
    
    // Standard OpenAI format
    const content = json?.choices?.[0]?.message?.content || json?.data || JSON.stringify(json).slice(0,800);
    return { role: 'assistant', content };
  } catch (e) {
    return { role: 'assistant', content: 'AI error: ' + String(e?.message || e) };
  }
});

