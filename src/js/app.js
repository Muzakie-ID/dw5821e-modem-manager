/* ═══════════════════════════════════════════════════════════════════════════
   App — Main application controller
   ═══════════════════════════════════════════════════════════════════════════ */

const App = (() => {

  let currentPage = 'dashboard';
  let portsCache = [];

  /**
   * Initialize the application
   */
  function init() {
    // Initialize modules
    Terminal.init();
    Signal.init();
    SMS.init();

    // Setup navigation
    setupNavigation();

    // Setup event listeners
    setupListeners();

    // Load ports on startup
    refreshPorts();

    // Listen for modem events
    if (window.modemAPI) {
      window.modemAPI.onConnectionStatus(handleConnectionStatus);
      window.modemAPI.onData(handleSerialData);
      window.modemAPI.onError(handleSerialError);
    }
  }

  /**
   * Setup sidebar navigation
   */
  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        navigateTo(page);
      });
    });
  }

  /**
   * Navigate to a page
   */
  function navigateTo(page) {
    // Update nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });

    currentPage = page;

    // Page-specific initialization
    if (page === 'signal') {
      Signal.resizeCanvas();
    } else if (page === 'sms') {
      SMS.onPageActive();
    }
  }

  /**
   * Setup event listeners
   */
  function setupListeners() {
    // Port selection change
    const portSelect = document.getElementById('port-select');
    portSelect.addEventListener('change', () => {
      const selectedPath = portSelect.value;
      const port = portsCache.find(p => p.path === selectedPath);
      const portInfoEl = document.getElementById('port-info');

      if (port) {
        portInfoEl.style.display = 'block';
        document.getElementById('port-manufacturer').textContent = port.manufacturer || 'Unknown';
        document.getElementById('port-vendor-id').textContent = port.vendorId || 'N/A';
        document.getElementById('port-product-id').textContent = port.productId || 'N/A';
      } else {
        portInfoEl.style.display = 'none';
      }
    });
  }

  /**
   * Refresh available COM ports
   */
  async function refreshPorts() {
    try {
      const ports = await window.modemAPI.listPorts();
      portsCache = ports;
      const select = document.getElementById('port-select');
      const currentValue = select.value;

      select.innerHTML = '<option value="">Select COM Port...</option>';
      ports.forEach(port => {
        const opt = document.createElement('option');
        opt.value = port.path;
        opt.textContent = `${port.path} — ${port.friendlyName || port.manufacturer || 'Unknown'}`;
        select.appendChild(opt);
      });

      // Restore selection
      if (currentValue && ports.some(p => p.path === currentValue)) {
        select.value = currentValue;
      }

      // Auto-select if only one Dell/Fibocom port
      if (!currentValue) {
        const dellPort = ports.find(p => 
          (p.manufacturer && p.manufacturer.toLowerCase().includes('dell')) ||
          (p.manufacturer && p.manufacturer.toLowerCase().includes('fibocom')) ||
          (p.friendlyName && p.friendlyName.toLowerCase().includes('dw5821e')) ||
          (p.friendlyName && p.friendlyName.toLowerCase().includes('application'))
        );
        if (dellPort) {
          select.value = dellPort.path;
          select.dispatchEvent(new Event('change'));
        }
      }
    } catch (err) {
      console.error('Error listing ports:', err);
    }
  }

  /**
   * Toggle connection panel visibility
   */
  function toggleConnectionPanel() {
    const panel = document.getElementById('connection-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      refreshPorts();
    }
  }

  /**
   * Connect to serial port
   */
  async function connect() {
    const portSelect = document.getElementById('port-select');
    const baudSelect = document.getElementById('baud-select');
    const portPath = portSelect.value;
    const baudRate = baudSelect.value;

    if (!portPath) {
      Utils.showToast('Please select a COM port', 'warning');
      return;
    }

    try {
      const btnConnect = document.getElementById('btn-connect');
      btnConnect.innerHTML = '<div class="spinner"></div> Connecting...';
      btnConnect.disabled = true;

      await window.modemAPI.connect(portPath, baudRate);

      // UI updated via onConnectionStatus callback
    } catch (err) {
      Utils.showToast(`Connection failed: ${err}`, 'error');
      const btnConnect = document.getElementById('btn-connect');
      btnConnect.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg> Connect`;
      btnConnect.disabled = false;
    }
  }

  /**
   * Disconnect from serial port
   */
  async function disconnect() {
    try {
      await window.modemAPI.disconnect();
    } catch (err) {
      Utils.showToast(`Disconnect error: ${err}`, 'error');
    }
  }

  /**
   * Handle connection status changes
   */
  function handleConnectionStatus(status) {
    const indicator = document.getElementById('connection-indicator');
    const text = document.getElementById('connection-text');
    const btnConnect = document.getElementById('btn-connect');
    const btnDisconnect = document.getElementById('btn-disconnect');
    const sidebarBtn = document.getElementById('btn-connect-sidebar');

    if (status.connected) {
      // Connected state
      indicator.className = 'connection-dot connected';
      text.textContent = 'Connected';
      text.style.color = 'var(--color-success)';

      btnConnect.classList.add('hidden');
      btnDisconnect.classList.remove('hidden');

      sidebarBtn.classList.add('connected');
      sidebarBtn.querySelector('span').textContent = 'Connected';

      // Close panel
      document.getElementById('connection-panel').classList.add('hidden');

      Utils.showToast('Connected to modem', 'success');

      // Auto-refresh dashboard and network bands
      setTimeout(() => {
        Dashboard.refreshAll();
        Network.readCurrentBands();
      }, 500);

      // Start auto-refresh for signal monitor if it's checked (default is checked)
      const autoRefreshCheckbox = document.getElementById('signal-auto-refresh');
      if (autoRefreshCheckbox && autoRefreshCheckbox.checked) {
        Signal.toggleAutoRefresh(true, true);
      }
    } else {
      // Disconnected state
      indicator.className = 'connection-dot disconnected';
      text.textContent = 'Disconnected';
      text.style.color = '';

      btnConnect.classList.remove('hidden');
      btnConnect.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg> Connect`;
      btnConnect.disabled = false;
      btnDisconnect.classList.add('hidden');

      sidebarBtn.classList.remove('connected');
      sidebarBtn.querySelector('span').textContent = 'Connect';

      // Pause auto-refresh (but keep checkbox checked if it was)
      Signal.toggleAutoRefresh(false, true);

      // Reset dashboard
      Dashboard.reset();

      if (status.error) {
        Utils.showToast(`Disconnected: ${status.error}`, 'error');
      } else {
        Utils.showToast('Disconnected from modem', 'info');
      }
    }
  }

  /**
   * Handle incoming serial data
   */
  function handleSerialData(data) {
    // Forward to terminal for real-time display (optional)
    Terminal.appendRawData(data);
  }

  /**
   * Handle serial errors
   */
  function handleSerialError(error) {
    Utils.showToast(`Serial error: ${error}`, 'error');
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init);

  return {
    navigateTo,
    toggleConnectionPanel,
    refreshPorts,
    connect,
    disconnect
  };
})();
