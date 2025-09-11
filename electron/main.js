const {
  app,
  BrowserWindow,
  nativeTheme,
  ipcMain,
  screen,
  dialog,
  systemPreferences,
} = require("electron");
const path = require("path");
const { execFile, exec, spawn } = require("child_process");
const { promisify } = require('util');
const execAsync = promisify(exec);
const Store = require("electron-store");
const https = require("https");
const fs = require("fs");
const Tesseract = require("tesseract.js");
const { Jimp } = require("jimp");

// Import new nudge system modules
const ContextSampler = require("../src/focus/ContextSampler");
const EntityCache = require("../src/focus/EntityCache");
const NudgeGenerator = require("../src/focus/NudgeGenerator");

// 尝试加载本地配置文件
let defaultConfig = {};
try {
  const configPath = path.join(__dirname, "..", "config.js");
  delete require.cache[configPath]; // 清除缓存，确保重新加载
  defaultConfig = require(configPath);
  console.log("✅ 配置文件加载成功:", defaultConfig);
} catch (e) {
  console.log("⚠️ 配置文件不存在，使用空配置:", e.message);
}

// dynamicIslandWindow 已经用 Swift Island 替代
let distractionAlertWindow = null;
let currentDistractionMessage = "Get back to work"; // Default fallback message

// Swift 灵动岛管理器
class SwiftIslandManager {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.messageQueue = [];
  }

  start() {
    if (this.isRunning) {
      console.log("🏝️ Swift Island already running");
      return;
    }

    const swiftAppPath = path.join(__dirname, "..", "build", "swift-island", "DynamicIsland");
    
    if (!fs.existsSync(swiftAppPath)) {
      console.error("❌ Swift Island executable not found:", swiftAppPath);
      return;
    }

    console.log("🚀 Starting Swift Island:", swiftAppPath);
    
    this.process = spawn(swiftAppPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.isRunning = true;

    // 监听 stdout 接收来自 Swift 应用的消息
    this.process.stdout.on('data', (data) => {
      const message = data.toString().trim();
      try {
        const jsonData = JSON.parse(message);
        this.handleSwiftMessage(jsonData);
      } catch (e) {
        console.log("🏝️ Swift Island:", message);
      }
    });

    // 监听 stderr
    this.process.stderr.on('data', (data) => {
      console.error("🏝️ Swift Island Error:", data.toString());
    });

    // 监听进程退出
    this.process.on('close', (code) => {
      console.log(`🏝️ Swift Island process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;
    });

    // 发送启动消息
    setTimeout(() => {
      this.sendMessage({ action: 'show' });
    }, 1000);
  }

  stop() {
    if (this.process && this.isRunning) {
      console.log("🏝️ Stopping Swift Island");
      this.process.kill();
      this.isRunning = false;
      this.process = null;
    }
  }

  sendMessage(message) {
    if (!this.process || !this.isRunning) {
      console.warn("🏝️ Swift Island not running, queuing message:", message);
      this.messageQueue.push(message);
      return;
    }

    try {
      const jsonString = JSON.stringify(message) + '\n';
      this.process.stdin.write(jsonString);
    } catch (e) {
      console.error("🏝️ Failed to send message to Swift Island:", e);
    }
  }

  handleSwiftMessage(data) {
    console.log("🏝️ Received from Swift Island:", data);
    
    // 转发事件到主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('swift-island-event', data);
    }
  }

  // 公共方法供其他部分调用
  show() { this.sendMessage({ action: 'show' }); }
  hide() { this.sendMessage({ action: 'hide' }); }
  expand(expanded = true) { this.sendMessage({ action: 'expand', expanded }); }
  updateStatus(status) { this.sendMessage({ action: 'updateStatus', status }); }
  updateMessage(message) { this.sendMessage({ action: 'updateMessage', message }); }
  reposition() { this.sendMessage({ action: 'reposition' }); }
  toggleLevel() { this.sendMessage({ action: 'toggleLevel' }); }
}

// 创建全局 Swift Island 管理器实例
const swiftIsland = new SwiftIslandManager();

// Generate AI distraction message
async function generateDistractionMessage(base64Image, workContext) {
  try {
    console.log("🤖 Generating AI distraction message...");
    console.log("🤖 Work context:", workContext);
    console.log("🤖 Has screenshot:", !!base64Image);
    
    const provider = defaultConfig?.ai?.provider || "bailian";
    const apiKey = defaultConfig?.ai?.apiKey || "";

    console.log("🤖 AI provider:", provider);
    console.log("🤖 Has API key:", !!apiKey);

    if (!apiKey) {
      console.warn("⚠️ No AI API key available, using default message");
      return "Get back to work";
    }

    const prompt = `You are analyzing a user's screen to create a specific distraction alert.

Work Goal: "${workContext}"
Screen Content: ${base64Image ? 'Image provided showing current screen' : 'No screenshot available'}

ANALYZE THE SCREEN and identify what the user is actually doing. Then create a specific, direct message.

PRIORITY RULES:
1. If you see social media (Facebook, Twitter, Instagram, TikTok, etc.) → "Stop browsing [app name]"
2. If you see video content (YouTube, Netflix, etc.) → "Stop watching [content type]"
3. If you see shopping sites → "Close shopping tabs"
4. If you see games → "Close the game"
5. If you see messaging/chat apps → "Focus, close chat apps"
6. If you see news sites → "Stop reading news"
7. If unclear but clearly not work → "Get back to ${workContext.split(' ').slice(0,2).join(' ')}"

FORMAT: Keep under 8 words. Be direct and specific. NO generic messages.
AVOID: "Your attention score is decreasing" - be more direct.

Examples:
- "Stop watching YouTube videos"
- "Close Facebook now"
- "Stop browsing Reddit"
- "Get back to coding"
- "Close entertainment sites"

Respond with ONLY the specific action message, no quotes or extra text.`;

    // Use the existing AI infrastructure with timeout
    console.log("🤖 Calling AI with timeout...");
    const result = await Promise.race([
      callAIWithVision(
        provider,
        apiKey,
        {
          model: "qwen-vl-plus-latest",
          messages: [
            {
              role: "user",
              content: base64Image ? [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${base64Image}` },
                },
              ] : [{ type: "text", text: prompt }],
            },
          ],
          max_tokens: 50,
          temperature: 0.3,
        },
        base64Image,
        prompt,
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI call timeout after 10 seconds')), 10000)
      )
    ]);
    
    console.log("🤖 AI call completed successfully");

    let message = result?.content?.trim() || "Get back to work";
    
    console.log("🤖 Raw AI response:", message);
    
    // Clean up the message - remove quotes if present
    message = message.replace(/^["']|["']$/g, '');
    
    console.log("🤖 After quote removal:", message);
    
    // Ensure message is not empty and not too generic
    if (!message || message.length < 3) {
      message = `Get back to ${workContext.split(' ').slice(0,2).join(' ')}`;
      console.log("🤖 Using fallback message:", message);
    }
    
    // Truncate if too long (keep under 8 words as per new format)
    const words = message.split(' ');
    if (words.length > 8) {
      message = words.slice(0, 8).join(' ');
      console.log("🤖 Truncated to 8 words:", message);
    }

    // Ensure first letter is capitalized
    message = message.charAt(0).toUpperCase() + message.slice(1);

    console.log("✅ Final generated AI distraction message:", message);
    return message;

  } catch (error) {
    console.error("❌ Failed to generate AI distraction message:", error);
    return "Get back to work";
  }
}

// Generate continuation suggestion from last on-task screenshot (module scope)
async function generateContinuationSuggestion(base64PrevImage, workContext) {
  const prompt = `The user was working on: ${workContext}.
They got distracted for a while.
Here is the unfinished work screenshot provided as an image input.

Task: Suggest what the user can try to continue their work, based on what you see in the screenshot.
Format: "Your attention score is decreasing, you can try to [specific suggestion]"
Constraints:
- Keep the suggestion part short and actionable (<= 8 words after "try to")
- Be specific about what they can do next based on the visible work
- Use encouraging language with "try to"
- Do NOT mention screenshots or analysis

Return the complete formatted message.`;

  try {
    const provider = defaultConfig?.ai?.provider || "bailian";
    const apiKey = defaultConfig?.ai?.apiKey || "";
    if (!apiKey) return "Your attention score is decreasing, you can try to resume where you left off";

    const result = await Promise.race([
      callAIWithVision(
        provider,
        apiKey,
        {
          model: "qwen-vl-plus-latest",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                base64PrevImage
                  ? { type: "image_url", image_url: { url: `data:image/png;base64,${base64PrevImage}` } }
                  : { type: "text", text: "No screenshot available" },
              ],
            },
          ],
          max_tokens: 60,
          temperature: 0.3,
        },
        base64PrevImage,
        prompt,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Continuation timeout")), 10000)),
    ]);

    let suggestion = (result?.content || "").trim();
    suggestion = suggestion.replace(/^"|"$/g, "");
    if (!suggestion) return "Your attention score is decreasing, you can try to pick up the next small step";
    
    // If AI didn't include the prefix, add it
    if (!suggestion.toLowerCase().includes("your attention score is decreasing")) {
      // Clean up the suggestion and add prefix
      const words = suggestion.split(" ");
      if (words.length > 8) suggestion = words.slice(0, 8).join(" ");
      suggestion = suggestion.charAt(0).toLowerCase() + suggestion.slice(1);
      suggestion = `Your attention score is decreasing, you can try to ${suggestion}`;
    }
    
    return suggestion;
  } catch (e) {
    console.warn("⚠️ Continuation suggestion failed:", e?.message || e);
    return "Your attention score is decreasing, you can try to pick up the next small step";
  }
}

