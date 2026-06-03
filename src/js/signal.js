/* ═══════════════════════════════════════════════════════════════════════════
   Signal Monitor — Real-time signal chart and metrics
   ═══════════════════════════════════════════════════════════════════════════ */

const Signal = (() => {

  let chart = null;
  let ctx = null;
  let autoRefreshTimer = null;
  let refreshInterval = 5000;
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

  function addDataPoint(dbm) {
    dataPoints.push({
      value: dbm,
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

    // Y-axis labels and grid lines (dBm)
    const yLabels = [-50, -65, -75, -85, -95, -105, -113];
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = font;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';

    yLabels.forEach(label => {
      const y = padding.top + ((label - (-50)) / (-113 - (-50))) * h;
      
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + w, y);
      ctx.stroke();

      ctx.fillText(`${label}`, padding.left - 8, y + 4);
    });

    // X-axis label
    ctx.textAlign = 'center';
    ctx.fillText('Time →', padding.left + w / 2, padding.top + h + 28);
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

    // Map data points to coordinates
    const minDbm = -113;
    const maxDbm = -50;
    const points = dataPoints.map((dp, i) => ({
      x: padding.left + (i / (MAX_POINTS - 1)) * w,
      y: padding.top + ((dp.value - maxDbm) / (minDbm - maxDbm)) * h,
      value: dp.value,
      time: dp.time
    }));

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
    gradient.addColorStop(0, chartConfig.gradientStart);
    gradient.addColorStop(1, chartConfig.gradientEnd);

    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + h);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padding.top + h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Draw points
    points.forEach((p, i) => {
      if (i === points.length - 1 || i % 5 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = pointColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // Draw last value label
    if (points.length > 0) {
      const last = points[points.length - 1];
      ctx.fillStyle = lineColor;
      ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${last.value} dBm`, last.x - 6, last.y - 10);
    }

    // X-axis time labels
    ctx.fillStyle = chartConfig.textColor;
    ctx.font = chartConfig.font;
    ctx.textAlign = 'center';
    const labelInterval = Math.max(1, Math.floor(points.length / 6));
    points.forEach((p, i) => {
      if (i % labelInterval === 0 || i === points.length - 1) {
        const timeStr = Utils.formatTime(p.time);
        ctx.fillText(timeStr, p.x, padding.top + h + 16);
      }
    });
  }

  async function refreshSignal() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      const response = await window.modemAPI.sendCommand('AT+CSQ');
      const parsed = Utils.parseCSQ(response);

      if (parsed && parsed.dbm !== null) {
        // Update metrics
        document.getElementById('metric-rssi').textContent = parsed.dbm;
        
        // Add to chart
        addDataPoint(parsed.dbm);

        // Update dashboard signal
        Dashboard.updateSignal(parsed);
      }
    } catch (err) {
      console.error('Signal refresh error:', err);
    }
  }

  function toggleAutoRefresh(enabled) {
    if (enabled) {
      refreshSignal();
      autoRefreshTimer = setInterval(refreshSignal, refreshInterval);
      Utils.showToast('Auto-refresh enabled', 'info');
    } else {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      Utils.showToast('Auto-refresh disabled', 'info');
    }
  }

  function setInterval(ms) {
    refreshInterval = parseInt(ms);
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = window.setInterval(refreshSignal, refreshInterval);
    }
  }

  function clearChart() {
    dataPoints = [];
    drawEmptyChart();
  }

  return {
    init,
    refreshSignal,
    toggleAutoRefresh,
    setInterval,
    clearChart,
    addDataPoint,
    resizeCanvas
  };
})();
