/* ═══════════════════════════════════════════════════════════════════════════
   Dashboard — Main dashboard with signal, network, SIM, and device info
   ═══════════════════════════════════════════════════════════════════════════ */

const Dashboard = (() => {

  let radioEnabled = null;

  /**
   * Refresh all dashboard information
   */
  async function refreshAll() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Refreshing modem info...', 'info');

      await Promise.all([
        refreshSignalInfo(),
        refreshNetworkInfo(),
        refreshSimInfo(),
        refreshDeviceInfo()
      ]);

      Utils.showToast('Dashboard updated', 'success');
    } catch (err) {
      console.error('Refresh error:', err);
      Utils.showToast('Error refreshing info', 'error');
    }
  }

  /**
   * Refresh signal strength
   */
  async function refreshSignalInfo() {
    try {
      const response = await window.modemAPI.sendCommand('AT+CSQ');
      const parsed = Utils.parseCSQ(response);
      if (parsed) {
        updateSignal(parsed);
      }
    } catch (err) {
      console.error('Signal refresh error:', err);
    }
  }

  /**
   * Update signal display elements
   */
  function updateSignal(csqData) {
    const { rssi, dbm } = csqData;
    const quality = Utils.getSignalQuality(dbm);

    // Update gauge
    const gaugeFill = document.getElementById('gauge-fill');
    const gaugeValue = document.getElementById('gauge-value');
    const signalBadge = document.getElementById('signal-badge');

    if (dbm !== null) {
      // Calculate gauge percentage (0-100 mapped to arc)
      const percentage = Math.max(0, Math.min(100, ((dbm + 113) / 63) * 100));
      const totalLength = 251.2;
      const offset = totalLength - (percentage / 100 * totalLength);
      gaugeFill.setAttribute('stroke-dashoffset', offset);
      gaugeValue.textContent = dbm;
    } else {
      gaugeFill.setAttribute('stroke-dashoffset', '251.2');
      gaugeValue.textContent = '--';
    }

    // Update badge
    signalBadge.textContent = quality.label;
    signalBadge.className = `badge ${quality.level >= 3 ? 'badge-green' : quality.level >= 2 ? 'badge-yellow' : quality.level >= 1 ? 'badge-red' : 'badge-gray'}`;

    // Update signal bars
    for (let i = 1; i <= 5; i++) {
      const bar = document.getElementById(`bar-${i}`);
      bar.classList.remove('active', 'weak', 'fair', 'good', 'excellent');
      if (i <= quality.level) {
        bar.classList.add('active', quality.class);
      }
    }

    // Update signal metrics page
    document.getElementById('metric-rssi').textContent = dbm !== null ? dbm : '--';
  }

  /**
   * Refresh network information
   */
  async function refreshNetworkInfo() {
    try {
      // Registration status
      const cregResp = await window.modemAPI.sendCommand('AT+CREG?');
      const creg = Utils.parseCREG(cregResp);
      if (creg) {
        document.getElementById('dash-registration').textContent = creg.statText;
        const networkBadge = document.getElementById('network-badge');
        if (creg.registered) {
          networkBadge.textContent = 'Registered';
          networkBadge.className = 'badge badge-green';
        } else if (creg.stat === 2) {
          networkBadge.textContent = 'Searching';
          networkBadge.className = 'badge badge-yellow';
        } else {
          networkBadge.textContent = creg.statText;
          networkBadge.className = 'badge badge-red';
        }
      }

      // Operator
      const copsResp = await window.modemAPI.sendCommand('AT+COPS?');
      const cops = Utils.parseCOPS(copsResp);
      if (cops) {
        document.getElementById('dash-operator').textContent = cops.operator || 'N/A';
        document.getElementById('dash-network-type').textContent = cops.actText || 'N/A';
        document.getElementById('current-operator').value = cops.operator || '';
      }

      // APN
      const apnResp = await window.modemAPI.sendCommand('AT+CGDCONT?');
      const apns = Utils.parseCGDCONT(apnResp);
      if (apns.length > 0) {
        document.getElementById('dash-apn').textContent = apns[0].apn || 'N/A';
        document.getElementById('apn-current').value = apns[0].apn || '';
      }
    } catch (err) {
      console.error('Network refresh error:', err);
    }
  }

  /**
   * Refresh SIM card information
   */
  async function refreshSimInfo() {
    try {
      // SIM status
      const cpinResp = await window.modemAPI.sendCommand('AT+CPIN?');
      const cpin = Utils.parseCPIN(cpinResp);
      if (cpin) {
        document.getElementById('dash-sim-status').textContent = cpin.status;
        document.getElementById('dev-sim-status').textContent = cpin.status;
        document.getElementById('dev-pin-status').textContent = cpin.pinRequired ? 'Yes' : 'No';
        
        const simBadge = document.getElementById('sim-badge');
        if (cpin.ready) {
          simBadge.textContent = 'Ready';
          simBadge.className = 'badge badge-green';
        } else {
          simBadge.textContent = cpin.status;
          simBadge.className = 'badge badge-yellow';
        }
      }

      // IMSI
      const imsiResp = await window.modemAPI.sendCommand('AT+CIMI');
      const imsi = Utils.getSingleLine(imsiResp);
      if (imsi && !Utils.isError(imsiResp)) {
        document.getElementById('dash-imsi').textContent = imsi;
        document.getElementById('dev-imsi').textContent = imsi;
      }

      // ICCID (try standard command)
      const iccidResp = await window.modemAPI.sendCommand('AT+ICCID');
      const iccid = Utils.getSingleLine(iccidResp);
      if (iccid && !Utils.isError(iccidResp)) {
        document.getElementById('dash-iccid').textContent = iccid.replace('+ICCID: ', '');
        document.getElementById('dev-iccid').textContent = iccid.replace('+ICCID: ', '');
      }
    } catch (err) {
      console.error('SIM refresh error:', err);
    }
  }

  /**
   * Refresh device information
   */
  async function refreshDeviceInfo() {
    try {
      // Manufacturer
      const mfrResp = await window.modemAPI.sendCommand('AT+CGMI');
      const mfr = Utils.getSingleLine(mfrResp);
      if (mfr && !Utils.isError(mfrResp)) {
        document.getElementById('dev-manufacturer').textContent = mfr;
      }

      // Model
      const modelResp = await window.modemAPI.sendCommand('AT+CGMM');
      const model = Utils.getSingleLine(modelResp);
      if (model && !Utils.isError(modelResp)) {
        document.getElementById('dash-model').textContent = model;
        document.getElementById('dev-model').textContent = model;
      }

      // IMEI
      const imeiResp = await window.modemAPI.sendCommand('AT+CGSN');
      const imei = Utils.getSingleLine(imeiResp);
      if (imei && !Utils.isError(imeiResp)) {
        document.getElementById('dash-imei').textContent = imei;
        document.getElementById('dev-imei').textContent = imei;
      }

      // Firmware
      const fwResp = await window.modemAPI.sendCommand('AT+CGMR');
      const fw = Utils.getSingleLine(fwResp);
      if (fw && !Utils.isError(fwResp)) {
        document.getElementById('dash-firmware').textContent = fw;
        document.getElementById('dev-firmware').textContent = fw;
      }

      // Radio status
      const cfunResp = await window.modemAPI.sendCommand('AT+CFUN?');
      const cfun = Utils.parseCFUN(cfunResp);
      if (cfun) {
        radioEnabled = cfun.enabled;
        updateRadioStatus(cfun);
      }
    } catch (err) {
      console.error('Device refresh error:', err);
    }
  }

  /**
   * Update radio status display
   */
  function updateRadioStatus(cfun) {
    const indicator = document.getElementById('radio-status-indicator');
    if (cfun.enabled) {
      indicator.textContent = 'Enabled';
      indicator.className = 'status-pill status-on';
    } else {
      indicator.textContent = 'Disabled';
      indicator.className = 'status-pill status-off';
    }
  }

  /**
   * Toggle radio on/off
   */
  async function toggleRadio() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      const newState = radioEnabled ? 0 : 1;
      const response = await window.modemAPI.sendCommand(`AT+CFUN=${newState}`);

      if (Utils.isOk(response)) {
        radioEnabled = !radioEnabled;
        updateRadioStatus({ enabled: radioEnabled });
        Utils.showToast(`Radio ${radioEnabled ? 'enabled' : 'disabled'}`, 'success');
      } else {
        Utils.showToast('Failed to toggle radio', 'error');
      }
    } catch (err) {
      Utils.showToast('Error toggling radio', 'error');
    }
  }

  /**
   * Restart modem (radio off then on)
   */
  async function restartModem() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      Utils.showToast('Restarting modem...', 'info');

      await window.modemAPI.sendCommand('AT+CFUN=0');
      await new Promise(r => setTimeout(r, 2000));
      const response = await window.modemAPI.sendCommand('AT+CFUN=1');

      if (Utils.isOk(response)) {
        radioEnabled = true;
        updateRadioStatus({ enabled: true });
        Utils.showToast('Modem restarted successfully', 'success');

        // Refresh after a delay
        setTimeout(() => refreshAll(), 3000);
      } else {
        Utils.showToast('Error restarting modem', 'error');
      }
    } catch (err) {
      Utils.showToast('Error restarting modem', 'error');
    }
  }

  /**
   * Reset dashboard displays to defaults
   */
  function reset() {
    // Signal
    document.getElementById('gauge-fill').setAttribute('stroke-dashoffset', '251.2');
    document.getElementById('gauge-value').textContent = '--';
    document.getElementById('signal-badge').textContent = 'N/A';
    document.getElementById('signal-badge').className = 'badge badge-gray';
    for (let i = 1; i <= 5; i++) {
      const bar = document.getElementById(`bar-${i}`);
      bar.classList.remove('active', 'weak', 'fair', 'good', 'excellent');
    }

    // Network
    document.getElementById('network-badge').textContent = 'Unknown';
    document.getElementById('network-badge').className = 'badge badge-gray';
    ['dash-operator', 'dash-registration', 'dash-network-type', 'dash-apn'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });

    // SIM
    document.getElementById('sim-badge').textContent = 'Unknown';
    document.getElementById('sim-badge').className = 'badge badge-gray';
    ['dash-sim-status', 'dash-imsi', 'dash-iccid'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });

    // Device
    ['dash-model', 'dash-imei', 'dash-firmware'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
    ['dev-manufacturer', 'dev-model', 'dev-imei', 'dev-imsi', 'dev-iccid', 'dev-firmware', 'dev-sim-status', 'dev-pin-status'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });

    // Metrics
    ['metric-rssi', 'metric-rsrp', 'metric-rsrq', 'metric-sinr'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });

    // Radio
    document.getElementById('radio-status-indicator').textContent = 'Unknown';
    document.getElementById('radio-status-indicator').className = 'status-pill status-unknown';
    radioEnabled = null;
  }

  return {
    refreshAll,
    refreshSignalInfo,
    refreshNetworkInfo,
    refreshSimInfo,
    refreshDeviceInfo,
    updateSignal,
    toggleRadio,
    restartModem,
    reset
  };
})();
