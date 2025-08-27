import SwiftUI
import AppKit

final class IslandWindowController: ObservableObject {
    private var window: NSPanel!
    private var hosting: NSHostingView<IslandContentView>!
    private var levelManager: WindowLevelManager!
    
    // 岛屿尺寸配置
    private let compactWidth: CGFloat = 420
    private let compactHeight: CGFloat = 46
    private let expandedWidth: CGFloat = 560
    private let expandedHeight: CGFloat = 96
    
    @Published var isExpanded = false {
        didSet {
            if isExpanded != oldValue {
                updateWindowSize()
            }
        }
    }
    
    init() {
        setupWindow()
        setupLevelManager()
        setupHostingView()
    }
    
    private func setupWindow() {
        window = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: compactWidth, height: compactHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        // 关键属性：确保覆盖菜单栏
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.hidesOnDeactivate = false
        window.ignoresMouseEvents = false
        
        // 窗口行为配置
        window.collectionBehavior = [
            .canJoinAllSpaces,        // 在所有空间显示
            .fullScreenAuxiliary,     // 全屏辅助窗口
            .stationary              // 固定位置
        ]
        
        // 禁止窗口激活影响应用焦点
        window.styleMask.insert(.nonactivatingPanel)
    }
    
    private func setupLevelManager() {
        levelManager = WindowLevelManager(window: window)
        
        // 默认尝试 statusBar 级别，如果不够高再切换
        levelManager.setLevel(.statusBar)
        
        // 添加快捷键切换层级（用于调试）
        setupLevelToggleShortcut()
    }
    
    private func setupHostingView() {
        let contentView = IslandContentView(
            isExpanded: Binding(
                get: { self.isExpanded },
                set: { self.isExpanded = $0 }
            ),
            onToggleLevel: { [weak self] in
                self?.levelManager.toggleLevel()
            }
        )
        
        hosting = NSHostingView(rootView: contentView)
        hosting.wantsLayer = true
        hosting.layer?.cornerRadius = 14
        hosting.layer?.masksToBounds = true
        
        window.contentView = hosting
    }
    
    private func setupLevelToggleShortcut() {
        // 添加全局快捷键 Option+L 切换窗口层级（调试用）
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.modifierFlags.contains(.option) && event.charactersIgnoringModifiers == "l" {
                self?.levelManager.toggleLevel()
            }
        }
    }
    
    func show() {
        window.orderFrontRegardless()
        reposition()
        
        // 延迟检查是否真的覆盖了菜单栏
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.verifyOverlay()
        }
    }
    
    func hide() {
        window.orderOut(nil)
    }
    
    func reposition() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            print("❌ No screen available for positioning")
            return
        }
        
        // 关键：使用 screen.frame 而不是 visibleFrame
        let screenFrame = screen.frame
        let currentWidth = isExpanded ? expandedWidth : compactWidth
        let currentHeight = isExpanded ? expandedHeight : compactHeight
        
        // 检测是否有 notch
        let visibleFrame = screen.visibleFrame
        let hasNotch = (screenFrame.height - visibleFrame.height) > 25
        let notchWidth: CGFloat = hasNotch ? 180 : 0
        
        // 计算 x 位置：避开 notch 中心
        let x: CGFloat
        if hasNotch {
            // 如果有 notch，优先放在左侧
            let notchCenter = screenFrame.width / 2
            let notchLeftEdge = notchCenter - notchWidth / 2
            let leftX = max(20, notchLeftEdge - currentWidth - 20)
            
            if leftX >= 20 {
                x = leftX
            } else {
                // 左侧空间不足，放到右侧
                let notchRightEdge = notchCenter + notchWidth / 2
                x = min(screenFrame.width - currentWidth - 20, notchRightEdge + 20)
            }
        } else {
            // 无 notch，居中显示
            x = (screenFrame.width - currentWidth) / 2
        }
        
        // 关键：y 位置基于 screen.frame，确保覆盖菜单栏
        let y = screenFrame.maxY - currentHeight - 6 // 顶部向下 6pt 缓冲
        
        let newFrame = NSRect(x: x, y: y, width: currentWidth, height: currentHeight)
        
        print("🏝️ Repositioning island:")
        print("  - Screen frame: \(screenFrame)")
        print("  - Has notch: \(hasNotch)")
        print("  - New frame: \(newFrame)")
        
        window.setFrame(newFrame, display: true, animate: true)
    }
    
    private func updateWindowSize() {
        reposition() // 重新定位包含尺寸更新
    }
    
    func updateVisibilityForSpace() {
        // 检测全屏状态
        let isAnyFullscreen = NSApp.windows.contains { window in
            window.styleMask.contains(.fullScreen)
        }
        
        // 检测菜单栏是否隐藏
        let isMenuBarHidden = NSMenu.menuBarVisible() == false
        
        let shouldHide = isAnyFullscreen || isMenuBarHidden
        
        print("🏝️ Visibility check:")
        print("  - Any fullscreen: \(isAnyFullscreen)")
        print("  - Menu bar hidden: \(isMenuBarHidden)")
        print("  - Should hide: \(shouldHide)")
        
        if shouldHide {
            hide()
        } else {
            show()
        }
    }
    
    private func verifyOverlay() {
        guard let screen = NSScreen.main else { return }
        
        let windowFrame = window.frame
        let screenFrame = screen.frame
        let visibleFrame = screen.visibleFrame
        
        let isOverlayingMenuBar = windowFrame.maxY > visibleFrame.maxY
        
        print("🔍 Overlay verification:")
        print("  - Window max Y: \(windowFrame.maxY)")
        print("  - Visible frame max Y: \(visibleFrame.maxY)")
        print("  - Screen frame max Y: \(screenFrame.maxY)")
        print("  - Is overlaying menu bar: \(isOverlayingMenuBar)")
        
        if !isOverlayingMenuBar {
            print("⚠️ Warning: Island may not be overlaying menu bar!")
            print("  Trying higher window level...")
            levelManager.toggleLevel()
        }
    }
}
