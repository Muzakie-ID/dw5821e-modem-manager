/* ═══════════════════════════════════════════════════════════════════════════
   Network — APN, operator, band, and radio management
   ═══════════════════════════════════════════════════════════════════════════ */

const Network = (() => {

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

  /**
   * Read current band configuration
   */
  async function readBands() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const bandInfo = document.getElementById('band-info');
      bandInfo.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Reading band configuration...</span></div>';

      // Try multiple commands that might work for this modem
      let result = '';

      const gtactResp = await window.modemAPI.sendCommand('AT+GTACT?');
      if (Utils.isOk(gtactResp)) {
        result += 'Band Configuration (GTACT):\n' + Utils.cleanResponse(gtactResp) + '\n\n';
      }

      const xactResp = await window.modemAPI.sendCommand('AT+XACT?');
      if (Utils.isOk(xactResp)) {
        result += 'Active Technology (XACT):\n' + Utils.cleanResponse(xactResp) + '\n\n';
      }

      // Also get serving cell info
      const cregResp = await window.modemAPI.sendCommand('AT+CREG=2;+CREG?');
      if (Utils.isOk(cregResp)) {
        result += 'Extended Registration:\n' + Utils.cleanResponse(cregResp) + '\n\n';
      }

      if (result.trim()) {
        bandInfo.textContent = result;
        Utils.showToast('Band info retrieved', 'success');
      } else {
        bandInfo.innerHTML = '<p class="text-muted">Could not retrieve band information. The modem may not support the standard band query commands. Try using the AT Terminal to send proprietary commands.</p>';
        Utils.showToast('Band commands not supported or no response', 'warning');
      }
    } catch (err) {
      document.getElementById('band-info').innerHTML = '<p class="text-muted">Error reading band configuration</p>';
      Utils.showToast('Error reading bands', 'error');
    }
  }

  return {
    readAPN,
    setAPN,
    scanOperators,
    selectOperator,
    setRadio,
    readBands
  };
})();
