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
        
        // 显示配置已加载的提示
        setTimeout(() => {
          showIsland(`配置已加载: ${defaultConfig.provider}`);
        }, 1000);
      }
    } catch (e) {
      console.log('⚠️ 配置加载错误:', e);
    }
    
    // 初始化系统级Dynamic Island
    setTimeout(() => {
      updateSystemIsland();
    }, 2000);
    
    // 测试窗口监控功能
    setTimeout(() => {
      testWindowMonitoring();
    }, 3000);
  })();

  // Chat helpers
  function addBubble(role, content) {
    const div = document.createElement('div');
    div.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
    div.textContent = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  let chatMessages = [
    { role: 'system', content: 'You are an attentive productivity coach. When user describes their work plan, respond with encouragement and then end your message with exactly "START_FOCUS_SESSION" to trigger the focus timer.' },
    { role: 'assistant', content: 'What would you like to work on today?' },
  ];

  // Focus session state
  let focusSessionActive = false;
  let sessionStartTime = null;
  let sessionDuration = 25 * 60; // 25 minutes default
  let timeRemaining = sessionDuration;
  let sessionTimer = null;
  let isAIOverridingStatus = false; // Flag to prevent time-based color changes when AI detects distraction

  async function sendChat() {
    const text = (chatInput.value || '').trim();
    if (!text) return;
    addBubble('user', text);
    chatMessages.push({ role: 'user', content: text });
    chatInput.value = '';
    try {
      const provider = localStorage.getItem('ai_provider') || 'openrouter';
      const apiKey = localStorage.getItem('ai_api_key') || '';
      const reply = await window.focusAPI.ai.chat(chatMessages, provider, apiKey);
      if (reply?.content) {
        let content = reply.content;
        
        // Check if AI wants to start focus session
        if (content.includes('START_FOCUS_SESSION')) {
          content = content.replace('START_FOCUS_SESSION', '').trim();
          addBubble('assistant', content);
          chatMessages.push({ role: 'assistant', content: content });
          
          // Show session configuration modal
          setTimeout(() => {
            showSessionConfigModal();
          }, 1500);
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
  
  function updateSystemIsland() {
    if (!window.focusAPI?.island) return;
    
    if (focusSessionActive) {
      // Update with current session data
      console.log(`🏝️ Updating Dynamic Island: status=${focusStatus}, timeRemaining=${timeRemaining}`);
      window.focusAPI.island.update({
        active: true,
        timeRemaining: timeRemaining,
        status: focusStatus
      });
    } else {
      // Show ready state
      console.log(`🏝️ Updating Dynamic Island: Ready state`);
      window.focusAPI.island.update({
        active: false,
        message: 'Ready to Focus'
      });
    }
  }
  
  function startWindowMonitoring() {
    if (!window.focusAPI?.windowMonitoring) return;
    
    console.log('👁️ Starting window monitoring...');
    
    // Start monitoring
    window.focusAPI.windowMonitoring.start();
    
    // Listen for window changes
    window.focusAPI.windowMonitoring.onWindowChanged((data) => {
      handleWindowChange(data);
    });
    
    // Listen for AI focus analysis results
    window.focusAPI.aiAnalysis.onFocusAnalysis((data) => {
      handleFocusAnalysis(data);
    });
    
    addBubble('assistant', '👁️ Window monitoring started! I\'ll track your window changes and take screenshots.');
  }
  
  function stopWindowMonitoring() {
    if (!window.focusAPI?.windowMonitoring) return;
    
    console.log('🛑 Stopping window monitoring');
    window.focusAPI.windowMonitoring.stop();
    
    // Disable AI analysis
    window.focusAPI.aiAnalysis.disable();
    
    addBubble('assistant', '🛑 Window monitoring stopped.');
  }
  
  function handleWindowChange(data) {
    const { previousWindow, currentWindow, screenshotPath, timestamp } = data;
    
    console.log('🔄 Window changed:', { previousWindow, currentWindow, screenshotPath });
    
    // Update Dynamic Island color based on window change
    if (focusSessionActive) {
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
      
      // Test getting current window
      const currentResult = await window.focusAPI?.windowMonitoring?.getCurrent();
      if (currentResult?.success) {
        console.log('✅ Current window:', currentResult.window);
        showIsland(`📱 Current: ${currentResult.window.split(' - ')[0]}`);
      }
      
      // Test screenshot capability
      const screenshotResult = await window.focusAPI?.windowMonitoring?.testScreenshot();
      if (screenshotResult?.success) {
        console.log('✅ Test screenshot saved:', screenshotResult.path);
        showIsland('📸 Test screenshot saved!');
        addBubble('assistant', `📸 Test screenshot saved to: ${screenshotResult.path.split('/').pop()}`);
      } else {
        console.error('❌ Screenshot test failed:', screenshotResult?.error);
        showIsland('❌ Screenshot test failed');
      }
    } catch (error) {
      console.error('❌ Window monitoring test error:', error);
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
      
      // Clean up the result string and check for various patterns
      const cleanResult = result?.toString().trim().toLowerCase() || '';
      console.log('🤖 Cleaned result for matching:', cleanResult);
      
      if (cleanResult.includes('专注中') || cleanResult.includes('专注') || 
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
      } else if (cleanResult.includes('分心中') || cleanResult.includes('分心') || 
                 cleanResult.includes('distracted') || cleanResult === '1' || 
                 cleanResult.includes('1.') || cleanResult.includes('1、')) {
        statusEmoji = '🚨';
        statusMessage = '分心中';
        newFocusStatus = 'red';
        isAIOverridingStatus = true;
      } else {
        statusEmoji = '❓';
        statusMessage = `状态不明 (${result})`;
        console.warn('🤖 Unknown AI result format:', result);
      }
      
      // Update focus status and Dynamic Island
      if (newFocusStatus !== focusStatus) {
        console.log(`🚨 Focus status changed: ${focusStatus} → ${newFocusStatus}`);
        focusStatus = newFocusStatus;
        updateSystemIsland();
      } else {
        console.log(`✅ Focus status remains: ${focusStatus} (no change needed)`);
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
        sessionDuration = minutes * 60;
        timeRemaining = sessionDuration;
        startFocusSession();
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

  function startFocusSession() {
    if (focusSessionActive) return;
    
    focusSessionActive = true;
    sessionStartTime = Date.now();
    timeRemaining = sessionDuration;
    focusStatus = 'green'; // Start with green status
    
    // Update system-level Dynamic Island
    updateSystemIsland();
    
    // Update chat with session info
    addBubble('assistant', `Great! I've started a ${Math.floor(sessionDuration/60)}-minute focus session for you. Stay focused! I'll monitor your activity and gently remind you if you get distracted.`);
    
    // Start window monitoring
    startWindowMonitoring();
    
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
    
    const sessionLengthMins = Math.floor(sessionDuration / 60);
    const actualTime = Math.floor((Date.now() - sessionStartTime) / 1000);
    const actualMins = Math.floor(actualTime / 60);
    
    // Update system island to ready state
    updateSystemIsland();
    
    // Show completion message
    setTimeout(() => {
      showIsland('🎉 Session Complete! Great work!');
    }, 500);
    addBubble('assistant', `Excellent work! You've completed your ${sessionLengthMins}-minute focus session. How do you feel about what you accomplished?`);
    
    // Save to history
    try {
      const lastUserMessage = chatMessages.filter(m => m.role === 'user').pop();
      window.focusAPI?.history?.add({
        startedAt: sessionStartTime,
        endedAt: Date.now(),
        subject: lastUserMessage?.content?.slice(0, 100) || 'Focus Session',
        lengthMin: actualMins,
        reminders: 0,
        breaksUsed: 0,
        privacy: false,
      });
    } catch (e) {}
  }

  function pauseFocusSession() {
    if (!focusSessionActive) return;
    
    clearInterval(sessionTimer);
    focusSessionActive = false;
    
    // Stop window monitoring
    stopWindowMonitoring();
    
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
})();

