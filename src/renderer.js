(() => {
  const island = document.getElementById('island');
  const islandContent = document.getElementById('islandContent');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalActions = document.getElementById('modalActions');
  const viewLanding = document.getElementById('viewLanding');
  const viewApp = document.getElementById('viewApp');
  const navCoach = document.getElementById('navCoach');
  const navHistory = document.getElementById('navHistory');
  const startFirstBtn = document.getElementById('startFirstBtn');
  const chat = document.getElementById('chat');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatMic = document.getElementById('chatMic');
  const settingsBtn = document.getElementById('settingsBtn');

  // Landing navigation
  function goAppView() {
    viewLanding.hidden = true;
    viewApp.hidden = false;
    chatInput?.focus();
  }
  navCoach?.addEventListener('click', goAppView);
  startFirstBtn?.addEventListener('click', goAppView);
  navHistory?.addEventListener('click', async () => { await showHistoryModal(); });
  settingsBtn?.addEventListener('click', () => window.openSettings());

  // 加载默认配置
  (async () => {
    try {
      const defaultConfig = await window.focusAPI?.config?.getDefault?.();
      console.log('🔧 获取到的默认配置:', defaultConfig);
      if (defaultConfig?.provider && defaultConfig?.apiKey) {
        localStorage.setItem('ai_provider', defaultConfig.provider);
        localStorage.setItem('ai_api_key', defaultConfig.apiKey);
        console.log('✅ 已设置配置:', defaultConfig.provider);
      }
    } catch (e) {
      console.log('⚠️ 配置加载错误:', e);
    }
    
    // 初始化工作上下文指示器
    setTimeout(() => {
      updateContextIndicator();
    }, 500);
    
    // 初始化系统级Dynamic Island
    setTimeout(() => {
      updateSystemIsland();
    }, 1000);
    
    // 静默测试窗口监控功能
    setTimeout(() => {
      testWindowMonitoring();
    }, 2000);
  })();

  // Chat helpers
  function addBubble(role, content) {
    const div = document.createElement('div');
    div.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
    div.textContent = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  // User context validation state
  let userWorkContext = {
    content: null,     // 工作内容 (AI、专注力、新能源等)
    method: null,      // 工作方式 (写作、研究、coding等)
    isValid: false
  };

  let chatMessages = [
    { role: 'system', content: 'You are an attentive productivity coach. Before starting any focus session, you MUST ensure the user has clearly described BOTH their work content (what field they work in, like AI, focus research, new energy, etc.) AND their work method (how they work, like writing, research, coding, etc.). Only after getting this complete information should you respond with encouragement and end your message with exactly "START_FOCUS_SESSION" to trigger the focus timer. If the user hasn\'t provided complete information, ask specific follow-up questions to understand their work context better.' },
    { role: 'assistant', content: '欢迎使用 Project Focus！在开始专注会话之前，我需要了解一下您的工作背景：\n\n1. **您主要从事什么领域的工作？**（比如：AI研究、专注力训练、新能源开发、软件工程等）\n\n2. **您通常采用什么工作方式？**（比如：写作、研究、编程、设计、分析等）\n\n请告诉我这两个方面的信息，这样我就能为您提供更精准的专注指导和监控。' },
  ];

  // Function to analyze user input for work context
  function analyzeWorkContext(userMessage) {
    const message = userMessage.toLowerCase();
    
    // Check for work content keywords
    const contentKeywords = [
      'ai', '人工智能', '机器学习', 'ml', 'deep learning',
      '专注力', 'focus', 'attention', '注意力',
      '新能源', 'renewable energy', '太阳能', '风能', 'solar', 'wind',
      '软件', 'software', '编程', 'programming', '开发', 'development',
      '研究', 'research', '学术', 'academic',
      '设计', 'design', 'ui', 'ux',
      '数据', 'data', '分析', 'analysis', 'analytics',
      '市场', 'marketing', '销售', 'sales',
      '教育', 'education', '教学', 'teaching',
      '医疗', 'medical', '健康', 'health',
      '金融', 'finance', '投资', 'investment'
    ];
    
    // Check for work method keywords  
    const methodKeywords = [
      '写作', 'writing', '撰写', '文章', 'article', 'blog',
      '研究', 'research', '调研', '分析', 'analysis',
      '编程', 'coding', 'programming', '开发', 'develop', 'code',
      '设计', 'design', '绘图', 'drawing', 'sketch',
      '阅读', 'reading', '学习', 'learning', '复习', 'review',
      '会议', 'meeting', '讨论', 'discussion',
      '实验', 'experiment', '测试', 'testing',
      '策划', 'planning', '规划', '管理', 'management'
    ];
    
    const hasContent = contentKeywords.some(keyword => message.includes(keyword));
    const hasMethod = methodKeywords.some(keyword => message.includes(keyword));
    
    return { hasContent, hasMethod };
  }

  // Function to update work context validation
  function updateWorkContext(userMessage) {
    const analysis = analyzeWorkContext(userMessage);
    
    if (analysis.hasContent && !userWorkContext.content) {
      userWorkContext.content = userMessage;
    }
    
    if (analysis.hasMethod && !userWorkContext.method) {
      userWorkContext.method = userMessage;
    }
    
    // Check if we have both content and method
    userWorkContext.isValid = userWorkContext.content && userWorkContext.method;
    
    // Update UI indicator
    updateContextIndicator();
    
    return userWorkContext.isValid;
  }

  // Function to update context validation indicator in UI
  function updateContextIndicator() {
    // Check if we have a context indicator element, if not create one
    let indicator = document.getElementById('contextIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'contextIndicator';
      indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 8px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        z-index: 1000;
        transition: all 0.3s ease;
        min-width: 120px;
        text-align: center;
      `;
      document.body.appendChild(indicator);
    }
    
    const hasContent = !!userWorkContext.content;
    const hasMethod = !!userWorkContext.method;
    
    if (userWorkContext.isValid) {
      indicator.textContent = '✅ 工作背景完整';
      indicator.style.backgroundColor = '#10b981';
      indicator.style.color = 'white';
    } else if (hasContent || hasMethod) {
      const missing = [];
      if (!hasContent) missing.push('工作领域');
      if (!hasMethod) missing.push('工作方式');
      indicator.textContent = `⚠️ 缺少：${missing.join('、')}`;
      indicator.style.backgroundColor = '#f59e0b';
      indicator.style.color = 'white';
    } else {
      indicator.textContent = '📝 请提供工作背景';
      indicator.style.backgroundColor = '#6b7280';
      indicator.style.color = 'white';
    }
  }

  // Focus session state
  let focusSessionActive = false;
  let sessionStartTime = null;
  let sessionDuration = 25 * 60; // 25 minutes default
  let timeRemaining = sessionDuration;
  let sessionTimer = null;
  let isAIOverridingStatus = false; // Flag to prevent time-based color changes when AI detects distraction
  
  // Session tracking data
  let sessionData = {
    distractions: [], // Array of distraction events
    windowChanges: [], // Array of window change events
    focusEvents: [] // Array of focus analysis events
  };

  async function sendChat() {
    const text = (chatInput.value || '').trim();
    if (!text) return;
    
    addBubble('user', text);
    chatMessages.push({ role: 'user', content: text });
    chatInput.value = '';
    
    // Update work context analysis
    updateWorkContext(text);
    
    // Add context validation info to the messages for AI
    const enhancedMessages = [...chatMessages];
    if (!userWorkContext.isValid) {
      const contextStatus = {
        hasContent: !!userWorkContext.content,
        hasMethod: !!userWorkContext.method,
        missingInfo: []
      };
      
      if (!userWorkContext.content) {
        contextStatus.missingInfo.push('work content/field');
      }
      if (!userWorkContext.method) {
        contextStatus.missingInfo.push('work method/approach');
      }
      
      // Add a system message with context validation status
      enhancedMessages.push({
        role: 'system',
        content: `CONTEXT VALIDATION STATUS: User has ${contextStatus.hasContent ? 'provided' : 'NOT provided'} work content and ${contextStatus.hasMethod ? 'provided' : 'NOT provided'} work method. Missing: ${contextStatus.missingInfo.join(', ')}. DO NOT start focus session until both are clearly provided.`
      });
    } else {
      // Add validation success message
      enhancedMessages.push({
        role: 'system',
        content: `CONTEXT VALIDATION STATUS: Complete! User has provided both work content and method. You may now proceed with focus session if appropriate.`
      });
    }
    
    try {
      const provider = localStorage.getItem('ai_provider') || 'openrouter';
      const apiKey = localStorage.getItem('ai_api_key') || '';
      const reply = await window.focusAPI.ai.chat(enhancedMessages, provider, apiKey);
      if (reply?.content) {
        let content = reply.content;
        
        // Check if AI wants to start focus session - but only if context is valid
        if (content.includes('START_FOCUS_SESSION')) {
          if (userWorkContext.isValid) {
            content = content.replace('START_FOCUS_SESSION', '').trim();
            addBubble('assistant', content);
            chatMessages.push({ role: 'assistant', content: content });
            
            // Show session configuration modal
            setTimeout(() => {
              showSessionConfigModal();
            }, 1500);
          } else {
            // AI tried to start session but context is invalid - override
            content = content.replace('START_FOCUS_SESSION', '').trim();
            content += '\n\n（系统提示：我还需要更完整的工作背景信息才能开始专注会话。请确保告诉我您的工作领域和工作方式。）';
            addBubble('assistant', content);
            chatMessages.push({ role: 'assistant', content: content });
          }
        } else {
          addBubble('assistant', content);
          chatMessages.push({ role: 'assistant', content: content });
        }
      }
    } catch (e) {
      addBubble('assistant', 'AI error: ' + String(e?.message || e));
    }
  }
  chatSend?.addEventListener('click', sendChat);
  chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  // Dynamic Island overlay
  let islandTimer = null;
  let focusStatus = 'green'; // green, yellow, red
  
  function showIsland(message) {
    if (typeof message === 'string') {
      islandContent.textContent = message;
    } else {
      islandContent.innerHTML = '';
      islandContent.appendChild(message);
    }
    island.classList.add('show');
    if (islandTimer) clearTimeout(islandTimer);
    islandTimer = setTimeout(() => island.classList.remove('show'), 2400);
  }
  
  function showFocusIsland() {
    if (!focusSessionActive) return;
    
    // Update island content with timer and status
    const focusIndicator = document.getElementById('focusIndicator');
    const sessionTitle = document.getElementById('sessionTitle');
    const timerDisplay = document.getElementById('timerDisplay');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    // Update status indicator
    if (focusIndicator) {
      focusIndicator.className = `focus-indicator ${focusStatus}`;
    }
    
    // Update session title
    if (sessionTitle) {
      sessionTitle.textContent = '专注Session进行中';
    }
    
    // Update timer display
    if (timerDisplay) {
      timerDisplay.textContent = formatTime(timeRemaining);
    }
    
    // Show buttons during session
    if (pauseBtn) {
      pauseBtn.style.display = 'flex';
      if (!pauseBtn.onclick) {
        pauseBtn.onclick = () => pauseFocusSession();
      }
    }
    if (stopBtn) {
      stopBtn.style.display = 'flex';
      if (!stopBtn.onclick) {
        stopBtn.onclick = () => completeFocusSession();
      }
    }
    
    // Show the island
    island.classList.add('show');
  }
  
  function hideFocusIsland() {
    island.classList.remove('show');
  }
  
  function updateFocusStatus(status) {
    focusStatus = status; // 'green', 'yellow', 'red'
    if (focusSessionActive) {
      updateSystemIsland();
    }
  }
  
  let lastIslandUpdate = 0;
  function updateSystemIsland() {
    if (!window.focusAPI?.island) return;
    
    // Throttle updates to prevent excessive calls
    const now = Date.now();
    if (now - lastIslandUpdate < 500) return; // Max 2 updates per second
    lastIslandUpdate = now;
    
    if (focusSessionActive) {
      // Update with current session data
      console.log(`🏝️ Updating Dynamic Island: status=${focusStatus}, timeRemaining=${timeRemaining}`);
      window.focusAPI.island.update({
        active: true,
        timeRemaining: timeRemaining,
        status: focusStatus
      });
      
      // Show the island if it's hidden
      window.focusAPI.island.show();
    } else {
      // Show ready state
      console.log(`🏝️ Updating Dynamic Island: Ready state`);
      window.focusAPI.island.update({
        active: false,
        message: 'Ready to Focus'
      });
    }
  }
  
  // Enhanced island interaction handlers
  function showIslandMessage(message, duration = 3000) {
    if (!window.focusAPI?.island) return;
    
    // Temporarily expand island to show message
    window.focusAPI.island.expand({ 
      expanded: true, 
      message: message 
    });
    
    // Auto-collapse after duration
    setTimeout(() => {
      if (!focusSessionActive) {
        window.focusAPI.island.collapse();
      }
    }, duration);
  }
  
  // Enhanced focus status updates with island feedback
  function updateFocusStatusWithIsland(status, reason) {
    // Update main UI
    updateFocusStatus(status);
    
    // Update island with enhanced info
    if (focusSessionActive && window.focusAPI?.island) {
      const statusColor = status.includes('专注') ? 'green' : 
                         status.includes('半分心') ? 'yellow' : 'red';
      
      window.focusAPI.island.update({
        active: true,
        timeRemaining: timeRemaining,
        status: statusColor,
        message: reason ? `${status}: ${reason}` : status
      });
      
      // Show expanded view for distractions
      if (status.includes('分心')) {
        window.focusAPI.island.expand({ 
          expanded: true,
          urgent: true 
        });
      }
    }
  }
  
  function startWindowMonitoring() {
    if (!window.focusAPI?.windowMonitoring) {
      console.error('❌ Window monitoring API not available');
      addBubble('assistant', '❌ 窗口监控API不可用');
      return;
    }
    
    console.log('👁️ Starting window monitoring...');
    
    // Start monitoring
    window.focusAPI.windowMonitoring.start();

    // Listen for window changes
    window.focusAPI.windowMonitoring.onWindowChanged((data) => {
      console.log('👁️ Window change event received:', data);
      handleWindowChange(data);
    });
    
    // Listen for AI focus analysis results
    window.focusAPI.aiAnalysis.onFocusAnalysis((data) => {
      console.log('🤖 AI analysis event received:', data);
      handleFocusAnalysis(data);
    });
    
    console.log('✅ Window monitoring started and event listeners registered');
    addBubble('assistant', '✅ 窗口监控已启动，正在监控窗口切换...');
  }
  
  function stopWindowMonitoring() {
    if (!window.focusAPI?.windowMonitoring) return;
    
    console.log('🛑 Stopping window monitoring');
    window.focusAPI.windowMonitoring.stop();
    
    // Disable AI analysis
    window.focusAPI.aiAnalysis.disable();
    
    console.log('🛑 Window monitoring stopped');
  }
  
  function handleWindowChange(data) {
    const { previousWindow, currentWindow, screenshotPath, timestamp } = data;
    
    console.log('🔄 Window changed:', { previousWindow, currentWindow, screenshotPath });
    
    // Record window change event if session is active
    if (focusSessionActive) {
      sessionData.windowChanges.push({
        timestamp: timestamp,
        previousWindow: previousWindow,
        currentWindow: currentWindow,
        screenshotPath: screenshotPath,
        sessionTime: Date.now() - sessionStartTime
      });
      
      // Change to yellow to indicate potential distraction
      isAIOverridingStatus = true;
      focusStatus = 'yellow';
      updateSystemIsland();
    }
    
    // Show notification in chat
    const fileName = screenshotPath ? screenshotPath.split('/').pop() : 'unknown';
    addBubble('assistant', `🔄 Window changed to: ${currentWindow}
📸 Screenshot saved: ${fileName}`);
    
    // Reset to normal color after 5 seconds
    setTimeout(() => {
      if (focusSessionActive && isAIOverridingStatus) {
        isAIOverridingStatus = false;
        const percentRemaining = timeRemaining / sessionDuration;
        if (percentRemaining > 0.5) {
          focusStatus = 'green';
        } else if (percentRemaining > 0.2) {
          focusStatus = 'yellow';
        } else {
          focusStatus = 'red';
        }
        updateSystemIsland();
      }
    }, 5000);
  }
  
  async function testWindowMonitoring() {
    try {
      console.log('🧪 Testing window monitoring...');
      
      // Check permissions first
      if (window.focusAPI?.permissions) {
        const permissionResult = await window.focusAPI.permissions.check();
        if (!permissionResult.hasPermission) {
          let message = '⚠️ 需要以下权限才能进行完整功能：\n';
          if (permissionResult.missingPermissions.includes('screen')) {
            message += '• 屏幕录制 - 用于截图分析\n';
          }
          if (permissionResult.missingPermissions.includes('accessibility')) {
            message += '• 辅助功能 - 用于窗口切换监控\n';
          }
          message += '\n请在"系统偏好设置 > 安全性与隐私 > 隐私"中启用相应权限。';
          addBubble('assistant', message);
          return;
        }
      }
      
      // Test getting current window (silent test)
      const currentResult = await window.focusAPI?.windowMonitoring?.getCurrent();
      if (currentResult?.success) {
        console.log('✅ Current window:', currentResult.window);
      }
      
      // Test screenshot capability (silent test)
      const screenshotResult = await window.focusAPI?.windowMonitoring?.testScreenshot();
      if (screenshotResult?.success) {
        console.log('✅ Test screenshot saved:', screenshotResult.path);
      } else {
        console.error('❌ Screenshot test failed:', screenshotResult?.error);
        addBubble('assistant', '❌ 截图测试失败。可能需要在系统偏好设置中授予屏幕录制权限。');
      }
    } catch (error) {
      console.error('❌ Window monitoring test error:', error);
      addBubble('assistant', `❌ 窗口监控测试错误: ${error.message}`);
    }
  }
  
  function handleFocusAnalysis(data) {
    const { result, reason, workContext, screenshotPath, timestamp, rawResult, rawReason, consensus } = data;
    
    console.log('🤖 AI Focus Analysis - Raw Result:', result);
    console.log('🤖 AI Focus Analysis - Result Type:', typeof result);
    console.log('🤖 AI Focus Analysis - Result Length:', result?.length);
    
    // Get filename for display
    const fileName = screenshotPath ? screenshotPath.split('/').pop() : 'unknown';
    
    // Update Dynamic Island color and show chat message based on result
    if (focusSessionActive) {
      let statusEmoji = '';
      let statusMessage = '';
      let newFocusStatus = focusStatus;
      let isDistraction = false;
      
      // Clean up the result string and check for various patterns
      const cleanResult = result?.toString().trim().toLowerCase() || '';
      console.log('🤖 Cleaned result for matching:', cleanResult);
      
      if (cleanResult.includes('检测中')) {
        statusEmoji = '⏳';
        statusMessage = '检测中';
        newFocusStatus = 'yellow';
        isAIOverridingStatus = true;
        isDistraction = false;
      } else if (cleanResult.includes('待机中') || cleanResult.includes('idle')) {
        statusEmoji = '🛌';
        statusMessage = '待机中';
        newFocusStatus = 'red';
        isAIOverridingStatus = true;
        isDistraction = true;
      } else if (cleanResult.includes('专注中') || cleanResult.includes('专注') || 
          cleanResult.includes('focused') || cleanResult === '2' || 
          cleanResult.includes('2.') || cleanResult.includes('2、')) {
        statusEmoji = '✅';
        statusMessage = '专注中';
        newFocusStatus = 'green';
        isAIOverridingStatus = false;
      } else if (cleanResult.includes('半分心') || cleanResult === '3' || 
                 cleanResult.includes('3.') || cleanResult.includes('3、')) {
        statusEmoji = '⚠️';
        statusMessage = '半分心';
        newFocusStatus = 'yellow';
        isAIOverridingStatus = true;
        isDistraction = true;
      } else if (cleanResult.includes('分心中') || cleanResult.includes('分心') || 
                 cleanResult.includes('distracted') || cleanResult === '1' || 
                 cleanResult.includes('1.') || cleanResult.includes('1、')) {
        statusEmoji = '🚨';
        statusMessage = '分心中';
        newFocusStatus = 'red';
        isAIOverridingStatus = true;
        isDistraction = true;
      } else {
        statusEmoji = '❓';
        statusMessage = `状态不明 (${result})`;
        console.warn('🤖 Unknown AI result format:', result);
      }
      
      // Record focus analysis event
      sessionData.focusEvents.push({
        timestamp: timestamp,
        result: result,
        reason: reason,
        status: statusMessage,
        isDistraction: isDistraction,
        screenshotPath: screenshotPath,
        sessionTime: Date.now() - sessionStartTime
      });
      
      // Record distraction event if detected
      if (isDistraction) {
        const currentWindow = sessionData.windowChanges.length > 0 ? 
          sessionData.windowChanges[sessionData.windowChanges.length - 1]?.currentWindow : 'Unknown';
        
        sessionData.distractions.push({
          timestamp: timestamp,
          type: statusMessage,
          reason: reason,
          currentWindow: currentWindow,
          screenshotPath: screenshotPath,
          sessionTime: Date.now() - sessionStartTime,
          severity: newFocusStatus === 'red' ? 'high' : 'medium'
        });
      }
      
      // Update focus status and Dynamic Island with enhanced feedback
      if (newFocusStatus !== focusStatus) {
        console.log(`🚨 Focus status changed: ${focusStatus} → ${newFocusStatus}`);
        focusStatus = newFocusStatus;
        updateSystemIsland();
        
        // Show enhanced island feedback for status changes
        if (isDistraction) {
          showIslandMessage(`${statusEmoji} ${statusMessage}: ${reason || '保持专注'}`, 4000);
          // Expand island for distractions
          if (window.focusAPI?.island) {
            window.focusAPI.island.expand({ 
              expanded: true,
              urgent: newFocusStatus === 'red'
            });
          }
        } else if (statusMessage === '专注中') {
          showIslandMessage(`${statusEmoji} 专注状态良好`, 2000);
        }
      } else {
        console.log(`✅ Focus status remains: ${focusStatus} (no change needed)`);
        // Still update island with reason if available
        if (reason && focusSessionActive) {
          updateSystemIsland();
        }
      }
      
      // Show analysis result in chat with reasoning and consensus info
      const consensusInfo = rawResult && rawResult !== result ? 
        `\n🔄 原始判断: "${rawResult}" → 稳定后: "${result}" (共识度: ${consensus || 1})` : '';
      
      const reasonInfo = reason ? `\n💭 AI分析理由: ${reason}` : '';
      const rawReasonInfo = rawReason && rawReason !== reason ? 
        `\n🧠 原始理由: ${rawReason}` : '';
      
      addBubble('assistant', `🤖 AI分析结果: ${statusEmoji} ${statusMessage}
📸 分析截图: ${fileName}
💼 工作内容: ${workContext}
🔍 最终状态: "${result}"${reasonInfo}${consensusInfo}${rawReasonInfo}`);
    }
  }
  
  function showReadyIsland() {
    // Show the ready state island
    const focusIndicator = document.getElementById('focusIndicator');
    const sessionTitle = document.getElementById('sessionTitle');
    const timerDisplay = document.getElementById('timerDisplay');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    // Set ready state
    if (focusIndicator) {
      focusIndicator.className = 'focus-indicator green';
    }
    if (sessionTitle) {
      sessionTitle.textContent = 'Ready to Focus';
    }
    if (timerDisplay) {
      timerDisplay.textContent = '--:--';
    }
    
    // Hide buttons in ready state
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';
    
    // Show the island
    island.classList.add('show');
  }

  function buildIslandActions(primaryLabel, primaryHandler, secondaryLabel, secondaryHandler) {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '8px';
    const primary = document.createElement('button');
    primary.className = 'btn';
    primary.textContent = primaryLabel;
    primary.onclick = () => { island.classList.remove('show'); primaryHandler?.(); };
    wrapper.appendChild(primary);
    if (secondaryLabel) {
      const secondary = document.createElement('button');
      secondary.className = 'btn secondary';
      secondary.textContent = secondaryLabel;
      secondary.onclick = () => { island.classList.remove('show'); secondaryHandler?.(); };
      wrapper.appendChild(secondary);
    }
    return wrapper;
  }

  function openModal(title, bodyHtml, actions) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalActions.innerHTML = '';
    (actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (a.variant === 'secondary' ? ' secondary' : '');
      btn.textContent = a.label;
      btn.onclick = () => { closeModal(); a.onClick?.(); };
      modalActions.appendChild(btn);
    });
    modalBackdrop.hidden = false;
  }
  function closeModal() { modalBackdrop.hidden = true; }

  // Allow inline script (settings) to open modal
  window.addEventListener('open-modal', (e) => {
    const { title, body, actions } = e.detail || {};
    openModal(title || 'Dialog', body || '', actions || [{ label: 'Close' }]);
  });
  
  // Allow inline script to show island messages
  window.addEventListener('show-island', (e) => {
    showIsland(e.detail || 'Done');
  });
  
  // Listen for actions from system Dynamic Island
  if (window.focusAPI) {
    // Listen for island button actions (handled by preload)
    window.focusAPI.onIslandAction && window.focusAPI.onIslandAction((action) => {
      console.log('🏝️ Island action received:', action);
      if (action === 'pause') {
        pauseFocusSession();
      } else if (action === 'stop') {
        completeFocusSession();
      }
    });
  }

  function showSessionConfigModal() {
    const lastUserMessage = chatMessages.filter(m => m.role === 'user').pop();
    const workSubject = lastUserMessage?.content?.slice(0, 60) || 'Focus Work';
    
    const body = `
      <div style="display:grid;gap:16px;text-align:center">
        <p style="color:var(--muted);margin:0">Ready to start your focus session?</p>
        
        <div style="display:grid;gap:12px">
          <label style="font-weight:600">Session Time</label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            <button class="time-option" data-minutes="25">25min</button>
            <button class="time-option selected" data-minutes="45">45min</button>
            <button class="time-option" data-minutes="60">1hr</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
            <button class="time-option" data-minutes="90">1.5hr</button>
            <button class="time-option" data-minutes="120">2hr</button>
          </div>
        </div>
        
        <div style="font-size:14px;color:var(--muted)">
          Subject: ${workSubject}
        </div>
      </div>`;
    
    openModal('确认专注Session需求', body, [
      { label: "Let's Get Started", onClick: () => {
        const selected = document.querySelector('.time-option.selected');
        const minutes = selected ? parseInt(selected.dataset.minutes) : 45;
        startFocusSession(minutes);
      }},
      { label: 'Cancel', variant: 'secondary', onClick: () => {} },
    ]);
    
    // Add click handlers for time options
    setTimeout(() => {
      const timeOptions = document.querySelectorAll('.time-option');
      timeOptions.forEach(option => {
        option.onclick = () => {
          timeOptions.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
        };
      });
    }, 100);
  }

  function showSessionSummary(sessionLengthMins, actualMins) {
    // Calculate statistics
    const distractionCount = sessionData.distractions.length;
    const windowChangeCount = sessionData.windowChanges.length;
    const focusPercentage = Math.round((1 - (distractionCount / Math.max(sessionData.focusEvents.length, 1))) * 100);
    
    // Format duration
    const formatDuration = (mins) => {
      const hours = Math.floor(mins / 60);
      const minutes = mins % 60;
      return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
    };
    
    // Create distraction timeline
    const distractionList = sessionData.distractions.map((distraction, index) => {
      const timeFromStart = Math.floor(distraction.sessionTime / 1000 / 60); // minutes
      const severity = distraction.severity === 'high' ? '🚨' : '⚠️';
      const windowInfo = distraction.currentWindow ? 
        distraction.currentWindow.split(' - ').slice(0, 2).join(' - ') : 'Unknown';
      
      return `
        <div style="display:flex;gap:12px;padding:12px;margin:8px 0;background:#f8f9fa;border-radius:8px;border-left:4px solid ${distraction.severity === 'high' ? '#ef4444' : '#f59e0b'}">
          <div style="font-size:18px">${severity}</div>
          <div style="flex:1">
            <div style="font-weight:600;color:#374151">${distraction.type}</div>
            <div style="font-size:14px;color:#6b7280;margin:4px 0">
              第${timeFromStart}分钟 • ${windowInfo}
            </div>
            <div style="font-size:14px;color:#4b5563">
              ${distraction.reason || '未提供具体原因'}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    const body = `
      <div style="display:grid;gap:20px;max-height:400px;overflow-y:auto">
        <!-- Session Overview -->
        <div style="text-align:center;padding:20px;background:linear-gradient(135deg, #10b981 0%, #059669 100%);border-radius:12px;color:white">
          <h3 style="margin:0 0 8px 0;font-size:24px">🎉 Session完成！</h3>
          <div style="font-size:16px;opacity:0.9">专注时长：${formatDuration(actualMins)} / ${formatDuration(sessionLengthMins)}</div>
        </div>
        
        <!-- Statistics Cards -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px">
            <div style="font-size:24px;font-weight:700;color:#059669">${distractionCount}</div>
            <div style="font-size:14px;color:#6b7280">分心次数</div>
          </div>
          <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px">
            <div style="font-size:24px;font-weight:700;color:#2563eb">${windowChangeCount}</div>
            <div style="font-size:14px;color:#6b7280">窗口切换</div>
          </div>
          <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px">
            <div style="font-size:24px;font-weight:700;color:#7c3aed">${focusPercentage}%</div>
            <div style="font-size:14px;color:#6b7280">专注度</div>
          </div>
        </div>
        
        <!-- Distraction Timeline -->
        ${distractionCount > 0 ? `
          <div>
            <h4 style="margin:0 0 12px 0;color:#374151">📝 分心记录</h4>
            ${distractionList}
          </div>
        ` : `
          <div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:8px;color:#166534">
            <div style="font-size:48px;margin-bottom:8px">🌟</div>
            <div style="font-weight:600">太棒了！整个session没有检测到分心</div>
          </div>
        `}
        
        <!-- Motivational Message -->
        <div style="padding:16px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6">
          <div style="font-weight:600;color:#1e40af;margin-bottom:4px">💪 继续保持</div>
          <div style="color:#374151;font-size:14px">
            ${focusPercentage >= 90 ? '专注度极高！你的工作效率非常出色，继续保持这种状态。' :
              focusPercentage >= 70 ? '专注度良好！稍微注意一下容易分心的环节，你会做得更好。' :
              '还有提升空间！试着减少容易分心的应用和网站，专注力会逐步提高。'}
          </div>
        </div>
      </div>
    `;
    
    openModal('Session总结', body, [
      { label: '查看详细数据', variant: 'secondary', onClick: () => {
        console.log('📊 Session Data:', sessionData);
        showIsland('数据已输出到控制台');
      }},
      { label: '继续工作', onClick: () => {
        // Maybe suggest starting another session
        setTimeout(() => {
          addBubble('assistant', '准备好开始下一个专注session了吗？让我知道你接下来想做什么！');
        }, 500);
      }},
    ]);
  }

  async function showHistoryModal() {
    try {
      const items = await window.focusAPI?.history?.list?.();
      const body = (items || []).slice(0, 20).map(it => {
        const start = new Date(it.startedAt || Date.now());
        const end = new Date(it.endedAt || Date.now());
        return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div><strong>${it.subject || 'Untitled'}</strong></div>
          <div class="small muted">${start.toLocaleString()} → ${end.toLocaleString()}</div>
          <div class="small">${it.lengthMin || '?'} min • reminders ~${it.reminders || 0} • breaks ${it.breaksUsed || 0}/3</div>
        </div>`;
      }).join('') || '<div class="muted">No sessions yet</div>';
      openModal('Session History', `<div>${body}</div>`, [
        { label: 'Clear All', variant: 'secondary', onClick: async () => { await window.focusAPI?.history?.clear?.(); } },
        { label: 'Close', onClick: () => {} },
      ]);
    } catch {
      openModal('Session History', '<div class="muted">Unable to load history</div>', [ { label: 'Close' } ]);
    }
  }

  // Voice input (Web Speech API)
  chatMic?.addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      openModal('Voice Input', '<div class="muted">Speech recognition not supported on this device/browser.</div>', [ { label: 'Close' } ]);
      return;
    }
    const recog = new SR();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      chatInput.value = text;
      chatInput.focus();
    };
    recog.onerror = () => {};
    recog.start();
    const node = document.createElement('div');
    node.textContent = 'Listening…';
    showIsland(node);
  });

  // Focus Session Functions
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function startFocusSession(durationMinutes = 45) {
    if (focusSessionActive) return;
    
    focusSessionActive = true;
    sessionStartTime = Date.now();
    sessionDuration = durationMinutes * 60; // Convert to seconds
    timeRemaining = sessionDuration;
    focusStatus = 'green'; // Start with green status
    
    // Reset session tracking data
    sessionData = {
      distractions: [],
      windowChanges: [],
      focusEvents: []
    };
    
    // Update system-level Dynamic Island
    updateSystemIsland();
    
    // Update chat with session info
    addBubble('assistant', `Great! I've started a ${Math.floor(sessionDuration/60)}-minute focus session for you. Stay focused! I'll monitor your activity and gently remind you if you get distracted.`);
    
    // Start window monitoring
    startWindowMonitoring();
    
    // Enable macOS Do Not Disturb
    if (window.focusAPI?.dnd?.toggle) {
      console.log('🌙 Requesting to enable Do Not Disturb mode...');
      window.focusAPI.dnd.toggle(true);
    }
    
    // Enable AI analysis for focus monitoring
    const lastUserMessage = chatMessages.filter(m => m.role === 'user').pop();
    const workContext = lastUserMessage?.content || 'General work';
    window.focusAPI.aiAnalysis.enable(workContext);
    
    // Start timer
    sessionTimer = setInterval(() => {
      timeRemaining--;
      
      // Update island every second
      updateSystemIsland();
      
      // Change status based on time remaining (only if not overridden by AI)
      if (!isAIOverridingStatus) {
        const percentRemaining = timeRemaining / sessionDuration;
        if (percentRemaining > 0.5) {
          if (focusStatus !== 'green') {
            focusStatus = 'green';
            updateSystemIsland();
          }
        } else if (percentRemaining > 0.2) {
          if (focusStatus !== 'yellow') {
            focusStatus = 'yellow';
            updateSystemIsland();
          }
        } else {
          if (focusStatus !== 'red') {
            focusStatus = 'red';
            updateSystemIsland();
          }
        }
      }
      
      // Session complete
      if (timeRemaining <= 0) {
        completeFocusSession();
      }
    }, 1000);
    
    // Send initial focus rules to activity monitor
    if (window.focusAPI) {
      const lastUserMessage = chatMessages.filter(m => m.role === 'user').pop();
      const workDescription = lastUserMessage?.content || '';
      const keywords = workDescription.toLowerCase().split(/\s+/).slice(0, 5);
      window.focusAPI.updateRules({ keywords });
    }
  }

  function completeFocusSession() {
    if (!focusSessionActive) return;
    
    clearInterval(sessionTimer);
    focusSessionActive = false;
    
    // Stop window monitoring
    stopWindowMonitoring();
    
    // Disable macOS Do Not Disturb
    if (window.focusAPI?.dnd?.toggle) {
      console.log('🌙 Requesting to disable Do Not Disturb mode...');
      window.focusAPI.dnd.toggle(false);
    }
    
    const sessionLengthMins = Math.floor(sessionDuration / 60);
    const actualTime = Math.floor((Date.now() - sessionStartTime) / 1000);
    const actualMins = Math.floor(actualTime / 60);
    
    // Update system island to ready state
    updateSystemIsland();
    
    // Show completion message
    setTimeout(() => {
      showIsland('🎉 Session Complete! Great work!');
    }, 500);
    
    // Add brief completion message to chat
    addBubble('assistant', `🎉 专注session完成！你工作了${actualMins}分钟，检测到${sessionData.distractions.length}次分心。正在为你生成详细总结...`);
    
    // Show detailed session summary modal
    setTimeout(() => {
      showSessionSummary(sessionLengthMins, actualMins);
    }, 1500);
    
    // Save to history with enhanced data
    try {
      const lastUserMessage = chatMessages.filter(m => m.role === 'user').pop();
      window.focusAPI?.history?.add({
        startedAt: sessionStartTime,
        endedAt: Date.now(),
        subject: lastUserMessage?.content?.slice(0, 100) || 'Focus Session',
        lengthMin: actualMins,
        reminders: sessionData.distractions.length,
        breaksUsed: 0,
        privacy: false,
        // Add session summary data
        distractionCount: sessionData.distractions.length,
        windowChangeCount: sessionData.windowChanges.length,
        focusEventsCount: sessionData.focusEvents.length,
      });
    } catch (e) {}
  }

  function pauseFocusSession() {
    if (!focusSessionActive) return;
    
    clearInterval(sessionTimer);
    focusSessionActive = false;
    
    // Stop window monitoring
    stopWindowMonitoring();
    
    // Disable macOS Do Not Disturb
    if (window.focusAPI?.dnd?.toggle) {
      console.log('🌙 Requesting to disable Do Not Disturb mode...');
      window.focusAPI.dnd.toggle(false);
    }
    
    // Update system island to ready state
    updateSystemIsland();
    
    // Show pause message
    setTimeout(() => {
      showIsland('⏸️ Session Paused');
    }, 300);
    
    addBubble('assistant', 'I noticed you might be taking a break. When you\'re ready to continue, just let me know!');
  }

  // Connect to activity monitoring for distraction detection
  if (window.focusAPI) {
    window.focusAPI.onDistraction((info) => {
      if (!focusSessionActive) return;
      
      // Update status to red when distracted
      updateFocusStatus('red');
      
      const actions = buildIslandActions(
        'Back to Work',
        () => {
          // Return to normal status when user clicks back to work
          updateFocusStatus('green');
        },
        'Take 5min break',
        () => {
          pauseFocusSession();
          setTimeout(() => {
            showIsland('Break over! Ready to refocus?');
          }, 5 * 60 * 1000);
        }
      );
      
      const wrap = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = 'Distraction detected: Stay focused? ';
      label.style.marginRight = '8px';
      wrap.appendChild(label);
      wrap.appendChild(actions);
      showIsland(wrap);
    });
  }

  // Handle Dynamic Island actions
  if (window.focusAPI?.onIslandAction) {
    window.focusAPI.onIslandAction((action) => {
      console.log('🏝️ Island action received:', action);
      
      switch(action) {
        case 'pause':
          if (focusSessionActive) {
            pauseFocusSession();
            showIslandMessage('⏸️ Session Paused', 2000);
          }
          break;
          
        case 'stop':
          if (focusSessionActive) {
            completeFocusSession();
            showIslandMessage('⏹️ Session Stopped', 2000);
          }
          break;
          
        case 'resume':
          if (!focusSessionActive && sessionTimer) {
            resumeFocusSession();
            showIslandMessage('▶️ Session Resumed', 2000);
          }
          break;
          
        default:
          console.log('🏝️ Unknown island action:', action);
      }
    });
  }
})();