function showDistractionAlert() {
  try {
    console.log("🚨 Showing distraction alert with message:", currentDistractionMessage);
    
    if (distractionAlertWindow && !distractionAlertWindow.isDestroyed()) {
      // Update the message in existing window
      console.log("🚨 Updating existing alert window with message:", currentDistractionMessage);
      distractionAlertWindow.webContents.send('update-message', currentDistractionMessage);
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
      backgroundColor: "#FFFFFF",
      show: true,
      // Prevent focusing main window when alert closes
      parent: null, // Don't set parent to avoid focus transfer
      modal: false, // Not modal to avoid blocking
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    distractionAlertWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    distractionAlertWindow.setAlwaysOnTop(true, "screen-saver");
    distractionAlertWindow.loadFile(
      path.join(__dirname, "..", "src", "alert.html"),
    );

    // Send the current message to the new window once it's ready
    distractionAlertWindow.webContents.once('did-finish-load', () => {
      console.log("🚨 Alert window loaded, sending message:", currentDistractionMessage);
      distractionAlertWindow.webContents.send('update-message', currentDistractionMessage);
    });

    // Handle window close to prevent main window activation
    distractionAlertWindow.on("closed", () => {
      distractionAlertWindow = null;

      // Prevent main window from gaining focus
      setTimeout(() => {
        const mainWindow = BrowserWindow.getAllWindows().find(
          (win) => !win.isDestroyed(),
        );
        if (mainWindow && mainWindow.isFocused()) {
          // If main window somehow got focus, blur it
          mainWindow.blur();
          console.log(
            "🔇 Prevented main window from gaining focus after alert dismissal",
          );
        }
      }, 100);
    });

    // Handle blur events to prevent unwanted focus changes
    distractionAlertWindow.on("blur", () => {
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
    console.warn(
      "⚠️ Failed to show always-on-top alert window:",
      e?.message || e,
    );
  }
}

function createDynamicIslandWindow() {
  console.log('🏝️ Starting Swift-based Dynamic Island...');
  swiftIsland.start();
}
// Dynamic Island 相关函数（现在使用 Swift 实现）
function animateIslandShow() {
  swiftIsland.show();
}

function animateIslandHide() {
  return new Promise((resolve) => {
    swiftIsland.hide();
    setTimeout(resolve, 350);
  });
}

function expandDynamicIsland(data) {
  swiftIsland.expand(true);
  swiftIsland.updateStatus(data.status || 'active');
  swiftIsland.updateMessage(data.message || 'Focus session active');
}

function collapseDynamicIsland() {
  swiftIsland.expand(false);
}



function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 880,
    minHeight: 560,
    title: "Project Focus",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));

  // Only open dev tools if explicitly requested via environment variable
  if (!app.isPackaged && process.env.OPEN_DEV_TOOLS === "true") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  return mainWindow;
}

app.setName("Project Focus");
app.setAppUserModelId("com.projectfocus.app");

app.whenReady().then(async () => {
  createMainWindow();
  createDynamicIslandWindow();

  // Check permissions on startup
  setTimeout(async () => {
    const permissionResult = await checkPermissions();
    if (!permissionResult.hasPermission) {
      console.warn(
        "⚠️ App started without required permissions:",
        permissionResult.missingPermissions,
      );
    }
  }, 2000); // Wait 2 seconds after app startup

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createDynamicIslandWindow();
    }
  });
});

app.on("window-all-closed", () => {
  console.log("🔄 All windows closed, cleaning up...");
  cleanupAllMonitoring();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// --- Activity monitoring (macOS via AppleScript) ---
let monitoringInterval = null;
const monitoringState = {
  privacy: false,
  rules: { keywords: [] },
  lastClassification: "unknown",
};

function runAppleScript(lines, callback) {
  const args = [];
  for (const line of lines) args.push("-e", line);
  execFile("osascript", args, { timeout: 2500 }, (err, stdout) => {
    if (err) return callback(err);
    callback(null, stdout);
  });
}

function getFrontmostInfo(callback) {
  const script = [
    'tell application "System Events"',
    "set frontApp to name of first application process whose frontmost is true",
    'set windowTitle to ""',
    "try",
    "tell application process frontApp to set windowTitle to name of front window",
    "end try",
    "end tell",
    'return frontApp & "\n" & windowTitle',
  ];
  runAppleScript(script, (err, out) => {
    if (err) return callback(err);
    const lines = out.split("\n");
    const appName = (lines[0] || "").trim();
    const windowTitle = (lines[1] || "").trim();
    callback(null, { appName, windowTitle });
  });
}

function classifyActivity(info, rules) {
  const name = `${info.appName} ${info.windowTitle}`.toLowerCase();
  const keywords = (rules.keywords || [])
    .map((k) => String(k).toLowerCase())
    .filter(Boolean);
  const containsKeyword = keywords.some((k) => name.includes(k));
  const distractors = [
    "facebook",
    "instagram",
    "tiktok",
    "twitter",
    "x.com",
    "youtube",
    "bilibili",
    "netflix",
    "steam",
  ];
  const assistive = ["music", "spotify", "apple music"];
  if (containsKeyword) return "focus";
  if (distractors.some((d) => name.includes(d))) return "distracted";
  if (assistive.some((a) => name.includes(a))) return "assistive";
  // Default: if dev/docs/editing tools, consider focus-ish
  const focusApps = [
    "code",
    "vscode",
    "visual studio",
    "xcode",
    "pages",
    "keynote",
    "numbers",
    "notes",
    "notion",
    "obsidian",
    "word",
    "excel",
    "powerpoint",
    "google docs",
    "docs.google",
  ];
  if (focusApps.some((f) => name.includes(f))) return "focus";
  return "neutral";
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
        currentWin.webContents.send("activity:update", {
          ...info,
          classification,
        });
        if (
          classification === "distracted" &&
          monitoringState.lastClassification !== "distracted"
        ) {
          currentWin.webContents.send("activity:distraction", info);
        }
      } catch (error) {
        console.warn(
          "⚠️ Failed to send activity update (window may be destroyed):",
          error.message,
        );
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

app.on("browser-window-created", () => startMonitoring());

// Prevent main window from being activated when alert windows close
app.on("browser-window-focus", (event, window) => {
  // Check if this is the main window and if there's an active distraction alert
  const isMainWindow =
    window !== distractionAlertWindow;

  if (
    isMainWindow &&
    distractionAlertWindow &&
    !distractionAlertWindow.isDestroyed()
  ) {
    // If main window tries to focus while alert is open, blur it
    setTimeout(() => {
      if (window && !window.isDestroyed()) {
        window.blur();
        console.log(
          "🔇 Prevented main window focus while distraction alert is active",
        );
      }
    }, 50);
  }
});
app.on("before-quit", () => {
  console.log("🔄 App is quitting, cleaning up...");
  cleanupAllMonitoring();
  swiftIsland.stop(); // 停止 Swift Island 进程
});

// Note: window-all-closed handler is defined earlier in the file

ipcMain.on("rules:update", (evt, payload) => {
  monitoringState.rules = { ...monitoringState.rules, ...payload };
});

ipcMain.on("preferences:update", (evt, payload) => {
  if (typeof payload?.privacy === "boolean")
    monitoringState.privacy = payload.privacy;
});

// --- Persistent session history using electron-store ---
const store = new Store({ name: "project-focus", defaults: { history: [] } });

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

ipcMain.handle("history:list", () => {
  return store.get("history", []);
});

ipcMain.handle("history:add", (evt, entry) => {
  const list = store.get("history", []);
  const withId = { id: generateId(), ...entry };
  list.unshift(withId);
  store.set("history", list);
  return withId;
});

ipcMain.handle("history:clear", () => {
  store.set("history", []);
  return [];
});

ipcMain.handle("config:get-default", () => {
  return defaultConfig?.ai || {};
});

// Dynamic Island IPC handlers
ipcMain.on("island:update", (event, data) => {
  swiftIsland.updateStatus(data.status);
  if (data.message) {
    swiftIsland.updateMessage(data.message);
  }
});

ipcMain.on("island:show", (event) => {
  swiftIsland.show();
});

ipcMain.on("island:hide", (event) => {
  swiftIsland.hide();
});

ipcMain.on("island:expand", (event, data) => {
  expandDynamicIsland(data);
});

ipcMain.on("island:collapse", (event) => {
  collapseDynamicIsland();
});

ipcMain.on("island:action", (event, action) => {
  // Send island actions back to main window
  const mainWindow = BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed(),
  );
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("island:action", action);
    } catch (error) {
      console.warn(
        "⚠️ Failed to send island action (window may be destroyed):",
        error.message,
      );
    }
  }
});

