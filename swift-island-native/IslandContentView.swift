import SwiftUI

struct IslandContentView: View {
    @Binding var isExpanded: Bool
    let onToggleLevel: () -> Void
    
    @State private var currentTime = Date()
    @State private var focusStatus: FocusStatus = .ready
    
    enum FocusStatus {
        case ready
        case focused
        case distracted
        case idle
        
        var color: Color {
            switch self {
            case .ready: return .gray
            case .focused: return .green
            case .distracted: return .red
            case .idle: return .orange
            }
        }
        
        var text: String {
            switch self {
            case .ready: return "Ready to Focus"
            case .focused: return "Focused"
            case .distracted: return "Distracted"
            case .idle: return "Idle"
            }
        }
        
        var icon: String {
            switch self {
            case .ready: return "circle.fill"
            case .focused: return "checkmark.circle.fill"
            case .distracted: return "exclamationmark.triangle.fill"
            case .idle: return "moon.fill"
            }
        }
    }
    
    var body: some View {
        ZStack {
            // 背景毛玻璃效果
            RoundedRectangle(cornerRadius: isExpanded ? 20 : 14)
                .fill(.ultraThinMaterial.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: isExpanded ? 20 : 14)
                        .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                )
            
            if isExpanded {
                expandedContent
            } else {
                compactContent
            }
        }
        .frame(
            width: isExpanded ? 560 : 420,
            height: isExpanded ? 96 : 46
        )
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: isExpanded)
        .onTapGesture {
            isExpanded.toggle()
        }
        .onAppear {
            startTimer()
        }
        .contextMenu {
            Button("Toggle Window Level") {
                onToggleLevel()
            }
            Button("Cycle Focus Status") {
                cycleFocusStatus()
            }
            Divider()
            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
    }
    
    @ViewBuilder
    private var compactContent: some View {
        HStack(spacing: 12) {
            // 状态指示器
            Image(systemName: focusStatus.icon)
                .foregroundColor(focusStatus.color)
                .font(.system(size: 12, weight: .semibold))
                .scaleEffect(focusStatus == .distracted ? 1.2 : 1.0)
                .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), 
                          value: focusStatus == .distracted)
            
            // 状态文本
            Text(focusStatus.text)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundColor(.primary)
            
            Spacer()
            
            // 时间显示
            Text(timeString)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
    
    @ViewBuilder
    private var expandedContent: some View {
        VStack(spacing: 12) {
            // 顶部状态行
            HStack {
                Image(systemName: focusStatus.icon)
                    .foregroundColor(focusStatus.color)
                    .font(.system(size: 16, weight: .semibold))
                
                Text("Project Focus")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundColor(.primary)
                
                Spacer()
                
                Text(timeString)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundColor(.secondary)
            }
            
            // 状态详情
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Status")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                    
                    Text(focusStatus.text)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(focusStatus.color)
                }
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Session")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                    
                    Text("25:30")
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundColor(.primary)
                }
            }
            
            // 快捷操作按钮
            HStack(spacing: 8) {
                Button("⏸") {
                    // 暂停操作
                }
                .buttonStyle(IslandButtonStyle())
                
                Button("⏹") {
                    // 停止操作
                }
                .buttonStyle(IslandButtonStyle())
                
                Spacer()
                
                Button("🎯") {
                    cycleFocusStatus()
                }
                .buttonStyle(IslandButtonStyle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
    
    private var timeString: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: currentTime)
    }
    
    private func startTimer() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            currentTime = Date()
        }
    }
    
    private func cycleFocusStatus() {
        withAnimation(.easeInOut(duration: 0.3)) {
            switch focusStatus {
            case .ready:
                focusStatus = .focused
            case .focused:
                focusStatus = .distracted
            case .distracted:
                focusStatus = .idle
            case .idle:
                focusStatus = .ready
            }
        }
    }
}

struct IslandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .frame(width: 32, height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(configuration.isPressed ? 0.3 : 0.15))
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

#Preview {
    IslandContentView(
        isExpanded: .constant(false),
        onToggleLevel: {}
    )
    .frame(width: 420, height: 46)
    .background(Color.black.opacity(0.8))
}
