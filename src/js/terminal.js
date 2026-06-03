/* ═══════════════════════════════════════════════════════════════════════════
   Terminal — Interactive AT command terminal
   ═══════════════════════════════════════════════════════════════════════════ */

const Terminal = (() => {

  let commandHistory = [];
  let historyIndex = -1;
  const MAX_HISTORY = 100;

  function init() {
    const input = document.getElementById('terminal-input');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateHistory(1);
      }
    });
  }

  /**
   * Send command from input field
   */
  async function send() {
    const input = document.getElementById('terminal-input');
    const command = input.value.trim();
    if (!command) return;

    input.value = '';

    // Add to history
    if (commandHistory[commandHistory.length - 1] !== command) {
      commandHistory.push(command);
      if (commandHistory.length > MAX_HISTORY) commandHistory.shift();
    }
    historyIndex = -1;

    await executeCommand(command);
  }

  /**
   * Send a quick command
   */
  async function sendQuick(command) {
    await executeCommand(command);
  }

  /**
   * Execute AT command and display result
   */
  async function executeCommand(command) {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        appendLine(command, 'cmd');
        appendLine('Error: Not connected to modem', 'error');
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      // Show command
      appendTimestamp();
      appendLine(command, 'cmd');

      const response = await window.modemAPI.sendCommand(command);

      // Display response
      if (response) {
        const lines = response.split('\n');
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;

          // Skip echo
          if (trimmed === command) return;

          if (trimmed === 'OK') {
            appendLine('OK', 'success');
          } else if (trimmed.startsWith('ERROR') || trimmed.startsWith('+CME ERROR') || trimmed.startsWith('+CMS ERROR')) {
            appendLine(trimmed, 'error');
          } else if (trimmed.startsWith('TIMEOUT')) {
            appendLine(trimmed, 'error');
          } else {
            appendLine(trimmed, 'response');
          }
        });
      }
    } catch (err) {
      appendLine(`Error: ${err}`, 'error');
    }

    scrollToBottom();
  }

  /**
   * Append a line to terminal output
   */
  function appendLine(text, type = 'response') {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    output.appendChild(line);
    scrollToBottom();
  }

  /**
   * Append timestamp separator
   */
  function appendTimestamp() {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.className = 'terminal-line timestamp';
    line.textContent = `── ${Utils.formatTime()} ──`;
    output.appendChild(line);
  }

  /**
   * Navigate command history
   */
  function navigateHistory(direction) {
    const input = document.getElementById('terminal-input');
    if (commandHistory.length === 0) return;

    if (direction === -1) {
      // Up
      if (historyIndex === -1) {
        historyIndex = commandHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
    } else {
      // Down
      if (historyIndex >= commandHistory.length - 1) {
        historyIndex = -1;
        input.value = '';
        return;
      } else {
        historyIndex++;
      }
    }

    if (historyIndex >= 0 && historyIndex < commandHistory.length) {
      input.value = commandHistory[historyIndex];
    }
  }

  /**
   * Clear terminal output
   */
  function clear() {
    const output = document.getElementById('terminal-output');
    output.innerHTML = `
      <div class="terminal-welcome">
        <span class="terminal-accent">DW5821e Terminal</span> — Cleared
        <br>Terminal ready. Type an AT command below.
      </div>
    `;
  }

  /**
   * Scroll terminal to bottom
   */
  function scrollToBottom() {
    const output = document.getElementById('terminal-output');
    output.scrollTop = output.scrollHeight;
  }

  /**
   * Handle raw serial data display
   */
  function appendRawData(data) {
    // We can optionally show raw data in terminal
    // For now, the command-based responses are enough
  }

  return {
    init,
    send,
    sendQuick,
    clear,
    appendLine,
    appendRawData
  };
})();
