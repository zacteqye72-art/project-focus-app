import Foundation
import AppKit

// MARK: - JSON Communication Bridge
class ElectronBridge {
    static let shared = ElectronBridge()
    private var controller: IslandWindowController?
    
    private init() {
        setupStdinListener()
    }
    
    func setController(_ controller: IslandWindowController) {
        self.controller = controller
    }
    
    // MARK: - Stdin Listener
    private func setupStdinListener() {
        DispatchQueue.global(qos: .background).async {
            while let line = readLine() {
                self.handleMessage(line)
            }
        }
    }
    
    // MARK: - Message Handling
    private func handleMessage(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = json["action"] as? String else {
            sendError("Invalid JSON format")
            return
        }
        
        DispatchQueue.main.async {
            self.processAction(action, data: json)
        }
    }
    
    private func processAction(_ action: String, data: [String: Any]) {
        switch action {
        case "show":
            controller?.show()
            sendResponse(["status": "shown"])
            
        case "hide":
            controller?.hide()
            sendResponse(["status": "hidden"])
            
        case "expand":
            if let expanded = data["expanded"] as? Bool {
                controller?.setExpanded(expanded)
                sendResponse(["status": "expanded", "expanded": expanded])
            }
            
        case "updateStatus":
            if let status = data["status"] as? String {
                controller?.updateStatus(status)
                sendResponse(["status": "updated", "newStatus": status])
            }
            
        case "updateMessage":
            if let message = data["message"] as? String {
                controller?.updateMessage(message)
                sendResponse(["status": "messageUpdated"])
            }
            
        case "reposition":
            controller?.reposition()
            sendResponse(["status": "repositioned"])
            
        case "toggleLevel":
            controller?.toggleWindowLevel()
            sendResponse(["status": "levelToggled"])
            
        case "ping":
            sendResponse(["status": "pong"])
            
        default:
            sendError("Unknown action: \(action)")
        }
    }
    
    // MARK: - Response Sending
    private func sendResponse(_ data: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: data),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return
        }
        print(jsonString)
        fflush(stdout)
    }
    
    private func sendError(_ message: String) {
        sendResponse(["error": message])
    }
    
    // MARK: - Event Broadcasting
    func broadcastEvent(_ event: String, data: [String: Any] = [:]) {
        var eventData = data
        eventData["event"] = event
        eventData["timestamp"] = Date().timeIntervalSince1970
        sendResponse(eventData)
    }
}
