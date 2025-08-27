import AppKit
import SwiftUI
import Foundation

// MARK: - Main Application Entry Point
final class DynamicIslandApp: NSApplication {
    private var appDelegate: DynamicIslandAppDelegate?
    
    override init() {
        super.init()
        self.appDelegate = DynamicIslandAppDelegate()
        self.delegate = appDelegate
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

// MARK: - App Delegate
final class DynamicIslandAppDelegate: NSObject, NSApplicationDelegate {
    private var controller: IslandWindowController?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        print("🏝️ Dynamic Island starting...")
        
        // 创建并显示灵动岛
        controller = IslandWindowController()
        ElectronBridge.shared.setController(controller!)
        controller?.show()
        
        // 监听显示器变化
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                print("🖥️ Screen parameters changed, repositioning island")
                self?.controller?.reposition()
            }
        
        // 监听工作空间变化
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil, queue: .main) { [weak self] _ in
                print("🏝️ Active space changed, updating visibility")
                self?.controller?.updateVisibilityForSpace()
            }
        
        // 调试：打印初始显示器信息
        printDisplayInfo()
        
        print("🏝️ Dynamic Island launched successfully")
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false // 保持应用运行，即使没有可见窗口
    }
    
    private func printDisplayInfo() {
        guard let screen = NSScreen.main else { return }
        let frame = screen.frame
        let visibleFrame = screen.visibleFrame
        
        print("🖥️ Main screen frame: \(frame)")
        print("🖥️ Main screen visible frame: \(visibleFrame)")
        print("🖥️ Notch detected: \(visibleFrame.minY > 0)")
    }
}


