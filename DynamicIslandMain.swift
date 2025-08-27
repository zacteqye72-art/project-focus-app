import AppKit
import SwiftUI
import Foundation

// MARK: - Command Line Interface
@main
struct DynamicIslandMain {
    static func main() {
        // 解析命令行参数
        let args = CommandLine.arguments
        
        if args.contains("--help") || args.contains("-h") {
            printUsage()
            return
        }
        
        if args.contains("--version") || args.contains("-v") {
            print("Dynamic Island v1.0.0")
            return
        }
        
        // 启动应用
        let app = NSApplication.shared
        let delegate = DynamicIslandAppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // 不在 Dock 中显示
        app.run()
    }
    
    static func printUsage() {
        print("""
        Dynamic Island - macOS Native Floating Bar
        
        Usage: DynamicIsland [options]
        
        Options:
          -h, --help     Show this help message
          -v, --version  Show version information
          
        Controls:
          - Click to expand/collapse
          - Right-click for context menu
          - Option+L to toggle window level
          
        Integration:
          This app is designed to be launched by Electron as a child process
          and communicates via JSON messages through stdout/stdin.
        """)
    }
}
