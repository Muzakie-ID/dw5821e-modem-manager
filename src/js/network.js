/* ═══════════════════════════════════════════════════════════════════════════
   Network — APN, operator, band lock, and radio management
   ═══════════════════════════════════════════════════════════════════════════ */

const Network = (() => {

  // ─── Constants ──────────────────────────────────────────────────────────────

  const ALL_LTE_BANDS = [1,2,3,4,5,7,8,12,13,14,17,18,19,20,25,26,28,29,30,32,38,39,40,41,42,43,66];
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
   * Set radio state
   */
  async function setRadio(state) {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast(`${state ? 'Enabling' : 'Disabling'} radio...`, 'info');
      const response = await window.modemAPI.sendCommand(`AT+CFUN=${state}`);

      if (Utils.isOk(response)) {
        const indicator = document.getElementById('radio-status-indicator');
        if (state) {
          indicator.textContent = 'Enabled';
          indicator.className = 'status-pill status-on';
        } else {
          indicator.textContent = 'Disabled';
          indicator.className = 'status-pill status-off';
        }
        Utils.showToast(`Radio ${state ? 'enabled' : 'disabled'}`, 'success');

        if (state) {
          setTimeout(() => Dashboard.refreshAll(), 3000);
        }
      } else {
        Utils.showToast('Failed to change radio state', 'error');
      }
    } catch (err) {
      Utils.showToast('Error changing radio state', 'error');
    }
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
   * Read current band configuration from modem via AT+GTACT?
   */
  async function readCurrentBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Reading band configuration...', 'info');

      const response = await window.modemAPI.sendCommand('AT+GTACT?');

      if (Utils.isOk(response)) {
        const parsed = parseGTACT(response);

        if (parsed) {
          // Set RAT mode dropdown
          const ratSelect = document.getElementById('band-rat-mode');
          if (ratSelect) {
            // Try to match the RAT value to an option
            const option = ratSelect.querySelector(`option[value="${parsed.rat}"]`);
            if (option) {
              ratSelect.value = parsed.rat;
            }
          }

          // Uncheck all first
          toggleAllBands(false, true);

          // Check LTE bands from response
          if (parsed.lteBands.length > 0) {
            parsed.lteBands.forEach(band => {
              const cb = document.querySelector(`#lte-band-grid .band-checkbox-item[data-band="${band}"] input`);
              if (cb) cb.checked = true;
            });
          } else {
            // If no specific bands listed, it means all bands are enabled
            document.querySelectorAll('#lte-band-grid .band-checkbox-item input').forEach(cb => {
              cb.checked = true;
            });
          }

          // Check WCDMA bands from response
          if (parsed.wcdmaBands.length > 0) {
            parsed.wcdmaBands.forEach(band => {
              const cb = document.querySelector(`#wcdma-band-grid .band-checkbox-item[data-band="${band}"] input`);
              if (cb) cb.checked = true;
            });
          } else {
            // If no specific bands listed, all bands enabled
            document.querySelectorAll('#wcdma-band-grid .band-checkbox-item input').forEach(cb => {
              cb.checked = true;
            });
          }

          updateBandCounts();
          updateBandStatus();
          updateBandLockBadge(parsed);
          Utils.showToast('Band configuration read successfully', 'success');
        } else {
          Utils.showToast('Could not parse band configuration', 'warning');
        }
      } else {
        // Try alternative: just display raw response
        Utils.showToast('AT+GTACT not supported or error. Try AT Terminal.', 'warning');
      }
    } catch (err) {
      Utils.showToast('Error reading band configuration', 'error');
    }
  }

  /**
   * Parse AT+GTACT? response
   * Format: +GTACT: <rat>,<pref1>,<pref2>[,<band1>,<band2>,...]
   * Example: +GTACT: 2,1,0,1,3,7,8,20
   */
  function parseGTACT(response) {
    const lines = response.split('\n');
    for (const line of lines) {
      const match = line.match(/\+GTACT:\s*(.+)/);
      if (match) {
        const parts = match[1].split(',').map(s => parseInt(s.trim()));
        if (parts.length >= 1) {
          const rat = parts[0];
          const pref1 = parts.length > 1 ? parts[1] : 0;
          const pref2 = parts.length > 2 ? parts[2] : 0;

          // Remaining values are band numbers
          const bands = parts.slice(3).filter(b => !isNaN(b) && b > 0);

          // Separate LTE and WCDMA bands
          const lteBands = bands.filter(b => ALL_LTE_BANDS.includes(b));
          const wcdmaBands = bands.filter(b => ALL_WCDMA_BANDS.includes(b) && !ALL_LTE_BANDS.includes(b));

          // Note: Some bands exist in both LTE and WCDMA lists (e.g., B1, B2, B5, B8)
          // When GTACT returns bands, context depends on RAT mode
          // For simplicity, we'll mark bands in both grids if they appear in both lists

          return {
            rat,
            pref1,
            pref2,
            allBands: bands,
            lteBands: bands.filter(b => ALL_LTE_BANDS.includes(b)),
            wcdmaBands: bands.filter(b => ALL_WCDMA_BANDS.includes(b)),
            isAllBands: bands.length === 0 // No bands listed = all enabled
          };
        }
      }
    }
    return null;
  }

  /**
   * Apply band lock — send AT+GTACT command with selected bands
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

      // Get selected WCDMA bands
      const wcdmaBands = [];
      document.querySelectorAll('#wcdma-band-grid .band-checkbox-item input:checked').forEach(cb => {
        wcdmaBands.push(parseInt(cb.value));
      });

      if (lteBands.length === 0 && wcdmaBands.length === 0) {
        Utils.showToast('Please select at least one band', 'warning');
        return;
      }

      const ratMode = document.getElementById('band-rat-mode').value;

      // Combine all selected bands
      const allSelectedBands = [...new Set([...lteBands, ...wcdmaBands])];

      // Check if all bands are selected — if so, just send RAT mode only (= unlock)
      const allLteSelected = lteBands.length === ALL_LTE_BANDS.length;
      const allWcdmaSelected = wcdmaBands.length === ALL_WCDMA_BANDS.length;

      let command;
      if (allLteSelected && allWcdmaSelected) {
        // All bands selected = essentially unlocked, just set RAT mode
        command = `AT+GTACT=${ratMode}`;
      } else {
        // Build command with specific bands
        command = `AT+GTACT=${ratMode},${ratMode === '14' ? '1' : ratMode === '13' ? '2' : '1'},0,${allSelectedBands.join(',')}`;
      }

      Utils.showToast('Applying band lock...', 'info');
      const response = await window.modemAPI.sendCommand(command);

      if (Utils.isOk(response)) {
        updateBandCounts();
        updateBandStatus();

        // Update badge
        if (allLteSelected && allWcdmaSelected) {
          setBandBadge('Unlocked', 'badge-gray');
        } else {
          setBandBadge('Locked', 'badge-yellow');
        }

        Utils.showToast('Band lock applied successfully!', 'success');

        // Refresh network info after a moment
        setTimeout(() => Dashboard.refreshNetworkInfo(), 3000);
      } else {
        Utils.showToast('Failed to apply band lock. Check AT Terminal for details.', 'error');
      }
    } catch (err) {
      Utils.showToast('Error applying band lock', 'error');
    }
  }

  /**
   * Reset all bands — unlock all bands by sending AT+GTACT=2
   */
  async function resetAllBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Resetting band configuration...', 'info');
      const response = await window.modemAPI.sendCommand('AT+GTACT=2');

      if (Utils.isOk(response)) {
        // Select all checkboxes
        toggleAllBands(true, true);

        // Reset RAT to auto
        document.getElementById('band-rat-mode').value = '2';

        updateBandCounts();
        updateBandStatus();
        setBandBadge('Unlocked', 'badge-gray');
        Utils.showToast('All bands unlocked (reset to auto)', 'success');

        setTimeout(() => Dashboard.refreshNetworkInfo(), 3000);
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
    const wcdmaChecked = document.querySelectorAll('#wcdma-band-grid .band-checkbox-item input:checked').length;

    const lteCountEl = document.getElementById('lte-band-count');
    const wcdmaCountEl = document.getElementById('wcdma-band-count');

    if (lteCountEl) lteCountEl.textContent = `${lteChecked} / ${ALL_LTE_BANDS.length} selected`;
    if (wcdmaCountEl) wcdmaCountEl.textContent = `${wcdmaChecked} / ${ALL_WCDMA_BANDS.length} selected`;
  }

  /**
   * Update the band status text
   */
  function updateBandStatus() {
    const lteChecked = document.querySelectorAll('#lte-band-grid .band-checkbox-item input:checked').length;
    const wcdmaChecked = document.querySelectorAll('#wcdma-band-grid .band-checkbox-item input:checked').length;
    const totalChecked = lteChecked + wcdmaChecked;
    const totalBands = ALL_LTE_BANDS.length + ALL_WCDMA_BANDS.length;

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
   * Update the band lock badge based on parsed GTACT response
   */
  function updateBandLockBadge(parsed) {
    if (!parsed) return;

    if (parsed.isAllBands || parsed.allBands.length === 0) {
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
    setRadio,
    readBands,
    readCurrentBands,
    applyBandLock,
    resetAllBands,
    toggleAllBands
  };
})();
