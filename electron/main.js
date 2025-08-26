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
const { execFile, exec } = require("child_process");
const Store = require("electron-store");
const https = require("https");
const fs = require("fs");

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
      backgroundColor: "#FFFFFF",
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
    distractionAlertWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    distractionAlertWindow.setAlwaysOnTop(true, "screen-saver");
    distractionAlertWindow.loadFile(
      path.join(__dirname, "..", "src", "alert.html"),
    );

    // Handle window close to prevent main window activation
    distractionAlertWindow.on("closed", () => {
      distractionAlertWindow = null;

      // Prevent main window from gaining focus
      setTimeout(() => {
        const mainWindow = BrowserWindow.getAllWindows().find(
          (win) => win !== dynamicIslandWindow && !win.isDestroyed(),
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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Create a separate HTML file for the Dynamic Island
  dynamicIslandWindow.loadFile(
    path.join(__dirname, "..", "src", "island.html"),
  );

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
    window !== dynamicIslandWindow && window !== distractionAlertWindow;

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
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.webContents.send("island:update", data);
  }
});

ipcMain.on("island:show", (event) => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.show();
  }
});

ipcMain.on("island:hide", (event) => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.hide();
  }
});

ipcMain.on("island:action", (event, action) => {
  // Send island actions back to main window
  const mainWindow = BrowserWindow.getAllWindows().find(
    (win) => win !== dynamicIslandWindow && !win.isDestroyed(),
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

// Screenshot management
let currentSessionScreenshots = [];
let distractionReminderInterval = null; // every 5s reminder while distracted

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
            (win) => win !== dynamicIslandWindow && !win.isDestroyed(),
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

          // If AI analysis is enabled, analyze the screenshot with cooldown
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
              analyzeScreenshotForFocus(screenshotPath);
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
      if (sinceChangeMs < 60_000) return; // only after 1 min without window switch
      const idleSec = await getIdleSeconds();
      console.log("🕑 Idle check:", { sinceChangeMs, idleSec });
      if (idleSec >= 30) {
        const mainWindow = BrowserWindow.getAllWindows().find(
          (win) => win !== dynamicIslandWindow && !win.isDestroyed(),
        );
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            showDistractionAlert();
            mainWindow.webContents.send("focus:analysis", {
              result: "分心",
              reason: "超过1分钟未切换窗口，且30秒无键鼠输入",
              workContext: currentWorkContext,
              screenshotPath: "",
              timestamp: Date.now(),
              rawResult: "分心",
              rawReason: "空闲输入检测",
              consensus: 1,
            });
          } catch (e) {
            console.warn(
              "⚠️ Failed to send idle distraction event:",
              e?.message || e,
            );
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Idle check error:", e?.message || e);
    }
  }, 30_000);
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
  console.log("🤖 AI analysis enabled for work context:", workContext);
  console.log("🤖 AI analysis status:", {
    aiAnalysisEnabled,
    currentWorkContext,
  });
}

function disableAIAnalysis() {
  aiAnalysisEnabled = false;
  currentWorkContext = "";
  console.log("🤖 AI analysis disabled");

  // Clean up screenshots when session ends
  if (currentSessionScreenshots.length > 0) {
    cleanupScreenshots();
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
        (win) => win !== dynamicIslandWindow && !win.isDestroyed(),
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
          if (statusText.includes("分心")) {
            // Start/maintain reminder loop
            showDistractionAlert();
            if (!distractionReminderInterval) {
              distractionReminderInterval = setInterval(() => {
                try {
                  showDistractionAlert();
                } catch (_) {}
              }, 5000);
              console.log("🔔 Started periodic distraction reminders");
            }
          } else {
            // Focus or semi-distracted → stop reminders
            if (distractionReminderInterval) {
              clearInterval(distractionReminderInterval);
              distractionReminderInterval = null;
              console.log("🔕 Stopped periodic distraction reminders");
            }
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
  const analysisPrompt = `You are an expert focus analyst. Analyze the user's screenshot to determine their focus state based on their stated work goal.
Work Goal: "${workContext}"

Analyze the image and respond with ONLY a JSON object in the following format, with no other text or explanations before or after the JSON block.
{
  "status": "...",
  "reason": "..."
}

Possible values for the "status" field are ONLY: "专注中", "半分心", "分心中".
The "reason" field should be a brief explanation (under 50 characters) in Chinese.`;

  try {
    // For vision analysis, we need to use a vision-capable model
    const visionPayload = {
      model: "qwen-vl-plus-latest", // Use Qwen VL Plus latest for vision analysis
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: 80, // Reduced for faster response
      temperature: 0.0, // Set to 0 for fastest, most deterministic response
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

    const response = result?.content?.trim() || "UNCLEAR";

    console.log("🔍 AI Vision Analysis Raw Response:", response);

    // Parse the structured response
    const parsed = parseAIResponse(response);
    return parsed;
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
        raw: response,
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
  const url =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
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
