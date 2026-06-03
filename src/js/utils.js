/* ═══════════════════════════════════════════════════════════════════════════
   Utils — Helper functions and AT command parsers
   ═══════════════════════════════════════════════════════════════════════════ */

const Utils = (() => {

  /**
   * Convert RSSI value (0-31) from AT+CSQ to dBm
   */
  function rssiToDbm(rssi) {
    if (rssi === 99 || rssi === null || rssi === undefined) return null;
    return -113 + (rssi * 2);
  }

  /**
   * Get signal quality level from dBm value
   * Returns: { level: 0-5, label: string, class: string }
   */
  function getSignalQuality(dbm) {
    if (dbm === null || dbm === undefined) {
      return { level: 0, label: 'No Signal', class: 'none', color: '#64748b' };
    }
    if (dbm >= -65) return { level: 5, label: 'Excellent', class: 'excellent', color: '#00d4ff' };
    if (dbm >= -75) return { level: 4, label: 'Good', class: 'good', color: '#22c55e' };
    if (dbm >= -85) return { level: 3, label: 'Fair', class: 'fair', color: '#22c55e' };
    if (dbm >= -95) return { level: 2, label: 'Weak', class: 'fair', color: '#f59e0b' };
    if (dbm >= -105) return { level: 1, label: 'Very Weak', class: 'weak', color: '#ef4444' };
    return { level: 0, label: 'No Signal', class: 'weak', color: '#ef4444' };
  }

  /**
   * Parse AT+CSQ response
   * Input: "+CSQ: 15,0" → { rssi: 15, ber: 0, dbm: -83 }
   */
  function parseCSQ(response) {
    const match = response.match(/\+CSQ:\s*(\d+),(\d+)/);
    if (!match) return null;
    const rssi = parseInt(match[1]);
    const ber = parseInt(match[2]);
    return {
      rssi,
      ber,
      dbm: rssiToDbm(rssi)
    };
  }

  /**
   * Parse AT+CREG? response
   * Input: "+CREG: 0,1" → { mode: 0, stat: 1, statText: 'Registered, Home' }
   */
  function parseCREG(response) {
    const match = response.match(/\+CREG:\s*(\d+),(\d+)/);
    if (!match) return null;
    const mode = parseInt(match[1]);
    const stat = parseInt(match[2]);
    const statTexts = {
      0: 'Not Registered',
      1: 'Registered, Home',
      2: 'Searching...',
      3: 'Registration Denied',
      4: 'Unknown',
      5: 'Registered, Roaming'
    };
    return {
      mode,
      stat,
      statText: statTexts[stat] || 'Unknown',
      registered: stat === 1 || stat === 5
    };
  }

  /**
   * Parse AT+COPS? response
   * Input: '+COPS: 0,0,"TELKOMSEL",7' → { mode: 0, format: 0, operator: 'TELKOMSEL', act: 7 }
   */
  function parseCOPS(response) {
    const match = response.match(/\+COPS:\s*(\d+)(?:,(\d+),"([^"]*)"(?:,(\d+))?)?/);
    if (!match) return null;
    const actTexts = {
      0: 'GSM', 1: 'GSM Compact', 2: 'UTRAN', 3: 'EDGE',
      4: 'UTRAN HSDPA', 5: 'UTRAN HSUPA', 6: 'UTRAN HSDPA/HSUPA',
      7: 'E-UTRAN (LTE)', 8: 'EC-GSM-IoT', 9: 'E-UTRAN NB-IoT'
    };
    return {
      mode: parseInt(match[1]),
      format: match[2] ? parseInt(match[2]) : null,
      operator: match[3] || null,
      act: match[4] ? parseInt(match[4]) : null,
      actText: match[4] ? (actTexts[parseInt(match[4])] || 'Unknown') : null
    };
  }

  /**
   * Parse AT+COPS=? response (operator scan)
   * Returns array of operators
   */
  function parseCOPSScan(response) {
    const operators = [];
    const regex = /\((\d+),"([^"]*)","([^"]*)","(\d+)"(?:,(\d+))?\)/g;
    let match;
    while ((match = regex.exec(response)) !== null) {
      const statTexts = { 0: 'Unknown', 1: 'Available', 2: 'Current', 3: 'Forbidden' };
      operators.push({
        stat: parseInt(match[1]),
        statText: statTexts[parseInt(match[1])] || 'Unknown',
        longName: match[2],
        shortName: match[3],
        numeric: match[4],
        act: match[5] ? parseInt(match[5]) : null
      });
    }
    return operators;
  }

  /**
   * Parse AT+CPIN? response
   * Input: "+CPIN: READY" → { status: 'READY', ready: true }
   */
  function parseCPIN(response) {
    const match = response.match(/\+CPIN:\s*(.+)/);
    if (!match) return null;
    const status = match[1].trim();
    return {
      status,
      ready: status === 'READY',
      pinRequired: status === 'SIM PIN',
      pukRequired: status === 'SIM PUK'
    };
  }

  /**
   * Parse AT+CGDCONT? response
   * Returns array of APN configurations
   */
  function parseCGDCONT(response) {
    const apns = [];
    const lines = response.split('\n');
    for (const line of lines) {
      const match = line.match(/\+CGDCONT:\s*(\d+),"([^"]*)","([^"]*)"(?:,"([^"]*)")?/);
      if (match) {
        apns.push({
          cid: parseInt(match[1]),
          pdpType: match[2],
          apn: match[3],
          address: match[4] || ''
        });
      }
    }
    return apns;
  }

  /**
   * Parse AT+CFUN? response
   * Input: "+CFUN: 1" → { fun: 1, enabled: true }
   */
  function parseCFUN(response) {
    const match = response.match(/\+CFUN:\s*(\d+)/);
    if (!match) return null;
    const fun = parseInt(match[1]);
    return {
      fun,
      enabled: fun === 1,
      label: fun === 0 ? 'Minimum (Radio Off)' : fun === 1 ? 'Full (Radio On)' : fun === 4 ? 'Airplane Mode' : `Mode ${fun}`
    };
  }

  /**
   * Extract clean value from AT response (removes echo and OK)
   */
  function cleanResponse(response) {
    if (!response) return '';
    return response
      .split('\n')
      .filter(line => {
        const l = line.trim();
        return l && l !== 'OK' && !l.startsWith('AT');
      })
      .join('\n')
      .trim();
  }

  /**
   * Get single line response (for simple AT queries like ATI, AT+CGSN)
   */
  function getSingleLine(response) {
    const clean = cleanResponse(response);
    return clean.split('\n')[0] || '';
  }

  /**
   * Show a toast notification
   */
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ'
    };
    
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Format timestamp
   */
  function formatTime(date = new Date()) {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * Check if response indicates success
   */
  function isOk(response) {
    return response && response.includes('OK');
  }

  /**
   * Check if response indicates error
   */
  function isError(response) {
    return response && (response.includes('ERROR') || response.includes('TIMEOUT'));
  }

  return {
    rssiToDbm,
    getSignalQuality,
    parseCSQ,
    parseCREG,
    parseCOPS,
    parseCOPSScan,
    parseCPIN,
    parseCGDCONT,
    parseCFUN,
    cleanResponse,
    getSingleLine,
    showToast,
    formatTime,
    isOk,
    isError
  };
})();
