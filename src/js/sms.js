/* ═══════════════════════════════════════════════════════════════════════════
   SMS — PDU-based SMS management module
   Handles inbox reading, message sending, PDU encoding/decoding,
   multi-segment concatenation, and storage management.
   ═══════════════════════════════════════════════════════════════════════════ */

const SMS = (() => {

  let messages = [];       // Parsed & concatenated messages
  let rawMessages = [];    // Raw parsed PDUs before concatenation
  let selectedIds = new Set();
  let smscNumber = '';
  let isSending = false;
  let isLoading = false;

  // ─── Initialization ───────────────────────────────────────────────────────

  /**
   * Initialize SMS module — configure modem for PDU mode
   */
  async function init() {
    // Setup event listeners
    const textarea = document.getElementById('sms-message');
    if (textarea) {
      textarea.addEventListener('input', updateCharCount);
    }

    const recipientInput = document.getElementById('sms-recipient');
    if (recipientInput) {
      recipientInput.addEventListener('input', validateRecipient);
    }

    const selectAll = document.getElementById('sms-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', toggleSelectAll);
    }
  }

  /**
   * Called when SMS page becomes active — configure modem & load inbox
   */
  async function onPageActive() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        return;
      }

      // Configure PDU mode
      await window.modemAPI.sendCommand('AT+CMGF=0');
      await window.modemAPI.sendCommand('AT+CSCS="GSM"');

      // Load data
      await Promise.all([
        fetchInbox(),
        fetchSmsc(),
        refreshStorage()
      ]);
    } catch (err) {
      console.error('SMS init error:', err);
    }
  }

  // ─── PDU Encoder (SMS-SUBMIT) ─────────────────────────────────────────────

  /**
   * Swap semi-octets for phone number encoding
   */
  function swapPhoneSemiOctets(number) {
    let clean = number.replace(/\D/g, '');
    if (clean.length % 2 !== 0) {
      clean += 'F';
    }
    let swapped = '';
    for (let i = 0; i < clean.length; i += 2) {
      swapped += clean[i + 1] + clean[i];
    }
    return swapped;
  }

  /**
   * Encode text to UCS2 hex string
   */
  function encodeToUcs2Hex(text) {
    let hex = '';
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i).toString(16).toUpperCase();
      hex += code.padStart(4, '0');
    }
    return hex;
  }

  /**
   * Encode SMS-SUBMIT PDU
   * @param {string} smsc - Service Center Number (e.g. "+6281100000")
   * @param {string} recipient - Destination Number (e.g. "+62812345678")
   * @param {string} text - Message body
   * @returns {object} { smscPart, pduBody, fullPduHex, pduLength }
   */
  function encodeSmsSubmitPdu(smsc, recipient, text) {
    // 1. Service Center Header
    let formattedSmsc = swapPhoneSemiOctets(smsc.replace(/^\+/, ''));
    let smscLen = (formattedSmsc.length / 2) + 1;
    let smscPart = `${smscLen.toString(16).padStart(2, '0').toUpperCase()}91${formattedSmsc}`;

    // 2. Destination Number Header
    let cleanRecipient = recipient.replace(/^\+/, '');
    let formattedDest = swapPhoneSemiOctets(cleanRecipient);
    let destLenHex = cleanRecipient.length.toString(16).padStart(2, '0').toUpperCase();

    // Determine TON/NPI (91 for international with +, 81 for national)
    let destTon = recipient.startsWith('+') ? '91' : '81';
    let destPart = `${destLenHex}${destTon}${formattedDest}`;

    // 3. User Data (Message Content) — UCS2
    let ucs2Body = encodeToUcs2Hex(text);
    let bodyLenByte = (ucs2Body.length / 2).toString(16).padStart(2, '0').toUpperCase();

    // 4. Combine submit body
    // 11: SMS-SUBMIT type (MTI=01, VPF=10 relative)
    // 00: Message reference (modem assigns)
    // destPart: Destination header
    // 00: Protocol identifier
    // 08: Data coding scheme (UCS2 / Unicode)
    // A7: Validity period (24 hours)
    let pduBody = `1100${destPart}0008A7${bodyLenByte}${ucs2Body}`;

    return {
      smscPart: smscPart,
      pduBody: pduBody,
      fullPduHex: smscPart + pduBody,
      pduLength: pduBody.length / 2
    };
  }

  /**
   * Encode multi-segment SMS with UDH for concatenation
   */
  function encodeLongSms(smsc, recipient, text) {
    const maxCharsPerSegment = 67; // UCS2 with UDH: (140 - 6) / 2 = 67
    if (text.length <= 70) {
      // Single segment
      return [encodeSmsSubmitPdu(smsc, recipient, text)];
    }

    const segments = [];
    const totalSegments = Math.ceil(text.length / maxCharsPerSegment);
    const refId = Math.floor(Math.random() * 256); // 8-bit reference

    for (let i = 0; i < totalSegments; i++) {
      const segmentText = text.substring(i * maxCharsPerSegment, (i + 1) * maxCharsPerSegment);
      const ucs2Body = encodeToUcs2Hex(segmentText);

      // UDH for concatenation: 05 00 03 XX TT SS
      // 05 = UDH length (5 bytes)
      // 00 = Concatenated SM IEI
      // 03 = IEI data length
      // XX = Reference number
      // TT = Total segments
      // SS = Segment number (1-based)
      const udh = `050003${refId.toString(16).padStart(2, '0').toUpperCase()}${totalSegments.toString(16).padStart(2, '0').toUpperCase()}${(i + 1).toString(16).padStart(2, '0').toUpperCase()}`;

      // Total UD length = UDH bytes + UCS2 data bytes
      const udLen = (udh.length / 2) + (ucs2Body.length / 2);
      const udLenHex = udLen.toString(16).padStart(2, '0').toUpperCase();

      // SMSC
      let formattedSmsc = swapPhoneSemiOctets(smsc.replace(/^\+/, ''));
      let smscLen = (formattedSmsc.length / 2) + 1;
      let smscPart = `${smscLen.toString(16).padStart(2, '0').toUpperCase()}91${formattedSmsc}`;

      // Destination
      let cleanRecipient = recipient.replace(/^\+/, '');
      let formattedDest = swapPhoneSemiOctets(cleanRecipient);
      let destLenHex = cleanRecipient.length.toString(16).padStart(2, '0').toUpperCase();
      let destTon = recipient.startsWith('+') ? '91' : '81';
      let destPart = `${destLenHex}${destTon}${formattedDest}`;

      // 51: SMS-SUBMIT with UDHI bit set (0x40 | 0x11)
      let pduBody = `5100${destPart}0008A7${udLenHex}${udh}${ucs2Body}`;

      segments.push({
        smscPart: smscPart,
        pduBody: pduBody,
        fullPduHex: smscPart + pduBody,
        pduLength: pduBody.length / 2
      });
    }

    return segments;
  }

  // ─── PDU Decoder (SMS-DELIVER) ────────────────────────────────────────────

  /**
   * Decode a single PDU hex string into message object
   */
  function decodePdu(pduHex) {
    try {
      let offset = 0;

      // 1. SMSC block
      const smscLen = parseInt(pduHex.substring(offset, offset + 2), 16);
      offset += 2 + (smscLen * 2);

      // 2. First octet of SMS-DELIVER
      const firstOctet = parseInt(pduHex.substring(offset, offset + 2), 16);
      const hasUdhi = (firstOctet & 0x40) !== 0;
      offset += 2;

      // 3. Sender address
      const senderLen = parseInt(pduHex.substring(offset, offset + 2), 16);
      offset += 2;
      const senderType = pduHex.substring(offset, offset + 2);
      offset += 2;

      // Sender number length in hex digits (pad to even)
      const senderHexLen = senderLen % 2 === 0 ? senderLen : senderLen + 1;
      const senderSwapped = pduHex.substring(offset, offset + senderHexLen);
      offset += senderHexLen;

      // Unswap semi-octets
      let sender = '';
      for (let i = 0; i < senderSwapped.length; i += 2) {
        sender += senderSwapped[i + 1] + senderSwapped[i];
      }
      sender = sender.replace(/[Ff]$/, '');

      // Add international prefix
      if (senderType === '91') {
        sender = '+' + sender;
      }

      // 4. Protocol Identifier + Data Coding Scheme
      const pid = pduHex.substring(offset, offset + 2);
      offset += 2;
      const dcs = parseInt(pduHex.substring(offset, offset + 2), 16);
      offset += 2;

      // 5. Timestamp (7 octets, semi-octet swapped)
      const tsRaw = pduHex.substring(offset, offset + 14);
      offset += 14;
      let timestamp = '';
      try {
        const tsSwap = (s) => s[1] + s[0];
        const yr = tsSwap(tsRaw.substring(0, 2));
        const mo = tsSwap(tsRaw.substring(2, 4));
        const dy = tsSwap(tsRaw.substring(4, 6));
        const hr = tsSwap(tsRaw.substring(6, 8));
        const mn = tsSwap(tsRaw.substring(8, 10));
        const sc = tsSwap(tsRaw.substring(10, 12));
        const tz = tsSwap(tsRaw.substring(12, 14));
        timestamp = `20${yr}-${mo}-${dy} ${hr}:${mn}:${sc}`;
      } catch (e) {
        timestamp = 'Unknown';
      }

      // 6. User Data Length
      const udl = parseInt(pduHex.substring(offset, offset + 2), 16);
      offset += 2;

      // 7. UDH (if present)
      let udhRef = null, udhTotal = null, udhSeq = null;
      if (hasUdhi) {
        const udhLen = parseInt(pduHex.substring(offset, offset + 2), 16);
        const udhData = pduHex.substring(offset, offset + (udhLen + 1) * 2);
        offset += (udhLen + 1) * 2;

        // Parse concatenation IE (IEI = 0x00)
        if (udhData.substring(2, 4) === '00' && udhData.substring(4, 6) === '03') {
          udhRef = parseInt(udhData.substring(6, 8), 16);
          udhTotal = parseInt(udhData.substring(8, 10), 16);
          udhSeq = parseInt(udhData.substring(10, 12), 16);
        }
      }

      // 8. Message body
      let body = '';
      const remaining = pduHex.substring(offset);

      if (dcs === 0x08 || dcs === 0x18) {
        // UCS2 encoding
        for (let i = 0; i < remaining.length; i += 4) {
          if (i + 4 <= remaining.length) {
            const codePoint = parseInt(remaining.substring(i, i + 4), 16);
            body += String.fromCharCode(codePoint);
          }
        }
      } else if (dcs === 0x00 || dcs === 0x10) {
        // 7-bit GSM default alphabet
        body = decode7bit(remaining, udl, hasUdhi);
      } else {
        // Fallback — try UCS2
        for (let i = 0; i < remaining.length; i += 4) {
          if (i + 4 <= remaining.length) {
            const codePoint = parseInt(remaining.substring(i, i + 4), 16);
            body += String.fromCharCode(codePoint);
          }
        }
      }

      return {
        sender: cleanSenderNumber(sender),
        senderRaw: sender,
        timestamp,
        body,
        dcs,
        hasUdhi,
        udhRef,
        udhTotal,
        udhSeq
      };

    } catch (err) {
      console.error('PDU decode error:', err, pduHex);
      return null;
    }
  }

  /**
   * Decode 7-bit GSM packed data
   */
  function decode7bit(hexStr, septetCount, hasUdhi) {
    const gsm7bit = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
                    'ÄÖÑÜabcdefghijklmnopqrstuvwxyz§àáâãäåçêëèïîìÿñòóôõöøùúûü';

    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
      bytes.push(parseInt(hexStr.substring(i, i + 2), 16));
    }

    let bitStream = 0;
    let bitsAvailable = 0;
    let result = '';
    let charIndex = 0;

    // Skip fill bits if UDH is present
    const skipSeptets = hasUdhi ? Math.ceil((parseInt(hexStr.substring(0, 2), 16) + 1) * 8 / 7) : 0;

    for (const byte of bytes) {
      bitStream |= (byte << bitsAvailable);
      bitsAvailable += 8;

      while (bitsAvailable >= 7 && charIndex < septetCount) {
        const septet = bitStream & 0x7F;
        bitStream >>= 7;
        bitsAvailable -= 7;

        if (charIndex >= skipSeptets) {
          result += septet < gsm7bit.length ? gsm7bit[septet] : '?';
        }
        charIndex++;
      }
    }

    return result;
  }

  /**
   * Clean sender number — remove international prefix for display
   */
  function cleanSenderNumber(number) {
    // Keep the + prefix for display, just clean up
    return number.replace(/^(\+?)(62|86|1|44|91)/, '$1$2');
  }

  /**
   * Format sender for display — shorter format
   */
  function formatSender(sender) {
    if (!sender) return 'Unknown';
    // If number is long, format with spaces for readability
    const clean = sender.replace(/^\+/, '');
    if (clean.length > 8) {
      return sender; // Keep as-is, it's a phone number
    }
    return sender; // Short code or alphanumeric
  }

  // ─── Concatenation Engine ─────────────────────────────────────────────────

  /**
   * Group and merge multi-segment messages
   */
  function concatenateMessages(parsedPdus) {
    const singles = [];
    const concatGroups = {};

    parsedPdus.forEach((msg, idx) => {
      if (msg.hasUdhi && msg.udhRef !== null) {
        // Multi-segment — group by sender + reference
        const key = `${msg.senderRaw}_${msg.udhRef}`;
        if (!concatGroups[key]) {
          concatGroups[key] = {
            sender: msg.sender,
            senderRaw: msg.senderRaw,
            timestamp: msg.timestamp,
            segments: [],
            totalSegments: msg.udhTotal,
            indices: []
          };
        }
        concatGroups[key].segments.push({
          seq: msg.udhSeq,
          body: msg.body,
          index: msg.storageIndex
        });
        concatGroups[key].indices.push(msg.storageIndex);
        // Use earliest timestamp
        if (msg.timestamp < concatGroups[key].timestamp) {
          concatGroups[key].timestamp = msg.timestamp;
        }
      } else {
        // Single message
        singles.push({
          id: `single_${idx}`,
          sender: msg.sender,
          senderRaw: msg.senderRaw,
          timestamp: msg.timestamp,
          body: msg.body,
          indices: [msg.storageIndex],
          isRead: msg.stat === 1 || msg.stat === 0
        });
      }
    });

    // Merge concatenated segments
    Object.keys(concatGroups).forEach(key => {
      const group = concatGroups[key];
      group.segments.sort((a, b) => a.seq - b.seq);
      const fullBody = group.segments.map(s => s.body).join('');
      singles.push({
        id: `concat_${key}`,
        sender: group.sender,
        senderRaw: group.senderRaw,
        timestamp: group.timestamp,
        body: fullBody,
        indices: group.indices,
        isRead: true,
        segmentCount: group.totalSegments
      });
    });

    // Sort by timestamp descending (newest first)
    singles.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return singles;
  }

  // ─── Inbox Operations ─────────────────────────────────────────────────────

  /**
   * Fetch all SMS from modem and render inbox
   */
  async function fetchInbox() {
    if (isLoading) return;
    isLoading = true;

    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) {
        Utils.showToast('Connect to modem first', 'warning');
        isLoading = false;
        return;
      }

      showInboxLoading(true);

      // Ensure PDU mode
      await window.modemAPI.sendCommand('AT+CMGF=0');

      // Fetch all messages
      const response = await window.modemAPI.sendCommand('AT+CMGL=4');

      if (Utils.isError(response)) {
        Utils.showToast('Error fetching messages', 'error');
        showInboxLoading(false);
        isLoading = false;
        return;
      }

      // Parse response — format: +CMGL: <index>,<stat>,[<alpha>],<length>\r\n<pdu>
      rawMessages = [];
      const lines = response.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const headerMatch = lines[i].match(/\+CMGL:\s*(\d+),(\d+),,(\d+)/);
        if (headerMatch && i + 1 < lines.length) {
          const storageIndex = parseInt(headerMatch[1]);
          const stat = parseInt(headerMatch[2]);
          const pduHex = lines[i + 1].trim();

          if (pduHex && pduHex.length > 10) {
            const decoded = decodePdu(pduHex);
            if (decoded) {
              decoded.storageIndex = storageIndex;
              decoded.stat = stat;
              rawMessages.push(decoded);
            }
          }
          i++; // Skip PDU line
        }
      }

      // Concatenate multi-part messages
      messages = concatenateMessages(rawMessages);
      selectedIds.clear();

      renderInbox();
      showInboxLoading(false);

    } catch (err) {
      console.error('Fetch inbox error:', err);
      Utils.showToast('Error loading inbox', 'error');
      showInboxLoading(false);
    }

    isLoading = false;
  }

  /**
   * Delete a single message by its storage indices
   */
  async function deleteMessage(indices) {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      for (const idx of indices) {
        await window.modemAPI.sendCommand(`AT+CMGD=${idx}`);
      }

      Utils.showToast('Message deleted', 'success');
      await fetchInbox();
      await refreshStorage();
    } catch (err) {
      Utils.showToast('Error deleting message', 'error');
    }
  }

  /**
   * Delete all selected messages
   */
  async function deleteSelected() {
    if (selectedIds.size === 0) {
      Utils.showToast('No messages selected', 'warning');
      return;
    }

    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      // Collect all storage indices from selected messages
      const allIndices = [];
      messages.forEach(msg => {
        if (selectedIds.has(msg.id)) {
          allIndices.push(...msg.indices);
        }
      });

      // Delete in reverse order to avoid index shifting
      allIndices.sort((a, b) => b - a);
      for (const idx of allIndices) {
        await window.modemAPI.sendCommand(`AT+CMGD=${idx}`);
      }

      Utils.showToast(`${selectedIds.size} message(s) deleted`, 'success');
      selectedIds.clear();
      await fetchInbox();
      await refreshStorage();
    } catch (err) {
      Utils.showToast('Error deleting messages', 'error');
    }
  }

  // ─── Composer Operations ──────────────────────────────────────────────────

  /**
   * Fetch SMSC number from modem
   */
  async function fetchSmsc() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      const response = await window.modemAPI.sendCommand('AT+CSCA?');
      const match = response.match(/\+CSCA:\s*"([^"]+)"/);
      if (match) {
        smscNumber = match[1];
        const smscInput = document.getElementById('sms-smsc');
        if (smscInput) {
          smscInput.value = smscNumber;
        }
      }
    } catch (err) {
      console.error('SMSC fetch error:', err);
    }
  }

  /**
   * Send an SMS message
   */
  async function sendSms() {
    if (isSending) return;

    const recipientInput = document.getElementById('sms-recipient');
    const messageInput = document.getElementById('sms-message');
    const recipient = recipientInput.value.trim();
    const text = messageInput.value;

    // Validate
    if (!recipient) {
      Utils.showToast('Enter a recipient number', 'warning');
      recipientInput.focus();
      return;
    }
    if (!text) {
      Utils.showToast('Enter a message', 'warning');
      messageInput.focus();
      return;
    }
    if (!smscNumber) {
      Utils.showToast('SMSC not available — fetch it first', 'warning');
      return;
    }

    isSending = true;
    setSendingState(true);

    try {
      // Encode PDU(s)
      const pdus = encodeLongSms(smscNumber, recipient, text);

      for (let i = 0; i < pdus.length; i++) {
        const pdu = pdus[i];

        // Step 1: Send AT+CMGS=<length>
        const cmgsResponse = await window.modemAPI.sendCommand(`AT+CMGS=${pdu.pduLength}`);

        // Step 2: Wait briefly, then send PDU hex + Ctrl+Z
        // The modem responds with > prompt, so we send PDU data
        await new Promise(r => setTimeout(r, 300));
        const sendResponse = await window.modemAPI.sendRaw(pdu.pduBody + '\x1a');

        if (Utils.isError(sendResponse)) {
          throw new Error(`Segment ${i + 1} failed: ${sendResponse}`);
        }
      }

      Utils.showToast('SMS sent successfully!', 'success');

      // Clear composer
      messageInput.value = '';
      updateCharCount();

    } catch (err) {
      console.error('SMS send error:', err);
      Utils.showToast(`Send failed: ${err.message || err}`, 'error');
    }

    isSending = false;
    setSendingState(false);
  }

  /**
   * Update character count and segment info
   */
  function updateCharCount() {
    const textarea = document.getElementById('sms-message');
    const counter = document.getElementById('sms-char-count');
    if (!textarea || !counter) return;

    const len = textarea.value.length;
    const maxPerSms = 70;  // UCS2 single segment
    const maxPerSegment = 67; // UCS2 with UDH

    let segments, remaining;
    if (len <= maxPerSms) {
      segments = len === 0 ? 0 : 1;
      remaining = maxPerSms - len;
    } else {
      segments = Math.ceil(len / maxPerSegment);
      remaining = (segments * maxPerSegment) - len;
    }

    counter.textContent = `${len} / ${segments <= 1 ? maxPerSms : segments * maxPerSegment} (${segments} SMS)`;

    // Color feedback
    if (segments > 3) {
      counter.className = 'sms-char-counter danger';
    } else if (segments > 1) {
      counter.className = 'sms-char-counter warning';
    } else {
      counter.className = 'sms-char-counter';
    }
  }

  /**
   * Validate recipient number
   */
  function validateRecipient() {
    const input = document.getElementById('sms-recipient');
    const value = input.value.trim();
    const isValid = /^\+?\d{6,15}$/.test(value) || value === '';
    input.classList.toggle('input-error', !isValid && value !== '');
  }

  // ─── Storage Management ───────────────────────────────────────────────────

  /**
   * Refresh storage usage bars
   */
  async function refreshStorage() {
    try {
      const connected = await window.modemAPI.isConnected();
      if (!connected) return;

      const response = await window.modemAPI.sendCommand('AT+CPMS?');
      const match = response.match(/\+CPMS:\s*"(\w+)",(\d+),(\d+),"(\w+)",(\d+),(\d+),"(\w+)",(\d+),(\d+)/);

      if (match) {
        updateStorageBar('sms-storage-read', match[1], parseInt(match[2]), parseInt(match[3]));
        updateStorageBar('sms-storage-write', match[4], parseInt(match[5]), parseInt(match[6]));
      }
    } catch (err) {
      console.error('Storage refresh error:', err);
    }
  }

  /**
   * Update a single storage progress bar
   */
  function updateStorageBar(id, label, used, total) {
    const container = document.getElementById(id);
    if (!container) return;

    const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
    const fill = container.querySelector('.storage-fill');
    const text = container.querySelector('.storage-text');
    const labelEl = container.querySelector('.storage-label');

    if (fill) fill.style.width = `${percentage}%`;
    if (text) text.textContent = `${used} / ${total}`;
    if (labelEl) labelEl.textContent = label;

    // Color based on usage
    if (fill) {
      fill.classList.remove('storage-ok', 'storage-warn', 'storage-full');
      if (percentage >= 90) fill.classList.add('storage-full');
      else if (percentage >= 70) fill.classList.add('storage-warn');
      else fill.classList.add('storage-ok');
    }
  }

  // ─── UI Rendering ─────────────────────────────────────────────────────────

  /**
   * Render the inbox message list
   */
  function renderInbox() {
    const container = document.getElementById('sms-inbox-body');
    if (!container) return;

    const selectAll = document.getElementById('sms-select-all');
    if (selectAll) selectAll.checked = false;

    // Update message count
    const countEl = document.getElementById('sms-msg-count');
    if (countEl) countEl.textContent = `${messages.length} message${messages.length !== 1 ? 's' : ''}`;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="sms-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>No messages found</span>
          <span class="text-muted">Messages will appear here when received</span>
        </div>
      `;
      return;
    }

    let html = '';
    messages.forEach(msg => {
      const isSelected = selectedIds.has(msg.id);
      const previewText = msg.body.length > 80 ? msg.body.substring(0, 80) + '…' : msg.body;
      const timeDisplay = formatTimestamp(msg.timestamp);
      const segBadge = msg.segmentCount ? `<span class="sms-seg-badge">${msg.segmentCount} parts</span>` : '';

      html += `
        <div class="sms-row ${isSelected ? 'selected' : ''}" data-id="${msg.id}">
          <label class="sms-checkbox-cell">
            <input type="checkbox" class="sms-row-check" data-id="${msg.id}"
              ${isSelected ? 'checked' : ''} onchange="SMS.toggleSelect('${msg.id}', this.checked)">
            <span class="sms-check-mark"></span>
          </label>
          <div class="sms-row-content" onclick="SMS.showMessageDetail('${msg.id}')">
            <div class="sms-row-header">
              <span class="sms-sender">${escapeHtml(formatSender(msg.sender))}</span>
              <span class="sms-time">${timeDisplay}</span>
            </div>
            <div class="sms-row-body">
              <span class="sms-preview">${escapeHtml(previewText)}</span>
              ${segBadge}
            </div>
          </div>
          <button class="sms-row-delete btn-icon-sm" onclick="SMS.deleteMessage([${msg.indices.join(',')}])" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /**
   * Show full message detail in a modal-like view
   */
  function showMessageDetail(msgId) {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    const detail = document.getElementById('sms-detail-panel');
    if (!detail) return;

    document.getElementById('sms-detail-sender').textContent = msg.sender;
    document.getElementById('sms-detail-time').textContent = msg.timestamp;
    document.getElementById('sms-detail-body').textContent = msg.body;

    detail.classList.remove('hidden');
  }

  /**
   * Close message detail panel
   */
  function closeDetail() {
    const detail = document.getElementById('sms-detail-panel');
    if (detail) detail.classList.add('hidden');
  }

  /**
   * Toggle message selection
   */
  function toggleSelect(id, checked) {
    if (checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    updateDeleteButton();

    // Update row visual
    const row = document.querySelector(`.sms-row[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', checked);
  }

  /**
   * Toggle select all
   */
  function toggleSelectAll() {
    const selectAll = document.getElementById('sms-select-all');
    const checked = selectAll.checked;

    selectedIds.clear();
    if (checked) {
      messages.forEach(m => selectedIds.add(m.id));
    }

    // Update all checkboxes
    document.querySelectorAll('.sms-row-check').forEach(cb => {
      cb.checked = checked;
    });
    document.querySelectorAll('.sms-row').forEach(row => {
      row.classList.toggle('selected', checked);
    });

    updateDeleteButton();
  }

  /**
   * Update delete button state
   */
  function updateDeleteButton() {
    const btn = document.getElementById('sms-btn-delete-selected');
    if (btn) {
      btn.disabled = selectedIds.size === 0;
      const countSpan = btn.querySelector('.sms-delete-count');
      if (countSpan) {
        countSpan.textContent = selectedIds.size > 0 ? ` (${selectedIds.size})` : '';
      }
    }
  }

  /**
   * Toggle composer visibility
   */
  function toggleComposer() {
    const composer = document.getElementById('sms-composer');
    if (composer) {
      composer.classList.toggle('hidden');
      if (!composer.classList.contains('hidden')) {
        // Auto-focus recipient
        const input = document.getElementById('sms-recipient');
        if (input) input.focus();
        // Fetch SMSC if not available
        if (!smscNumber) fetchSmsc();
      }
    }
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────────

  function showInboxLoading(show) {
    const loader = document.getElementById('sms-inbox-loader');
    const body = document.getElementById('sms-inbox-body');
    if (loader) loader.classList.toggle('hidden', !show);
    if (body) body.classList.toggle('hidden', show);
  }

  function setSendingState(sending) {
    const btn = document.getElementById('sms-btn-send');
    if (!btn) return;
    if (sending) {
      btn.innerHTML = '<div class="spinner"></div> Sending...';
      btn.disabled = true;
    } else {
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Send
      `;
      btn.disabled = false;
    }
  }

  function formatTimestamp(ts) {
    if (!ts || ts === 'Unknown') return ts;
    try {
      const date = new Date(ts.replace(' ', 'T'));
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return ts;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    init,
    onPageActive,
    fetchInbox,
    fetchSmsc,
    sendSms,
    deleteMessage,
    deleteSelected,
    refreshStorage,
    toggleComposer,
    toggleSelect,
    toggleSelectAll,
    showMessageDetail,
    closeDetail,
    updateCharCount
  };

})();