// Window Monitoring IPC handlers
ipcMain.on("window-monitoring:start", (event) => {
  console.log("📡 Received window monitoring start request");
  startWindowMonitoring();
});

ipcMain.on("window-monitoring:stop", (event) => {
  stopWindowMonitoring();
});

ipcMain.handle("window-monitoring:get-current", async () => {
  try {
    const currentWindow = await getCurrentActiveWindow();
    return { success: true, window: currentWindow };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("window-monitoring:test-screenshot", async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `test-screenshot-${timestamp}.png`;
    const screenshotPath = await takeScreenshotToFile(filename);
    return { success: true, path: screenshotPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// AI Analysis IPC handlers
ipcMain.on("ai-analysis:enable", (event, { workContext }) => {
  enableAIAnalysis(workContext);
});

ipcMain.on("ai-analysis:disable", (event) => {
  disableAIAnalysis();
});

ipcMain.handle("permissions:check", async () => {
  return await checkPermissions();
});

// Do Not Disturb (macOS)
function toggleDND(enable) {
  if (process.platform !== "darwin") return;

  console.log(`🌙 Toggling Do Not Disturb: ${enable ? "ON" : "OFF"}`);
  const state = enable ? "on" : "off";
  // This command attempts to use a Shortcut first, falling back to the older `defaults` command.
  const command = `shortcuts run "Set Focus" --input "${state}" || defaults write com.apple.notificationcenterui doNotDisturb -boolean ${enable} && killall NotificationCenter`;
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Failed to ${enable ? "enable" : "disable"} DND:`, error.message);
      if (stderr) console.error(`❌ DND stderr:`, stderr);
    } else {
      console.log(`✅ DND ${enable ? "enabled" : "disabled"} successfully.`);
    }
  });
}

ipcMain.on("dnd:toggle", (event, enable) => {
  toggleDND(enable);
});


// Window Monitoring and Screenshot Capture ---
let windowMonitoringInterval = null;
let idleCheckInterval = null; // Idle input checker
let lastActiveWindow = null;
let lastWindowChangeAt = Date.now();
let screenshotCounter = 0;
let currentWorkContext = "";
let aiAnalysisEnabled = false;

// Status stabilization
let lastAnalysisResult = null;
let lastAnalysisTime = 0;
let statusHistory = []; // Keep last 3 results for consensus
const ANALYSIS_COOLDOWN = 2000; // 2 seconds
const STATUS_CONSENSUS_COUNT = 1; // Immediate update on next analysis
// Idle and semi-distraction tracking
let isIdleMode = false; // 是否处于待机中
let semiStartAt = null; // 半分心开始时间
let semiEscalated = false; // 是否已从半分心升级为分心中

// Screenshot management
let currentSessionScreenshots = [];
let distractionReminderInterval = null; // every 5s reminder while distracted
// Track the last screenshot when user was on-task (专注中 or 半分心)
let lastOnTaskScreenshotPath = null;

// Nudge system instances
let contextSampler = null;
let entityCache = null;
let nudgeGenerator = null;
let lastNudgeTime = 0;
let isInDistractionWindow = false;

// Cleanup screenshots function
function cleanupScreenshots() {
  console.log("🧹 Cleaning up screenshots from current session...");

  currentSessionScreenshots.forEach((screenshotPath) => {
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
  console.log("✅ Screenshot cleanup completed");
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
        console.error("Failed to get active window:", error);
        reject(error);
        return;
      }

      const windowInfo = stdout.trim();
      resolve(windowInfo);
    });
  });
}

// Check macOS permissions
async function checkPermissions() {
  if (process.platform !== "darwin")
    return { hasPermission: true, missingPermissions: [] };

  try {
    const missingPermissions = [];

    // Check screen recording permission
    const screenAccess = systemPreferences.getMediaAccessStatus("screen");
    console.log("🔒 Screen recording permission status:", screenAccess);

    if (screenAccess !== "granted") {
      console.warn("⚠️ Screen recording permission not granted");
      missingPermissions.push("screen");
    }

    // Check accessibility permission (for window monitoring)
    const accessibilityAccess =
      systemPreferences.isTrustedAccessibilityClient(false);
    console.log("🔒 Accessibility permission status:", accessibilityAccess);

    if (!accessibilityAccess) {
      console.warn("⚠️ Accessibility permission not granted");
      missingPermissions.push("accessibility");
    }

    if (missingPermissions.length > 0) {
      // Show permission dialog
      let message = "Permissions Required";
      let detail = "This app needs the following permissions:\n";

      if (missingPermissions.includes("screen")) {
        detail += "• Screen Recording - for taking screenshots\n";
      }
      if (missingPermissions.includes("accessibility")) {
        detail += "• Accessibility - for monitoring window changes\n";
      }

      detail +=
        "\nPlease enable them in System Preferences > Security & Privacy > Privacy.";

      const result = await dialog.showMessageBox({
        type: "warning",
        title: "Permissions Required",
        message: message,
        detail: detail,
        buttons: ["Open System Preferences", "Cancel"],
        defaultId: 0,
      });

      if (result.response === 0) {
        if (missingPermissions.includes("screen")) {
          exec(
            'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"',
          );
        } else if (missingPermissions.includes("accessibility")) {
          exec(
            'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"',
          );
        }
      }

      return { hasPermission: false, missingPermissions };
    }

    return { hasPermission: true, missingPermissions: [] };
  } catch (error) {
    console.error("❌ Permission check failed:", error);
    return {
      hasPermission: false,
      missingPermissions: ["unknown"],
      error: error.message,
    };
  }
}

function takeScreenshotToFile(filename) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("[SCREENSHOT] Initiating screenshot sequence...");
      // Check permissions first
      const permissionResult = await checkPermissions();
      if (!permissionResult.hasPermission) {
        const errorMsg = `Required permissions not granted: ${permissionResult.missingPermissions.join(", ")}`;
        console.error("[SCREENSHOT] Permission check failed:", errorMsg);
        reject(new Error(errorMsg));
        return;
      }
      console.log("[SCREENSHOT] Permissions check passed.");

      // Create screenshots directory if it doesn't exist in a writable location
      const screenshotsDir = path.join(app.getPath("userData"), "screenshots");
      if (!fs.existsSync(screenshotsDir)) {
        console.log("[SCREENSHOT] Creating screenshots directory at:", screenshotsDir);
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      const screenshotPath = path.join(screenshotsDir, filename);
      console.log("[SCREENSHOT] Target path:", screenshotPath);

      // Add to current session screenshots for cleanup
      currentSessionScreenshots.push(screenshotPath);

      // Use macOS screencapture command
      exec(`screencapture -x "${screenshotPath}"`, (error, stdout, stderr) => {
        if (error) {
          console.error("❌ Screenshot failed:", error);
          console.error("❌ Error details:", error.message);
          if (stderr) console.error("❌ Stderr:", stderr);

          // Check if it's a permission error
          if (
            error.message.includes("not authorized") ||
            error.message.includes("permission")
          ) {
            console.error(
              "❌ This appears to be a permission error. Please check System Preferences > Security & Privacy > Privacy > Screen Recording",
            );
          }

          reject(error);
          return;
        }

        console.log("✅ Screenshot saved:", screenshotPath);
        resolve(screenshotPath);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// --- Enhanced PII detection and redaction ---
function detectPIIFromText(text) {
  try {
    const patterns = [
      // === 证件与账户标识 ===
      // 中国大陆18位身份证号
      /\b[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
      // US SSN: 123-45-6789 or 123456789
      /\b\d{3}-?\d{2}-?\d{4}\b/g,
      // 护照号 (通用格式)
      /\b[A-Z]{1,2}\d{6,9}\b/g,
      // 驾照号 (多种格式)
      /\b[A-Z]\d{7,15}\b/g,
      // 税号/TIN (US format)
      /\b\d{2}-?\d{7}\b/g,
      
      // 银行账户相关
      // 银行卡号 (13-19位，包含常见前缀)
      /\b(4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{1,7}\b/g,
      // 通用银行卡号 (13-19位数字)
      /\b(?:\d[ -]*?){13,19}\b/g,
      // IBAN (国际银行账户号)
      /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
      // 路由号 (US)
      /\b\d{9}\b/g,
      // CVV/CVC (3-4位) - 更宽松的匹配
      /\b\d{3,4}\b(?=.*(?:cvv|cvc|security|code|验证码))/gi,
      /(?:cvv|cvc|security|code|验证码)[\s:：]*\d{3,4}/gi,
      // 信用卡有效期 MM/YY or MM/YYYY
      /\b(0[1-9]|1[0-2])\/\d{2,4}\b/g,
      
      // 联系方式
      // 手机号 (中国大陆)
      /\b1[3-9]\d{9}\b/g,
      // 国际手机号格式
      /\b\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
      // 固定电话
      /\b\d{3,4}[-.\s]?\d{7,8}\b/g,
      // 邮箱地址
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      
      // 地址信息
      // 精确住址 (包含数字+楼层/房号关键词)
      /\b\d+.*?(?:号|楼|层|室|栋|单元|门牌)\b/g,
      // 邮政编码
      /\b\d{5,6}\b/g,
      
      // 日期信息
      // 出生日期 (完整格式)
      /\b(19|20)\d{2}[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/g,
      /\b(0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])[-/.](19|20)\d{2}\b/g,
      
      // === 凭证与安全 ===
      // API 密钥和 Token
      // OpenAI API keys
      /\bsk-[A-Za-z0-9]{48,}\b/g,
      // AWS Access Key
      /\bAKIA[A-Z0-9]{16}\b/g,
      // GitHub Personal Access Token (更灵活的长度)
      /\bghp_[A-Za-z0-9]{30,40}\b/g,
      /\bgho_[A-Za-z0-9]{30,40}\b/g,
      /\bghu_[A-Za-z0-9]{30,40}\b/g,
      /\bghs_[A-Za-z0-9]{30,40}\b/g,
      /\bghr_[A-Za-z0-9]{30,40}\b/g,
      // Slack tokens
      /\bxox[bpoa]-[A-Za-z0-9-]+/g,
      // JWT tokens (基本格式检测)
      /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      
      // 密码相关 (在用户名附近的密码)
      /\b(?:password|passwd|pwd|pass)\s*[:=]\s*[^\s]{6,}\b/gi,
      // PIN码 - 更宽松的匹配
      /\b\d{4,8}\b(?=.*(?:pin|密码|验证码))/gi,
      /(?:pin|密码)[\s:：]*\d{4,8}/gi,
      
      // 验证码
      // 短信验证码/一次性口令 (4-8位数字)
      /\b\d{4,8}\b(?=.*(?:验证码|code|otp|sms))/gi,
      
      // SSH 私钥标识
      /-----BEGIN.*PRIVATE KEY-----/g,
      // TLS 私钥标识  
      /-----BEGIN.*CERTIFICATE-----/g,
      
      // 会话相关
      // Session cookies (长字符串)
      /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
      // CSRF Token
      /\b[A-Za-z0-9_-]{32,}\b(?=.*(?:csrf|token))/gi,
n    ];
    
    return patterns.some((re) => re.test(text));
  } catch (_) {
    return false;
  }
}

async function ocrAndMaybeRedactImage(inputPath) {
  try {
    console.log("🔍 [REDACT] Starting redaction for:", inputPath);
    const image = await Jimp.read(inputPath);
    console.log("🔍 [REDACT] Image loaded, dimensions:", image.width, "x", image.height);
    
    const { data } = await Tesseract.recognize(inputPath, "eng", {
      logger: () => {},
    });

    const rawText = data?.text || "";
    const words = data?.words || [];
    console.log("🔍 [REDACT] OCR completed - Text length:", rawText.length, "Words:", words.length);

    const hasPII = detectPIIFromText(rawText);
    console.log("🔍 [REDACT] PII detection result:", hasPII ? "FOUND PII" : "NO PII");
    
    if (!hasPII) {
      console.log("🔍 [REDACT] No PII found, returning original");
      return { redactedPath: null, usedRedaction: false };
    }

    console.log("🔍 [REDACT] Starting word-by-word redaction...");
    let redactedCount = 0;
    
    // Heuristic: redact lines/words that look like PII by regex again per word
    for (const w of words) {
      const t = String(w?.text || "").trim();
      if (!t) continue;
      
      const looksSensitive = detectPIIFromText(t);
      if (looksSensitive) {
        console.log("🔍 [REDACT] Found sensitive word:", t, "bbox:", w?.bbox);
        
        if (w?.bbox) {
          const x = Math.max(0, Math.floor(w.bbox.x0));
          const y = Math.max(0, Math.floor(w.bbox.y0));
          const wdt = Math.max(1, Math.floor(w.bbox.x1 - w.bbox.x0));
          const hgt = Math.max(1, Math.floor(w.bbox.y1 - w.bbox.y0));
          
          console.log(`🔍 [REDACT] Redacting area: x=${x}, y=${y}, w=${wdt}, h=${hgt}`);
          
          // Method 1: Try scan function
          try {
            image.scan(x, y, wdt, hgt, function (xx, yy, idx) {
              // Fill with solid black
              this.bitmap.data[idx + 0] = 0;
              this.bitmap.data[idx + 1] = 0;
              this.bitmap.data[idx + 2] = 0;
              this.bitmap.data[idx + 3] = 255;
            });
            console.log(`🔍 [REDACT] Successfully redacted using scan method`);
          } catch (scanError) {
            console.warn(`🔍 [REDACT] Scan method failed, trying setPixelColor:`, scanError.message);
            
            // Method 2: Fallback to setPixelColor
            try {
              for (let px = x; px < x + wdt; px++) {
                for (let py = y; py < y + hgt; py++) {
                  if (px < image.width && py < image.height) {
                    image.setPixelColor(0x000000FF, px, py); // Black
                  }
                }
              }
              console.log(`🔍 [REDACT] Successfully redacted using setPixelColor method`);
            } catch (pixelError) {
              console.error(`🔍 [REDACT] Both redaction methods failed:`, pixelError.message);
            }
          }
          
          redactedCount++;
        } else {
          console.warn("🔍 [REDACT] Sensitive word found but no bbox:", t);
          
          // Fallback: If no bbox, try to redact based on text position heuristics
          // This is a rough estimation - redact a small area in the center
          const centerX = Math.floor(image.width / 2);
          const centerY = Math.floor(image.height / 2);
          const fallbackWidth = Math.min(200, Math.floor(image.width * 0.3));
          const fallbackHeight = 30;
          
          console.log(`🔍 [REDACT] Using fallback redaction at center: x=${centerX-fallbackWidth/2}, y=${centerY}, w=${fallbackWidth}, h=${fallbackHeight}`);
          
          try {
            for (let px = centerX - fallbackWidth/2; px < centerX + fallbackWidth/2; px++) {
              for (let py = centerY; py < centerY + fallbackHeight; py++) {
                if (px >= 0 && px < image.width && py >= 0 && py < image.height) {
                  image.setPixelColor(0x000000FF, Math.floor(px), Math.floor(py));
                }
              }
            }
            console.log(`🔍 [REDACT] Applied fallback redaction`);
            redactedCount++;
          } catch (fallbackError) {
            console.error(`🔍 [REDACT] Fallback redaction failed:`, fallbackError.message);
          }
        }
      }
    }

    console.log(`🔍 [REDACT] Redacted ${redactedCount} sensitive words`);
    
    // If we detected PII but couldn't redact any words (bbox issues), apply blanket redaction
    if (redactedCount === 0) {
      console.warn("🔍 [REDACT] PII detected but no words were redacted - applying blanket protection");
      
      // Apply a semi-transparent black overlay to the entire image
      const overlayColor = 0x00000080; // Black with 50% transparency
      for (let x = 0; x < image.width; x++) {
        for (let y = 0; y < image.height; y++) {
          const currentColor = image.getPixelColor(x, y);
          // Blend with black overlay
          image.setPixelColor(overlayColor, x, y);
        }
      }
      
      // Add a warning text overlay
      try {
        // Create a large black bar in the center
        const barHeight = 60;
        const barY = Math.floor((image.height - barHeight) / 2);
        
        for (let x = 0; x < image.width; x++) {
          for (let y = barY; y < barY + barHeight; y++) {
            image.setPixelColor(0x000000FF, x, y); // Solid black
          }
        }
        
        console.log("🔍 [REDACT] Applied blanket redaction due to PII detection failure");
        redactedCount = 1; // Mark as redacted
      } catch (blanketError) {
        console.error("🔍 [REDACT] Blanket redaction failed:", blanketError.message);
      }
    }

    // Replace the original file with the redacted version
    await image.write(inputPath);
    console.log("🔍 [REDACT] Replaced original screenshot with redacted version:", inputPath);
    
    // Verify file was updated
    if (fs.existsSync(inputPath)) {
      const stats = fs.statSync(inputPath);
      console.log("🔍 [REDACT] Verification: redacted file saved, size:", stats.size, "bytes");
    } else {
      console.error("🔍 [REDACT] ERROR: Redacted file was not saved!");
    }
    
    // Return the original path since we replaced the file in place
    return { redactedPath: inputPath, usedRedaction: true, redactedCount };
  } catch (e) {
    console.error("🔍 [REDACT] Redaction failed:", e?.message || e);
    console.error("🔍 [REDACT] Stack trace:", e?.stack);
    return { redactedPath: null, usedRedaction: false };
  }
}

function startWindowMonitoring() {
  console.log("👁️ Starting window monitoring...");
  console.log("👁️ Current monitoring state:", {
    aiAnalysisEnabled,
    currentWorkContext,
  });

  if (windowMonitoringInterval) {
    console.log("👁️ Clearing existing monitoring interval");
    clearInterval(windowMonitoringInterval);
  }
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  lastWindowChangeAt = Date.now();

  windowMonitoringInterval = setInterval(async () => {
    try {
      const currentWindow = await getCurrentActiveWindow();

      if (currentWindow !== lastActiveWindow) {
        console.log(
          `🔄 Window changed: ${lastActiveWindow} → ${currentWindow}`,
        );
        lastWindowChangeAt = Date.now();

        // Take screenshot when window changes
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        screenshotCounter++;
        const filename = `window-change-${screenshotCounter}-${timestamp}.png`;

        try {
          const screenshotPath = await takeScreenshotToFile(filename);

          // Send window change event to renderer
          const mainWindow = BrowserWindow.getAllWindows().find(
            (win) => !win.isDestroyed(),
          );

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.webContents.send("window:changed", {
                previousWindow: lastActiveWindow,
                currentWindow: currentWindow,
                screenshotPath: screenshotPath,
                timestamp: Date.now(),
              });
            } catch (error) {
              console.warn(
                "⚠️ Failed to send window change event (window may be destroyed):",
                error.message,
              );
            }
          }

          // If AI analysis is enabled, redact PII if needed, then analyze with cooldown
          console.log("🤖 Checking AI analysis conditions:", {
            aiAnalysisEnabled,
            currentWorkContext,
            hasWorkContext: !!currentWorkContext,
          });
          if (aiAnalysisEnabled && currentWorkContext) {
            const now = Date.now();
            if (now - lastAnalysisTime >= ANALYSIS_COOLDOWN) {
              lastAnalysisTime = now;
              console.log(
                "🤖 Starting AI analysis for screenshot:",
                screenshotPath,
              );
              // Run OCR + PII redaction
              console.log("🔍 [AI] Starting redaction check for:", screenshotPath);
              try {
                const { redactedPath, usedRedaction, redactedCount } = await ocrAndMaybeRedactImage(
                  screenshotPath,
                );
                if (usedRedaction) {
                  console.log(`🔍 [AI] Screenshot redacted in place (${redactedCount} items redacted)`);
                } else {
                  console.log("🔍 [AI] No PII found, using original screenshot");
                }
                // Always use the screenshotPath since redaction is done in place
              } catch (e) {
                console.error(
                  "🔍 [AI] OCR/Redaction failed, using original screenshot:",
                  e?.message || e,
                );
              }
              const pathForAI = screenshotPath;
              // Emit detecting state while waiting for AI response
              try {
                const mainWindowForDetect = BrowserWindow.getAllWindows().find(
                  (win) => !win.isDestroyed(),
                );
                if (mainWindowForDetect && !mainWindowForDetect.isDestroyed()) {
                  mainWindowForDetect.webContents.send("focus:analysis", {
                    result: "检测中",
                    reason: "AI分析中",
                    workContext: currentWorkContext,
                    screenshotPath: screenshotPath, // Always use original path since redaction is in place
                    timestamp: Date.now(),
                    rawResult: "检测中",
                    rawReason: "AI分析中",
                    consensus: 0,
                  });
                }
              } catch (_) {}
              analyzeScreenshotForFocus(pathForAI);
            } else {
              console.log(
                `⏳ Analysis cooldown active, skipping (${Math.round((ANALYSIS_COOLDOWN - (now - lastAnalysisTime)) / 1000)}s remaining)`,
              );
            }
          } else {
            console.log("🤖 AI analysis not triggered - conditions not met:", {
              aiAnalysisEnabled,
              currentWorkContext,
            });
          }
        } catch (screenshotError) {
          console.error("Failed to take screenshot:", screenshotError);
        }

        lastActiveWindow = currentWindow;
      }
    } catch (error) {
      console.error("Window monitoring error:", error);
    }
  }, 1000); // Check every second

  // Idle input checker (approximate CGEventTap using HIDIdleTime)
  function getIdleSeconds() {
    return new Promise((resolve) => {
      exec(
        "ioreg -r -k HIDIdleTime -d 1 | awk '/HIDIdleTime/ {print $NF/1000000000; exit}' | tr -d '\n'",
        (err, stdout) => {
          if (err) {
            console.warn("⚠️ Failed to read HIDIdleTime:", err.message);
            resolve(-1);
            return;
          }
          const sec = parseFloat(stdout || "0");
          resolve(isNaN(sec) ? -1 : sec);
        },
      );
    });
  }

  idleCheckInterval = setInterval(async () => {
    try {
      const sinceChangeMs = Date.now() - lastWindowChangeAt;
      const idleSec = await getIdleSeconds();
      // Enter idle (待机中): no window switch >= 60s AND idle >= 30s
      if (sinceChangeMs >= 60_000 && idleSec >= 30) {
        if (!isIdleMode) {
          isIdleMode = true;
          const mainWindow = BrowserWindow.getAllWindows().find(
            (win) => !win.isDestroyed(),
          );
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              // Prefer continuation suggestion on idle
              (async () => {
                try {
                  if (lastOnTaskScreenshotPath && fs.existsSync(lastOnTaskScreenshotPath)) {
                    const prevBuf = fs.readFileSync(lastOnTaskScreenshotPath);
                    const prevB64 = prevBuf.toString("base64");
                    const suggestion = await generateContinuationSuggestion(prevB64, currentWorkContext);
                    currentDistractionMessage = suggestion;
                    showDistractionAlert();
                  } else {
                    const aiMessage = await generateDistractionMessage(null, currentWorkContext);
                    currentDistractionMessage = aiMessage;
                    showDistractionAlert();
                  }
                } catch (e) {
                  console.error("❌ Idle continuation failed, using default:", e);
                  currentDistractionMessage = "Stop being idle, get back to work";
                  showDistractionAlert();
                }
              })();
              
              mainWindow.webContents.send("focus:analysis", {
                result: "待机中",
                reason: "超过1分钟未切换窗口且30秒无输入",
                workContext: currentWorkContext,
                screenshotPath: "",
                timestamp: Date.now(),
                rawResult: "待机中",
                rawReason: "空闲输入检测",
                consensus: 1,
              });
            } catch (e) {
              console.warn(
                "⚠️ Failed to send idle state event:",
                e?.message || e,
              );
            }
          }
        }
      } else {
        // Exit idle to focus when input resumes (idle seconds very small)
        if (isIdleMode && idleSec >= 0 && idleSec <= 3) {
          isIdleMode = false;
          const mainWindow = BrowserWindow.getAllWindows().find(
            (win) => !win.isDestroyed(),
          );
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.webContents.send("focus:analysis", {
                result: "专注中",
                reason: "检测到键鼠输入，退出待机",
                workContext: currentWorkContext,
                screenshotPath: "",
                timestamp: Date.now(),
                rawResult: "专注中",
                rawReason: "输入恢复",
                consensus: 1,
              });
            } catch (e) {
              console.warn(
                "⚠️ Failed to send resume focus event:",
                e?.message || e,
              );
            }
          }
        }
      }

      // Escalate 半分心 -> 分心中 after 60s continuous semi-distracted
      if (semiStartAt && !semiEscalated && Date.now() - semiStartAt >= 60_000) {
        semiEscalated = true;
        const mainWindow = BrowserWindow.getAllWindows().find(
          (win) => !win.isDestroyed(),
        );
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            // Prefer continuation on escalation
            (async () => {
              try {
                if (lastOnTaskScreenshotPath && fs.existsSync(lastOnTaskScreenshotPath)) {
                  const prevBuf = fs.readFileSync(lastOnTaskScreenshotPath);
                  const prevB64 = prevBuf.toString("base64");
                  const suggestion = await generateContinuationSuggestion(prevB64, currentWorkContext);
                  currentDistractionMessage = suggestion;
                  showDistractionAlert();
                } else {
                  const aiMessage = await generateDistractionMessage(null, currentWorkContext);
                  currentDistractionMessage = aiMessage;
                  showDistractionAlert();
                }
              } catch (e) {
                console.error("❌ Escalation continuation failed, using default:", e);
                currentDistractionMessage = "Focus needed, get back to work";
                showDistractionAlert();
              }
            })();
            
            mainWindow.webContents.send("focus:analysis", {
              result: "分心中",
              reason: "半分心持续超过1分钟",
              workContext: currentWorkContext,
              screenshotPath: "",
              timestamp: Date.now(),
              rawResult: "分心中",
              rawReason: "半分心升级",
              consensus: 2,
            });
          } catch (e) {
            console.warn(
              "⚠️ Failed to send semi escalation event:",
              e?.message || e,
            );
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Idle check error:", e?.message || e);
    }
  }, 1000);
}

function stopWindowMonitoring() {
  if (windowMonitoringInterval) {
    clearInterval(windowMonitoringInterval);
    windowMonitoringInterval = null;
    aiAnalysisEnabled = false;
    console.log("🛑 Stopped window monitoring");
  }
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  if (distractionReminderInterval) {
    clearInterval(distractionReminderInterval);
    distractionReminderInterval = null;
  }
}

// Enhanced cleanup function for app shutdown
function cleanupAllMonitoring() {
  console.log("🧹 Cleaning up all monitoring and timers...");

  // Stop window monitoring
  stopWindowMonitoring();

  // Stop activity monitoring
  stopMonitoring();

  // Disable AI analysis
  disableAIAnalysis();

  console.log("✅ All monitoring cleaned up");
}

function enableAIAnalysis(workContext) {
  currentWorkContext = workContext;
  aiAnalysisEnabled = true;
  
  // Initialize nudge system
  initializeNudgeSystem(workContext);
  
  console.log("🤖 AI analysis enabled for work context:", workContext);
  console.log("🤖 AI analysis status:", {
    aiAnalysisEnabled,
    currentWorkContext,
  });
}

// Initialize the nudge system
function initializeNudgeSystem(workContext) {
  try {
    // Initialize components
    contextSampler = new ContextSampler();
    entityCache = new EntityCache();
    
    // Create AI caller function for nudge generator
    const aiCaller = async (messages) => {
      const provider = defaultConfig?.ai?.provider || "bailian";
      const apiKey = defaultConfig?.ai?.apiKey || "";
      
      if (!apiKey) {
        throw new Error("No AI API key available");
      }
      
      return await callAIForNudge(messages, provider, apiKey);
    };
    
    nudgeGenerator = new NudgeGenerator(aiCaller);
    
    // Start context sampling
    contextSampler.start();
    
    // Setup milestone event detection
    setupMilestoneDetection();
    
    console.log("🎯 Nudge system initialized");
  } catch (error) {
    console.error("❌ Failed to initialize nudge system:", error);
  }
}

// Setup milestone event detection
function setupMilestoneDetection() {
  try {
    // Use globalShortcut to detect key combinations
    const { globalShortcut } = require('electron');
    
    // Register shortcuts for milestone events
    const shortcuts = [
      { key: 'CommandOrControl+S', event: 'save' },
      { key: 'CommandOrControl+R', event: 'run' },
      { key: 'CommandOrControl+T', event: 'test' },
      { key: 'F5', event: 'run' },
      { key: 'CommandOrControl+Shift+T', event: 'test' }
    ];
    
    shortcuts.forEach(({ key, event }) => {
      try {
        globalShortcut.register(key, () => {
          handleMilestoneEvent(event);
        });
      } catch (error) {
        // Some shortcuts might conflict, ignore errors
        console.warn(`⚠️ Could not register shortcut ${key}:`, error.message);
      }
    });
    
    // Setup periodic tab change detection via AppleScript
    setInterval(async () => {
      try {
        await detectBrowserTabChanges();
      } catch (error) {
        // Ignore errors in background detection
      }
    }, 5000); // Check every 5 seconds
    
    console.log('🎯 Milestone detection setup complete');
  } catch (error) {
    console.warn('⚠️ Milestone detection setup failed:', error.message);
  }
}

// Handle milestone events
async function handleMilestoneEvent(eventType) {
  if (!contextSampler || !entityCache) return;
  
  try {
    console.log(`🎯 Milestone event detected: ${eventType}`);
    const sample = await contextSampler.onMilestoneEvent(eventType);
    if (sample) {
      entityCache.addSample(sample);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to handle milestone event ${eventType}:`, error.message);
  }
}

// Detect browser tab changes
let lastBrowserUrl = '';
async function detectBrowserTabChanges() {
  try {
    const script = `
      try {
        tell application "Google Chrome"
          if (count of windows) > 0 then
            set activeTab to active tab of front window
            return URL of activeTab
          end if
        end tell
      on error
        try {
          tell application "Safari"
            if (count of windows) > 0 then
              set activeTab to current tab of front window
              return URL of activeTab
            end if
          end tell
        on error
          return ""
        end try
      end try
    `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const currentUrl = stdout.trim();
    
    if (currentUrl && currentUrl !== lastBrowserUrl && currentUrl !== 'missing value') {
      lastBrowserUrl = currentUrl;
      await handleMilestoneEvent('tab_switch');
    }
  } catch (error) {
    // Ignore errors in background detection
  }
}

function disableAIAnalysis() {
  aiAnalysisEnabled = false;
  currentWorkContext = "";
  
  // Clean up nudge system
  if (contextSampler) {
    contextSampler.stop();
    contextSampler = null;
  }
  if (entityCache) {
    entityCache.clear();
    entityCache = null;
  }
  if (nudgeGenerator) {
    nudgeGenerator.resetSession();
    nudgeGenerator = null;
  }
  
  // Clean up global shortcuts
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
    console.log('🧹 Global shortcuts cleaned up');
  } catch (error) {
    console.warn('⚠️ Failed to cleanup shortcuts:', error.message);
  }
  
  console.log("🤖 AI analysis disabled");

  // Clean up screenshots when session ends
  if (currentSessionScreenshots.length > 0) {
    cleanupScreenshots();
  }
}

// AI caller function for nudge generation
async function callAIForNudge(messages, provider, apiKey) {
  try {
    // Use existing AI chat handler but with specific formatting
    const result = await postJsonCustom(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
      {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      {
        model: "qwen-plus",
        input: { messages },
        parameters: { 
          temperature: 0.1, 
          result_format: "message",
          max_tokens: 50
        },
      }
    );

    const content = result?.output?.text || 
                   result?.output?.choices?.[0]?.message?.content || 
                   "Failed to generate nudge";

    return { content: content };
  } catch (error) {
    console.error("❌ AI nudge generation failed:", error);
    throw error;
  }
}

// Get current context metadata
async function getCurrentContextMeta() {
  try {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appId to bundle identifier of frontApp
        try
          set windowTitle to name of front window of frontApp
        on error
          set windowTitle to ""
        end try
        return appId & "|||" & windowTitle
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const [appId, windowTitle] = stdout.trim().split('|||');

    return {
      appId: appId || 'unknown',
      windowTitle: windowTitle || '',
      timestamp: Date.now()
    };
  } catch (error) {
    console.warn('⚠️ Failed to get current context meta:', error.message);
    return {
      appId: 'unknown',
      windowTitle: '',
      timestamp: Date.now()
    };
  }
}

// Fallback to old distraction system
async function fallbackToOldDistractionSystem(screenshotPath) {
  try {
    if (lastOnTaskScreenshotPath && fs.existsSync(lastOnTaskScreenshotPath)) {
      const prevBuf = fs.readFileSync(lastOnTaskScreenshotPath);
      const prevB64 = prevBuf.toString("base64");
      const suggestion = await generateContinuationSuggestion(prevB64, currentWorkContext);
      currentDistractionMessage = suggestion;
      showDistractionAlert();
    } else {
      // Fallback to current distraction message based on current screen
      const imageBuffer = fs.existsSync(screenshotPath) ? fs.readFileSync(screenshotPath) : null;
      const base64Image = imageBuffer ? imageBuffer.toString("base64") : null;
      const aiMessage = await generateDistractionMessage(base64Image, currentWorkContext);
      currentDistractionMessage = aiMessage;
      showDistractionAlert();
    }
  } catch (error) {
    console.error("❌ Failed to generate continuation/distraction message, using default:", error);
    currentDistractionMessage = "Get back to work";
    showDistractionAlert();
  }
}

async function analyzeScreenshotForFocus(screenshotPath) {
  try {
    console.log("🤖 Analyzing screenshot for focus:", screenshotPath);

    // Read screenshot file and convert to base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString("base64");

    // Get AI provider and key from config
    const provider = defaultConfig?.ai?.provider || "bailian";
    const apiKey = defaultConfig?.ai?.apiKey || "";

    if (!apiKey) {
      console.error("❌ No AI API key available for analysis");
      return;
    }

    // Analyze with AI
    const focusAnalysis = await analyzeScreenshotWithAI(
      base64Image,
      currentWorkContext,
      provider,
      apiKey,
    );

    // Handle structured response
    const currentStatus =
      typeof focusAnalysis === "object" ? focusAnalysis.status : focusAnalysis;
    const currentReason =
      typeof focusAnalysis === "object" ? focusAnalysis.reason : "未提供理由";

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
    } else if (
      currentStatus ===
      (typeof lastAnalysisResult === "object"
        ? lastAnalysisResult.status
        : lastAnalysisResult)
    ) {
      // Same status as last result, always send (but update reason)
      shouldUpdate = true;
      finalResult = focusAnalysis; // Use new reason
    } else {
      // Different status, immediate update
      shouldUpdate = true;
      console.log(
        `✅ Status change: ${typeof lastAnalysisResult === "object" ? lastAnalysisResult.status : lastAnalysisResult} → ${currentStatus}`,
      );
      finalResult = focusAnalysis;
    }

    // Store sameCount for later use
    const consensusCount = statusHistory.filter(
      (r) => r === currentStatus,
    ).length;

    if (shouldUpdate) {
      lastAnalysisResult = finalResult;

      // Send result to main window
      const mainWindow = BrowserWindow.getAllWindows().find(
        (win) => !win.isDestroyed(),
      );

      if (mainWindow && !mainWindow.isDestroyed()) {
        const resultToSend =
          typeof finalResult === "object"
            ? finalResult
            : { status: finalResult, reason: "未提供理由" };
        const rawToSend =
          typeof focusAnalysis === "object"
            ? focusAnalysis
            : { status: focusAnalysis, reason: "未提供理由" };

        // If distracted, show system-level alert window
        try {
          const statusText = resultToSend.status || "";
          // Track semi-distracted periods for escalation
          if (statusText.includes("半分心")) {
            if (!semiStartAt) {
              semiStartAt = Date.now();
              semiEscalated = false;
            }
            // Save last on-task screenshot when semi-focus
            try {
              if (screenshotPath && fs.existsSync(screenshotPath)) {
                lastOnTaskScreenshotPath = screenshotPath;
              }
              
              // Sample context when semi-focused
              if (contextSampler && entityCache) {
                contextSampler.sampleContext('semi_focus_state').then(sample => {
                  if (sample) {
                    entityCache.addSample(sample);
                  }
                });
              }
            } catch (_) {}
          } else {
            // Any non-semi status resets the semi tracking
            semiStartAt = null;
            semiEscalated = false;
          }

          if (statusText.includes("分心")) {
            // Use new nudge system if available, otherwise fallback to old system
            if (nudgeGenerator && entityCache && contextSampler) {
              (async () => {
                try {
                  // Sample current context
                  const currentMeta = await getCurrentContextMeta();
                  
                  // Generate nudge using new system
                  const nudgeMessage = await nudgeGenerator.generate(currentWorkContext, entityCache, currentMeta);
                  
                  if (nudgeMessage) {
                    currentDistractionMessage = nudgeMessage;
                    showDistractionAlert();
                    isInDistractionWindow = true;
                    setTimeout(() => { isInDistractionWindow = false; }, 90000); // 90 seconds
                  }
                } catch (error) {
                  console.error("❌ Nudge generation failed, using fallback:", error);
                  // Fallback to old system
                  await fallbackToOldDistractionSystem(screenshotPath);
                }
              })();
            } else {
              // Fallback to old system
              await fallbackToOldDistractionSystem(screenshotPath);
            }
            
            if (!distractionReminderInterval) {
              distractionReminderInterval = setInterval(() => {
                try {
                  (async () => {
                    try {
                      if (lastOnTaskScreenshotPath && fs.existsSync(lastOnTaskScreenshotPath)) {
                        const prevBuf = fs.readFileSync(lastOnTaskScreenshotPath);
                        const prevB64 = prevBuf.toString("base64");
                        const suggestion = await generateContinuationSuggestion(prevB64, currentWorkContext);
                        currentDistractionMessage = suggestion;
                        showDistractionAlert();
                      } else {
                        const imageBuffer = fs.existsSync(screenshotPath) ? fs.readFileSync(screenshotPath) : null;
                        const base64Image = imageBuffer ? imageBuffer.toString("base64") : null;
                        const aiMessage = await generateDistractionMessage(base64Image, currentWorkContext);
                        currentDistractionMessage = aiMessage;
                        showDistractionAlert();
                      }
                    } catch (error) {
                      console.error("❌ Reminder generation failed, using default:", error);
                      currentDistractionMessage = "Get back to work";
                      showDistractionAlert();
                    }
                  })();
                } catch (_) {}
              }, 5000);
              console.log("🔔 Started periodic distraction reminders with AI messages");
            }
          } else {
            // Focus or semi-distracted → stop reminders
            if (distractionReminderInterval) {
              clearInterval(distractionReminderInterval);
              distractionReminderInterval = null;
              console.log("🔕 Stopped periodic distraction reminders");
            }
            // Save last on-task screenshot when focus
            try {
              if (screenshotPath && fs.existsSync(screenshotPath)) {
                lastOnTaskScreenshotPath = screenshotPath;
              }
              
              // Sample context when focused
              if (contextSampler && entityCache) {
                contextSampler.sampleContext('focus_state').then(sample => {
                  if (sample) {
                    entityCache.addSample(sample);
                  }
                });
              }
            } catch (_) {}
          }
        } catch (e) {
          console.warn(
            "⚠️ Failed to manage distraction reminders:",
            e?.message || e,
          );
        }

        try {
          mainWindow.webContents.send("focus:analysis", {
            result: resultToSend.status,
            reason: resultToSend.reason,
            workContext: currentWorkContext,
            screenshotPath: screenshotPath,
            timestamp: Date.now(),
            rawResult: rawToSend.status,
            rawReason: rawToSend.reason,
            consensus: consensusCount,
          });
        } catch (error) {
          console.warn(
            "⚠️ Failed to send focus analysis (window may be destroyed):",
            error.message,
          );
        }
      }
    }

    console.log("🎯 Focus analysis result:", currentStatus, "→", finalResult);
  } catch (error) {
    console.error("❌ Failed to analyze screenshot for focus:", error);
  }
}

async function analyzeScreenshotWithAI(
  base64Image,
  workContext,
  provider,
  apiKey,
) {
  const analysisPrompt = `分析用户的专注状态。

工作目标: "${workContext}"

请根据截图内容判断用户的专注状态，只返回JSON格式：
{
  "status": "状态",
  "reason": "原因"
}

状态只能是以下三个之一：
- "专注中": 屏幕内容与工作目标直接相关
- "半分心": 在做辅助性工作（设置、音乐、简单沟通等）
- "分心中": 屏幕内容与工作目标无关（社交媒体、视频、购物、游戏等）

只返回JSON，不要其他解释。`;

// Generate continuation suggestion from last on-task screenshot
async function generateContinuationSuggestion(base64PrevImage, workContext) {
  const prompt = `The user was working on: ${workContext}.
They got distracted for a while.
Here is the unfinished work screenshot provided as an image input.
Task: Based on what you see in the screenshot, generate a short, actionable suggestion that nudges the user to continue their work.
Do not give advice about what they should do. Instead, act as if you are the user and directly continue their work by adding a concrete next step.
Write only the next small piece (one sentence, one bullet, or a few lines of code).
Format: "Your attention score is decreasing, you can try to add [a specific concrete next element, data, or example relevant to the work, e.g. 'an APAC vs EMEA margin comparison' or 'a patient outcome under Personalized treatment']"
Constraints:
- Keep the suggestion short and actionable (<= 15 words after "try to")
- Be specific about what to add next based on the visible work (e.g., concrete data, example, or item)
- Use encouraging language like "try to add"
- Do NOT mention screenshots or analysis`;

  try {
    const provider = defaultConfig?.ai?.provider || "bailian";
    const apiKey = defaultConfig?.ai?.apiKey || "";
    if (!apiKey) return "Your attention score is decreasing, you can try to resume where you left off";

    const result = await Promise.race([
      callAIWithVision(
        provider,
        apiKey,
        {
          model: "qwen-vl-plus-latest",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                base64PrevImage
                  ? { type: "image_url", image_url: { url: `data:image/png;base64,${base64PrevImage}` } }
                  : { type: "text", text: "No screenshot available" },
              ],
            },
          ],
          max_tokens: 60,
          temperature: 0.3,
        },
        base64PrevImage,
        prompt,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Continuation timeout")), 10000)),
    ]);

    let suggestion = (result?.content || "").trim();
    suggestion = suggestion.replace(/^"|"$/g, "");
    if (!suggestion) return "Pick up the next small step";
    const words = suggestion.split(" ");
    if (words.length > 12) suggestion = words.slice(0, 12).join(" ");
    suggestion = suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
    return suggestion;
  } catch (e) {
    console.warn("⚠️ Continuation suggestion failed:", e?.message || e);
    return "Pick up the next small step";
  }
}

  try {
    // For vision analysis, we need to use a vision-capable model
    const visionPayload = {
      model: "qwen-vl-plus-latest",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } },
          ],
        },
      ],
      max_tokens: 80,
      temperature: 0.1,
    };

    console.log("🔗 Calling AI with provider:", provider);
    console.log("🔗 Payload:", JSON.stringify(visionPayload, null, 2));

    const result = await callAIWithVision(
      provider,
      apiKey,
      visionPayload,
      base64Image,
      analysisPrompt,
    );
    console.log("🔗 Raw AI result:", JSON.stringify(result, null, 2));

    const response = result?.content?.trim() || "{}";

    console.log("🔍 AI Vision Analysis Raw Response:", response);

    // Parse the structured response
    const parsed = parseAIResponse(response);
    if (parsed && parsed.status && ["专注中","半分心","分心中"].includes(parsed.status)) {
      return parsed;
    }
    // Fallback: heuristic from text if JSON failed
    const lower = response.toLowerCase();
    if (lower.includes("分心")) return { status: "分心中", reason: "与目标无关的内容" };
    if (lower.includes("半分心")) return { status: "半分心", reason: "辅助性操作" };
    if (lower.includes("专注")) return { status: "专注中", reason: "与目标一致" };
    return { status: "半分心", reason: "无法严格解析，保守判断" };
  } catch (error) {
    console.error("❌ AI analysis failed with error:", error);
    console.error("❌ Error stack:", error.stack);
    return "UNCLEAR";
  }
}

