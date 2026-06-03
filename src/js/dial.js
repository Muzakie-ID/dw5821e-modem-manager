/* ═══════════════════════════════════════════════════════════════════════════
   Dial — USSD code execution module
   Handles USSD queries, interactive sessions, response decoding,
   quick dial presets, and session history.
   ═══════════════════════════════════════════════════════════════════════════ */

const Dial = (() => {

  let sessionActive = false;
  let isDialing = false;
  let history = [];        // Session history (last 20)
  const MAX_HISTORY = 20;

  let customPresets = [];

  // ─── Initialization ───────────────────────────────────────────────────────

  function init() {
    const input = document.getElementById('dial-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          dialCode();
        }
      });
      input.addEventListener('input', validateInput);
    }

    const replyInput = document.getElementById('dial-reply-input');
    if (replyInput) {
      replyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendReply();
        }
      });
    }

    // Render initial presets
    renderPresets();
    renderHistory();
  }

  // ─── USSD Execution ──────────────────────────────────────────────────────

  /**
   * Dial a USSD code
   */
  async function dialCode(code) {
    if (isDialing) return;

    // Get code from parameter or input
    if (!code) {
      const input = document.getElementById('dial-input');
      code = input ? input.value.trim() : '';
    }

    if (!code) {
      Utils.showToast('Enter a USSD code', 'warning');
      return;
    }

    // Validate
    if (!isValidUssd(code)) {
      Utils.showToast('Invalid USSD code format', 'warning');
      return;
    }

    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      isDialing = true;
      setDialingState(true);
      setResponseState('loading');

      // Send USSD command
      const response = await window.modemAPI.sendCommand(`AT+CUSD=1,"${code}",15`);

      // Parse +CUSD response
      const parsed = parseCUSD(response);

      if (parsed) {
        sessionActive = parsed.sessionActive;
        displayResponse(parsed);
        addToHistory(code, parsed);
        updateSessionUI();
      } else if (Utils.isOk(response)) {
        // Sometimes OK comes first, then +CUSD arrives asynchronously
        // Show waiting state
        setResponseState('waiting');
        // Wait a bit for the USSD response
        await new Promise(r => setTimeout(r, 3000));

        // Try to check if we got a response via the data listener
        setResponseState('empty');
        displayResponse({
          status: 0,
          text: 'Command sent. Response may appear in terminal.',
          dcs: 15,
          sessionActive: false
        });
      } else if (Utils.isError(response)) {
        setResponseState('error');
        displayResponse({
          status: 4,
          text: `Error: ${response}`,
          dcs: 15,
          sessionActive: false
        });
      }

    } catch (err) {
      console.error('USSD dial error:', err);
      Utils.showToast(`Dial failed: ${err}`, 'error');
      setResponseState('error');
    }

    isDialing = false;
    setDialingState(false);
  }

  /**
   * Send reply within active USSD session
   */
  async function sendReply() {
    if (!sessionActive || isDialing) return;

    const input = document.getElementById('dial-reply-input');
    const reply = input ? input.value.trim() : '';

    if (!reply) {
      Utils.showToast('Enter a reply', 'warning');
      return;
    }

    try {
      isDialing = true;
      setDialingState(true);
      setResponseState('loading');

      const response = await window.modemAPI.sendCommand(`AT+CUSD=1,"${reply}",15`);
      const parsed = parseCUSD(response);

      if (parsed) {
        sessionActive = parsed.sessionActive;
        displayResponse(parsed);
        updateSessionUI();
      }

      // Clear reply input
      if (input) input.value = '';

    } catch (err) {
      console.error('USSD reply error:', err);
      Utils.showToast('Reply failed', 'error');
    }

    isDialing = false;
    setDialingState(false);
  }

  /**
   * Cancel active USSD session
   */
  async function cancelSession() {
    try {
      await window.modemAPI.sendCommand('AT+CUSD=2');
      sessionActive = false;
      updateSessionUI();
      Utils.showToast('Session cancelled', 'info');
    } catch (err) {
      console.error('Cancel session error:', err);
    }
  }

  // ─── Response Parsing & Decoding ──────────────────────────────────────────

  /**
   * Parse +CUSD response
   */
  function parseCUSD(response) {
    if (!response) return null;

    // Try to find +CUSD line in response
    const lines = response.split('\n');
    for (const line of lines) {
      const match = line.match(/\+CUSD:\s*(\d+)(?:,"([^"]*)"(?:,(\d+))?)?/);
      if (match) {
        const status = parseInt(match[1]);
        const rawText = match[2] || '';
        const dcs = match[3] ? parseInt(match[3]) : 15;

        let decodedText = rawText;

        // DCS 72 = UCS2 hex-encoded
        if (dcs === 72 && /^[0-9A-Fa-f]+$/.test(rawText) && rawText.length >= 4) {
          decodedText = decodeUcs2Hex(rawText);
        }

        return {
          status,
          text: decodedText,
          dcs,
          sessionActive: status === 1
        };
      }
    }

    return null;
  }

  /**
   * Decode UCS2 hex string to text
   */
  function decodeUcs2Hex(hex) {
    let result = '';
    for (let i = 0; i < hex.length; i += 4) {
      if (i + 4 <= hex.length) {
        result += String.fromCharCode(parseInt(hex.substring(i, i + 4), 16));
      }
    }
    return result;
  }

  /**
   * Validate USSD code format
   */
  function isValidUssd(code) {
    return /^[*#][0-9*#]+#$/.test(code);
  }

  /**
   * Validate input field in real-time
   */
  function validateInput() {
    const input = document.getElementById('dial-input');
    if (!input) return;
    const value = input.value.trim();
    const isValid = value === '' || /^[*#][0-9*#]*#?$/.test(value);
    input.classList.toggle('input-error', !isValid && value !== '');
  }

  // ─── History Management ───────────────────────────────────────────────────

  /**
   * Add a session to history
   */
  function addToHistory(code, parsed) {
    history.unshift({
      code,
      text: parsed.text,
      status: parsed.status,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });

    // Keep only last N entries
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    renderHistory();
  }

  // ─── Preset Management ───────────────────────────────────────────────────

  /**
   * Add a custom preset
   */
  function addCustomPreset() {
    const codeInput = document.getElementById('dial-custom-code');
    const labelInput = document.getElementById('dial-custom-label');

    const code = codeInput ? codeInput.value.trim() : '';
    const label = labelInput ? labelInput.value.trim() : '';

    if (!code || !isValidUssd(code)) {
      Utils.showToast('Enter a valid USSD code', 'warning');
      return;
    }

    customPresets.push({
      label: label || code,
      code: code,
      icon: '⭐'
    });

    if (codeInput) codeInput.value = '';
    if (labelInput) labelInput.value = '';

    renderPresets();
    Utils.showToast('Preset saved', 'success');
  }

  /**
   * Remove a custom preset
   */
  function removeCustomPreset(index) {
    customPresets.splice(index, 1);
    renderPresets();
  }

  // ─── UI Rendering ─────────────────────────────────────────────────────────

  /**
   * Render custom preset buttons
   */
  function renderPresets() {
    const grid = document.getElementById('dial-presets-grid');
    if (!grid) return;

    if (customPresets.length === 0) {
      grid.innerHTML = `
        <div class="dial-preset-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span class="text-muted">Add your USSD codes below</span>
        </div>
      `;
      return;
    }

    let html = '';
    customPresets.forEach((preset, idx) => {
      html += `
        <button class="dial-preset-btn" onclick="Dial.dialCode('${preset.code}')" title="${preset.code}">
          <span class="dial-preset-icon">${preset.icon}</span>
          <span class="dial-preset-label">${escapeHtml(preset.label)}</span>
          <span class="dial-preset-code">${preset.code}</span>
          <span class="dial-preset-remove" onclick="event.stopPropagation(); Dial.removeCustomPreset(${idx})" title="Remove">×</span>
        </button>
      `;
    });

    grid.innerHTML = html;
  }

  /**
   * Render session history list
   */
  function renderHistory() {
    const container = document.getElementById('dial-history-list');
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = `
        <div class="dial-history-empty">
          <span class="text-muted">No history yet</span>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((entry, idx) => {
      const preview = entry.text.length > 60 ? entry.text.substring(0, 60) + '…' : entry.text;
      const statusClass = entry.status === 0 ? 'success' : entry.status === 1 ? 'active' : 'error';

      html += `
        <div class="dial-history-item" onclick="Dial.dialCode('${entry.code}')">
          <div class="dial-history-header">
            <span class="dial-history-code">${entry.code}</span>
            <span class="dial-history-time">${entry.timestamp}</span>
          </div>
          <div class="dial-history-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /**
   * Display USSD response in the response panel
   */
  function displayResponse(parsed) {
    const panel = document.getElementById('dial-response-panel');
    const textEl = document.getElementById('dial-response-text');
    const statusEl = document.getElementById('dial-response-status');

    if (!panel || !textEl) return;

    panel.classList.remove('hidden');

    // Format text — preserve line breaks
    textEl.textContent = parsed.text;

    // Status indicator
    if (statusEl) {
      const statusLabels = {
        0: 'Complete',
        1: 'Session Active',
        2: 'Terminated',
        4: 'Not Supported'
      };
      const statusClasses = {
        0: 'status-complete',
        1: 'status-active',
        2: 'status-terminated',
        4: 'status-error'
      };
      statusEl.textContent = statusLabels[parsed.status] || 'Unknown';
      statusEl.className = `dial-status-badge ${statusClasses[parsed.status] || ''}`;
    }

    setResponseState('result');
  }

  /**
   * Update session-related UI elements
   */
  function updateSessionUI() {
    const replySection = document.getElementById('dial-reply-section');
    const cancelBtn = document.getElementById('dial-btn-cancel');

    if (replySection) {
      replySection.classList.toggle('hidden', !sessionActive);
    }
    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', !sessionActive);
    }
  }

  /**
   * Set dialing spinner state
   */
  function setDialingState(dialing) {
    const btn = document.getElementById('dial-btn-execute');
    if (!btn) return;

    if (dialing) {
      btn.innerHTML = '<div class="spinner"></div>';
      btn.disabled = true;
    } else {
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      `;
      btn.disabled = false;
    }
  }

  /**
   * Set response panel state
   */
  function setResponseState(state) {
    const panel = document.getElementById('dial-response-panel');
    const loader = document.getElementById('dial-response-loader');
    const content = document.getElementById('dial-response-content');
    const empty = document.getElementById('dial-response-empty');

    if (!panel) return;
    panel.classList.remove('hidden');

    if (loader) loader.classList.toggle('hidden', state !== 'loading' && state !== 'waiting');
    if (content) content.classList.toggle('hidden', state === 'loading' || state === 'waiting' || state === 'empty');
    if (empty) empty.classList.toggle('hidden', state !== 'empty');
  }

  /**
   * Clear history
   */
  function clearHistory() {
    history = [];
    renderHistory();
    Utils.showToast('History cleared', 'info');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    init,
    dialCode,
    sendReply,
    cancelSession,
    addCustomPreset,
    removeCustomPreset,
    clearHistory
  };

})();
