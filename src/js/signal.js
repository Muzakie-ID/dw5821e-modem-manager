/* ═══════════════════════════════════════════════════════════════════════════
   Signal Monitor — Real-time signal chart and metrics
   ═══════════════════════════════════════════════════════════════════════════ */

const Signal = (() => {

  let chart = null;
  let ctx = null;
  let autoRefreshTimer = null;
  let refreshInterval = 2000;
  let dataPoints = [];
  const MAX_POINTS = 60;

  // Chart config
  const chartConfig = {
    padding: { top: 20, right: 20, bottom: 35, left: 50 },
    gridColor: 'rgba(255, 255, 255, 0.04)',
    lineColor: '#00d4ff',
    gradientStart: 'rgba(0, 212, 255, 0.3)',
    gradientEnd: 'rgba(0, 212, 255, 0.0)',
    pointColor: '#00d4ff',
    textColor: '#64748b',
    font: '11px Inter, sans-serif'
  };

  function init() {
    const canvas = document.getElementById('signal-chart');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    drawEmptyChart();
    window.addEventListener('resize', () => {
      resizeCanvas();
      drawChart();
    });
  }

  function resizeCanvas() {
    const canvas = document.getElementById('signal-chart');
    if (!canvas) return;
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  }

  function addDataPoint(rsrp, rsrq, sinr) {
    dataPoints.push({
      rsrp: rsrp !== null ? rsrp : -120,
      rsrq: rsrq !== null ? rsrq : -30,
      sinr: sinr !== null ? sinr : -10,
      time: new Date()
    });
    if (dataPoints.length > MAX_POINTS) {
      dataPoints.shift();
    }
    drawChart();
  }

  function drawEmptyChart() {
    if (!ctx) return;
    const canvas = ctx.canvas;
    const { padding } = chartConfig;
    const w = canvas.width - padding.left - padding.right;
    const h = canvas.height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid(w, h);

    // Empty message
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No signal data yet', padding.left + w / 2, padding.top + h / 2);
  }

  function drawGrid(w, h) {
    const { padding, gridColor, textColor, font } = chartConfig;

    // Y-axis labels from -120 to +30
    const yLabels = [-120, -90, -60, -30, 0, 30];
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = font;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';

    yLabels.forEach(label => {
      // Invert Y axis: larger values at the top
      const yInv = padding.top + h - ((label - (-120)) / (30 - (-120))) * h;
      
      ctx.beginPath();
      ctx.moveTo(padding.left, yInv);
      ctx.lineTo(padding.left + w, yInv);
      ctx.stroke();

      ctx.fillText(`${label}`, padding.left - 8, yInv + 4);
    });

    // X-axis label
    ctx.textAlign = 'center';
    ctx.fillText('Time →', padding.left + w / 2, padding.top + h + 28);
    
    // Legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = '#00d4ff'; ctx.fillText('RSRP', padding.left + 10, padding.top - 5);
    ctx.fillStyle = '#22c55e'; ctx.fillText('RSRQ', padding.left + 50, padding.top - 5);
    ctx.fillStyle = '#f59e0b'; ctx.fillText('SINR', padding.left + 90, padding.top - 5);
  }

  function drawChart() {
    if (!ctx || dataPoints.length === 0) {
      drawEmptyChart();
      return;
    }

    const canvas = ctx.canvas;
    const { padding, lineColor, pointColor } = chartConfig;
    const w = canvas.width - padding.left - padding.right;
    const h = canvas.height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid(w, h);

    // Map Y bounds
    const minVal = -120;
    const maxVal = 30;
    const range = maxVal - minVal;
    const mapY = (val) => padding.top + h - ((val - minVal) / range) * h;

    const drawLine = (key, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      dataPoints.forEach((dp, i) => {
        const x = padding.left + (i / (MAX_POINTS - 1)) * w;
        const y = mapY(dp[key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      
      // Draw points
      dataPoints.forEach((dp, i) => {
        if (i === dataPoints.length - 1 || i % 5 === 0) {
          const x = padding.left + (i / (MAX_POINTS - 1)) * w;
          const y = mapY(dp[key]);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      });
    };

    // Draw lines
    drawLine('rsrp', '#00d4ff');
    drawLine('rsrq', '#22c55e');
    drawLine('sinr', '#f59e0b');

    // Draw last value labels
    if (dataPoints.length > 0) {
      const last = dataPoints[dataPoints.length - 1];
      const lastX = padding.left + w;
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      
      ctx.fillStyle = '#00d4ff';
      ctx.fillText(`${last.rsrp.toFixed(1)}`, lastX, mapY(last.rsrp) - 8);
      
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`${last.rsrq.toFixed(1)}`, lastX, mapY(last.rsrq) - 8);
      
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`${last.sinr.toFixed(1)}`, lastX, mapY(last.sinr) - 8);
    }

    // X-axis time labels
    ctx.fillStyle = chartConfig.textColor;
    ctx.font = chartConfig.font;
    ctx.textAlign = 'center';
    const labelInterval = Math.max(1, Math.floor(dataPoints.length / 6));
    dataPoints.forEach((dp, i) => {
      if (i % labelInterval === 0 || i === dataPoints.length - 1) {
        const x = padding.left + (i / (MAX_POINTS - 1)) * w;
        const timeStr = Utils.formatTime(dp.time);
        ctx.fillText(timeStr, x, padding.top + h + 16);
      }
    });
  }

  async function refreshSignal() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      // Try AT^DEBUG? first
      let parsed = null;
      try {
        const debugResp = await window.modemAPI.sendCommand('AT^DEBUG?');
        if (debugResp && !Utils.isError(debugResp)) {
          parsed = Utils.parseDebugSignal(debugResp);
        }
      } catch (e) {
        console.log('AT^DEBUG? failed, trying CSQ/CESQ...', e);
      }

      // Fallback/Supplement with specific Dell commands if debug query failed
      if (!parsed || parsed.dbm === null || parsed.rsrp === null) {
        const rssiResp = await window.modemAPI.sendCommand('AT^RSSI?');
        const rsrpResp = await window.modemAPI.sendCommand('AT$QCRSRP?');
        const rsrqResp = await window.modemAPI.sendCommand('AT$QCRSRQ?');
        
        let dbm = null;
        let rsrp = null;
        let rsrq = null;

        if (rssiResp && !Utils.isError(rssiResp)) {
          const match = rssiResp.match(/\^RSSI:\s*(-?\d+)/);
          if (match) dbm = parseInt(match[1]);
        }
        
        if (rsrpResp && !Utils.isError(rsrpResp)) {
          const match = rsrpResp.match(/\$QCRSRP:\s*(-?\d+)/);
          if (match) rsrp = parseInt(match[1]);
        }

        if (rsrqResp && !Utils.isError(rsrqResp)) {
          const match = rsrqResp.match(/\$QCRSRQ:\s*(-?\d+)/);
          if (match) rsrq = parseInt(match[1]);
        }

        parsed = {
          dbm: dbm,
          rssi: null,
          rsrp: rsrp,
          rsrq: rsrq,
          sinr: parsed ? parsed.sinr : null
        };
      }

      if (parsed && parsed.dbm !== null) {
        // Update metrics
        const rssiEl = document.getElementById('metric-rssi');
        const rsrpEl = document.getElementById('metric-rsrp');
        const rsrqEl = document.getElementById('metric-rsrq');
        const sinrEl = document.getElementById('metric-sinr');

        if (rssiEl) rssiEl.textContent = parsed.dbm;
        if (rsrpEl) rsrpEl.textContent = parsed.rsrp !== null ? parsed.rsrp : '--';
        if (rsrqEl) rsrqEl.textContent = parsed.rsrq !== null ? parsed.rsrq : '--';
        if (sinrEl) sinrEl.textContent = parsed.sinr !== null ? parsed.sinr : '--';
        
        // Add to chart
        addDataPoint(parsed.rsrp, parsed.rsrq, parsed.sinr);

        // Update dashboard signal
        Dashboard.updateSignal(parsed);
      }
      
      // Pass the global signal to band info so PCC can display it
      fetchBandInfo(parsed);
      
    } catch (err) {
      console.error('Signal refresh error:', err);
    }
  }

  // ─── Per-Band Signal ─────────────────────────────────────────────────────

  let lastBandCells = null;
  let isFirstBandRender = true;

  /**
   * Fetch per-band signal information from modem.
   * Tries multiple AT commands with graceful fallback.
   */
  async function fetchBandInfo(globalSignal) {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      let cells = null;

      // Strategy 1: AT^CA_INFO? (Dell/Foxconn Carrier Aggregation)
      try {
        const resp = await window.modemAPI.sendCommand('AT^CA_INFO?');
        if (resp && !Utils.isError(resp)) {
          const caInfo = Utils.parseDellCAInfo(resp);
          if (caInfo) {
            cells = caInfo;
            // Inject global signal into PCC since CA_INFO only gives band/bandwidth
            if (globalSignal) {
              const pcc = cells.find(c => c.type === 'PCC');
              if (pcc) {
                pcc.rsrp = globalSignal.rsrp;
                pcc.rsrq = globalSignal.rsrq;
                pcc.sinr = globalSignal.sinr;
              }

              // Inject SCC metrics from globalSignal.scells
              if (globalSignal.scells && globalSignal.scells.length > 0) {
                const sccs = cells.filter(c => c.type !== 'PCC');
                for (let i = 0; i < sccs.length; i++) {
                  const scc = sccs[i];
                  // Find matching scell in globalSignal.scells by band, or just take the i-th one
                  const matchedScell = globalSignal.scells.find(s => s.band === scc.band) || globalSignal.scells[i];
                  
                  if (matchedScell) {
                    if (scc.bandwidth === null && matchedScell.bandwidth) scc.bandwidth = matchedScell.bandwidth;
                    scc.rsrp = matchedScell.rsrp;
                    scc.rsrq = matchedScell.rsrq;
                    scc.sinr = matchedScell.sinr;
                  }
                }
              }
            }
          }
        }
      } catch (e) { /* skip */ }

      // Strategy 2: AT^ABAND? (Dell/Foxconn Active Band)
      if (!cells || cells.length === 0) {
        try {
          const resp = await window.modemAPI.sendCommand('AT^ABAND?');
          if (resp && !Utils.isError(resp)) {
            const aband = Utils.parseDellABand(resp);
            if (aband) {
              // ABAND usually returns band number or name. Let's make a generic PCC cell.
              // E.g. ^ABAND: 3
              const bandMatch = aband.match(/\d+/);
              if (bandMatch) {
                cells = [{
                  type: 'PCC',
                  band: parseInt(bandMatch[0]),
                  earfcn: null, pci: null, bandwidth: null, rsrp: null, rsrq: null, sinr: null,
                  freq: Utils.BAND_FREQ_MAP[bandMatch[0]] || null
                }];
              }
            }
          }
        } catch (e) { /* skip */ }
      }

      // Strategy 3: AT+QENG="servingcell" (Quectel-style fallback)
      if (!cells || cells.length === 0) {
        try {
          const resp = await window.modemAPI.sendCommand('AT+QENG="servingcell"');
          if (resp && !Utils.isError(resp)) {
            cells = Utils.parseServingCell(resp);
          }
        } catch (e) { /* skip */ }
      }

      // Strategy 2: AT+QCAINFO (Carrier Aggregation — gives PCC + SCC)
      if (!cells) {
        try {
          const resp = await window.modemAPI.sendCommand('AT+QCAINFO');
          if (resp && !Utils.isError(resp)) {
            cells = Utils.parseQCAInfo(resp);
          }
        } catch (e) { /* skip */ }
      }

      // Strategy 3: AT+QNWINFO (basic band info)
      if (!cells) {
        try {
          const resp = await window.modemAPI.sendCommand('AT+QNWINFO');
          if (resp && !Utils.isError(resp)) {
            const nwInfo = Utils.parseQNWInfo(resp);
            if (nwInfo && nwInfo.band) {
              cells = [{
                type: 'PCC',
                band: nwInfo.band,
                earfcn: nwInfo.earfcn,
                pci: null,
                bandwidth: null,
                rsrp: null,
                rsrq: null,
                sinr: null,
                freq: nwInfo.freq
              }];
            }
          }
        } catch (e) { /* skip */ }
      }

      // Strategy 4: AT^DEBUG? (Dell/Foxconn debug — already used for basic signal)
      if (!cells) {
        try {
          const resp = await window.modemAPI.sendCommand('AT^DEBUG?');
          if (resp && !Utils.isError(resp)) {
            cells = Utils.parseDebugBandInfo(resp);
          }
        } catch (e) { /* skip */ }
      }

      lastBandCells = cells;
      renderBandInfo(cells);

    } catch (err) {
      console.error('Band info fetch error:', err);
    }
  }

  /**
   * Render per-band signal information into the Band Details card.
   */
  function renderBandInfo(cells) {
    const body = document.getElementById('band-signal-body');
    const statusBadge = document.getElementById('band-signal-status');
    const caBadge = document.getElementById('band-signal-ca-badge');
    if (!body) return;

    if (!cells || cells.length === 0) {
      // Keep the empty state or show unsupported
      if (statusBadge) {
        statusBadge.textContent = 'No Data';
        statusBadge.className = 'badge badge-gray';
      }
      if (caBadge) caBadge.classList.add('hidden');

      body.innerHTML = `
        <div class="band-signal-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20v-12"/><path d="M22 20v-16"/>
          </svg>
          <span class="text-muted">Band details not available — modem may not support AT+QENG or AT+QCAINFO</span>
        </div>
      `;
      return;
    }

    // Update status badge
    if (statusBadge) {
      statusBadge.textContent = `${cells.length} Band${cells.length > 1 ? 's' : ''}`;
      statusBadge.className = 'badge badge-blue';
    }

    // Show CA badge if multiple bands (carrier aggregation)
    if (caBadge) {
      if (cells.length > 1) {
        caBadge.classList.remove('hidden');
        caBadge.textContent = `CA ${cells.length}×`;
        caBadge.className = 'badge badge-purple';
      } else {
        caBadge.classList.add('hidden');
      }
    }

    let html = '';
    cells.forEach((cell, idx) => {
      const isPCC = cell.type === 'PCC' || cell.type === 'pcc';
      const badgeClass = isPCC ? 'pcc' : 'scc';
      const bandLabel = cell.band ? `Band ${cell.band}` : 'Unknown';
      const freqLabel = cell.freq ? `(${cell.freq} MHz)` : '';

      const rsrpQuality = Utils.getRsrpQuality(cell.rsrp);
      const rsrqClass = getRsrqClass(cell.rsrq);
      const sinrClass = getSinrClass(cell.sinr);

      const animClass = isFirstBandRender ? ' animate-band-row' : '';

      html += `
        <div class="band-signal-row${animClass}" style="animation-delay: ${idx * 50}ms">
          <div class="band-row-header">
            <span class="band-type-badge ${badgeClass}">${escapeHtml(cell.type)}</span>
            <span class="band-name">${bandLabel} <small>${freqLabel}</small></span>
            <div class="band-row-meta">
              ${cell.earfcn !== null ? `<span>EARFCN: ${cell.earfcn}</span>` : ''}
              ${cell.pci !== null ? `<span>PCI: ${cell.pci}</span>` : ''}
              ${cell.bandwidth !== null ? `<span>BW: ${cell.bandwidth} MHz</span>` : ''}
            </div>
          </div>
          <div class="band-signal-metrics">
            <div class="band-metric">
              <span class="band-metric-label">RSRP</span>
              <span class="band-metric-value ${rsrpQuality.class}">
                ${cell.rsrp !== null ? cell.rsrp : '--'}
                <span class="band-metric-unit">dBm</span>
              </span>
            </div>
            <div class="band-metric">
              <span class="band-metric-label">RSRQ</span>
              <span class="band-metric-value ${rsrqClass}">
                ${cell.rsrq !== null ? cell.rsrq : '--'}
                <span class="band-metric-unit">dB</span>
              </span>
            </div>
            <div class="band-metric">
              <span class="band-metric-label">SINR</span>
              <span class="band-metric-value ${sinrClass}">
                ${cell.sinr !== null ? cell.sinr : '--'}
                <span class="band-metric-unit">dB</span>
              </span>
            </div>
          </div>
          <div class="band-rsrp-bar">
            <div class="band-rsrp-bar-track">
              <div class="band-rsrp-bar-fill" style="width: ${rsrpQuality.percent}%; background: ${rsrpQuality.color};"></div>
            </div>
            <span class="band-rsrp-label" style="color: ${rsrpQuality.color}">${rsrpQuality.label}</span>
          </div>
        </div>
      `;
    });

    body.innerHTML = html;
    isFirstBandRender = false;
  }

  /**
   * Get CSS class for RSRQ quality
   */
  function getRsrqClass(rsrq) {
    if (rsrq === null || rsrq === undefined) return 'none';
    if (rsrq >= -10) return 'excellent';
    if (rsrq >= -15) return 'good';
    if (rsrq >= -20) return 'fair';
    return 'weak';
  }

  /**
   * Get CSS class for SINR quality
   */
  function getSinrClass(sinr) {
    if (sinr === null || sinr === undefined) return 'none';
    if (sinr >= 20) return 'excellent';
    if (sinr >= 10) return 'good';
    if (sinr >= 0) return 'fair';
    return 'weak';
  }

  /**
   * HTML escape helper
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Controls ────────────────────────────────────────────────────────────

  function toggleAutoRefresh(enabled, silent = false) {
    if (enabled) {
      refreshAll();
      autoRefreshTimer = window.setInterval(refreshAll, refreshInterval);
      if (!silent) Utils.showToast('Auto-refresh enabled', 'info');
    } else {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      if (!silent) Utils.showToast('Auto-refresh disabled', 'info');
    }
  }

  /**
   * Combined refresh — signal metrics + band info
   */
  async function refreshAll() {
    await refreshSignal();
    // fetchBandInfo is called internally by refreshSignal to pass the parsed global signal
  }

  function setInterval(ms) {
    refreshInterval = parseInt(ms);
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = window.setInterval(refreshAll, refreshInterval);
    }
  }

  function clearChart() {
    dataPoints = [];
    drawEmptyChart();
  }

  return {
    init,
    refreshSignal,
    fetchBandInfo,
    toggleAutoRefresh,
    setInterval,
    clearChart,
    addDataPoint,
    resizeCanvas
  };
})();