function parseAIResponse(response) {
  let cleanResponse = response.trim();

  // Handle potential markdown code blocks around JSON
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.substring(7).trim();
    if (cleanResponse.endsWith("```")) {
      cleanResponse = cleanResponse.slice(0, -3).trim();
    }
  } else if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.substring(3).trim();
    if (cleanResponse.endsWith("```")) {
      cleanResponse = cleanResponse.slice(0, -3).trim();
    }
  }

  // Attempt to parse as JSON first
  try {
    const jsonResponse = JSON.parse(cleanResponse);
    if (jsonResponse.status && jsonResponse.reason) {
      const status = (jsonResponse.status || "").trim();
      const reason = (jsonResponse.reason || "").trim();
      const validStati = ["专注中", "半分心", "分心中"];
      if (validStati.includes(status)) {
        console.log("✅ Parsed structured JSON response from AI.");
        return {
          status: status,
          reason: reason,
          raw: response,
        };
      }
    }
  } catch (e) {
    console.warn("⚠️ AI response was not valid JSON, falling back to text parsing.", cleanResponse);
  }

  // Fallback 1: try to parse the structured text response
  try {
    // Try to parse structured response first
    const statusMatch = response.match(/状态:\s*(.+)/);
    const reasonMatch = response.match(/理由:\s*(.+)/);

    if (statusMatch && reasonMatch) {
      let status = statusMatch[1].trim();
      const reason = reasonMatch[1].trim();

      // Clean up status - remove brackets and extra formatting
      status = status.replace(/[\[\]]/g, "").trim();

      return {
        status: status,
        reason: reason,
        raw: response
      };
    }

    // Fallback: try to extract just the status from old format
    const cleanResponse = response.toLowerCase().trim();
    let status = "UNCLEAR";

    if (cleanResponse.includes("专注中") || cleanResponse.includes("专注")) {
      status = "专注中";
    } else if (cleanResponse.includes("半分心")) {
      status = "半分心";
    } else if (
      cleanResponse.includes("分心中") ||
      cleanResponse.includes("分心")
    ) {
      status = "分心中";
    }

    return {
      status: status,
      reason: "未提供详细理由",
      raw: response,
    };
  } catch (error) {
    console.error("❌ Failed to parse AI response:", error);
    return {
      status: "UNCLEAR",
      reason: "解析失败",
      raw: response,
    };
  }
}

