/* ═══════════════════════════════════════════════════════════════════════════
   Network — APN, operator, band lock, and radio management
   ═══════════════════════════════════════════════════════════════════════════ */

const Network = (() => {

  // ─── Constants ──────────────────────────────────────────────────────────────

  const ALL_LTE_BANDS = [1,2,3,4,5,7,8,12,13,14,17,18,19,20,25,26,28,29,30,32,38,39,40,41,42,43,46,66];
  const ALL_WCDMA_BANDS = [1,2,4,5,6,8,9,19];

  // ─── APN ────────────────────────────────────────────────────────────────────

  /**
   * Read current APN configuration
   */
  async function readAPN() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const response = await window.modemAPI.sendCommand('AT+CGDCONT?');
      const apns = Utils.parseCGDCONT(response);

      if (apns.length > 0) {
        document.getElementById('apn-current').value = apns.map(a => `CID${a.cid}: ${a.apn} (${a.pdpType})`).join(', ');
        Utils.showToast('APN info retrieved', 'success');
      } else if (Utils.isError(response)) {
        Utils.showToast('Error reading APN', 'error');
      } else {
        document.getElementById('apn-current').value = 'No APN configured';
      }
    } catch (err) {
      Utils.showToast('Error reading APN', 'error');
    }
  }

  /**
   * Set APN configuration
   */
  async function setAPN() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const apnInput = document.getElementById('apn-input');
      const pdpType = document.getElementById('apn-pdp-type').value;
      const apn = apnInput.value.trim();

      if (!apn) {
        Utils.showToast('Please enter an APN name', 'warning');
        return;
      }

      const response = await window.modemAPI.sendCommand(`AT+CGDCONT=1,"${pdpType}","${apn}"`);

      if (Utils.isOk(response)) {
        Utils.showToast(`APN set to "${apn}"`, 'success');
        apnInput.value = '';
        readAPN();
        // Update dashboard
        document.getElementById('dash-apn').textContent = apn;
      } else {
        Utils.showToast('Failed to set APN', 'error');
      }
    } catch (err) {
      Utils.showToast('Error setting APN', 'error');
    }
  }

  // ─── Operator ───────────────────────────────────────────────────────────────

  /**
   * Scan for available operators
   */
  async function scanOperators() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const listEl = document.getElementById('operator-list');
      listEl.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Scanning networks... This may take up to 60 seconds</span></div>';
      Utils.showToast('Scanning for operators...', 'info', 5000);

      const response = await window.modemAPI.sendCommand('AT+COPS=?');
      const operators = Utils.parseCOPSScan(response);

      if (operators.length > 0) {
        listEl.innerHTML = operators.map(op => `
          <div class="operator-item ${op.stat === 2 ? 'current' : ''}" onclick="Network.selectOperator('${op.numeric}')">
            <div>
              <strong>${op.longName}</strong>
              <small style="color: var(--text-muted); display: block;">${op.numeric} ${op.shortName ? `(${op.shortName})` : ''}</small>
            </div>
            <span class="badge ${op.stat === 2 ? 'badge-green' : op.stat === 1 ? 'badge-blue' : 'badge-red'}">${op.statText}</span>
          </div>
        `).join('');
        Utils.showToast(`Found ${operators.length} operators`, 'success');
      } else if (Utils.isError(response)) {
        listEl.innerHTML = '<p class="text-muted">Error scanning operators</p>';
        Utils.showToast('Error scanning operators', 'error');
      } else {
        listEl.innerHTML = '<p class="text-muted">No operators found</p>';
      }
    } catch (err) {
      document.getElementById('operator-list').innerHTML = '<p class="text-muted">Error scanning operators</p>';
      Utils.showToast('Error scanning operators', 'error');
    }
  }

  /**
   * Select a specific operator manually
   */
  async function selectOperator(numeric) {
    try {
      Utils.showToast('Registering to operator...', 'info');
      const response = await window.modemAPI.sendCommand(`AT+COPS=1,2,"${numeric}"`);

      if (Utils.isOk(response)) {
        Utils.showToast('Operator selected successfully', 'success');
        // Refresh network info
        setTimeout(() => Dashboard.refreshNetworkInfo(), 2000);
      } else {
        Utils.showToast('Failed to select operator', 'error');
      }
    } catch (err) {
      Utils.showToast('Error selecting operator', 'error');
    }
  }

  // ─── Radio ──────────────────────────────────────────────────────────────────

  /**
   * Refresh IP by restarting radio
   */
  async function refreshIP() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Refreshing IP (Restarting Radio)...', 'info');
      const ipEl = document.getElementById('public-ip-address');
      if (ipEl) {
        ipEl.textContent = 'Restarting radio...';
        ipEl.className = 'status-pill status-unknown';
      }

      await window.modemAPI.sendCommand('AT+CFUN=4');
      setTimeout(async () => {
        await window.modemAPI.sendCommand('AT+CFUN=1');
        Dashboard.refreshNetworkInfo();
        
        if (ipEl) ipEl.textContent = 'Reconnecting...';
        
        // Wait another 5 seconds for network registration before checking IP
        setTimeout(() => {
          checkIP();
        }, 5000);
      }, 2000);
    } catch (err) {
      Utils.showToast('Error refreshing IP', 'error');
    }
  }

  let isCheckingIP = false;
  let ipCheckInterval = null;

  /**
   * Check Public IP Address using ipify API
   */
  async function checkIP(silent = false) {
    const ipEl = document.getElementById('public-ip-address');
    if (!ipEl) return;
    
    // Prevent overlapping requests if one is already in progress
    if (isCheckingIP) return;
    isCheckingIP = true;

    try {
      if (!silent && ipEl.textContent !== 'Reconnecting...') {
        ipEl.textContent = 'Checking...';
        ipEl.className = 'status-pill status-unknown';
      }

      // We use the browser's fetch API which will route through the default network
      const response = await fetch('https://api.ipify.org?format=json', {
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        ipEl.textContent = data.ip;
        ipEl.className = 'status-pill status-on';
        if (!silent) Utils.showToast('Public IP retrieved', 'success');
      } else {
        throw new Error('API Error');
      }
    } catch (err) {
      ipEl.textContent = 'Failed / Offline';
      ipEl.className = 'status-pill status-off';
      if (!silent) Utils.showToast('Failed to retrieve IP. Are you connected to the internet?', 'error');
    } finally {
      isCheckingIP = false;
    }
  }

  // Start auto-checking IP every 3 seconds (3000ms)
  // We avoid 500ms because public APIs will instantly block us for rate-limiting
  if (!ipCheckInterval) {
    ipCheckInterval = setInterval(() => {
      // Only check if we're on the Network page to save resources
      const networkPage = document.getElementById('page-network');
      if (networkPage && !networkPage.classList.contains('hidden')) {
        checkIP(true);
      }
    }, 3000);
  }

  // ─── Band Lock ──────────────────────────────────────────────────────────────

  /**
   * Initialize band lock checkbox listeners
   * Called once when the app initializes
   */
  function initBandLock() {
    const allCheckboxes = document.querySelectorAll('.band-checkbox-item input[type="checkbox"]');
    allCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        updateBandCounts();
        updateBandStatus();
      });
    });
  }

  /**
   * Read current band configuration from modem via AT^SLBAND? and AT^BAND_PRI?
   */
  async function readCurrentBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Reading band configuration...', 'info');

      // Read Selected Bands
      const slBandResp = await window.modemAPI.sendCommand('AT^SLBAND?');
      if (Utils.isOk(slBandResp)) {
        const selectedBands = Utils.parseDellSLBand(slBandResp);
        
        toggleAllBands(false, true);

        if (selectedBands.length > 0) {
          selectedBands.forEach(band => {
            const cb = document.querySelector(`#lte-band-grid .band-checkbox-item[data-band="${band}"] input`);
            if (cb) cb.checked = true;
          });
        } else {
          // If no specific bands, check all
          toggleAllBands(true, true);
        }

        updateBandCounts();
        updateBandStatus();
        updateBandLockBadge(selectedBands);
        Utils.showToast('Band configuration read successfully', 'success');
      } else {
        Utils.showToast('AT^SLBAND not supported or error. Try AT Terminal.', 'warning');
      }

      // Read Priority Bands
      const priResp = await window.modemAPI.sendCommand('AT^BAND_PRI?');
      if (Utils.isOk(priResp)) {
        const priBands = Utils.parseDellBandPri(priResp);
        document.getElementById('priority-bands').value = priBands.join(',');
      }

    } catch (err) {
      Utils.showToast('Error reading band configuration', 'error');
    }
  }

  /**
   * Apply band lock — send AT^SLBAND command with selected bands
   */
  async function applyBandLock() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      // Get selected LTE bands
      const lteBands = [];
      document.querySelectorAll('#lte-band-grid .band-checkbox-item input:checked').forEach(cb => {
        lteBands.push(parseInt(cb.value));
      });

      if (lteBands.length === 0) {
        Utils.showToast('Please select at least one band', 'warning');
        return;
      }

      const allLteSelected = lteBands.length === ALL_LTE_BANDS.length;

      let command;
      if (allLteSelected) {
        // Send all supported bands explicitly
        command = `AT^SLBAND=LTE,2,${lteBands.join(',')}`;
      } else {
        command = `AT^SLBAND=LTE,2,${lteBands.join(',')}`;
      }

      Utils.showToast('Applying band lock...', 'info');
      const response = await window.modemAPI.sendCommand(command);

      if (Utils.isOk(response)) {
        updateBandCounts();
        updateBandStatus();

        if (allLteSelected) {
          setBandBadge('Unlocked', 'badge-gray');
        } else {
          setBandBadge('Locked', 'badge-yellow');
        }

        Utils.showToast('Band lock applied. Restarting radio to take effect...', 'success');
        
        // Toggle Radio to apply changes
        await window.modemAPI.sendCommand('AT+CFUN=4');
        setTimeout(async () => {
          await window.modemAPI.sendCommand('AT+CFUN=1');
          Dashboard.refreshNetworkInfo();
          Utils.showToast('Radio restarted. Reconnecting...', 'info');
        }, 2000);
      } else {
        Utils.showToast('Failed to apply band lock. Check AT Terminal for details.', 'error');
      }
    } catch (err) {
      Utils.showToast('Error applying band lock', 'error');
    }
  }

  /**
   * Apply priority bands - send AT^BAND_PRI
   */
  async function applyPriorityBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const priStr = document.getElementById('priority-bands').value.trim();
      const command = priStr ? `AT^BAND_PRI=${priStr}` : `AT^BAND_PRI=`;

      Utils.showToast('Applying priority bands...', 'info');
      const response = await window.modemAPI.sendCommand(command);

      if (Utils.isOk(response)) {
        Utils.showToast('Priority bands set. Restarting radio...', 'success');
        
        // Toggle Radio to apply changes
        await window.modemAPI.sendCommand('AT+CFUN=4');
        setTimeout(async () => {
          await window.modemAPI.sendCommand('AT+CFUN=1');
          Dashboard.refreshNetworkInfo();
        }, 2000);
      } else {
        Utils.showToast('Failed to set priority bands.', 'error');
      }
    } catch (err) {
      Utils.showToast('Error setting priority bands', 'error');
    }
  }

  /**
   * Reset all bands — unlock all bands by sending AT^SLBAND with all bands
   */
  async function resetAllBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Resetting band configuration...', 'info');
      
      const allBandsCommand = `AT^SLBAND=LTE,2,${ALL_LTE_BANDS.join(',')}`;
      const response = await window.modemAPI.sendCommand(allBandsCommand);

      if (Utils.isOk(response)) {
        toggleAllBands(true, true);

        updateBandCounts();
        updateBandStatus();
        setBandBadge('Unlocked', 'badge-gray');
        Utils.showToast('All bands unlocked. Restarting radio...', 'success');

        // Toggle Radio to apply changes
        await window.modemAPI.sendCommand('AT+CFUN=4');
        setTimeout(async () => {
          await window.modemAPI.sendCommand('AT+CFUN=1');
          Dashboard.refreshNetworkInfo();
        }, 2000);
      } else {
        Utils.showToast('Failed to reset bands', 'error');
      }
    } catch (err) {
      Utils.showToast('Error resetting bands', 'error');
    }
  }

  /**
   * Toggle all band checkboxes on or off
   * @param {boolean} checked - true to check all, false to uncheck all
   * @param {boolean} silent - if true, don't update status (used internally)
   */
  function toggleAllBands(checked, silent = false) {
    document.querySelectorAll('.band-checkbox-item input[type="checkbox"]').forEach(cb => {
      cb.checked = checked;
    });
    if (!silent) {
      updateBandCounts();
      updateBandStatus();
    }
  }

  /**
   * Update the band count displays
   */
  function updateBandCounts() {
    const lteChecked = document.querySelectorAll('#lte-band-grid .band-checkbox-item input:checked').length;
    const lteCountEl = document.getElementById('lte-band-count');
    if (lteCountEl) lteCountEl.textContent = `${lteChecked} / ${ALL_LTE_BANDS.length} selected`;
  }

  /**
   * Update the band status text
   */
  function updateBandStatus() {
    const lteChecked = document.querySelectorAll('#lte-band-grid .band-checkbox-item input:checked').length;
    const totalChecked = lteChecked;
    const totalBands = ALL_LTE_BANDS.length;

    const statusEl = document.getElementById('band-status-text');
    if (!statusEl) return;

    if (totalChecked === 0) {
      statusEl.textContent = 'No bands selected — select at least one band';
      statusEl.className = 'band-status-warning';
    } else if (totalChecked === totalBands) {
      statusEl.textContent = 'All bands selected — modem will use all available bands';
      statusEl.className = 'text-muted';
    } else {
      const bandNames = [];
      document.querySelectorAll('.band-checkbox-item input:checked').forEach(cb => {
        const label = cb.closest('.band-checkbox-item').querySelector('.band-label');
        if (label) bandNames.push(label.childNodes[0].textContent);
      });
      statusEl.textContent = `${totalChecked} band${totalChecked > 1 ? 's' : ''} selected: ${bandNames.join(', ')}`;
      statusEl.className = 'band-status-active';
    }
  }

  /**
   * Update the band lock badge based on parsed SLBAND response
   */
  function updateBandLockBadge(selectedBands) {
    if (!selectedBands || selectedBands.length === 0 || selectedBands.length >= ALL_LTE_BANDS.length) {
      setBandBadge('Unlocked', 'badge-gray');
    } else {
      setBandBadge('Locked', 'badge-yellow');
    }
  }

  /**
   * Set the band lock badge text and class
   */
  function setBandBadge(text, badgeClass) {
    const badge = document.getElementById('band-lock-badge');
    if (badge) {
      badge.textContent = text;
      badge.className = `badge ${badgeClass}`;
    }
  }

  // ─── Legacy compat (readBands) ──────────────────────────────────────────────
  // Keep readBands as alias for readCurrentBands for backward compatibility
  const readBands = readCurrentBands;

  // ─── Init ───────────────────────────────────────────────────────────────────

  // Initialize band lock listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBandLock);
  } else {
    // DOM already loaded
    setTimeout(initBandLock, 0);
  }

  return {
    readAPN,
    setAPN,
    scanOperators,
    selectOperator,
    refreshIP,
    checkIP,
    readBands,
    readCurrentBands,
    applyBandLock,
    applyPriorityBands,
    resetAllBands,
    toggleAllBands
  };
})();
