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
   * Parse AT+CESQ response
   * Input: "+CESQ: 99,99,255,255,20,56"
   */
  function parseCESQ(response) {
    const match = response.match(/\+CESQ:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (!match) return null;
    
    const rxlev = parseInt(match[1]);
    const ber = parseInt(match[2]);
    const rscp = parseInt(match[3]);
    const ecno = parseInt(match[4]);
    const rsrq = parseInt(match[5]);
    const rsrp = parseInt(match[6]);
    
    let rsrqDb = null;
    if (rsrq !== 255) {
      if (rsrq === 0) rsrqDb = -20;
      else if (rsrq === 34) rsrqDb = -3;
      else rsrqDb = -19.5 + (rsrq * 0.5);
    }
    
    let rsrpDbm = null;
    if (rsrp !== 255) {
      if (rsrp === 0) rsrpDbm = -140;
      else if (rsrp === 97) rsrpDbm = -44;
      else rsrpDbm = -140 + rsrp;
    }
    
    return {
      rxlev,
      ber,
      rscp,
      ecno,
      rsrq,
      rsrp,
      rsrqDb,
      rsrpDbm
    };
  }

  /**
   * Parse AT^DEBUG? response containing signal metrics
   */
  function parseDebugSignal(response) {
    if (!response || isError(response)) return null;

    const rsrpMatch = response.match(/(?:RSRP|rsrp)[:\s=]+(-?\d+(?:\.\d+)?)/i);
    const rsrqMatch = response.match(/(?:RSRQ|rsrq)[:\s=]+(-?\d+(?:\.\d+)?)/i);
    const sinrMatch = response.match(/(?:SINR|sinr|RS-SINR|rs-sinr|RS-SNR|rs-snr|SNR|snr)[:\s=]+(-?\d+(?:\.\d+)?)/i);
    const rssiMatch = response.match(/(?:RSSI|rssi)[:\s=]+(-?\d+(?:\.\d+)?)/i);

    const rsrp = rsrpMatch ? parseFloat(rsrpMatch[1]) : null;
    const rsrq = rsrqMatch ? parseFloat(rsrqMatch[1]) : null;
    const sinr = sinrMatch ? parseFloat(sinrMatch[1]) : null;
    let dbm = rssiMatch ? parseFloat(rssiMatch[1]) : null;
    
    if (dbm !== null && dbm >= 0 && dbm <= 31) {
      dbm = rssiToDbm(dbm);
    }

    // Extract SCells from SCellX: blocks
    const scells = [];
    const scellRegex = /SCell\d+:[\s\S]*?(?=SCell\d+:|OK|$)/g;
    const scellMatches = response.match(scellRegex);
    
    if (scellMatches) {
      for (const block of scellMatches) {
        const s_bandMatch = block.match(/BAND[:\s]*(\d+)/i);
        const s_bwMatch = block.match(/BW[:\s]*([\d\.]+)\s*MHz/i);
        const s_rsrpMatch = block.match(/RSRP[:\s]*(-?\d+(?:\.\d+)?)/i);
        const s_rsrqMatch = block.match(/RSRQ[:\s]*(-?\d+(?:\.\d+)?)/i);
        const s_sinrMatch = block.match(/(?:SINR|SNR)[:\s]*(-?\d+(?:\.\d+)?)/i);

        if (s_bandMatch) {
          scells.push({
            band: parseInt(s_bandMatch[1]),
            bandwidth: s_bwMatch ? parseFloat(s_bwMatch[1]) : null,
            rsrp: s_rsrpMatch ? parseFloat(s_rsrpMatch[1]) : null,
            rsrq: s_rsrqMatch ? parseFloat(s_rsrqMatch[1]) : null,
            sinr: s_sinrMatch ? parseFloat(s_sinrMatch[1]) : null
          });
        }
      }
    }

    return {
      dbm,
      rssi: rssiMatch ? parseFloat(rssiMatch[1]) : null,
      rsrp,
      rsrq,
      sinr,
      scells
    };
  }

  /**
   * LTE Band → Frequency mapping
   */
  const BAND_FREQ_MAP = {
    1: '2100', 2: '1900', 3: '1800', 4: 'AWS', 5: '850', 7: '2600',
    8: '900', 12: '700a', 13: '700c', 14: '700ps', 17: '700b',
    18: '800', 19: '800', 20: '800', 25: '1900', 26: '850',
    28: '700', 29: '700d', 30: '2300', 32: '1500',
    38: '2600T', 39: '1900T', 40: '2300T', 41: '2500T',
    42: '3500', 43: '3700', 66: 'AWS+'
  };

  /**
   * Get signal quality level for RSRP value
   * Returns: { label: string, class: string, color: string, percent: number }
   */
  function getRsrpQuality(rsrp) {
    if (rsrp === null || rsrp === undefined) {
      return { label: 'Unknown', class: 'none', color: '#64748b', percent: 0 };
    }
    const percent = Math.max(0, Math.min(100, ((rsrp + 140) / 96) * 100));
    if (rsrp >= -80) return { label: 'Excellent', class: 'excellent', color: '#00d4ff', percent };
    if (rsrp >= -90) return { label: 'Good', class: 'good', color: '#22c55e', percent };
    if (rsrp >= -100) return { label: 'Fair', class: 'fair', color: '#f59e0b', percent };
    if (rsrp >= -110) return { label: 'Weak', class: 'weak', color: '#ef4444', percent };
    return { label: 'Very Weak', class: 'very-weak', color: '#dc2626', percent };
  }

  /**
   * Parse AT+QENG="servingcell" response (Quectel-style)
   * Example: +QENG: "servingcell","NOCONN","LTE","FDD",510,10,1234567,123,1300,3,5,5,-106,-17,-2,10
   */
  function parseServingCell(response) {
    if (!response || isError(response)) return null;
    const cells = [];

    const lines = response.split('\n');
    for (const line of lines) {
      const m = line.match(/\+QENG:\s*"servingcell","[^"]*","LTE","([^"]*)",\d+,\d+,\d+,(\d+),(\d+),(\d+),\d+,\d+,(-?\d+),(-?\d+),(-?\d+),(\d+)/);
      if (m) {
        cells.push({
          type: 'PCC',
          duplex: m[1],
          pci: parseInt(m[2]),
          earfcn: parseInt(m[3]),
          band: parseInt(m[4]),
          rsrp: parseInt(m[5]),
          rsrq: parseInt(m[6]),
          sinr: parseInt(m[7]),
          bandwidth: parseInt(m[8]),
          freq: BAND_FREQ_MAP[parseInt(m[4])] || ''
        });
      }
    }
    return cells.length > 0 ? cells : null;
  }

  /**
   * Parse AT+QCAINFO response (Carrier Aggregation — Quectel-style)
   * Example:
   *   +QCAINFO: "PCC",1300,50,3,-106,-17,-2,123
   *   +QCAINFO: "SCC",100,75,1,-98,-12,8,456
   */
  function parseQCAInfo(response) {
    if (!response || isError(response)) return null;
    const cells = [];

    const lines = response.split('\n');
    for (const line of lines) {
      const m = line.match(/\+QCAINFO:\s*"(\w+)",(\d+),(\d+),(\d+),(-?\d+),(-?\d+),(-?\d+),(\d+)/);
      if (m) {
        const band = parseInt(m[4]);
        cells.push({
          type: m[1],
          earfcn: parseInt(m[2]),
          bandwidth: bandwidthFromRB(parseInt(m[3])),
          band: band,
          rsrp: parseInt(m[5]),
          rsrq: parseInt(m[6]),
          sinr: parseInt(m[7]),
          pci: parseInt(m[8]),
          freq: BAND_FREQ_MAP[band] || ''
        });
      }
    }
    return cells.length > 0 ? cells : null;
  }

  /**
   * Parse AT+QNWINFO response
   * Example: +QNWINFO: "FDD LTE","51010","LTE BAND 3",1300
   */
  function parseQNWInfo(response) {
    if (!response || isError(response)) return null;

    const m = response.match(/\+QNWINFO:\s*"([^"]*)","([^"]*)","([^"]*)",\s*(\d+)/);
    if (!m) return null;

    const bandMatch = m[3].match(/BAND\s*(\d+)/i);
    const band = bandMatch ? parseInt(bandMatch[1]) : null;

    return {
      mode: m[1],
      plmn: m[2],
      bandText: m[3],
      earfcn: parseInt(m[4]),
      band: band,
      freq: band ? (BAND_FREQ_MAP[band] || '') : ''
    };
  }

  /**
   * Parse AT^DEBUG? response for per-band info
   * Some Dell/Foxconn modems include band info in debug output
   */
  function parseDebugBandInfo(response) {
    if (!response || isError(response)) return null;
    const cells = [];

    const bandMatch = response.match(/(?:Band|BAND|LTE Band|E-UTRA Band)[:\s=]+(\d+)/i);
    const earfcnMatch = response.match(/(?:EARFCN|earfcn|DL EARFCN|Channel)[:\s=]+(\d+)/i);
    const pciMatch = response.match(/(?:PCI|pci|Physical Cell ID|PhysCellId)[:\s=]+(\d+)/i);
    const bwMatch = response.match(/(?:BW|Bandwidth|DL BW|bandwidth)[:\s=]+(\d+)/i);
    const rsrpMatch = response.match(/(?:RSRP|rsrp)[:\s=]+(-?\d+(?:\.\d+)?)/i);
    const rsrqMatch = response.match(/(?:RSRQ|rsrq)[:\s=]+(-?\d+(?:\.\d+)?)/i);
    const sinrMatch = response.match(/(?:SINR|sinr|RS-SINR|SNR|snr)[:\s=]+(-?\d+(?:\.\d+)?)/i);

    if (bandMatch || earfcnMatch) {
      const band = bandMatch ? parseInt(bandMatch[1]) : null;
      cells.push({
        type: 'PCC',
        band: band,
        earfcn: earfcnMatch ? parseInt(earfcnMatch[1]) : null,
        pci: pciMatch ? parseInt(pciMatch[1]) : null,
        bandwidth: bwMatch ? parseInt(bwMatch[1]) : null,
        rsrp: rsrpMatch ? parseFloat(rsrpMatch[1]) : null,
        rsrq: rsrqMatch ? parseFloat(rsrqMatch[1]) : null,
        sinr: sinrMatch ? parseFloat(sinrMatch[1]) : null,
        freq: band ? (BAND_FREQ_MAP[band] || '') : ''
      });
    }

    return cells.length > 0 ? cells : null;
  }

  /**
   * Convert Resource Block count to bandwidth in MHz
   */
  function bandwidthFromRB(rb) {
    const map = { 6: 1.4, 15: 3, 25: 5, 50: 10, 75: 15, 100: 20 };
    return map[rb] || rb;
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

  // ─── Dell DW5821e Specific Parsers ──────────────────────────────────────────

  function parseDellTemp(response) {
    const clean = cleanResponse(response);
    if (!clean) return null;
    
    // Check for multi-value Dell format: PA: 39C \n TSENS: 44C
    const paMatch = clean.match(/PA:\s*([\d.-]+)/i);
    const tsMatch = clean.match(/TSENS:\s*([\d.-]+)/i);
    if (paMatch && tsMatch) {
      return `${paMatch[1]}, ${tsMatch[1]}`;
    }

    let match = clean.match(/(?:\^TEMP|\+QTEMP|Temperature|Temp|T)[:=\s]*([\d.-]+)/i);
    if (!match) match = clean.match(/([\d.-]+)/);
    return match ? match[1] : null;
  }

  function parseDellVolt(response) {
    const clean = cleanResponse(response);
    if (!clean) return null;
    let match = clean.match(/(?:\+VOLT|\^VOLT|Voltage|Volt|V)[:=\s]*([\d.-]+)/i);
    if (!match) match = clean.match(/([\d.-]+)/);
    return match ? match[1] : null;
  }

  function parseDellCat(response) {
    const match = response.match(/\^GETLTECAT:\s*(\d+)/i);
    return match ? `CAT ${match[1]}` : null;
  }

  function parseDellUSB(response) {
    const match = response.match(/\^USBTYPE:\s*(.*)/i);
    return match ? match[1].trim() : null;
  }

  function parseDellCustomer(response) {
    const match = response.match(/\^CUSTOMER:\s*"?(.*?)"?\r?\n/i);
    if (!match) {
        // Fallback for no quotes
        const m = response.match(/\^CUSTOMER:\s*(.*)/i);
        return m ? m[1].trim() : null;
    }
    return match[1].trim();
  }

  function parseDellError(response) {
    const match = response.match(/\+CEER:\s*(.*)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Parse AT^CA_INFO?
   * Format usually: ^CA_INFO: PCC, Band, BW ... SCC, Band, BW ...
   * We will extract it generically or fallback to a string.
   */
  function parseDellCAInfo(response) {
    const cells = [];
    const lines = response.split('\n').map(l => l.trim());
    
    for (const line of lines) {
      // Regex to match "PCC info: Band is LTE_B3, Band_width is 20.0 MHz"
      // or "SCC1 info: Band is LTE_B1, Band_width is 20.0 MHz"
      const match = line.match(/(PCC|SCC\d*)\s*info:\s*Band\s*is\s*LTE_B(\d+),\s*Band_width\s*is\s*([\d.]+)\s*MHz/i);
      if (match) {
        const typeStr = match[1].toUpperCase();
        const isPcc = typeStr === 'PCC';
        const band = parseInt(match[2]);
        const bandwidth = match[3]; // The UI template already appends ' MHz'
        
        cells.push({
          type: isPcc ? 'PCC' : 'SCC',
          band: band,
          bandwidth: bandwidth,
          earfcn: null,
          pci: null,
          rsrp: null,
          rsrq: null,
          sinr: null,
          freq: BAND_FREQ_MAP[band] || null
        });
      }
    }
    return cells.length > 0 ? cells : null;
  }

  function parseDellABand(response) {
    const info = response.split('\n').map(l => l.trim()).find(l => l.startsWith('^ABAND:'));
    return info ? info.replace('^ABAND:', '').trim() : null;
  }

  function parseDellSLBand(response) {
    // New format based on user output: "LTE,Enable Bands :1,2,3,..."
    const match = response.match(/LTE,Enable Bands\s*:([,\d\s]+)/i);
    if (match) {
      return match[1].split(',').map(b => parseInt(b.trim())).filter(b => !isNaN(b));
    }

    // Fallback for older firmware just in case
    const info = response.split('\n').map(l => l.trim()).find(l => l.startsWith('^SLBAND:'));
    if (info) {
      const bandsStr = info.replace('^SLBAND:', '').replace('LTE', '').replace(/^[,\s]+/, '').trim();
      return bandsStr.split(',').map(b => parseInt(b.trim())).filter(b => !isNaN(b));
    }
    return [];
  }

  function parseDellBandPri(response) {
    const info = response.split('\n').map(l => l.trim()).find(l => l.startsWith('^BAND_PRI:'));
    if (info) {
      const bandsStr = info.replace('^BAND_PRI:', '').trim();
      return bandsStr.split(',').map(b => parseInt(b.trim())).filter(b => !isNaN(b));
    }
    return [];
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
    getRsrpQuality,
    parseCSQ,
    parseCESQ,
    parseDebugSignal,
    parseServingCell,
    parseQCAInfo,
    parseQNWInfo,
    parseDebugBandInfo,
    parseCREG,
    parseCOPS,
    parseCOPSScan,
    parseCPIN,
    parseCGDCONT,
    parseCFUN,
    parseDellTemp,
    parseDellVolt,
    parseDellCat,
    parseDellUSB,
    parseDellCustomer,
    parseDellError,
    parseDellCAInfo,
    parseDellABand,
    parseDellSLBand,
    parseDellBandPri,
    cleanResponse,
    getSingleLine,
    showToast,
    formatTime,
    isOk,
    isError,
    BAND_FREQ_MAP
  };
})();