async function callAIWithVision(
  provider,
  apiKey,
  payload,
  base64Image,
  analysisPrompt,
) {
  // Always use qwen-vl-max for all vision analysis, regardless of provider
  const url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  // Use qwen-vl-max model with DashScope format for all providers
  const dashScopePayload = {
    model: "qwen-vl-plus-latest",
    input: {
      messages: [
        {
          role: "user",
          content: [
            { text: analysisPrompt },
            { image: `data:image/png;base64,${base64Image}` },
          ],
        },
      ],
    },
    parameters: {
      max_tokens: payload.max_tokens,
      temperature: payload.temperature,
    },
  };
  
  console.log("🔗 Using qwen-vl-plus-latest for vision analysis");
  console.log("🔗 DashScope URL:", url);
  console.log("🔗 DashScope headers:", headers);
  console.log(
    "🔗 DashScope payload:",
    JSON.stringify(dashScopePayload, null, 2),
  );

  const dashResult = await postJsonCustom(url, headers, dashScopePayload);
  console.log("🔗 DashScope raw result:", JSON.stringify(dashResult, null, 2));

  // DashScope multimodal response format
  const content =
    dashResult?.output?.choices?.[0]?.message?.content?.[0]?.text ||
    dashResult?.output?.text ||
    "UNCLEAR";
  console.log("🔗 Extracted content:", content);

  return { content: content };
}

