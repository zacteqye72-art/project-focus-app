import AppKit

final class WindowLevelManager {
    
    enum Level {
        case statusBar
        case popUpMenu
        case custom(Int)
        
        var nsLevel: NSWindow.Level {
            switch self {
            case .statusBar:
                return .statusBar
            case .popUpMenu:
                return .popUpMenu
            case .custom(let value):
                return NSWindow.Level(rawValue: value)
            }
        }
        
        var description: String {
            switch self {
            case .statusBar:
                return "StatusBar (\(NSWindow.Level.statusBar.rawValue))"
            case .popUpMenu:
                return "PopUpMenu (\(NSWindow.Level.popUpMenu.rawValue))"
            case .custom(let value):
                return "Custom (\(value))"
            }
        }
    }
    
    private var currentLevel: Level = .statusBar
    private weak var window: NSWindow?
    
    init(window: NSWindow) {
        self.window = window
        setLevel(.statusBar)
    }
    
    func setLevel(_ level: Level) {
        currentLevel = level
        window?.level = level.nsLevel
        print("🏝️ Window level set to: \(level.description)")
        
        // 调试：验证窗口层级
        debugWindowLevels()
    }
    
    func getCurrentLevel() -> Level {
        return currentLevel
    }
    
    func toggleLevel() {
        switch currentLevel {
        case .statusBar:
            setLevel(.popUpMenu)
        case .popUpMenu:
            // 尝试更高层级确保覆盖
            let customLevel = CGWindowLevelForKey(.statusWindow) + 1
            setLevel(.custom(Int(customLevel)))
        case .custom:
            setLevel(.statusBar)
        }
    }
    
    private func debugWindowLevels() {
        guard let window = window else { return }
        
        print("🔍 Current window level: \(window.level.rawValue)")
        
        // 打印系统窗口层级参考
        let statusLevel = CGWindowLevelForKey(.statusWindow)
        let menuBarLevel = CGWindowLevelForKey(.mainMenuWindow)
        let normalLevel = CGWindowLevelForKey(.normalWindow)
        
        print("🔍 System levels reference:")
        print("  - Normal window: \(normalLevel)")
        print("  - Menu bar: \(menuBarLevel)")
        print("  - Status window: \(statusLevel)")
        print("  - Current island: \(window.level.rawValue)")
        
        // 列出顶层窗口（用于调试是否真的覆盖了菜单栏）
        listTopWindows()
    }
    
    private func listTopWindows() {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            print("❌ Failed to get window list")
            return
        }
        
        print("🏷️ Top 10 windows:")
        for (index, windowInfo) in windowList.prefix(10).enumerated() {
            let owner = windowInfo[kCGWindowOwnerName as String] as? String ?? "Unknown"
            let name = windowInfo[kCGWindowName as String] as? String ?? "Untitled"
            let level = windowInfo[kCGWindowLayer as String] as? Int ?? 0
            
            print("  \(index + 1). \(owner) - \(name) (level: \(level))")
            
            // 特别关注 SystemUIServer（菜单栏）
            if owner.contains("SystemUIServer") {
                print("    ↑ This is the menu bar")
            }
        }
    }
}
