import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: IslandWindowController?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 隐藏 Dock 图标，让应用作为后台服务运行
        NSApp.setActivationPolicy(.accessory)
        
        controller = IslandWindowController()
        controller?.show()
        
        // 监听屏幕参数变化（分辨率、显示器连接/断开等）
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                print("🖥️ Screen parameters changed, repositioning island")
                self?.controller?.reposition()
            }
        
        // 监听工作区变化（全屏切换、空间切换等）
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil, queue: .main) { [weak self] _ in
                print("🏝️ Active space changed, updating visibility")
                self?.controller?.updateVisibilityForSpace()
            }
        
        // 监听显示器配置变化 (使用 NSApplication 的通知)
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                print("🖥️ Screens configuration changed")
                self?.controller?.reposition()
            }
        
        // 调试：打印初始显示器信息
        printDisplayInfo()
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }
    
    private func printDisplayInfo() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        print("🖥️ Display Info:")
        print("  - Screen frame: \(screen.frame)")
        print("  - Visible frame: \(screen.visibleFrame)")
        print("  - Scale factor: \(screen.backingScaleFactor)")
        print("  - Has notch: \(screen.frame.height - screen.visibleFrame.height > 25)")
    }
}