// Old monitoring functions removed - replaced by window monitoring with AI analysis

// --- Simple AI proxy using fetch-like HTTPS (OpenRouter/OpenAI compatible) ---
function postJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = Buffer.from(JSON.stringify(payload));
      const req = https.request(
        {
          method: "POST",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers: {
            "content-type": "application/json",
            "content-length": data.length,
            authorization: `Bearer ${apiKey}`,
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve({ error: "invalid_json", raw: body });
            }
          });
        },
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function postJsonCustom(url, headers, payload) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = Buffer.from(JSON.stringify(payload));
      const req = https.request(
        {
          method: "POST",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers: {
            ...headers,
            "content-length": data.length,
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve({ error: "invalid_json", raw: body });
            }
          });
        },
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Test function for AI distraction messages
ipcMain.handle("ai:test-distraction-message", async (evt, { workContext, base64Image }) => {
  try {
    console.log("🧪 Testing AI distraction message generation");
    const message = await generateDistractionMessage(base64Image, workContext);
    return { success: true, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Manual trigger for testing distraction alerts
ipcMain.on("test:show-distraction-alert", (evt, message) => {
  if (message) {
    currentDistractionMessage = message;
  }
  console.log("🧪 Manually triggering distraction alert with message:", currentDistractionMessage);
  showDistractionAlert();
});

// Manual test: generate continuation message from last on-task screenshot
ipcMain.handle("ai:test-continuation", async (evt, { workContext }) => {
  try {
    if (!lastOnTaskScreenshotPath || !fs.existsSync(lastOnTaskScreenshotPath)) {
      return { success: false, error: "No last on-task screenshot available" };
    }
    const prevBuf = fs.readFileSync(lastOnTaskScreenshotPath);
    const prevB64 = prevBuf.toString("base64");
    const suggestion = await generateContinuationSuggestion(prevB64, workContext || currentWorkContext);
    return { success: true, message: suggestion };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

// Test nudge system
ipcMain.handle("nudge:test", async (evt, { workContext }) => {
  try {
    if (!nudgeGenerator || !entityCache || !contextSampler) {
      return { success: false, error: "Nudge system not initialized" };
    }
    
    const currentMeta = await getCurrentContextMeta();
    const nudgeMessage = await nudgeGenerator.forceGenerate(workContext || currentWorkContext, entityCache, currentMeta);
    
    return { success: true, message: nudgeMessage };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

// Get nudge system stats
ipcMain.handle("nudge:stats", async () => {
  try {
    const stats = {
      contextSampler: contextSampler ? 'active' : 'inactive',
      entityCache: entityCache ? entityCache.getStats() : null,
      nudgeGenerator: nudgeGenerator ? nudgeGenerator.getStats() : null,
      lastNudgeTime: lastNudgeTime,
      isInDistractionWindow: isInDistractionWindow
    };
    
    return { success: true, stats };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

// Force context sampling
ipcMain.handle("nudge:sample", async () => {
  try {
    if (!contextSampler || !entityCache) {
      return { success: false, error: "Context sampler not initialized" };
    }
    
    const sample = await contextSampler.sampleContext('manual_trigger');
    if (sample) {
      entityCache.addSample(sample);
      return { success: true, sample };
    } else {
      return { success: false, error: "Failed to sample context" };
    }
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle("ai:chat", async (evt, { messages, provider, apiKey }) => {
  try {
    if (!apiKey) {
      // No-key fallback: rule-based nudge
      const last = messages[messages.length - 1]?.content || "";
      const reply = `Got it. I'll keep you on task. Outline your next 3 concrete steps for: "${last.slice(0, 120)}"`;
      return { role: "assistant", content: reply };
    }

    // Always use qwen-plus for all text chat, regardless of provider
    const url =
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
    const payload = {
      model: "qwen-plus",
      input: { messages },
      parameters: { temperature: 0.3, result_format: "message" },
    };
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };

    console.log("🔗 Using qwen-plus for text chat");
    console.log("🔗 DashScope Text URL:", url);

    const result = await postJsonCustom(url, headers, payload);
    const content =
      result?.output?.text ||
      result?.output?.choices?.[0]?.message?.content ||
      result?.message ||
      "Qwen-plus API error";

    return { role: "assistant", content: content };
  } catch (e) {
    return {
      role: "assistant",
      content: "AI error: " + String(e?.message || e),
    };
  }
});
