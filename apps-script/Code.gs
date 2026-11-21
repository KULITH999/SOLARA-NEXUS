/**
 * Solara Nexus - Backend (FULL FIXED)
 * Supports Index.html (capital I)
 */

const SHEET_ID = '10Vm12YaZOa6gjKmKEZLVR09SxTa-NnBdIWJqx8sJl74';
const USERS_SHEET = 'Users';
const USERS_HEADERS = ['Created', 'Name', 'Email', 'Salt', 'PasswordHash'];
const VPN_LINKS_SHEET = 'VPNLinks';
const VPN_LINKS_HEADERS = ['WebsiteEmail', 'PanelClientEmail', 'Enabled', 'InboundId', 'PackageId', 'ClientId', 'ClientName', 'DeletedAt'];
const PACKAGE_SHEET = 'PackageCatalog';
const PACKAGE_HEADERS = ['PackageId', 'PackageName', 'DurationDays', 'DataGB', 'PriceLKR', 'InboundId', 'Features', 'Enabled', 'CreatedAt', 'UpdatedAt'];
const SERVICE_SHEET = 'ServiceCatalog';
const SERVICE_HEADERS = ['ServiceId', 'Category', 'ServiceName', 'PriceLKR', 'PriceLabel', 'Description', 'Specs', 'Icon', 'ButtonText', 'OrderUrl', 'Enabled', 'CreatedAt', 'UpdatedAt', 'DurationDays', 'DataGB', 'AppType', 'PackageId'];
const PAYMENTS_SHEET = 'Payments';
const PAYMENTS_HEADERS = ['RequestId', 'CreatedAt', 'WebsiteEmail', 'CustomerName', 'PackageId', 'PackageName', 'DurationDays', 'DataGB', 'PriceLKR', 'RequestType', 'Status', 'SlipFileId', 'SlipFileName', 'AdminNote', 'ReviewedAt', 'ReviewedBy', 'TargetExpiryMs', 'VpsAction', 'VpsClientEmail', 'InboundId', 'PaymentMethod', 'CheckoutKey', 'ServiceId', 'ConfigType', 'ConfigValue', 'ConfigFileId', 'ConfigFileName', 'ServiceAppType', 'TargetClientId', 'ClientName'];
const WALLET_TX_SHEET = 'WalletTransactions';
const WALLET_TX_HEADERS = ['TransactionId', 'CreatedAt', 'WebsiteEmail', 'Type', 'AmountLKR', 'ReferenceId', 'Note', 'BalanceAfterLKR'];
const WALLET_TOPUP_SHEET = 'WalletTopups';
const WALLET_TOPUP_HEADERS = ['RequestId', 'CreatedAt', 'WebsiteEmail', 'CustomerName', 'AmountLKR', 'PaymentMethod', 'CustomerNote', 'SlipFileId', 'SlipFileName', 'Status', 'AdminNote', 'ReviewedAt', 'ReviewedBy'];
const ADMIN_SESSION_TTL = 14400; // 4 hours
const PAYMENT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const CUSTOMER_SESSION_TTL = 21600; // 6 hours (Apps Script CacheService maximum TTL)
const OTP_TTL = 600;
const OTP_MAX_TRIES = 5;
const RESEND_WAIT = 60;
const HTML_FILE = 'Index';  // ✅ capital I — matches your Index.html

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const downloadRequestId = String(params.downloadOrderFile || '').trim();
  if (downloadRequestId) {
    return renderCustomerOrderFileDownload_(downloadRequestId, String(params.token || ''));
  }
  const page = String(params.page || '').toLowerCase();
  const isAdminPage = page === 'admin';
  const htmlFile = isAdminPage ? 'Admin' : HTML_FILE;
  return HtmlService.createHtmlOutputFromFile(htmlFile)
    .setTitle(isAdminPage ? 'Solara Nexus | Admin Portal' : 'Solara Nexus | Secure VPN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPlans() {
  try {
    return readPackages_(false).map(function (p) {
      return {
        id: p.packageId,
        name: p.name,
        price: p.priceLKR,
        durationDays: p.durationDays,
        dataGB: p.dataGB,
        features: (p.features ? [p.features] : []).concat([(p.durationDays === 0 ? 'Unlimited validity' : p.durationDays + ' days validity'), p.dataGB === 0 ? 'Unlimited data' : p.dataGB + ' GB data']),
        popular: false
      };
    });
  } catch (err) {
    console.error('getPlans error: ' + err.message);
    return [];
  }
}

function getOrderServices() {
  try {
    const sheet = ensureHeaders_(SERVICE_SHEET, SERVICE_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    if (last < 2) return [];

    // Read PackageCatalog once instead of re-reading it several times for every card.
    const packages = readPackages_(true);
    const packageMap = {};
    packages.forEach(function (p) { packageMap[p.packageId] = p; });

    return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().map(function (row) {
      const packageId = String(idx.PackageId != null ? row[idx.PackageId] || '' : '').trim();
      const linked = packageId ? packageMap[packageId] : null;
      if (!asBool_(row[idx.Enabled]) || !(linked && linked.enabled && linked.inboundId > 0)) return null;
      return {
        id: String(row[idx.ServiceId] || ''),
        packageId: packageId,
        name: String(row[idx.ServiceName] || ''),
        priceLKR: Number((linked && linked.priceLKR) || row[idx.PriceLKR] || 0),
        durationDays: linked ? Number(linked.durationDays) : (String(row[idx.DurationDays] == null ? '' : row[idx.DurationDays]).trim() === '' ? 30 : Number(row[idx.DurationDays])),
        dataGB: linked ? Number(linked.dataGB) : Number(row[idx.DataGB] || 0),
        appType: String((idx.AppType != null && row[idx.AppType]) || 'http-injector'),
        buttonText: String(row[idx.ButtonText] || 'Configure Order'),
        orderUrl: safeServiceUrl_(row[idx.OrderUrl])
      };
    }).filter(function (item) { return item !== null; });
  } catch (err) {
    console.error('getOrderServices error: ' + err.message);
    // Do not turn a temporary Sheet/API error into an empty-services response.
    throw new Error('Could not load Order Services: ' + (err.message || err));
  }
}

function safeServiceUrl_(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function signUp(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const name = clean_(data.name, 80);
    const email = clean_(data.email, 120).toLowerCase();
    const password = String(data.password || '');
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (!validEmail_(email)) return { ok: false, error: 'Please enter a valid email address.' };
    if (password.length < 8 || password.length > 100) return { ok: false, error: 'Password must be 8 to 100 characters.' };
    lock.waitLock(10000);
    const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
    if (findUserRow_(sheet, email) > 0) return { ok: false, error: 'This email is already registered.' };
    const salt = Utilities.getUuid();
    sheet.appendRow([new Date(), name, email, salt, hash_(salt + password)]);
    console.log('signUp: created user ' + email);
    return { ok: true };
  } catch (err) {
    console.error('signUp error: ' + err.message);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function signIn(data) {
  try {
    data = data || {};
    const email = clean_(data.email, 120).toLowerCase();
    const password = String(data.password || '');
    const bad = { ok: false, error: 'Invalid email or password.' };
    const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
    const row = findUserRow_(sheet, email);
    // ✅ Not signed up yet -> clear message
    if (row < 0) return { ok: false, error: 'You are not registered. Please sign up first.' };
    const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
    const name = values[1];
    const salt = values[3];
    const stored = values[4];
    if (hash_(salt + password) !== stored) return bad;
    const sessionToken = createCustomerSession_(email, name);
    return { ok: true, name: name, sessionToken: sessionToken };
  } catch (err) {
    console.error('signIn error: ' + err.message);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

function requestReset(data) {
  let email = '';
  try {
    email = clean_((data || {}).email, 120).toLowerCase();
    console.log('=== requestReset START ===');
    console.log('requestReset: input email = "' + email + '"');
    if (!validEmail_(email)) {
      console.log('requestReset: invalid email format');
      return { ok: false, error: 'Please enter a valid email address.' };
    }
    const cache = CacheService.getScriptCache();
    if (cache.get('cd_' + email)) {
      console.log('requestReset: cooldown active');
      return { ok: false, error: 'Please wait a minute before asking for another code.' };
    }
    cache.put('cd_' + email, '1', RESEND_WAIT);
    const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
    const row = findUserRow_(sheet, email);
    console.log('requestReset: findUserRow_ = ' + row);
    if (row > 0) {
      const quota = MailApp.getRemainingDailyQuota();
      console.log('requestReset: quota = ' + quota);
      if (quota < 1) {
        cache.remove('cd_' + email);
        return { ok: false, error: 'Email limit reached for today. Please try again tomorrow.' };
      }
      const otp = genOtp_();
      cache.put('otp_' + email, JSON.stringify({ h: hash_('otp:' + email + ':' + otp), t: 0 }), OTP_TTL);
      console.log('requestReset: generated OTP = ' + otp);
      try {
        MailApp.sendEmail({
          to: email,
          name: 'Solara Nexus',
          subject: 'Your Solara Nexus verification code',
          body: 'Your Solara Nexus verification code is ' + otp + '. It expires in 10 minutes.',
          htmlBody: '<div style="font-family:Arial,sans-serif;background:#03040a;color:#e8f1ff;padding:28px;border-radius:12px;max-width:420px"><h2 style="color:#00b3ff;margin:0 0 12px;letter-spacing:2px">SOLARA NEXUS</h2><p style="margin:0">Your verification code is:</p><p style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#00b3ff;margin:14px 0">' + otp + '</p><p style="color:#8fa3c7;font-size:13px;margin:0">This code expires in 10 minutes.</p></div>'
        });
        console.log('requestReset: ✅ email SENT to ' + email);
      } catch (mailErr) {
        console.error('requestReset: ❌ MAIL FAILED - ' + mailErr.message);
        cache.remove('cd_' + email);
        return { ok: false, error: 'Could not send email: ' + mailErr.message };
      }
    } else {
      console.log('requestReset: ❌ user NOT FOUND in sheet (row = -1)');
      console.log('requestReset: emails in sheet:');
      const last = sheet.getLastRow();
      if (last > 1) {
        const emails = sheet.getRange(2, 3, last - 1, 1).getValues();
        for (let i = 0; i < emails.length; i++) {
          console.log('  row ' + (i + 2) + ': "' + emails[i][0] + '"');
        }
      }
    }
    console.log('=== requestReset END ===');
    return { ok: true };
  } catch (err) {
    console.error('requestReset error: ' + err.message);
    try { CacheService.getScriptCache().remove('cd_' + email); } catch (x) {}
    return { ok: false, error: 'Could not send code: ' + err.message };
  }
}

function verifyOtp(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const email = clean_(data.email, 120).toLowerCase();
    const otp = String(data.otp || '').trim();
    console.log('verifyOtp: email=' + email + ' otp=' + otp);
    if (!/^\d{6}$/.test(otp)) return { ok: false, error: 'Enter the 6-digit code.' };
    lock.waitLock(10000);
    const cache = CacheService.getScriptCache();
    const raw = cache.get('otp_' + email);
    if (!raw) {
      console.log('verifyOtp: no OTP in cache (expired)');
      return { ok: false, error: 'This code has expired. Please request a new one.' };
    }
    const rec = JSON.parse(raw);
    if (rec.t >= OTP_MAX_TRIES) {
      cache.remove('otp_' + email);
      return { ok: false, error: 'Too many wrong attempts. Please request a new code.' };
    }
    if (rec.h !== hash_('otp:' + email + ':' + otp)) {
      rec.t++;
      cache.put('otp_' + email, JSON.stringify(rec), OTP_TTL);
      console.log('verifyOtp: wrong code (try ' + rec.t + '/' + OTP_MAX_TRIES + ')');
      return { ok: false, error: 'Incorrect code.' };
    }
    cache.remove('otp_' + email);
    const token = Utilities.getUuid() + Utilities.getUuid();
    cache.put('rt_' + email, hash_('rt:' + email + ':' + token), OTP_TTL);
    console.log('verifyOtp: ✅ success, token issued');
    return { ok: true, token: token };
  } catch (err) {
    console.error('verifyOtp error: ' + err.message);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function resetPassword(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const email = clean_(data.email, 120).toLowerCase();
    const token = String(data.token || '');
    const password = String(data.password || '');
    console.log('resetPassword: email=' + email + ' tokenLen=' + token.length);
    if (password.length < 8 || password.length > 100) return { ok: false, error: 'Password must be 8 to 100 characters.' };
    lock.waitLock(10000);
    const cache = CacheService.getScriptCache();
    const stored = cache.get('rt_' + email);
    if (!token || !stored || stored !== hash_('rt:' + email + ':' + token)) {
      console.log('resetPassword: token invalid or expired');
      return { ok: false, error: 'Your verification expired. Please start again.' };
    }
    const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
    const row = findUserRow_(sheet, email);
    if (row < 0) return { ok: false, error: 'User not found. Please start again.' };
    const salt = Utilities.getUuid();
    // ✅ Replace Salt (col D) and PasswordHash (col E)
    sheet.getRange(row, 4, 1, 2).setValues([[salt, hash_(salt + password)]]);
    cache.remove('rt_' + email);
    console.log('resetPassword: ✅ password updated for ' + email);
    return { ok: true };
  } catch (err) {
    console.error('resetPassword error: ' + err.message);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}


/* ---------- Solara Nexus ↔ 3x-ui customer dashboard ---------- */

/**
 * Creates the mapping sheet used to link a Solara website account to the
 * matching 3x-ui client email. Run once from the Apps Script editor.
 */
function setupVpnMappingSheet() {
  try {
    const sheet = ensureHeaders_(VPN_LINKS_SHEET, VPN_LINKS_HEADERS);
    sheet.setFrozenRows(1);
    const result = { ok: true, sheetName: VPN_LINKS_SHEET, headers: VPN_LINKS_HEADERS };
    Logger.log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('setupVpnMappingSheet error: ' + err.message);
    return { ok: false, error: 'Could not prepare the VPNLinks sheet. Check that this script is connected to its Google Spreadsheet.' };
  }
}

/**
 * Stores a random session token server-side. The browser receives the token,
 * but it never receives the 3x-ui API token or the VPS credentials.
 */
function createCustomerSession_(email, name) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const key = customerSessionKey_(token);
  CacheService.getScriptCache().put(key, JSON.stringify({
    email: String(email || '').trim().toLowerCase(),
    name: String(name || '').trim(),
    createdAt: Date.now()
  }), CUSTOMER_SESSION_TTL);
  return token;
}

function customerSessionKey_(token) {
  return 'sn_customer_session_' + hash_('sn-session:' + String(token || ''));
}

function getCustomerSession_(token) {
  token = String(token || '').trim();
  if (token.length < 40 || token.length > 200) return null;
  const raw = CacheService.getScriptCache().get(customerSessionKey_(token));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session || !validEmail_(String(session.email || ''))) return null;
    return session;
  } catch (err) {
    return null;
  }
}

function signOutCustomer(token) {
  try {
    token = String(token || '').trim();
    if (token) CacheService.getScriptCache().remove(customerSessionKey_(token));
    return { ok: true };
  } catch (err) {
    console.error('signOutCustomer error: ' + err.message);
    return { ok: false };
  }
}

/**
 * Reads the exact mapped 3x-ui client for the authenticated website account.
 * The website email is taken from the server-side session, never from a
 * browser-supplied email parameter.
 */
function getCustomerDashboard(sessionToken, selectedClientId) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };

    const records = getVpnMappingRecords_(session.email, false);
    if (!records.length) {
      return {
        ok: true,
        customer: { name: session.name, email: session.email },
        clients: [],
        selectedClientId: '',
        vpn: { clientLabel: '—', uploadBytes: 0, downloadBytes: 0, usedBytes: 0, quotaBytes: 0, remainingBytes: null, expiryTime: 0, status: 'No Client', inbounds: [] },
        refreshedAt: new Date().toISOString()
      };
    }

    const inbounds = fetchXuiInbounds_();
    const clientCards = records.map(function (record) {
      const mapping = {
        panelClientEmail: String(record.row[record.index.PanelClientEmail] || '').trim(),
        inboundId: Number(record.row[record.index.InboundId] || 0) || null
      };
      const summary = buildCustomerVpnSummary_(inbounds, mapping);
      let status = summary.ok ? summary.vpn.status : 'Unavailable';
      const enabledValue = String(record.row[record.index.Enabled] == null ? '' : record.row[record.index.Enabled]).trim().toLowerCase();
      if (status !== 'Expired' && !(enabledValue === '' || enabledValue === 'true' || enabledValue === 'yes' || enabledValue === '1')) status = 'Disabled';
      return {
        clientId: String(record.row[record.index.ClientId] || ''),
        clientName: String(record.row[record.index.ClientName] || 'VPN Client'),
        status: status,
        expiryTime: summary.ok ? Number(summary.vpn.expiryTime || 0) : 0
      };
    });

    const requestedId = String(selectedClientId || '').trim();
    const selectedRecord = records.find(function (record) {
      return String(record.row[record.index.ClientId] || '') === requestedId;
    }) || records[0];
    const selectedId = String(selectedRecord.row[selectedRecord.index.ClientId] || '');
    const selectedMapping = {
      panelClientEmail: String(selectedRecord.row[selectedRecord.index.PanelClientEmail] || '').trim(),
      inboundId: Number(selectedRecord.row[selectedRecord.index.InboundId] || 0) || null
    };
    const selectedSummary = buildCustomerVpnSummary_(inbounds, selectedMapping);
    let vpn = selectedSummary.ok ? selectedSummary.vpn : {
      clientLabel: selectedMapping.panelClientEmail || '—', uploadBytes: 0, downloadBytes: 0,
      usedBytes: 0, quotaBytes: 0, remainingBytes: null, expiryTime: 0, status: 'Unavailable', inbounds: []
    };
    const selectedEnabled = String(selectedRecord.row[selectedRecord.index.Enabled] == null ? '' : selectedRecord.row[selectedRecord.index.Enabled]).trim().toLowerCase();
    if (vpn.status !== 'Expired' && !(selectedEnabled === '' || selectedEnabled === 'true' || selectedEnabled === 'yes' || selectedEnabled === '1')) vpn.status = 'Disabled';

    return {
      ok: true,
      customer: { name: session.name, email: session.email },
      clients: clientCards,
      selectedClientId: selectedId,
      vpn: vpn,
      vpnMessage: selectedSummary.ok ? '' : selectedSummary.error,
      refreshedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('getCustomerDashboard error: ' + err.message);
    return { ok: false, error: err.message || 'Could not load your VPN information. Please try again.' };
  }
}


/** Returns traffic counters for one authenticated customer's selected VPN client only. */
function getCustomerClientTraffic(sessionToken, selectedClientId) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const clientId = String(selectedClientId || '').trim();
    if (!clientId) return { ok: false, error: 'Select a VPN client to view its live speed.' };
    const record = getVpnMappingRecord_(session.email, clientId);
    if (!record) return { ok: false, error: 'The selected VPN client was not found in your account.' };
    const mapping = {
      panelClientEmail: String(record.row[record.index.PanelClientEmail] || '').trim(),
      inboundId: Number(record.row[record.index.InboundId] || 0) || null
    };
    if (!mapping.panelClientEmail) return { ok: false, error: 'The selected VPN client mapping is incomplete.' };
    const inbounds = fetchXuiInbounds_();
    const summary = buildCustomerVpnSummary_(inbounds, mapping);
    if (!summary.ok) return { ok: false, error: summary.error || 'Could not read this client traffic.' };
    return {
      ok: true,
      clientId: clientId,
      uploadBytes: Number(summary.vpn.uploadBytes || 0),
      downloadBytes: Number(summary.vpn.downloadBytes || 0),
      sampledAt: Date.now()
    };
  } catch (err) {
    console.error('getCustomerClientTraffic error: ' + err.message);
    return { ok: false, error: err.message || 'Could not read the selected client traffic.' };
  }
}

/** Reads customer-owned VPN client mappings. Deleted rows remain in the sheet for history. */
function getVpnMappingForEmail_(websiteEmail, clientId) {
  const record = getVpnMappingRecord_(websiteEmail, clientId || '');
  if (!record) return { ok: false, error: 'Your VPN account has not been linked yet. Please contact support.' };
  const enabledValue = String(record.row[record.index.Enabled] == null ? '' : record.row[record.index.Enabled]).trim().toLowerCase();
  const isEnabled = enabledValue === '' || enabledValue === 'true' || enabledValue === 'yes' || enabledValue === '1';
  if (!isEnabled) return { ok: false, error: 'Your VPN subscription is currently disabled. Please contact support.' };
  const panelClientEmail = String(record.row[record.index.PanelClientEmail] || '').trim();
  if (!panelClientEmail) return { ok: false, error: 'Your VPN account mapping is incomplete. Please contact support.' };
  const inboundIdRaw = String(record.row[record.index.InboundId] == null ? '' : record.row[record.index.InboundId]).trim();
  const inboundId = inboundIdRaw ? Number(inboundIdRaw) : null;
  if (inboundIdRaw && (!Number.isFinite(inboundId) || inboundId <= 0)) return { ok: false, error: 'The inbound ID in your VPN account mapping is invalid. Please contact support.' };
  return {
    ok: true,
    clientId: String(record.row[record.index.ClientId] || ''),
    clientName: String(record.row[record.index.ClientName] || ''),
    panelClientEmail: panelClientEmail,
    inboundId: inboundId,
    packageId: record.index.PackageId != null ? String(record.row[record.index.PackageId] || '') : ''
  };
}

/** 3x-ui v3.11.0: Node synchronization tokens can GET /panel/api/inbounds/list. */
function fetchXuiInbounds_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = String(props.getProperty('XUI_BASE_URL') || '').trim().replace(/\/+$/, '');
  const apiToken = String(props.getProperty('XUI_API_TOKEN') || '').trim();
  if (!baseUrl || !apiToken) throw new Error('Missing XUI_BASE_URL or XUI_API_TOKEN in Script Properties.');
  if (!/^https:\/\//i.test(baseUrl) || !/\/panel$/i.test(baseUrl) || /[?#]/.test(baseUrl)) {
    throw new Error('XUI_BASE_URL must be the full HTTPS panel URL ending in /panel (without a trailing slash).');
  }

  const url = baseUrl + '/api/inbounds/list';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + apiToken,
      Accept: 'application/json'
    },
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });

  const status = response.getResponseCode();
  const bodyText = response.getContentText();
  if (status === 401) throw new Error('3x-ui rejected the API token (HTTP 401). Check that the token is enabled and copied correctly.');
  if (status === 403) throw new Error('3x-ui denied this API request (HTTP 403). Check the token scope.');
  if (status === 404) throw new Error('3x-ui API endpoint was not found (HTTP 404). Check that XUI_BASE_URL ends with the correct /panel path.');
  if (status < 200 || status >= 300) throw new Error('3x-ui API returned HTTP ' + status + '.');

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (parseErr) {
    throw new Error('3x-ui returned a non-JSON response. Check XUI_BASE_URL and the panel path.');
  }
  if (!payload || payload.success !== true || !Array.isArray(payload.obj)) {
    throw new Error((payload && payload.msg) ? String(payload.msg) : '3x-ui did not return an inbound list.');
  }
  return payload.obj;
}

function parseXuiObject_(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value); } catch (err) { return {}; }
  }
  return {};
}

function numberOrZero_(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Summarises only one mapped client and strips secrets/UUIDs from the response. */
function buildCustomerVpnSummary_(inbounds, mapping) {
  const targetEmail = String(mapping.panelClientEmail || '').trim().toLowerCase();
  let uploadBytes = 0;
  let downloadBytes = 0;
  let quotaBytes = 0;
  let expiryTime = 0;
  let hasClient = false;
  let enabledSomewhere = false;
  const matchedInbounds = [];
  const seenInboundIds = {};

  (Array.isArray(inbounds) ? inbounds : []).forEach(function (inbound) {
    if (mapping.inboundId != null && Number(inbound.id) !== Number(mapping.inboundId)) return;

    const settings = parseXuiObject_(inbound.settings);
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    const client = clients.find(function (item) {
      return String(item && item.email || '').trim().toLowerCase() === targetEmail;
    });
    const statsRows = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
    const stats = statsRows.filter(function (item) {
      return String(item && item.email || '').trim().toLowerCase() === targetEmail;
    });
    if (!client && !stats.length) return;

    hasClient = true;
    const clientEnabled = !!(client && client.enable !== false);
    const inboundEnabled = inbound.enable !== false;
    if (clientEnabled && inboundEnabled) enabledSomewhere = true;

    if (client) {
      // 3x-ui stores totalGB as bytes (the UI converts GB to bytes before API calls).
      quotaBytes = Math.max(quotaBytes, numberOrZero_(client.totalGB));
      expiryTime = Math.max(expiryTime, numberOrZero_(client.expiryTime));
    }

    stats.forEach(function (stat) {
      uploadBytes += numberOrZero_(stat.up);
      downloadBytes += numberOrZero_(stat.down);
      quotaBytes = Math.max(quotaBytes, numberOrZero_(stat.total));
      expiryTime = Math.max(expiryTime, numberOrZero_(stat.expiryTime));
    });

    const inboundKey = String(inbound.id == null ? inbound.remark || 'service' : inbound.id);
    if (!seenInboundIds[inboundKey]) {
      seenInboundIds[inboundKey] = true;
      matchedInbounds.push({
        id: inbound.id == null ? '' : String(inbound.id),
        remark: String(inbound.remark || inbound.tag || 'VPN Service'),
        protocol: String(inbound.protocol || '—').toUpperCase(),
        port: Number(inbound.port || 0),
        enabled: clientEnabled && inboundEnabled
      });
    }
  });

  if (!hasClient) {
    return { ok: false, error: 'The linked VPN client was not found in the 3x-ui panel. Check the PanelClientEmail and InboundId in the VPNLinks sheet.' };
  }

  const usedBytes = uploadBytes + downloadBytes;
  const now = Date.now();
  let status = 'Active';
  if (expiryTime > 0 && expiryTime <= now) status = 'Expired';
  else if (quotaBytes > 0 && usedBytes >= quotaBytes) status = 'Quota reached';
  else if (!enabledSomewhere) status = 'Disabled';

  return {
    ok: true,
    vpn: {
      clientLabel: mapping.panelClientEmail,
      uploadBytes: uploadBytes,
      downloadBytes: downloadBytes,
      usedBytes: usedBytes,
      quotaBytes: quotaBytes,
      remainingBytes: quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) : null,
      expiryTime: expiryTime,
      status: status,
      inbounds: matchedInbounds
    }
  };
}

/** Run manually in Apps Script to verify the stored URL and token. No secret is logged. */
function testVpsConnection() {
  try {
    const inbounds = fetchXuiInbounds_();
    const result = { ok: true, message: '3x-ui API connection successful.', inboundCount: inbounds.length };
    Logger.log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('testVpsConnection error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/* ---------- Solara Nexus payments, packages and 3x-ui lifecycle ---------- */

/** Run once from the Apps Script editor. Adds new headers without touching existing rows. */
function setupPaymentSystem() {
  try {
    ensureHeaders_(VPN_LINKS_SHEET, VPN_LINKS_HEADERS).setFrozenRows(1);
    const packageSheet = ensureHeaders_(PACKAGE_SHEET, PACKAGE_HEADERS);
    ensureHeaders_(SERVICE_SHEET, SERVICE_HEADERS).setFrozenRows(1);
    ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS).setFrozenRows(1);
    ensureHeaders_(WALLET_TX_SHEET, WALLET_TX_HEADERS).setFrozenRows(1);
    packageSheet.setFrozenRows(1);

    // Safe, disabled starter options. Admin sets the real LKR price and inbound before enabling.
    if (packageSheet.getLastRow() < 2) {
      const now = new Date();
      packageSheet.getRange(2, 1, 3, PACKAGE_HEADERS.length).setValues([
        ['starter-30-50', 'Starter', 30, 50, 0, '', '1 device · Standard support', false, now, now],
        ['nexus-60-100', 'Nexus', 60, 100, 0, '', '5 devices · Priority support', false, now, now],
        ['elite-90-200', 'Elite', 90, 200, 0, '', '10 devices · Premium support', false, now, now]
      ]);
    }

    const props = PropertiesService.getScriptProperties();
    let folderId = props.getProperty('SN_PAYMENT_FOLDER_ID');
    if (!folderId) {
      const folder = DriveApp.createFolder('Solara Nexus Payment Slips');
      folderId = folder.getId();
      props.setProperty('SN_PAYMENT_FOLDER_ID', folderId);
    }

    const missing = [];
    if (!props.getProperty('SN_ADMIN_USERNAME')) missing.push('SN_ADMIN_USERNAME');
    if (!props.getProperty('SN_ADMIN_PASSWORD')) missing.push('SN_ADMIN_PASSWORD');
    return {
      ok: true,
      message: 'Payment system sheets and private Drive folder are ready.',
      sheets: [VPN_LINKS_SHEET, PACKAGE_SHEET, PAYMENTS_SHEET],
      adminPropertiesMissing: missing,
      note: 'Set the missing admin login properties in Script Properties before using Admin Panel.'
    };
  } catch (err) {
    console.error('setupPaymentSystem error: ' + err.message);
    return { ok: false, error: err.message || 'Payment setup failed.' };
  }
}

function ensureHeaders_(sheetName, headers) {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Bind this Apps Script project to the customer spreadsheet or set SHEET_ID.');
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  if (existing.every(function (v) { return !v; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  headers.forEach(function (header) {
    if (existing.indexOf(header) < 0) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(header);
      existing.push(header);
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function headerIndexMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); });
  const map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

function rowObject_(row, idx) {
  const out = {};
  Object.keys(idx).forEach(function (key) { out[key] = row[idx[key]]; });
  return out;
}

function asBool_(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return value === true || s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

function readPackages_(includeDisabled) {
  const sheet = ensureHeaders_(PACKAGE_SHEET, PACKAGE_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().map(function (row) {
    return {
      packageId: String(row[idx.PackageId] || ''),
      name: String(row[idx.PackageName] || ''),
      durationDays: Number(row[idx.DurationDays] || 0),
      dataGB: Number(row[idx.DataGB] || 0),
      priceLKR: Number(row[idx.PriceLKR] || 0),
      inboundId: Number(row[idx.InboundId] || 0),
      features: String(row[idx.Features] || ''),
      enabled: asBool_(row[idx.Enabled]),
      // google.script.run cannot serialize Date objects in return values.
      // Send ISO strings so Admin portal data (including inbound options) reaches the browser.
      createdAt: row[idx.CreatedAt] instanceof Date ? row[idx.CreatedAt].toISOString() : String(row[idx.CreatedAt] || ''),
      updatedAt: row[idx.UpdatedAt] instanceof Date ? row[idx.UpdatedAt].toISOString() : String(row[idx.UpdatedAt] || '')
    };
  }).filter(function (p) {
    return p.packageId && (includeDisabled || (p.enabled && p.priceLKR > 0 && p.inboundId > 0));
  });
}

function getPackageById_(packageId) {
  const target = String(packageId || '').trim().toLowerCase();
  if (!target) return null;
  return readPackages_(true).find(function (p) {
    return String(p.packageId || '').trim().toLowerCase() === target;
  }) || null;
}

function packageNameKey_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function packageQuotaMatches_(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0 || b === 0) return Math.abs(a - b) < 0.0001;
  // Allow tiny decimal precision differences from Sheets / 3x-ui conversions.
  return Math.abs(a - b) <= Math.max(0.01, Math.max(Math.abs(a), Math.abs(b)) * 0.001);
}

function getNextVpnClientName_(websiteEmail) {
  // Backfill identity fields on legacy rows before deciding the next label.
  getVpnMappingRecords_(websiteEmail, true);
  const sheet = ensureHeaders_(VPN_LINKS_SHEET, VPN_LINKS_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  const email = String(websiteEmail || '').trim().toLowerCase();
  let maxNumber = 0;
  if (last > 1) {
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    rows.forEach(function (row) {
      if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== email) return;
      const match = String(row[idx.ClientName] || '').match(/^Client\s+(\d+)$/i);
      if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
    });
  }
  return 'Client ' + (maxNumber + 1);
}

function getVpnMappingRecords_(websiteEmail, includeDeleted) {
  const sheet = ensureHeaders_(VPN_LINKS_SHEET, VPN_LINKS_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const email = String(websiteEmail || '').trim().toLowerCase();
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  const matches = [];
  let customerNumber = 0;
  rows.forEach(function (row, i) {
    if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== email) return;
    customerNumber++;
    let changed = false;
    if (!String(row[idx.ClientId] || '').trim()) {
      row[idx.ClientId] = Utilities.getUuid();
      changed = true;
    }
    if (!String(row[idx.ClientName] || '').trim()) {
      row[idx.ClientName] = 'Client ' + customerNumber;
      changed = true;
    }
    if (changed) sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
    const record = { rowNumber: i + 2, row: row, index: idx, sheet: sheet };
    const deletedAt = idx.DeletedAt != null ? row[idx.DeletedAt] : '';
    if (includeDeleted || !deletedAt) matches.push(record);
  });
  return matches;
}

function getVpnMappingRecord_(websiteEmail, clientId) {
  const records = getVpnMappingRecords_(websiteEmail, false);
  const wanted = String(clientId || '').trim();
  if (wanted) return records.find(function (record) {
    return String(record.row[record.index.ClientId] || '') === wanted;
  }) || null;
  if (records.length > 1) {
    throw new Error('This account has multiple VPN clients. Select the correct Client button on your Dashboard before renewing or changing a package.');
  }
  return records[0] || null;
}

function saveVpnMapping_(websiteEmail, panelClientEmail, inboundId, packageId, enabled, options) {
  options = options || {};
  const record = options.append ? null : getVpnMappingRecord_(websiteEmail, options.clientId || '');
  const sheet = record ? record.sheet : ensureHeaders_(VPN_LINKS_SHEET, VPN_LINKS_HEADERS);
  const idx = record ? record.index : headerIndexMap_(sheet);
  const rowNo = record ? record.rowNumber : sheet.getLastRow() + 1;
  const row = record ? record.row.slice() : new Array(sheet.getLastColumn()).fill('');
  row[idx.WebsiteEmail] = String(websiteEmail || '').trim().toLowerCase();
  row[idx.PanelClientEmail] = String(panelClientEmail || '').trim();
  row[idx.Enabled] = enabled !== false;
  row[idx.InboundId] = inboundId || '';
  row[idx.PackageId] = packageId || '';
  if (idx.ClientId != null) row[idx.ClientId] = String(options.clientId || row[idx.ClientId] || Utilities.getUuid());
  if (idx.ClientName != null) row[idx.ClientName] = String(options.clientName || row[idx.ClientName] || getNextVpnClientName_(websiteEmail));
  if (idx.DeletedAt != null) row[idx.DeletedAt] = '';
  sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
  return { rowNumber: rowNo, row: row, index: idx, sheet: sheet };
}

function getCustomerSubscriptionData(sessionToken, clientId) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const record = getVpnMappingRecord_(session.email, clientId || '');
    const mapping = record ? {
      clientId: String(record.row[record.index.ClientId] || ''),
      clientName: String(record.row[record.index.ClientName] || ''),
      panelClientEmail: String(record.row[record.index.PanelClientEmail] || ''),
      inboundId: Number(record.row[record.index.InboundId] || 0) || null,
      packageId: String(record.row[record.index.PackageId] || '')
    } : null;
    const options = readPackages_(false).map(function (p) {
      return { packageId: p.packageId, name: p.name, durationDays: p.durationDays, dataGB: p.dataGB, priceLKR: p.priceLKR, features: p.features };
    });
    let currentPackage = mapping && mapping.packageId ? getPackageById_(mapping.packageId) : null;
    if (currentPackage) currentPackage = {
      packageId: currentPackage.packageId, name: currentPackage.name, durationDays: currentPackage.durationDays,
      dataGB: currentPackage.dataGB, priceLKR: currentPackage.priceLKR, features: currentPackage.features
    };

    // Keep the catalogue quota separately. It identifies the renewal group even
    // when 3x-ui reports the stored byte count with a slightly different precision.
    const catalogueDataGB = currentPackage ? Number(currentPackage.dataGB || 0) : 0;
    let liveClientFound = false;
    let liveQuotaBytes = 0;
    if (currentPackage && mapping && mapping.panelClientEmail) {
      const liveInbounds = fetchXuiInbounds_();
      const scopedInbounds = mapping.inboundId == null ? liveInbounds : liveInbounds.filter(function (ib) { return Number(ib.id) === Number(mapping.inboundId); });
      let liveClient = findXuiClient_(scopedInbounds, mapping.panelClientEmail);
      // A stale inbound value in VPNLinks should not hide valid renewal choices
      // when the mapped 3x-ui client can still be found in another inbound.
      if (!liveClient && mapping.inboundId != null) liveClient = findXuiClient_(liveInbounds, mapping.panelClientEmail);
      if (liveClient) {
        liveQuotaBytes = Math.max(0, Number(liveClient.client.totalGB || 0));
        if (liveQuotaBytes > 0) currentPackage.dataGB = liveQuotaBytes / (1024 * 1024 * 1024);
        liveClientFound = true;
      }
    }

    // PackageId identifies one PackageCatalog row (one duration). Other duration
    // rows have their own IDs, so group them by the same package name + catalogue
    // data allowance. Do not require a successful live-client lookup just to show
    // the configured options; the renewal submit path still validates the client.
    const renewalOptions = currentPackage ? options.filter(function (p) {
      return packageNameKey_(p.name) === packageNameKey_(currentPackage.name) &&
        packageQuotaMatches_(p.dataGB, catalogueDataGB);
    }) : [];
    console.log('Renewal options lookup: packageId=' + (mapping ? mapping.packageId : '') +
      ', package=' + (currentPackage ? currentPackage.name : 'none') +
      ', catalogueGB=' + catalogueDataGB + ', liveClientFound=' + liveClientFound +
      ', liveQuotaBytes=' + liveQuotaBytes + ', options=' + renewalOptions.length);
    const paySheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const idx = headerIndexMap_(paySheet);
    const last = paySheet.getLastRow();
    const history = [];
    if (last > 1) {
      const rows = paySheet.getRange(2, 1, last - 1, paySheet.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0 && history.length < 5; i--) {
        if (String(rows[i][idx.WebsiteEmail] || '').toLowerCase() === session.email && !/^NEW ORDER/i.test(String(rows[i][idx.RequestType] || ''))) {
          history.push({
            requestId: String(rows[i][idx.RequestId] || ''),
            createdAt: rows[i][idx.CreatedAt] instanceof Date ? rows[i][idx.CreatedAt].toISOString() : String(rows[i][idx.CreatedAt] || ''),
            packageName: String(rows[i][idx.PackageName] || ''),
            requestType: String(rows[i][idx.RequestType] || ''),
            priceLKR: Number(rows[i][idx.PriceLKR] || 0),
            status: String(rows[i][idx.Status] || '')
          });
        }
      }
    }
    return { ok: true, packages: options, renewalOptions: renewalOptions,
      hasVpnAccount: !!(mapping && mapping.panelClientEmail), clientId: mapping ? mapping.clientId : '', clientName: mapping ? mapping.clientName : '', currentPackage: currentPackage,
      walletBalanceLKR: getWalletBalance_(session.email), paymentHistory: history };
  } catch (err) {
    console.error('getCustomerSubscriptionData error: ' + err.message);
    return { ok: false, error: err.message || 'Could not load subscription options.' };
  }
}

function getCustomerWalletBalance(sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    return { ok: true, balanceLKR: getWalletBalance_(session.email) };
  } catch (err) {
    console.error('getCustomerWalletBalance error: ' + err.message);
    return { ok: false, error: 'Could not load wallet balance.' };
  }
}

/**
 * Resolve a customer-selected catalog row. Renewal only accepts another
 * duration under the same named plan. applyPaymentRequestToVps_ then verifies
 * the selected row's quota against the live 3x-ui totalGB before changing expiry.
 */
function resolveCustomerPackageChoice_(mapping, packageChoice, flow) {
  const isRenewal = String(flow || '').toLowerCase() === 'renew';
  const choice = String(packageChoice || '').trim();
  if (isRenewal) {
    if (!mapping || !String(mapping.row[mapping.index.PanelClientEmail] || '').trim()) {
      return { ok: false, error: 'There is no existing VPN client to renew. Please use Change Package to activate a package.' };
    }
    const currentId = String(mapping.row[mapping.index.PackageId] || '').trim();
    const current = currentId ? getPackageById_(currentId) : null;
    if (!current) return { ok: false, error: 'Your current package is not recorded. Please contact support before renewing.' };
    const candidate = choice === 'current' ? current : getPackageById_(choice);
    if (!candidate || !candidate.enabled || candidate.priceLKR <= 0 || candidate.durationDays < 0) {
      return { ok: false, error: 'Please choose an enabled renewal duration.' };
    }
    if (String(candidate.name).toLowerCase() !== String(current.name).toLowerCase()) {
      return { ok: false, error: 'Renewal can only change validity days. Your existing package and data limit must remain unchanged.' };
    }
    return { ok: true, package: candidate, currentPackage: current };
  }

  const candidate = getPackageById_(choice);
  if (!candidate || !candidate.enabled || candidate.priceLKR <= 0 || candidate.inboundId <= 0 || candidate.durationDays < 0) {
    return { ok: false, error: 'Please choose an available package.' };
  }
  return { ok: true, package: candidate, currentPackage: null };
}

function resolveServiceOrder_(serviceId) {
  const id = String(serviceId || '').trim();
  if (!id) return { ok: false, error: 'Choose an Order Services card.' };
  const sheet = ensureHeaders_(SERVICE_SHEET, SERVICE_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: 'This service is no longer available.' };
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[idx.ServiceId] || '') !== id || !asBool_(row[idx.Enabled])) continue;
    const packageId = String(idx.PackageId != null ? row[idx.PackageId] || '' : '').trim();
    const pkg = packageId ? getPackageById_(packageId) : null;
    if (!pkg || !pkg.enabled || pkg.priceLKR <= 0 || pkg.inboundId <= 0) return { ok: false, error: 'This service is not linked to an enabled PackageCatalog package. Please contact support.' };
    return { ok: true, service: { serviceId:id, name:String(row[idx.ServiceName]||''), appType:String(row[idx.AppType]||'http-injector') }, package:pkg };
  }
  return { ok: false, error: 'This service is not available anymore.' };
}

function getPrivatePaymentFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SN_PAYMENT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { props.deleteProperty('SN_PAYMENT_FOLDER_ID'); }
  }
  const folder = DriveApp.createFolder('Solara Nexus Payment Slips');
  props.setProperty('SN_PAYMENT_FOLDER_ID', folder.getId());
  return folder;
}

function notifyAdminNewOrder_(customerName, email, packageName, amount, requestId, paymentMethod) {
  try {
    const props = PropertiesService.getScriptProperties();
    const recipient = String(props.getProperty('SN_ADMIN_NOTIFICATION_EMAIL') || Session.getEffectiveUser().getEmail() || '').trim();
    if (!recipient || !validEmail_(recipient)) return;
    MailApp.sendEmail(recipient, 'New Solara Nexus customer order',
      'A new Order Services order was received.\n\nCustomer: ' + String(customerName || '') + '\nGmail: ' + String(email || '') +
      '\nPackage: ' + String(packageName || '') + '\nAmount: LKR ' + Number(amount || 0) + '\nPayment: ' + String(paymentMethod || '') +
      '\nOrder ID: ' + String(requestId || '') + '\n\nOpen the Admin Panel → New Orders to review and deliver the configuration.');
  } catch (err) { console.error('Admin new-order notification failed: ' + err.message); }
}

function submitPaymentRequest(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const session = getCustomerSession_(data.sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const file = data.file || {};
    const fileName = String(file.name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
    const mimeType = String(file.mimeType || '').toLowerCase();
    if (!fileName || !['image/jpeg', 'image/png', 'application/pdf'].includes(mimeType)) {
      return { ok: false, error: 'Upload a JPG, PNG or PDF payment slip.' };
    }
    const rawBase64 = String(file.base64 || '').replace(/^data:[^,]+,/, '').trim();
    if (!rawBase64 || rawBase64.length > Math.ceil(PAYMENT_FILE_MAX_BYTES * 1.4)) return { ok: false, error: 'Payment slip is too large. Maximum file size is 5 MB.' };
    const bytes = Utilities.base64Decode(rawBase64);
    if (!bytes.length || bytes.length > PAYMENT_FILE_MAX_BYTES) return { ok: false, error: 'Payment slip is too large. Maximum file size is 5 MB.' };

    lock.waitLock(15000);
    const paymentSheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const pIdx = headerIndexMap_(paymentSheet);
    const last = paymentSheet.getLastRow();
    if (last > 1) {
      const rows = paymentSheet.getRange(2, 1, last - 1, paymentSheet.getLastColumn()).getValues();
      const hasPending = rows.some(function (row) {
        return String(row[pIdx.WebsiteEmail] || '').toLowerCase() === session.email && ['PENDING', 'PROCESSING', 'FAILED'].indexOf(String(row[pIdx.Status] || '').toUpperCase()) >= 0;
      });
      if (hasPending) return { ok: false, error: 'You already have a payment request waiting for review.' };
    }

    const chosenPaymentMethod = String(data.paymentMethod || '').toUpperCase();
    if (['BANK_TRANSFER','EZ_CASH'].indexOf(chosenPaymentMethod) < 0) return { ok: false, error: 'Choose Bank Transfer or EZ Cash.' };
    if (chosenPaymentMethod === 'EZ_CASH' && !PropertiesService.getScriptProperties().getProperty('SN_WALLET_EZCASH_NUMBER')) return { ok: false, error: 'EZ Cash details are not configured yet. Please contact support.' };
    const flowValue = String(data.flow || 'change').toLowerCase();
    const isNewOrder = flowValue === 'new-order';
    const flow = flowValue === 'renew' ? 'renew' : 'change';
    const mapping = isNewOrder ? null : getVpnMappingRecord_(session.email, data.clientId || '');
    const serviceResolved = isNewOrder ? resolveServiceOrder_(data.serviceId) : null;
    if (isNewOrder && !serviceResolved.ok) return { ok:false, error:serviceResolved.error };
    const resolved = isNewOrder ? serviceResolved : resolveCustomerPackageChoice_(mapping, data.packageChoice, flow);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const selected = resolved.package;
    if (!selected || selected.priceLKR <= 0 || selected.durationDays < 0) return { ok: false, error: 'This package is not configured for payments yet. Contact support.' };

    const requestId = Utilities.getUuid();
    const blob = Utilities.newBlob(bytes, mimeType, requestId + '_' + fileName);
    const driveFile = getPrivatePaymentFolder_().createFile(blob);
    driveFile.setDescription('Solara Nexus payment slip. Request ID: ' + requestId + '. Customer: ' + session.email);
    const hasExistingClient = !!(mapping && String(mapping.row[mapping.index.PanelClientEmail] || '').trim());
    const requestFlow = flow === 'renew' ? 'RENEWAL' : 'PACKAGE_CHANGE';
    const type = isNewOrder ? 'NEW ORDER · ' + serviceResolved.service.name : (hasExistingClient ? (requestFlow === 'RENEWAL' ? 'Renewal' : 'Package Change') : 'New Activation');
    const newRow = new Array(paymentSheet.getLastColumn()).fill('');
    newRow[pIdx.RequestId] = requestId;
    newRow[pIdx.CreatedAt] = new Date();
    newRow[pIdx.WebsiteEmail] = session.email;
    newRow[pIdx.CustomerName] = session.name;
    newRow[pIdx.PackageId] = selected.packageId;
    newRow[pIdx.PackageName] = selected.name;
    newRow[pIdx.DurationDays] = selected.durationDays;
    newRow[pIdx.DataGB] = selected.dataGB;
    newRow[pIdx.PriceLKR] = selected.priceLKR;
    newRow[pIdx.RequestType] = type;
    newRow[pIdx.Status] = 'PENDING';
    newRow[pIdx.SlipFileId] = driveFile.getId();
    newRow[pIdx.SlipFileName] = fileName;
    newRow[pIdx.VpsAction] = 'WAITING_FOR_ADMIN';
    if (pIdx.InboundId != null) newRow[pIdx.InboundId] = selected.inboundId || (mapping && Number(mapping.row[mapping.index.InboundId] || 0)) || '';
    if (pIdx.TargetClientId != null && mapping) newRow[pIdx.TargetClientId] = String(mapping.row[mapping.index.ClientId] || '');
    if (pIdx.ClientName != null && mapping) newRow[pIdx.ClientName] = String(mapping.row[mapping.index.ClientName] || '');
    if (pIdx.PaymentMethod != null) newRow[pIdx.PaymentMethod] = chosenPaymentMethod;
    if (isNewOrder && pIdx.ServiceId != null) newRow[pIdx.ServiceId] = serviceResolved.service.serviceId;
    if (isNewOrder && pIdx.ServiceAppType != null) newRow[pIdx.ServiceAppType] = serviceResolved.service.appType;
    if (pIdx.AdminNote != null && String(data.note||'').trim()) newRow[pIdx.AdminNote] = 'Customer note: ' + String(data.note).trim().slice(0,500);
    paymentSheet.getRange(paymentSheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    if (isNewOrder) notifyAdminNewOrder_(session.name, session.email, selected.name, selected.priceLKR, requestId, chosenPaymentMethod);
    return { ok: true, requestId: requestId, message: isNewOrder ? 'New order submitted. Admin will review the slip, create your VPN client, and attach your configuration.' : 'Payment slip submitted. Your VPN will be activated or renewed after admin approval.' };
  } catch (err) {
    console.error('submitPaymentRequest error: ' + err.message);
    return { ok: false, error: err.message || 'Could not submit payment request.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function getWalletTopupInfo(sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const props = PropertiesService.getScriptProperties();
    const sheet = ensureHeaders_(WALLET_TOPUP_SHEET, WALLET_TOPUP_HEADERS);
    const idx = headerIndexMap_(sheet);
    const history = [];
    const last = sheet.getLastRow();
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0 && history.length < 12; i--) {
        if (String(rows[i][idx.WebsiteEmail] || '').toLowerCase() !== session.email) continue;
        history.push({ requestId:String(rows[i][idx.RequestId]||''), createdAt:rows[i][idx.CreatedAt] instanceof Date ? rows[i][idx.CreatedAt].toISOString() : String(rows[i][idx.CreatedAt]||''), amountLKR:Number(rows[i][idx.AmountLKR]||0), method:String(rows[i][idx.PaymentMethod]||''), status:String(rows[i][idx.Status]||''), adminNote:String(rows[i][idx.AdminNote]||'') });
      }
    }
    return { ok:true, balanceLKR:getWalletBalance_(session.email), bank:{ bankName:String(props.getProperty('SN_WALLET_BANK_NAME')||'BOC'), accountName:String(props.getProperty('SN_WALLET_BANK_ACCOUNT_NAME')||'PGK SANDEEPA'), accountNumber:String(props.getProperty('SN_WALLET_BANK_ACCOUNT_NUMBER')||'0079768225'), branch:String(props.getProperty('SN_WALLET_BANK_BRANCH')||'THAWALAMA') }, ezcash:{ name:String(props.getProperty('SN_WALLET_EZCASH_NAME')||''), number:String(props.getProperty('SN_WALLET_EZCASH_NUMBER')||'') }, history:history };
  } catch (err) { console.error('getWalletTopupInfo error: '+err.message); return {ok:false,error:'Could not load wallet information.'}; }
}

function submitWalletTopup(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const session = getCustomerSession_(data.sessionToken);
    if (!session) return {ok:false,sessionExpired:true,error:'Your session has expired. Please sign in again.'};
    const amount = Number(data.amountLKR);
    if (!Number.isInteger(amount) || amount < 100 || amount > 100000000) return {ok:false,error:'Minimum wallet top-up is LKR 100. Enter a valid whole-number amount.'};
    const method = String(data.paymentMethod||'').toUpperCase();
    if (['BANK_TRANSFER','EZ_CASH'].indexOf(method)<0) return {ok:false,error:'Choose Bank Transfer or EZ Cash.'};
    const paymentProps=PropertiesService.getScriptProperties();
    if(method==='BANK_TRANSFER' && (!paymentProps.getProperty('SN_WALLET_BANK_ACCOUNT_NAME') || !paymentProps.getProperty('SN_WALLET_BANK_ACCOUNT_NUMBER'))) return {ok:false,error:'Bank transfer details are not configured yet. Please contact support.'};
    if(method==='EZ_CASH' && !paymentProps.getProperty('SN_WALLET_EZCASH_NUMBER')) return {ok:false,error:'EZ Cash details are not configured yet. Please contact support.'};
    const note = String(data.note||'').trim().slice(0,500);
    const file = data.file || {};
    const fileName = String(file.name||'').replace(/[\\/:*?"<>|]/g,'_').slice(0,100);
    const mimeType = String(file.mimeType||'').toLowerCase();
    if (!fileName || ['image/jpeg','image/png','application/pdf'].indexOf(mimeType)<0) return {ok:false,error:'Upload a JPG, PNG or PDF payment slip.'};
    const rawBase64 = String(file.base64||'').replace(/^data:[^,]+,/,'').trim();
    if (!rawBase64 || rawBase64.length > Math.ceil(PAYMENT_FILE_MAX_BYTES*1.4)) return {ok:false,error:'Payment slip is too large. Maximum file size is 5 MB.'};
    const bytes = Utilities.base64Decode(rawBase64);
    if (!bytes.length || bytes.length > PAYMENT_FILE_MAX_BYTES) return {ok:false,error:'Payment slip is too large. Maximum file size is 5 MB.'};
    lock.waitLock(20000);
    const sheet = ensureHeaders_(WALLET_TOPUP_SHEET,WALLET_TOPUP_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    if (last > 1) {
      const rows = sheet.getRange(2,1,last-1,sheet.getLastColumn()).getValues();
      const pending = rows.some(r=>String(r[idx.WebsiteEmail]||'').toLowerCase()===session.email && ['PENDING','PROCESSING'].indexOf(String(r[idx.Status]||'').toUpperCase())>=0);
      if (pending) return {ok:false,error:'You already have a wallet top-up request waiting for admin review.'};
    }
    const requestId = Utilities.getUuid();
    const driveFile = getPrivatePaymentFolder_().createFile(Utilities.newBlob(bytes,mimeType,requestId+'_'+fileName));
    driveFile.setDescription('Solara Nexus wallet top-up slip. Request ID: '+requestId+'. Customer: '+session.email);
    const row = new Array(sheet.getLastColumn()).fill('');
    row[idx.RequestId]=requestId; row[idx.CreatedAt]=new Date(); row[idx.WebsiteEmail]=session.email; row[idx.CustomerName]=session.name;
    row[idx.AmountLKR]=amount; row[idx.PaymentMethod]=method; row[idx.CustomerNote]=note; row[idx.SlipFileId]=driveFile.getId(); row[idx.SlipFileName]=fileName; row[idx.Status]='PENDING';
    sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    return {ok:true,requestId:requestId,message:'Wallet top-up request submitted. Your wallet will be credited after admin approval.'};
  } catch(err) { console.error('submitWalletTopup error: '+err.message); return {ok:false,error:err.message||'Could not submit wallet top-up.'}; }
  finally { try {lock.releaseLock();} catch(x){} }
}

function adminSaveWalletPaymentSettings(data) {
  try {
    data=data||{};
    const admin=requireAdmin_(data.adminToken);
    if(!admin) return {ok:false,sessionExpired:true,error:'Admin session expired.'};
    const clean=(v,max)=>String(v||'').trim().slice(0,max);
    const props=PropertiesService.getScriptProperties();
    const values={SN_WALLET_BANK_NAME:clean(data.bankName,100),SN_WALLET_BANK_ACCOUNT_NAME:clean(data.accountName,120),SN_WALLET_BANK_ACCOUNT_NUMBER:clean(data.accountNumber,80),SN_WALLET_BANK_BRANCH:clean(data.branch,100),SN_WALLET_EZCASH_NAME:clean(data.ezName,120),SN_WALLET_EZCASH_NUMBER:clean(data.ezNumber,80)};
    Object.keys(values).forEach(k=>props.setProperty(k,values[k]));
    return {ok:true,message:'Wallet payment details saved.'};
  } catch(err) { return {ok:false,error:err.message||'Could not save wallet payment details.'}; }
}

function adminReviewWalletTopup(data) {
  const lock=LockService.getScriptLock();
  try {
    data=data||{};
    const admin=requireAdmin_(data.adminToken);
    if(!admin) return {ok:false,sessionExpired:true,error:'Admin session expired.'};
    const requestId=String(data.requestId||'').trim();
    const action=String(data.action||'').toLowerCase();
    const note=String(data.note||'').trim().slice(0,500);
    if(!requestId || ['approve','reject'].indexOf(action)<0) return {ok:false,error:'Invalid wallet top-up review request.'};
    lock.waitLock(20000);
    const sheet=ensureHeaders_(WALLET_TOPUP_SHEET,WALLET_TOPUP_HEADERS);
    const idx=headerIndexMap_(sheet); const last=sheet.getLastRow();
    if(last<2) return {ok:false,error:'Wallet top-up request not found.'};
    const rows=sheet.getRange(2,1,last-1,sheet.getLastColumn()).getValues();
    let rowNo=-1,row=null;
    for(let i=0;i<rows.length;i++) if(String(rows[i][idx.RequestId]||'')===requestId){rowNo=i+2;row=rows[i];break;}
    if(!row) return {ok:false,error:'Wallet top-up request not found.'};
    if(String(row[idx.Status]||'').toUpperCase()!=='PENDING') return {ok:false,error:'This wallet top-up has already been reviewed.'};
    if(action==='reject'){
      row[idx.Status]='REJECTED'; row[idx.AdminNote]=note||'Rejected by admin.'; row[idx.ReviewedAt]=new Date(); row[idx.ReviewedBy]=admin.user;
      sheet.getRange(rowNo,1,1,row.length).setValues([row]);
      return {ok:true,message:'Wallet top-up rejected.'};
    }
    const email=String(row[idx.WebsiteEmail]||'').trim().toLowerCase();
    const amount=Number(row[idx.AmountLKR]||0);
    if(!validEmail_(email)||!Number.isInteger(amount)||amount<100) return {ok:false,error:'Invalid customer email or top-up amount.'};
    const credit=changeWalletBalance_(email,amount,'WALLET_TOPUP',requestId,note||'Wallet top-up approved by '+admin.user);
    if(!credit.ok) return credit;
    row[idx.Status]='APPROVED'; row[idx.AdminNote]=note||'Payment verified and wallet credited.'; row[idx.ReviewedAt]=new Date(); row[idx.ReviewedBy]=admin.user;
    sheet.getRange(rowNo,1,1,row.length).setValues([row]);
    return {ok:true,message:'Wallet credited with LKR '+amount+'. New balance: LKR '+credit.balanceLKR, balanceLKR:credit.balanceLKR};
  } catch(err) { console.error('adminReviewWalletTopup error: '+err.message); return {ok:false,error:err.message||'Could not review wallet top-up.'}; }
  finally { try{lock.releaseLock();}catch(x){} }
}

function adminSessionKey_(token) {
  return 'sn_admin_session_' + hash_('admin-session:' + String(token || ''));
}

function adminLogin(data) {
  try {
    data = data || {};
    const props = PropertiesService.getScriptProperties();
    const configuredUser = String(props.getProperty('SN_ADMIN_USERNAME') || '');
    const configuredPass = String(props.getProperty('SN_ADMIN_PASSWORD') || '');
    if (!configuredUser || !configuredPass) return { ok: false, error: 'Admin login is not configured. Set SN_ADMIN_USERNAME and SN_ADMIN_PASSWORD in Script Properties.' };
    const cache = CacheService.getScriptCache();
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    const ipKey = 'sn_admin_attempts_' + hash_(username.toLowerCase()).slice(0, 16);
    const attempts = Number(cache.get(ipKey) || 0);
    if (attempts >= 8) return { ok: false, error: 'Too many login attempts. Try again in 10 minutes.' };
    if (hash_(username) !== hash_(configuredUser) || hash_(password) !== hash_(configuredPass)) {
      cache.put(ipKey, String(attempts + 1), 600);
      return { ok: false, error: 'Invalid admin username or password.' };
    }
    cache.remove(ipKey);
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    cache.put(adminSessionKey_(token), JSON.stringify({ user: configuredUser, createdAt: Date.now() }), ADMIN_SESSION_TTL);
    return { ok: true, token: token, username: configuredUser };
  } catch (err) {
    console.error('adminLogin error: ' + err.message);
    return { ok: false, error: 'Admin login failed.' };
  }
}

function requireAdmin_(token) {
  token = String(token || '').trim();
  if (token.length < 40 || token.length > 200) return null;
  const raw = CacheService.getScriptCache().get(adminSessionKey_(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function adminLogout(token) {
  try {
    if (token) CacheService.getScriptCache().remove(adminSessionKey_(token));
    return { ok: true };
  } catch (err) { return { ok: false }; }
}

function adminGetPortalData(token) {
  try {
    const admin = requireAdmin_(token);
    if (!admin) return { ok: false, sessionExpired: true, error: 'Admin session expired. Please sign in again.' };
    const inbounds = fetchXuiInbounds_().map(function (ib) {
      return { id: Number(ib.id), remark: String(ib.remark || ib.tag || 'Inbound'), protocol: String(ib.protocol || '').toUpperCase(), port: Number(ib.port || 0), enabled: ib.enable !== false };
    });
    const packages = readPackages_(true);
    const services = readServices_(true);
    const paymentSheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const idx = headerIndexMap_(paymentSheet);
    const payments = [];
    const newOrders = [];
    const last = paymentSheet.getLastRow();
    if (last > 1) {
      const rows = paymentSheet.getRange(2, 1, last - 1, paymentSheet.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0 && payments.length < 100; i--) {
        const status = String(rows[i][idx.Status] || '');
        const method = idx.PaymentMethod != null ? String(rows[i][idx.PaymentMethod] || 'SLIP').toUpperCase() : 'SLIP';
        const requestType = String(rows[i][idx.RequestType] || '');
        const isNewOrder = /^NEW ORDER/i.test(requestType);
        if (isNewOrder) {
          const serviceId = String(idx.ServiceId != null ? rows[i][idx.ServiceId] || '' : '');
          const linkedService = services.find(function(svc){ return svc.serviceId === serviceId; });
          const slipId = String(rows[i][idx.SlipFileId] || '');
          newOrders.push({requestId:String(rows[i][idx.RequestId]||''),createdAt:rows[i][idx.CreatedAt] instanceof Date?rows[i][idx.CreatedAt].toISOString():String(rows[i][idx.CreatedAt]||''),websiteEmail:String(rows[i][idx.WebsiteEmail]||''),customerName:String(rows[i][idx.CustomerName]||''),packageName:String(rows[i][idx.PackageName]||''),durationDays:Number(rows[i][idx.DurationDays]||0),dataGB:Number(rows[i][idx.DataGB]||0),priceLKR:Number(rows[i][idx.PriceLKR]||0),paymentMethod:method,status:status,appType:String(idx.ServiceAppType!=null?rows[i][idx.ServiceAppType]||'':(linkedService?linkedService.appType:'')),slipFileName:String(rows[i][idx.SlipFileName]||''),slipUrl:slipId?'https://drive.google.com/file/d/'+encodeURIComponent(slipId)+'/view':'',configType:String(idx.ConfigType!=null?rows[i][idx.ConfigType]||'':''),configCode:String(idx.ConfigValue!=null?rows[i][idx.ConfigValue]||'':''),configFileName:String(idx.ConfigFileName!=null?rows[i][idx.ConfigFileName]||'':''),clientName:String(idx.ClientName!=null?rows[i][idx.ClientName]||'':''),hasConfig:!!(String(idx.ConfigValue!=null?rows[i][idx.ConfigValue]||'':'')||String(idx.ConfigFileId!=null?rows[i][idx.ConfigFileId]||'':''))});
          continue;
        }
        if (method === 'WALLET' || ['PENDING', 'PROCESSING', 'FAILED'].indexOf(status.toUpperCase()) < 0) continue;
        const fileId = String(rows[i][idx.SlipFileId] || '');
        payments.push({
          requestId: String(rows[i][idx.RequestId] || ''),
          createdAt: rows[i][idx.CreatedAt] instanceof Date ? rows[i][idx.CreatedAt].toISOString() : String(rows[i][idx.CreatedAt] || ''),
          websiteEmail: String(rows[i][idx.WebsiteEmail] || ''),
          customerName: String(rows[i][idx.CustomerName] || ''),
          packageName: String(rows[i][idx.PackageName] || ''),
          durationDays: Number(rows[i][idx.DurationDays] || 0),
          dataGB: Number(rows[i][idx.DataGB] || 0),
          priceLKR: Number(rows[i][idx.PriceLKR] || 0),
          requestType: String(rows[i][idx.RequestType] || ''),
          paymentMethod: method,
          status: status,
          adminNote: String(rows[i][idx.AdminNote] || ''),
          slipFileName: String(rows[i][idx.SlipFileName] || ''),
          slipUrl: fileId ? 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view' : ''
        });
      }
    }
    const topupSheet = ensureHeaders_(WALLET_TOPUP_SHEET, WALLET_TOPUP_HEADERS);
    const topupIdx = headerIndexMap_(topupSheet);
    const walletTopups = [];
    const topupLast = topupSheet.getLastRow();
    if (topupLast > 1) {
      const topupRows = topupSheet.getRange(2,1,topupLast-1,topupSheet.getLastColumn()).getValues();
      for (let i=topupRows.length-1;i>=0 && walletTopups.length<100;i--) {
        const r=topupRows[i], status=String(r[topupIdx.Status]||'').toUpperCase();
        if (['PENDING','PROCESSING'].indexOf(status)<0) continue;
        const fileId=String(r[topupIdx.SlipFileId]||'');
        walletTopups.push({requestId:String(r[topupIdx.RequestId]||''),createdAt:r[topupIdx.CreatedAt] instanceof Date?r[topupIdx.CreatedAt].toISOString():String(r[topupIdx.CreatedAt]||''),websiteEmail:String(r[topupIdx.WebsiteEmail]||''),customerName:String(r[topupIdx.CustomerName]||''),amountLKR:Number(r[topupIdx.AmountLKR]||0),paymentMethod:String(r[topupIdx.PaymentMethod]||''),customerNote:String(r[topupIdx.CustomerNote]||''),status:status,adminNote:String(r[topupIdx.AdminNote]||''),slipFileName:String(r[topupIdx.SlipFileName]||''),slipUrl:fileId?'https://drive.google.com/file/d/'+encodeURIComponent(fileId)+'/view':''});
      }
    }
    const props=PropertiesService.getScriptProperties();
    const walletPaymentSettings={bankName:props.getProperty('SN_WALLET_BANK_NAME')||'',accountName:props.getProperty('SN_WALLET_BANK_ACCOUNT_NAME')||'',accountNumber:props.getProperty('SN_WALLET_BANK_ACCOUNT_NUMBER')||'',branch:props.getProperty('SN_WALLET_BANK_BRANCH')||'',ezName:props.getProperty('SN_WALLET_EZCASH_NAME')||'',ezNumber:props.getProperty('SN_WALLET_EZCASH_NUMBER')||''};
    return { ok: true, username: admin.user, packages: packages, services: services, inbounds: inbounds, payments: payments, newOrders:newOrders, walletTopups:walletTopups, walletPaymentSettings:walletPaymentSettings };
  } catch (err) {
    console.error('adminGetPortalData error: ' + err.message);
    return { ok: false, error: err.message || 'Could not load admin panel data.' };
  }
}

/** Lightweight New Orders feed used by the 5-second admin refresh. It avoids a 3x-ui call. */
function getAdminNewOrders(token) {
  try {
    if (!requireAdmin_(token)) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    const services = readServices_(true);
    const serviceMap = {};
    services.forEach(function (svc) { serviceMap[svc.serviceId] = svc; });
    const orders = [];
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (!/^NEW ORDER/i.test(String(row[idx.RequestType] || ''))) continue;
        const serviceId = String(idx.ServiceId != null ? row[idx.ServiceId] || '' : '');
        const linked = serviceMap[serviceId] || null;
        const slipId = String(row[idx.SlipFileId] || '');
        const configCode = String(idx.ConfigValue != null ? row[idx.ConfigValue] || '' : '');
        const configFileId = String(idx.ConfigFileId != null ? row[idx.ConfigFileId] || '' : '');
        orders.push({
          requestId: String(row[idx.RequestId] || ''),
          createdAt: row[idx.CreatedAt] instanceof Date ? row[idx.CreatedAt].toISOString() : String(row[idx.CreatedAt] || ''),
          websiteEmail: String(row[idx.WebsiteEmail] || ''),
          customerName: String(row[idx.CustomerName] || ''),
          packageName: String(row[idx.PackageName] || ''),
          durationDays: Number(row[idx.DurationDays] || 0),
          dataGB: Number(row[idx.DataGB] || 0),
          priceLKR: Number(row[idx.PriceLKR] || 0),
          paymentMethod: idx.PaymentMethod != null ? String(row[idx.PaymentMethod] || 'SLIP').toUpperCase() : 'SLIP',
          status: String(row[idx.Status] || '').toUpperCase(),
          appType: String(idx.ServiceAppType != null ? row[idx.ServiceAppType] || '' : (linked ? linked.appType : '')),
          slipFileName: String(row[idx.SlipFileName] || ''),
          slipUrl: slipId ? 'https://drive.google.com/file/d/' + encodeURIComponent(slipId) + '/view' : '',
          configType: String(idx.ConfigType != null ? row[idx.ConfigType] || '' : ''),
          configCode: configCode,
          configFileName: String(idx.ConfigFileName != null ? row[idx.ConfigFileName] || '' : ''),
          hasConfig: !!(configCode || configFileId)
        });
      }
    }
    return { ok: true, newOrders: orders };
  } catch (err) {
    console.error('getAdminNewOrders error: ' + err.message);
    return { ok: false, error: err.message || 'Could not refresh new orders.' };
  }
}

/** Trash a private app configuration after its owning order is removed. Payment slips are retained. */
function trashOrderConfigFile_(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return;
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (err) {
    console.warn('Could not trash order config file ' + id + ': ' + err.message);
  }
}

/** Allows a customer to delete only their own New Order record. */
function deleteCustomerOrder(sessionToken, requestId) {
  const lock = LockService.getScriptLock();
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    requestId = String(requestId || '').trim();
    if (!requestId) return { ok: false, error: 'Order not found.' };
    lock.waitLock(15000);
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const found = findPaymentRequest_(sheet, requestId);
    if (!found) return { ok: false, error: 'This order no longer exists.' };
    const idx = found.index, row = found.row;
    if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== session.email) return { ok: false, error: 'You cannot delete another customer\'s order.' };
    if (!/^NEW ORDER/i.test(String(row[idx.RequestType] || ''))) return { ok: false, error: 'Only Order Services orders can be deleted here.' };
    const configFileId = idx.ConfigFileId != null ? String(row[idx.ConfigFileId] || '') : '';
    sheet.deleteRow(found.rowNo);
    trashOrderConfigFile_(configFileId);
    return { ok: true, message: 'Order deleted successfully.' };
  } catch (err) {
    console.error('deleteCustomerOrder error: ' + err.message);
    return { ok: false, error: err.message || 'Could not delete this order.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/** Allows an authenticated administrator to delete old New Order records only. */
function adminDeleteNewOrder(token, requestId) {
  const lock = LockService.getScriptLock();
  try {
    if (!requireAdmin_(token)) return { ok: false, sessionExpired: true, error: 'Admin session expired. Please sign in again.' };
    requestId = String(requestId || '').trim();
    if (!requestId) return { ok: false, error: 'Order not found.' };
    lock.waitLock(15000);
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const found = findPaymentRequest_(sheet, requestId);
    if (!found) return { ok: false, error: 'This order no longer exists.' };
    const idx = found.index, row = found.row;
    if (!/^NEW ORDER/i.test(String(row[idx.RequestType] || ''))) return { ok: false, error: 'This is not a New Order record.' };
    const configFileId = idx.ConfigFileId != null ? String(row[idx.ConfigFileId] || '') : '';
    sheet.deleteRow(found.rowNo);
    trashOrderConfigFile_(configFileId);
    return { ok: true, message: 'New order deleted successfully.' };
  } catch (err) {
    console.error('adminDeleteNewOrder error: ' + err.message);
    return { ok: false, error: err.message || 'Could not delete this new order.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function getAdminNewOrderCount(token) {
  try {
    if (!requireAdmin_(token)) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    let count = 0;
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      rows.forEach(function (row) {
        if (!/^NEW ORDER/i.test(String(row[idx.RequestType] || ''))) return;
        const status = String(row[idx.Status] || '').toUpperCase();
        const hasConfig = !!(String(idx.ConfigValue != null ? row[idx.ConfigValue] || '' : '') || String(idx.ConfigFileId != null ? row[idx.ConfigFileId] || '' : ''));
        if (['PENDING', 'FAILED', 'PROCESSING'].indexOf(status) >= 0 || (status === 'APPROVED' && !hasConfig)) count++;
      });
    }
    return { ok: true, count: count };
  } catch (err) {
    console.error('getAdminNewOrderCount error: ' + err.message);
    return { ok: false, error: err.message || 'Could not check new orders.' };
  }
}

function adminSavePackage(token, data) {
  try {
    if (!requireAdmin_(token)) return { ok: false, sessionExpired: true, error: 'Admin session expired. Please sign in again.' };
    data = data || {};
    const name = String(data.name || '').trim().slice(0, 40);
    const duration = Number(data.durationDays);
    const quota = Number(data.dataGB);
    const price = Number(data.priceLKR);
    const inboundId = Number(data.inboundId);
    const enabled = data.enabled === true || String(data.enabled) === 'true';
    if (!name) return { ok: false, error: 'Enter a package name.' };
    if ([0, 30, 60, 90].indexOf(duration) < 0) return { ok: false, error: 'Validity must be 30, 60, 90 days or Unlimited.' };
    if ([0, 50, 100, 200].indexOf(quota) < 0) return { ok: false, error: 'Data allowance must be 50, 100, 200 GB or Unlimited.' };
    if (!Number.isInteger(price) || price < 0 || price > 100000000) return { ok: false, error: 'Enter a whole-number LKR price.' };
    if (!Number.isInteger(inboundId) || inboundId <= 0) return { ok: false, error: 'Choose an active 3x-ui inbound.' };
    const available = fetchXuiInbounds_().some(function (ib) { return Number(ib.id) === inboundId && ib.enable !== false; });
    if (!available) return { ok: false, error: 'Selected inbound is not available or enabled.' };
    if (enabled && price <= 0) return { ok: false, error: 'Set a price above LKR 0 before enabling this package.' };

    const sheet = ensureHeaders_(PACKAGE_SHEET, PACKAGE_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    const existingId = String(data.packageId || '').trim();
    let rowNo = 0;
    if (existingId && last > 1) {
      const values = sheet.getRange(2, idx.PackageId + 1, last - 1, 1).getValues();
      for (let i = 0; i < values.length; i++) if (String(values[i][0]) === existingId) rowNo = i + 2;
    }
    const now = new Date();
    const id = existingId || Utilities.getUuid();
    const row = rowNo ? sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).getValues()[0] : new Array(sheet.getLastColumn()).fill('');
    row[idx.PackageId] = id;
    row[idx.PackageName] = name;
    row[idx.DurationDays] = duration;
    row[idx.DataGB] = quota;
    row[idx.PriceLKR] = price;
    row[idx.InboundId] = inboundId;
    row[idx.Features] = String(data.features || '').trim().slice(0, 200);
    row[idx.Enabled] = enabled;
    if (!row[idx.CreatedAt]) row[idx.CreatedAt] = now;
    row[idx.UpdatedAt] = now;
    if (rowNo) sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, message: 'Package saved.' };
  } catch (err) {
    console.error('adminSavePackage error: ' + err.message);
    return { ok: false, error: err.message || 'Could not save package.' };
  }
}

function readServices_(includeDisabled) {
  const sheet = ensureHeaders_(SERVICE_SHEET, SERVICE_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().map(function(row) {
    return {
      serviceId: String(row[idx.ServiceId] || ''),
      name: String(row[idx.ServiceName] || ''),
      priceLKR: Number(row[idx.PriceLKR] || 0),
      durationDays: String(row[idx.DurationDays] == null ? '' : row[idx.DurationDays]).trim() === '' ? 30 : Number(row[idx.DurationDays]),
      dataGB: Number(row[idx.DataGB] || 0),
      appType: String((idx.AppType != null && row[idx.AppType]) || 'http-injector'),
      packageId: String((idx.PackageId != null && row[idx.PackageId]) || ''),
      buttonText: String(row[idx.ButtonText] || 'Configure Order'),
      orderUrl: String(row[idx.OrderUrl] || ''),
      enabled: asBool_(row[idx.Enabled])
    };
  }).filter(function(item) { return includeDisabled || item.enabled; });
}

function adminSaveService(token, data) {
  try {
    if (!requireAdmin_(token)) return { ok:false, sessionExpired:true, error:'Admin session expired. Please sign in again.' };
    data = data || {};
    const name = String(data.name || '').trim().slice(0,60);
    const appType = String(data.appType || '').trim().toLowerCase();
    const allowedAppTypes = ['http-injector','napsternetv','npv-tunnel','v2box'];
    const price = Number(data.priceLKR);
    const duration = Number(data.durationDays);
    const dataGB = Number(data.dataGB);
    const packageId = String(data.packageId || '').trim();
    const linkedPackage = packageId ? getPackageById_(packageId) : null;
    const buttonText = 'Configure Order';
    const orderUrl = String(data.orderUrl || '').trim().slice(0,500);
    const enabled = data.enabled === true || String(data.enabled) === 'true';
    if (!name) return {ok:false,error:'Enter a service name.'};
    if (!linkedPackage || !linkedPackage.enabled || linkedPackage.inboundId <= 0) return {ok:false,error:'Select an enabled PackageCatalog package with an active 3x-ui inbound.'};
    if (allowedAppTypes.indexOf(appType) < 0) return {ok:false,error:'Choose a supported app: HTTP Injector, NetMod, NPV Tunnel or V2Box.'};
    if (!Number.isInteger(price) || price < 0 || price > 100000000) return {ok:false,error:'Enter a valid whole-number LKR price.'};
    if (!Number.isInteger(duration) || duration < 0 || duration > 3650) return {ok:false,error:'Enter validity in days. Use 0 for Unlimited.'};
    if (!Number.isFinite(dataGB) || dataGB < 0 || dataGB > 100000) return {ok:false,error:'Enter a valid data limit. Use 0 for Unlimited.'};
    if (orderUrl && !/^https?:\/\//i.test(orderUrl)) return {ok:false,error:'Order link must start with https:// or http://.'};
    // Order links are optional; services can be published without an external order URL.

    const sheet = ensureHeaders_(SERVICE_SHEET, SERVICE_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    const existingId = String(data.serviceId || '').trim();
    let rowNo = 0;
    if (existingId && last > 1) {
      const values = sheet.getRange(2, idx.ServiceId + 1, last - 1, 1).getValues();
      for (let i=0;i<values.length;i++) if (String(values[i][0]) === existingId) rowNo=i+2;
    }
    const now = new Date();
    const id = existingId || Utilities.getUuid();
    const row = rowNo ? sheet.getRange(rowNo,1,1,sheet.getLastColumn()).getValues()[0] : new Array(sheet.getLastColumn()).fill('');
    row[idx.ServiceId]=id; row[idx.ServiceName]=name; row[idx.PriceLKR]=price;
    if (idx.AppType != null) row[idx.AppType]=appType;
    row[idx.DurationDays]=duration; row[idx.DataGB]=dataGB; row[idx.ButtonText]=buttonText;
    row[idx.OrderUrl]=orderUrl; row[idx.Enabled]=enabled;
    if (idx.PackageId != null) row[idx.PackageId]=packageId;
    row[idx.PriceLKR]=linkedPackage.priceLKR; row[idx.DurationDays]=linkedPackage.durationDays; row[idx.DataGB]=linkedPackage.dataGB;
    if (idx.Category != null) row[idx.Category]='';
    if (idx.PriceLabel != null) row[idx.PriceLabel]='';
    if (idx.Description != null) row[idx.Description]='';
    if (idx.Specs != null) row[idx.Specs]='';
    if (idx.Icon != null) row[idx.Icon]='☁';
    if (!row[idx.CreatedAt]) row[idx.CreatedAt]=now;
    row[idx.UpdatedAt]=now;
    if (rowNo) sheet.getRange(rowNo,1,1,row.length).setValues([row]);
    else sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    return {ok:true,message:'Service saved successfully.'};
  } catch(err) {
    console.error('adminSaveService error: '+err.message);
    return {ok:false,error:err.message || 'Could not save service.'};
  }
}

function adminDisableService(token, serviceId) {
  try {
    if (!requireAdmin_(token)) return {ok:false,sessionExpired:true,error:'Admin session expired.'};
    const sheet=ensureHeaders_(SERVICE_SHEET,SERVICE_HEADERS);
    const idx=headerIndexMap_(sheet), last=sheet.getLastRow();
    if(last<2)return {ok:false,error:'Service not found.'};
    const rows=sheet.getRange(2,1,last-1,sheet.getLastColumn()).getValues();
    for(let i=0;i<rows.length;i++){
      if(String(rows[i][idx.ServiceId]||'')===String(serviceId||'')){
        rows[i][idx.Enabled]=false;rows[i][idx.UpdatedAt]=new Date();
        sheet.getRange(i+2,1,1,rows[i].length).setValues([rows[i]]);
        return {ok:true,message:'Service hidden from customers.'};
      }
    }
    return {ok:false,error:'Service not found.'};
  }catch(err){return {ok:false,error:err.message||'Could not disable service.'};}
}

function adminDeleteService(token, serviceId) {
  try {
    if (!requireAdmin_(token)) return {ok:false,sessionExpired:true,error:'Admin session expired.'};
    const sheet=ensureHeaders_(SERVICE_SHEET,SERVICE_HEADERS);
    const idx=headerIndexMap_(sheet), last=sheet.getLastRow();
    if(last<2)return {ok:false,error:'Service not found.'};
    const ids=sheet.getRange(2,idx.ServiceId+1,last-1,1).getValues();
    for(let i=0;i<ids.length;i++) if(String(ids[i][0]||'')===String(serviceId||'')) {
      sheet.deleteRow(i+2); return {ok:true,message:'Service deleted.'};
    }
    return {ok:false,error:'Service not found.'};
  } catch(err) { return {ok:false,error:err.message||'Could not delete service.'}; }
}

function adminDisablePackage(token, packageId) {
  try {
    if (!requireAdmin_(token)) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const sheet = ensureHeaders_(PACKAGE_SHEET, PACKAGE_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    if (last < 2) return { ok: false, error: 'Package not found.' };
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][idx.PackageId] || '') === String(packageId || '')) {
        rows[i][idx.Enabled] = false;
        rows[i][idx.UpdatedAt] = new Date();
        sheet.getRange(i + 2, 1, 1, rows[i].length).setValues([rows[i]]);
        return { ok: true, message: 'Package disabled. Existing customer history is preserved.' };
      }
    }
    return { ok: false, error: 'Package not found.' };
  } catch (err) { return { ok: false, error: err.message || 'Could not disable package.' }; }
}

/** Read wallet balance from the append-only transaction ledger. All mutations run under ScriptLock. */
function getWalletBalance_(websiteEmail) {
  const email = String(websiteEmail || '').trim().toLowerCase();
  const sheet = ensureHeaders_(WALLET_TX_SHEET, WALLET_TX_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  let balance = 0;
  rows.forEach(function (row) {
    if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() === email) {
      balance += Number(row[idx.AmountLKR] || 0);
    }
  });
  return Math.round(balance * 100) / 100;
}

/** Append one idempotent wallet transaction. Caller must hold ScriptLock. Positive=credit, negative=debit. */
function changeWalletBalance_(websiteEmail, amountLKR, type, referenceId, note) {
  const email = String(websiteEmail || '').trim().toLowerCase();
  const amount = Math.round(Number(amountLKR) * 100) / 100;
  const txType = String(type || '').trim().toUpperCase();
  const ref = String(referenceId || '').trim();
  if (!validEmail_(email) || !Number.isFinite(amount) || amount === 0 || !txType || !ref) {
    return { ok: false, error: 'Invalid wallet transaction.' };
  }
  const sheet = ensureHeaders_(WALLET_TX_SHEET, WALLET_TX_HEADERS);
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  let balance = 0;
  let duplicate = false;
  if (last > 1) {
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < rows.length; i++) {
      const rowEmail = String(rows[i][idx.WebsiteEmail] || '').trim().toLowerCase();
      if (rowEmail === email) {
        balance += Number(rows[i][idx.AmountLKR] || 0);
        if (String(rows[i][idx.Type] || '').toUpperCase() === txType && String(rows[i][idx.ReferenceId] || '') === ref) duplicate = true;
      }
    }
  }
  balance = Math.round(balance * 100) / 100;
  if (duplicate) return { ok: true, duplicate: true, balanceLKR: balance };
  if (amount < 0 && balance + amount < -0.001) {
    return { ok: false, insufficientBalance: true, balanceLKR: balance, error: 'Insufficient wallet balance.' };
  }
  const newBalance = Math.round((balance + amount) * 100) / 100;
  const row = new Array(sheet.getLastColumn()).fill('');
  row[idx.TransactionId] = Utilities.getUuid();
  row[idx.CreatedAt] = new Date();
  row[idx.WebsiteEmail] = email;
  row[idx.Type] = txType;
  row[idx.AmountLKR] = amount;
  row[idx.ReferenceId] = ref;
  row[idx.Note] = String(note || '').slice(0, 300);
  row[idx.BalanceAfterLKR] = newBalance;
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return { ok: true, balanceLKR: newBalance };
}

function findPaymentRequest_(sheet, requestId) {
  const idx = headerIndexMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][idx.RequestId] || '') === String(requestId || '')) {
      return { rowNo: i + 2, row: rows[i], index: idx };
    }
  }
  return null;
}

/**
 * Applies a single saved payment snapshot to 3x-ui. TargetExpiryMs and intended
 * client email are persisted before remote calls so an interrupted retry does
 * not add the subscription days a second time.
 */
function makeNewOrderClientName_(customerName, requestId) {
  let base = String(customerName || 'customer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  if (!base) base = 'customer';
  const suffix = String(requestId || Utilities.getUuid()).replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  return (base + '-' + (suffix || Utilities.getUuid().slice(0,8))).slice(0, 48);
}

function applyPaymentRequestToVps_(sheet, rowNo, row, idx, actor) {
  const websiteEmail = String(row[idx.WebsiteEmail] || '').trim().toLowerCase();
  const packageId = String(row[idx.PackageId] || '');
  const durationDays = Number(row[idx.DurationDays] || 0);
  const dataGB = Number(row[idx.DataGB] || 0);
  const priceLKR = Number(row[idx.PriceLKR] || 0);
  const plan = getPackageById_(packageId);
  const requestType = String(row[idx.RequestType] || '');
  const isRenewal = /renewal/i.test(requestType);
  const isNewOrder = /^NEW ORDER/i.test(requestType);
  if (!validEmail_(websiteEmail) || durationDays < 0 || priceLKR <= 0 || !Number.isFinite(dataGB) || dataGB < 0) {
    throw new Error('Payment request package/customer details are incomplete.');
  }

  const inbounds = fetchXuiInbounds_();
  const priorAttemptEmail = String(row[idx.VpsClientEmail] || '').trim();
  const requestedClientId = idx.TargetClientId != null ? String(row[idx.TargetClientId] || '').trim() : '';
  // Order Services always represents a separately purchased client. Existing
  // customer mappings are never reused for this flow.
  const mapRecord = isNewOrder
    ? (requestedClientId ? getVpnMappingRecord_(websiteEmail, requestedClientId) : null)
    : getVpnMappingRecord_(websiteEmail, requestedClientId);
  const mappedEmail = (!isNewOrder && mapRecord) ? String(mapRecord.row[mapRecord.index.PanelClientEmail] || '').trim() : '';
  const panelEmail = isNewOrder
    ? (priorAttemptEmail || makeNewOrderClientName_(row[idx.CustomerName], row[idx.RequestId]))
    : (mappedEmail || priorAttemptEmail || websiteEmail);
  if (!panelEmail || /[\\/\s]/.test(panelEmail)) throw new Error('The mapped 3x-ui client email contains unsupported characters.');

  const clientId = requestedClientId || (mapRecord && String(mapRecord.row[mapRecord.index.ClientId] || '')) || Utilities.getUuid();
  const clientName = (idx.ClientName != null ? String(row[idx.ClientName] || '') : '') ||
    (mapRecord ? String(mapRecord.row[mapRecord.index.ClientName] || '') : '') || getNextVpnClientName_(websiteEmail);
  if (idx.TargetClientId != null) row[idx.TargetClientId] = clientId;
  if (idx.ClientName != null) row[idx.ClientName] = clientName;
  row[idx.VpsClientEmail] = panelEmail;
  // Save the retry identity before calling 3x-ui; a retry reuses this exact client.
  sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);

  const found = findXuiClient_(inbounds, panelEmail);
  const alreadyLinkedOrPriorAttempt = isNewOrder
    ? !!priorAttemptEmail
    : (!!mappedEmail || (!!priorAttemptEmail && priorAttemptEmail.toLowerCase() === panelEmail.toLowerCase()));
  if (found && !alreadyLinkedOrPriorAttempt) {
    throw new Error('A 3x-ui client already uses this email but is not linked to this website account. Please review VPNLinks manually before applying.');
  }
  if (isRenewal) {
    if (!found || !mapRecord || !mappedEmail) throw new Error('Renewal requires the selected existing 3x-ui client. No new client will be created for a renewal.');
    const mappedPackageId = String(mapRecord.row[mapRecord.index.PackageId] || '');
    const currentPackage = mappedPackageId ? getPackageById_(mappedPackageId) : null;
    const actualClientQuotaBytes = Math.max(0, Number(found.client.totalGB || 0));
    if (!currentPackage || !plan ||
        String(plan.name).toLowerCase() !== String(currentPackage.name).toLowerCase() ||
        Number(plan.dataGB) !== Number(dataGB) || quotaBytesFromGB_(dataGB) !== actualClientQuotaBytes) {
      throw new Error('Renewal can only extend validity. The selected duration must match this client’s exact 3x-ui data cap.');
    }
  }

  let targetExpiry = Number(row[idx.TargetExpiryMs] || 0);
  if (durationDays === 0) {
    targetExpiry = 0;
  } else if (!targetExpiry) {
    const oldExpiry = (!isNewOrder && found) ? Number(found.client.expiryTime || 0) : 0;
    targetExpiry = Math.max(Date.now(), oldExpiry) + durationDays * 24 * 60 * 60 * 1000;
    row[idx.TargetExpiryMs] = targetExpiry;
    sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
  }

  let actionLabel = '';
  let primaryInboundId = 0;
  if (found && isNewOrder && priorAttemptEmail) {
    // The client was created in an earlier attempt. Do not reset its traffic or
    // recreate it; just finish linking the already-created client to this order.
    primaryInboundId = Number(row[idx.InboundId] || found.inboundIds[0] || 0);
    actionLabel = 'CREATED_NEW_CLIENT';
  } else if (found) {
    const updatedClient = Object.assign({}, found.client);
    updatedClient.email = panelEmail;
    if (!isRenewal) updatedClient.totalGB = quotaBytesFromGB_(dataGB);
    updatedClient.expiryTime = targetExpiry;
    updatedClient.enable = true;
    xuiPostJson_('/api/clients/update/' + encodeURIComponent(panelEmail), updatedClient);
    xuiPostJson_('/api/clients/resetTraffic/' + encodeURIComponent(panelEmail), {});
    primaryInboundId = Number((mapRecord && mapRecord.row[mapRecord.index.InboundId]) || found.inboundIds[0] || row[idx.InboundId] || 0);
    actionLabel = 'RENEWED_EXISTING_CLIENT';
  } else {
    const inboundId = Number(row[idx.InboundId] || (plan && plan.inboundId) || 0);
    const inbound = inbounds.find(function (ib) { return Number(ib.id) === inboundId && ib.enable !== false; });
    if (!inbound) throw new Error('The selected package inbound is not active. Edit the package and choose an active inbound.');
    const generatedId = Utilities.getUuid();
    const generatedPassword = Utilities.getUuid().replace(/-/g, '');
    const generatedAuth = Utilities.getUuid().replace(/-/g, '');
    const client = {
      email: panelEmail, id: generatedId, uuid: generatedId,
      password: generatedPassword, auth: generatedAuth, secret: generatedPassword,
      enable: true, totalGB: quotaBytesFromGB_(dataGB), expiryTime: targetExpiry,
      limitIp: 0, limitHwid: 0, tgId: 0,
      subId: Utilities.getUuid().replace(/-/g, ''), flow: '', security: 'auto',
      group: '', comment: 'Solara Nexus · ' + String(row[idx.CustomerName] || websiteEmail) + ' · ' + websiteEmail + ' · ' + clientName,
      reset: 0, resetDay: 0, resetWeekday: 0, resetMax: 0,
      trafficReset: 'never', trafficResetDay: 1
    };
    xuiPostJson_('/api/clients/add', { client: client, inboundIds: [inboundId] });
    primaryInboundId = inboundId;
    actionLabel = 'CREATED_NEW_CLIENT';
  }

  saveVpnMapping_(websiteEmail, panelEmail, primaryInboundId, packageId, true, {
    append: !mapRecord,
    clientId: clientId,
    clientName: clientName
  });
  row[idx.VpsAction] = actionLabel;
  row[idx.VpsClientEmail] = panelEmail;
  row[idx.InboundId] = primaryInboundId;
  if (idx.TargetClientId != null) row[idx.TargetClientId] = clientId;
  if (idx.ClientName != null) row[idx.ClientName] = clientName;
  row[idx.AdminNote] = row[idx.AdminNote] || (actor ? 'Applied by ' + actor : 'VPS update completed.');
  sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
  return { action: actionLabel, panelEmail: panelEmail, clientId: clientId, clientName: clientName, inboundId: primaryInboundId, targetExpiryMs: targetExpiry };
}

function purchaseWithWallet(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const session = getCustomerSession_(data.sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const checkoutKey = String(data.checkoutKey || '').trim();
    if (checkoutKey.length < 12 || checkoutKey.length > 120) return { ok: false, error: 'Invalid checkout request. Please refresh and try again.' };

    lock.waitLock(30000);
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const idx = headerIndexMap_(sheet);
    let request = null;
    // A stable checkout key prevents a double click or network retry from charging twice.
    const last = sheet.getLastRow();
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][idx.CheckoutKey] || '') === checkoutKey && String(rows[i][idx.WebsiteEmail] || '').toLowerCase() === session.email) {
          request = { rowNo: i + 2, row: rows[i] };
          break;
        }
      }
    }

    if (request && String(request.row[idx.Status] || '').toUpperCase() === 'APPROVED') {
      return { ok: true, alreadyCompleted: true, balanceLKR: getWalletBalance_(session.email), message: 'This wallet purchase has already been completed.' };
    }

    if (!request) {
      const flowValue = String(data.flow || 'change').toLowerCase();
      const isNewOrder = flowValue === 'new-order';
      const flow = flowValue === 'renew' ? 'renew' : 'change';
      const mapping = isNewOrder ? null : getVpnMappingRecord_(session.email, data.clientId || '');
      const serviceResolved = isNewOrder ? resolveServiceOrder_(data.serviceId) : null;
      if (isNewOrder && !serviceResolved.ok) return { ok:false, error:serviceResolved.error };
      const resolved = isNewOrder ? serviceResolved : resolveCustomerPackageChoice_(mapping, data.packageChoice, flow);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const selected = resolved.package;
      if (!selected || selected.priceLKR <= 0 || selected.durationDays < 0 || !Number.isFinite(selected.dataGB) || selected.dataGB < 0) {
        return { ok: false, error: 'This package is not configured for wallet checkout.' };
      }

      let pendingWallet = null;
      if (last > 1) {
        const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (String(row[idx.WebsiteEmail] || '').toLowerCase() !== session.email) continue;
          const state = String(row[idx.Status] || '').toUpperCase();
          if (['PENDING', 'PROCESSING', 'FAILED'].indexOf(state) < 0) continue;
          const method = String(row[idx.PaymentMethod] || 'SLIP').toUpperCase();
          if (method === 'WALLET' && ['PROCESSING', 'FAILED'].indexOf(state) >= 0 && String(row[idx.PackageId] || '') === selected.packageId) {
            pendingWallet = { rowNo: i + 2, row: row };
          } else {
            return { ok: false, error: 'You already have another payment request waiting for review or reconciliation.' };
          }
        }
      }

      if (pendingWallet) {
        request = pendingWallet;
        request.row[idx.CheckoutKey] = checkoutKey;
        sheet.getRange(request.rowNo, 1, 1, request.row.length).setValues([request.row]);
      } else {
        const balance = getWalletBalance_(session.email);
        if (balance < selected.priceLKR) {
          return { ok: false, insufficientBalance: true, balanceLKR: balance, requiredLKR: selected.priceLKR, shortfallLKR: selected.priceLKR - balance, error: 'Your wallet balance is not enough. Please upload a payment slip for admin approval.' };
        }
        const hasExistingClient = !!(mapping && String(mapping.row[mapping.index.PanelClientEmail] || '').trim());
        const requestFlow = flow === 'renew' ? 'RENEWAL' : 'PACKAGE_CHANGE';
        const row = new Array(sheet.getLastColumn()).fill('');
        const requestId = Utilities.getUuid();
        row[idx.RequestId] = requestId;
        row[idx.CreatedAt] = new Date();
        row[idx.WebsiteEmail] = session.email;
        row[idx.CustomerName] = session.name;
        row[idx.PackageId] = selected.packageId;
        row[idx.PackageName] = selected.name;
        row[idx.DurationDays] = selected.durationDays;
        row[idx.DataGB] = selected.dataGB;
        row[idx.PriceLKR] = selected.priceLKR;
        row[idx.RequestType] = isNewOrder ? 'NEW ORDER · WALLET · ' + serviceResolved.service.name : (hasExistingClient ? (requestFlow === 'RENEWAL' ? 'Wallet Renewal' : 'Wallet Package Change') : 'Wallet New Activation');
        row[idx.Status] = 'PROCESSING';
        row[idx.VpsAction] = 'WALLET_CHECKOUT_PROCESSING';
        row[idx.InboundId] = selected.inboundId || (mapping && Number(mapping.row[mapping.index.InboundId] || 0)) || '';
        if (idx.TargetClientId != null && mapping) row[idx.TargetClientId] = String(mapping.row[mapping.index.ClientId] || '');
        if (idx.ClientName != null && mapping) row[idx.ClientName] = String(mapping.row[mapping.index.ClientName] || '');
        row[idx.PaymentMethod] = 'WALLET';
        row[idx.CheckoutKey] = checkoutKey;
        if (isNewOrder && idx.ServiceId != null) row[idx.ServiceId] = serviceResolved.service.serviceId;
        if (isNewOrder && idx.ServiceAppType != null) row[idx.ServiceAppType] = serviceResolved.service.appType;
        const rowNo = sheet.getLastRow() + 1;
        sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
        request = { rowNo: rowNo, row: row };
      }
    }

    const paymentMethod = String(request.row[idx.PaymentMethod] || '').toUpperCase();
    if (paymentMethod !== 'WALLET') return { ok: false, error: 'This request is not a wallet purchase.' };
    const status = String(request.row[idx.Status] || '').toUpperCase();
    if (status === 'REJECTED') return { ok: false, error: 'This checkout request was rejected.' };

    const requestId = String(request.row[idx.RequestId] || '');
    // If a previous interrupted run already wrote the debit, do not charge it again.
    const walletTx = ensureHeaders_(WALLET_TX_SHEET, WALLET_TX_HEADERS);
    const txIdx = headerIndexMap_(walletTx);
    const txLast = walletTx.getLastRow();
    let debitAlreadyRecorded = false;
    if (txLast > 1) {
      const txRows = walletTx.getRange(2, 1, txLast - 1, walletTx.getLastColumn()).getValues();
      debitAlreadyRecorded = txRows.some(function (r) {
        return String(r[txIdx.WebsiteEmail] || '').toLowerCase() === session.email && String(r[txIdx.Type] || '') === 'PURCHASE_DEBIT' && String(r[txIdx.ReferenceId] || '') === requestId;
      });
    }
    if (!debitAlreadyRecorded && getWalletBalance_(session.email) < Number(request.row[idx.PriceLKR] || 0)) {
      return { ok: false, insufficientBalance: true, balanceLKR: getWalletBalance_(session.email), requiredLKR: Number(request.row[idx.PriceLKR] || 0), error: 'Your wallet balance is not enough. Please upload a payment slip.' };
    }

    request.row[idx.Status] = 'PROCESSING';
    request.row[idx.AdminNote] = 'Wallet checkout is being reconciled.';
    sheet.getRange(request.rowNo, 1, 1, request.row.length).setValues([request.row]);
    let applied = null;
    let vpsApplied = false;
    try {
      const appliedLabel = String(request.row[idx.VpsAction] || '');
      if (['CREATED_NEW_CLIENT', 'RENEWED_EXISTING_CLIENT'].indexOf(appliedLabel) >= 0) {
        // The helper only saves this label after both 3x-ui operations and VPNLinks save completed.
        applied = { action: appliedLabel };
        vpsApplied = true;
      } else {
        applied = applyPaymentRequestToVps_(sheet, request.rowNo, request.row, idx, 'wallet checkout');
        vpsApplied = true;
      }
      if (!debitAlreadyRecorded) {
        const debit = changeWalletBalance_(session.email, -Number(request.row[idx.PriceLKR]), 'PURCHASE_DEBIT', requestId,
          'Wallet payment for ' + String(request.row[idx.PackageName] || 'VPN package'));
        if (!debit.ok) throw new Error(debit.error || 'Could not debit the wallet after VPS update.');
      }
      request.row[idx.Status] = 'APPROVED';
      request.row[idx.AdminNote] = 'Paid from wallet and applied to 3x-ui successfully.';
      request.row[idx.ReviewedAt] = new Date();
      request.row[idx.ReviewedBy] = 'WALLET';
      sheet.getRange(request.rowNo, 1, 1, request.row.length).setValues([request.row]);
      if (/^NEW ORDER/i.test(String(request.row[idx.RequestType]||''))) notifyAdminNewOrder_(session.name, session.email, request.row[idx.PackageName], request.row[idx.PriceLKR], requestId, 'WALLET');
      return { ok: true, requestId: requestId, action: applied.action, balanceLKR: getWalletBalance_(session.email), message: /^NEW ORDER/i.test(String(request.row[idx.RequestType]||'')) ? 'Wallet payment completed. Your new VPN client is active; your configuration will appear in Orders after admin attaches it.' : 'Wallet payment completed. Your VPN subscription has been updated.' };
    } catch (applyErr) {
      request.row[idx.Status] = 'FAILED';
      request.row[idx.AdminNote] = 'Wallet checkout VPS action failed: ' + String(applyErr.message || applyErr).slice(0, 350);
      if (!vpsApplied) request.row[idx.VpsAction] = 'FAILED_RETRY_ALLOWED';
      sheet.getRange(request.rowNo, 1, 1, request.row.length).setValues([request.row]);
      return { ok: false, error: request.row[idx.AdminNote], requestId: requestId };
    }
  } catch (err) {
    console.error('purchaseWithWallet error: ' + err.message);
    return { ok: false, error: err.message || 'Wallet checkout failed.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function adminCreditWallet(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const admin = requireAdmin_(data.adminToken);
    if (!admin) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const email = String(data.websiteEmail || '').trim().toLowerCase();
    const amount = Number(data.amountLKR);
    const note = String(data.note || '').trim().slice(0, 300);
    if (!validEmail_(email) || findUserRow_(getSheet_(USERS_SHEET, USERS_HEADERS), email) < 2) return { ok: false, error: 'Enter an existing customer website email.' };
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return { ok: false, error: 'Enter a valid whole-number LKR amount.' };
    lock.waitLock(20000);
    const ref = Utilities.getUuid();
    const result = changeWalletBalance_(email, amount, 'ADMIN_CREDIT', ref, note || ('Wallet credit by ' + admin.user));
    if (!result.ok) return result;
    return { ok: true, balanceLKR: result.balanceLKR, message: 'Wallet credited successfully. New balance: LKR ' + result.balanceLKR };
  } catch (err) {
    console.error('adminCreditWallet error: ' + err.message);
    return { ok: false, error: err.message || 'Could not credit wallet.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function adminReviewPayment(data) {
  const lock = LockService.getScriptLock();
  try {
    data = data || {};
    const admin = requireAdmin_(data.adminToken);
    if (!admin) return { ok: false, sessionExpired: true, error: 'Admin session expired. Please sign in again.' };
    const requestId = String(data.requestId || '').trim();
    const action = String(data.action || '').toLowerCase();
    const note = String(data.note || '').trim().slice(0, 500);
    if (!requestId || ['approve', 'reject'].indexOf(action) < 0) return { ok: false, error: 'Invalid payment review request.' };

    lock.waitLock(30000);
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const foundRequest = findPaymentRequest_(sheet, requestId);
    if (!foundRequest) return { ok: false, error: 'Payment request not found.' };
    const idx = foundRequest.index;
    const row = foundRequest.row;
    const rowNo = foundRequest.rowNo;
    const method = String(row[idx.PaymentMethod] || 'SLIP').toUpperCase();
    if (method === 'WALLET') return { ok: false, error: 'Wallet purchases are processed automatically; do not approve them as a payment slip.' };
    const currentStatus = String(row[idx.Status] || '').toUpperCase();
    if (currentStatus === 'APPROVED' || currentStatus === 'REJECTED') return { ok: false, error: 'This payment request has already been reviewed.' };

    if (action === 'reject') {
      if (currentStatus !== 'PENDING') return { ok: false, error: 'Only a pending slip request can be rejected.' };
      row[idx.Status] = 'REJECTED';
      row[idx.AdminNote] = note || 'Payment rejected by admin.';
      row[idx.ReviewedAt] = new Date();
      row[idx.ReviewedBy] = admin.user;
      row[idx.VpsAction] = 'NOT_APPLIED';
      sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
      return { ok: true, message: 'Payment rejected.' };
    }

    row[idx.Status] = 'PROCESSING';
    row[idx.AdminNote] = note || 'Approved by admin; applying to 3x-ui.';
    sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
    let vpsApplied = false;
    try {
      const appliedLabel = String(row[idx.VpsAction] || '');
      const result = ['CREATED_NEW_CLIENT', 'RENEWED_EXISTING_CLIENT'].indexOf(appliedLabel) >= 0
        ? { action: appliedLabel }
        : applyPaymentRequestToVps_(sheet, rowNo, row, idx, admin.user);
      vpsApplied = true;
      row[idx.Status] = 'APPROVED';
      row[idx.AdminNote] = note || 'Approved by admin and applied to 3x-ui.';
      row[idx.ReviewedAt] = new Date();
      row[idx.ReviewedBy] = admin.user;
      sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
      const isNewOrder = /^NEW ORDER/i.test(String(row[idx.RequestType] || ''));
      return { ok: true, message: isNewOrder ? 'New order approved and its 3x-ui client is ready for configuration delivery.' : (result.action === 'CREATED_NEW_CLIENT' ? 'Payment approved and new VPN client created.' : 'Payment approved and existing VPN client renewed.') };
    } catch (vpsErr) {
      row[idx.Status] = 'FAILED';
      row[idx.AdminNote] = (note ? note + ' · ' : '') + 'VPS action failed: ' + String(vpsErr.message || vpsErr).slice(0, 400);
      if (!vpsApplied) row[idx.VpsAction] = 'FAILED_RETRY_ALLOWED';
      sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
      return { ok: false, error: row[idx.AdminNote] };
    }
  } catch (err) {
    console.error('adminReviewPayment error: ' + err.message);
    return { ok: false, error: err.message || 'Could not review payment.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}


function deleteExpiredCustomerClient(sessionToken, clientId) {
  const lock = LockService.getScriptLock();
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const id = String(clientId || '').trim();
    if (!id) return { ok: false, error: 'Choose the client you want to delete.' };
    lock.waitLock(20000);
    const record = getVpnMappingRecord_(session.email, id);
    if (!record) return { ok: false, error: 'This VPN client was not found in your account.' };
    const panelEmail = String(record.row[record.index.PanelClientEmail] || '').trim();
    if (!panelEmail) return { ok: false, error: 'The selected VPN client mapping is incomplete.' };
    const inbounds = fetchXuiInbounds_();
    const mapping = { panelClientEmail: panelEmail, inboundId: Number(record.row[record.index.InboundId] || 0) || null };
    const summary = buildCustomerVpnSummary_(inbounds, mapping);
    if (!summary.ok) return { ok: false, error: summary.error || 'Could not verify this VPN client.' };
    if (summary.vpn.status !== 'Expired') return { ok: false, error: 'Only an expired client can be deleted. This client is currently ' + summary.vpn.status + '.' };

    // Official 3x-ui Clients API. keepTraffic=1 preserves the traffic record for history.
    xuiPostJson_('/api/clients/del/' + encodeURIComponent(panelEmail) + '?keepTraffic=1', {});
    const row = record.row.slice();
    row[record.index.Enabled] = false;
    if (record.index.DeletedAt != null) row[record.index.DeletedAt] = new Date();
    record.sheet.getRange(record.rowNumber, 1, 1, row.length).setValues([row]);
    return { ok: true, message: String(row[record.index.ClientName] || 'VPN client') + ' was deleted successfully.' };
  } catch (err) {
    console.error('deleteExpiredCustomerClient error: ' + err.message);
    return { ok: false, error: err.message || 'Could not delete the expired VPN client.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function getCustomerOrders(sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return {ok:false,sessionExpired:true,error:'Your session has expired. Please sign in again.'};
    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS), idx = headerIndexMap_(sheet), last = sheet.getLastRow(), orders=[];
    const webAppUrl = ScriptApp.getService().getUrl();
    if (last > 1) {
      const rows = sheet.getRange(2,1,last-1,sheet.getLastColumn()).getValues();
      for (let i=rows.length-1;i>=0 && orders.length<50;i--) {
        const r=rows[i];
        if (String(r[idx.WebsiteEmail]||'').toLowerCase()!==session.email || !/^NEW ORDER/i.test(String(r[idx.RequestType]||''))) continue;
        const status=String(r[idx.Status]||'').toUpperCase();
        const fileId=String(idx.ConfigFileId!=null?r[idx.ConfigFileId]||'':'');
        const requestId=String(r[idx.RequestId]||'');
        const fileUrl=status==='APPROVED'&&fileId&&webAppUrl
          ? webAppUrl+'?downloadOrderFile='+encodeURIComponent(requestId)+'&token='+encodeURIComponent(String(sessionToken||''))
          : '';
        orders.push({requestId:requestId,createdAt:r[idx.CreatedAt] instanceof Date?r[idx.CreatedAt].toISOString():String(r[idx.CreatedAt]||''),packageName:String(r[idx.PackageName]||''),priceLKR:Number(r[idx.PriceLKR]||0),status:status,configType:String(idx.ConfigType!=null?r[idx.ConfigType]||'':''),configCode:String(idx.ConfigValue!=null?r[idx.ConfigValue]||'':''),configFileName:status==='APPROVED'?String(idx.ConfigFileName!=null?r[idx.ConfigFileName]||'':'' ):'',configFileUrl:fileUrl,clientName:String(r[idx.VpsClientEmail]||'')});
      }
    }
    return {ok:true,orders:orders};
  } catch(err) { console.error('getCustomerOrders error: '+err.message); return {ok:false,error:err.message||'Could not load orders.'}; }
}

/**
 * Serves the original uploaded config file only to the customer who owns the order.
 * The file is streamed through a short-lived HTML download page so the browser
 * receives the original filename and extension instead of a Drive preview/archive.
 */
function renderCustomerOrderFileDownload_(requestId, sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return HtmlService.createHtmlOutput('<h3>Session expired</h3><p>Please sign in to Solara Nexus and open Orders again.</p>');

    const sheet = ensureHeaders_(PAYMENTS_SHEET, PAYMENTS_HEADERS);
    const found = findPaymentRequest_(sheet, requestId);
    if (!found) return HtmlService.createHtmlOutput('<h3>Order not found</h3><p>This download link is not valid.</p>');

    const idx = found.index, row = found.row;
    if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== session.email || !/^NEW ORDER/i.test(String(row[idx.RequestType] || ''))) {
      return HtmlService.createHtmlOutput('<h3>Access denied</h3><p>This configuration belongs to a different account.</p>');
    }
    if (String(row[idx.Status] || '').toUpperCase() !== 'APPROVED') {
      return HtmlService.createHtmlOutput('<h3>Configuration not ready</h3><p>Your order must be approved before its configuration can be downloaded.</p>');
    }
    const fileId = String(idx.ConfigFileId != null ? row[idx.ConfigFileId] || '' : '').trim();
    if (!fileId) return HtmlService.createHtmlOutput('<h3>File not found</h3><p>No configuration file is attached to this order.</p>');

    const driveFile = DriveApp.getFileById(fileId);
    const blob = driveFile.getBlob();
    const payload = {
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: String(blob.getContentType() || 'application/octet-stream'),
      fileName: String(idx.ConfigFileName != null ? row[idx.ConfigFileName] || driveFile.getName() : driveFile.getName())
    };
    const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Downloading configuration</title>' +
      '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#03040a;color:#e8f1ff;font:16px Arial,sans-serif}.box{max-width:440px;margin:24px;padding:30px;border:1px solid #164d75;border-radius:18px;background:#0a1228;text-align:center}button{border:0;border-radius:10px;padding:13px 22px;background:linear-gradient(135deg,#00b3ff,#2f6bff);color:#00101f;font-weight:700;cursor:pointer}</style></head><body><div class="box"><h2>Solara Nexus</h2><p>Your original configuration file is ready.</p><button id="downloadBtn" type="button">Download file</button><p id="status">Starting download…</p></div>' +
      '<script>const fileData=' + payloadJson + ';function downloadOriginal(){try{const raw=atob(fileData.base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const blob=new Blob([bytes],{type:fileData.mimeType||"application/octet-stream"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=fileData.fileName||"configuration.bin";document.body.appendChild(a);a.click();a.remove();document.getElementById("status").textContent="Download started. If it did not start, press Download file.";setTimeout(function(){URL.revokeObjectURL(url);},15000);}catch(e){document.getElementById("status").textContent="Download could not start. Press Download file to try again.";}}document.getElementById("downloadBtn").addEventListener("click",downloadOriginal);window.addEventListener("load",function(){setTimeout(downloadOriginal,250);});</script></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('Solara Nexus | Download Configuration').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    console.error('renderCustomerOrderFileDownload_ error: ' + err.message);
    return HtmlService.createHtmlOutput('<h3>Download failed</h3><p>Could not prepare this configuration file. Please contact support.</p>');
  }
}

function adminSaveOrderDelivery(data) {
  const lock=LockService.getScriptLock();
  try {
    data=data||{};
    const admin=requireAdmin_(data.adminToken);
    if(!admin)return {ok:false,sessionExpired:true,error:'Admin session expired.'};
    const requestId=String(data.requestId||'').trim();
    if(!requestId)return {ok:false,error:'Order not found.'};
    const type=String(data.configType||'').toUpperCase();
    if(['FILE','CODE'].indexOf(type)<0)return {ok:false,error:'Choose a config file or config code.'};
    lock.waitLock(20000);
    const sheet=ensureHeaders_(PAYMENTS_SHEET,PAYMENTS_HEADERS), found=findPaymentRequest_(sheet,requestId);
    if(!found)return {ok:false,error:'Order not found.'};
    const idx=found.index,row=found.row,rowNo=found.rowNo;
    if(!/^NEW ORDER/i.test(String(row[idx.RequestType]||'')))return {ok:false,error:'This request is not a new Order Services order.'};
    // The admin's Delivery type selector is authoritative: FILE and CODE are both supported.
    if(String(row[idx.Status]||'').toUpperCase()!=='APPROVED')return {ok:false,error:'Approve the order payment and create the VPS client before sending its config.'};
    let fileId='',fileName='',code='';
    if(idx.ConfigType==null)return {ok:false,error:'Payments sheet is missing the ConfigType column. Please run the payment setup again.'};
    if(type==='CODE'){
      code=String(data.configCode||'');
      if(!code.trim() || code.length>20000)return {ok:false,error:'Enter a config code (maximum 20,000 characters).'};
      if(idx.ConfigValue==null)return {ok:false,error:'Payments sheet is missing the ConfigValue column. Please run the payment setup again.'};
      // Write only the delivery cells. Force plain text so codes beginning with '='
      // or containing special characters are not interpreted as spreadsheet formulas.
      const codeCell=sheet.getRange(rowNo,idx.ConfigValue+1);
      codeCell.setNumberFormat('@');
      codeCell.setValue(code);
      if(idx.ConfigFileId!=null)sheet.getRange(rowNo,idx.ConfigFileId+1).clearContent();
      if(idx.ConfigFileName!=null)sheet.getRange(rowNo,idx.ConfigFileName+1).clearContent();
      sheet.getRange(rowNo,idx.ConfigType+1).setValue('CODE');
      SpreadsheetApp.flush();
      const savedCode=String(codeCell.getValue()==null?'':codeCell.getValue());
      if(savedCode!==code)return {ok:false,error:'The configuration code could not be verified after saving. Please try again.'};
    }else{
      const f=data.file||{};
      const name=String(f.name||'').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
      const suppliedMime=String(f.mimeType||'').toLowerCase();
      const allowedExtensions=['ehi','zip','txt','json'];
      const extension=(name.split('.').pop()||'').toLowerCase();
      const allowedMimeTypes=['application/octet-stream','application/zip','application/x-zip-compressed','text/plain','application/json'];
      if(!name || allowedExtensions.indexOf(extension)<0)return {ok:false,error:'Choose an EHI, ZIP, TXT or JSON configuration file.'};
      const mime=allowedMimeTypes.indexOf(suppliedMime)>=0?suppliedMime:'application/octet-stream';
      const b64=String(f.base64||'').replace(/^data:[^,]+,/,'').trim();
      if(!b64 || b64.length>Math.ceil(PAYMENT_FILE_MAX_BYTES*1.4))return {ok:false,error:'Config file is too large (maximum 5 MB).'};
      const bytes=Utilities.base64Decode(b64); if(!bytes.length||bytes.length>PAYMENT_FILE_MAX_BYTES)return {ok:false,error:'Config file is too large (maximum 5 MB).'};
      const folder=getPrivatePaymentFolder_();
      const driveFile=folder.createFile(Utilities.newBlob(bytes,mime,name));
      driveFile.setDescription('Solara Nexus order config. Request ID: '+requestId+' Customer: '+String(row[idx.WebsiteEmail]||''));
      // Keep the file private. The customer downloads it through the authenticated
      // order link, so Drive viewer permissions are not required.
      fileId=driveFile.getId();fileName=name;
      if(idx.ConfigFileId!=null)sheet.getRange(rowNo,idx.ConfigFileId+1).setValue(fileId);
      if(idx.ConfigFileName!=null)sheet.getRange(rowNo,idx.ConfigFileName+1).setValue(fileName);
      if(idx.ConfigValue!=null)sheet.getRange(rowNo,idx.ConfigValue+1).clearContent();
      sheet.getRange(rowNo,idx.ConfigType+1).setValue('FILE');
      SpreadsheetApp.flush();
      const savedFileId=idx.ConfigFileId!=null?String(sheet.getRange(rowNo,idx.ConfigFileId+1).getValue()||''):'';
      if(!savedFileId || savedFileId!==fileId)return {ok:false,error:'The configuration file was uploaded but its order record could not be verified. Please contact support.'};
    }

    const email=String(row[idx.WebsiteEmail]||'').toLowerCase();
    const clientName=String(row[idx.VpsClientEmail]||email);
    const subject='Your Solara Nexus VPN order is ready';
    const body='Your new VPN client has been created. Client name: '+clientName+'\n\n'+
      (type==='CODE'?'Your configuration code:\n'+code:'Your configuration file is ready. Sign in to Solara Nexus and open the Orders tab to download the original file.')+
      '\n\nOpen the Orders tab in your Solara Nexus account to access it.';
    let emailSent=false;
    try { MailApp.sendEmail(email,subject,body); emailSent=true; }
    catch(mailErr) { console.error('Order config email failed after save: '+mailErr.message); }
    return {ok:true,message:emailSent?'Configuration saved and emailed to '+email+'.':'Configuration saved successfully. The customer can access it from the Orders tab; email delivery was unavailable.'};
  } catch(err) { console.error('adminSaveOrderDelivery error: '+err.message); return {ok:false,error:err.message||'Could not save order configuration.'}; }
  finally { try{lock.releaseLock();}catch(x){} }
}

function findXuiClient_(inbounds, clientEmail) {
  const target = String(clientEmail || '').trim().toLowerCase();
  let found = null;
  (Array.isArray(inbounds) ? inbounds : []).forEach(function (ib) {
    const settings = parseXuiObject_(ib.settings);
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    clients.forEach(function (client) {
      if (String(client && client.email || '').trim().toLowerCase() === target) {
        if (!found) found = { client: client, inboundIds: [] };
        found.inboundIds.push(Number(ib.id));
      }
    });
  });
  return found;
}

/** Converts an allowance entered in GB into the byte count expected by 3x-ui. Zero means unlimited. */
function quotaBytesFromGB_(gb) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1024 * 1024 * 1024);
}

/** 3x-ui v3.11.0 Node Sync scope permits clients/add, clients/update/:email and clients/resetTraffic/:email. */
function xuiPostJson_(apiPath, body) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = String(props.getProperty('XUI_BASE_URL') || '').trim().replace(/\/+$/, '');
  const token = String(props.getProperty('XUI_API_TOKEN') || '').trim();
  if (!baseUrl || !token) throw new Error('Missing XUI_BASE_URL or XUI_API_TOKEN in Script Properties.');
  const response = UrlFetchApp.fetch(baseUrl + apiPath, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    payload: JSON.stringify(body || {}),
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) throw new Error('3x-ui request failed (HTTP ' + status + '): ' + text.slice(0, 220));
  let result;
  try { result = JSON.parse(text); } catch (err) { throw new Error('3x-ui returned a non-JSON response for ' + apiPath + '.'); }
  if (!result || result.success !== true) throw new Error(String(result && result.msg || '3x-ui rejected the client operation.'));
  return result;
}

/* ---------- Diagnostic helpers ---------- */

function testMail() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Solara Nexus test', 'If you can read this, email sending works.');
}

function checkSetup() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet: ' + (ss ? ss.getName() : 'NOT FOUND'));
  const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
  Logger.log('Registered users: ' + Math.max(0, sheet.getLastRow() - 1));
  Logger.log('Emails you can send today: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Codes sent from: ' + Session.getEffectiveUser().getEmail());
  Logger.log('HTML file used: ' + HTML_FILE + '.html');
}

function debugEmails() {
  const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
  const last = sheet.getLastRow();
  Logger.log('Total rows: ' + last + ' (users: ' + Math.max(0, last - 1) + ')');
  if (last > 1) {
    const emails = sheet.getRange(2, 3, last - 1, 1).getValues();
    for (let i = 0; i < emails.length; i++) {
      const raw = emails[i][0];
      Logger.log('Row ' + (i + 2) + ': "' + raw + '" (len=' + String(raw).length + ')');
    }
  }
}

function testFindUser() {
  const email = 'YOUR_SIGNUP_EMAIL@gmail.com'; // <-- change this
  const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
  const row = findUserRow_(sheet, email);
  Logger.log('Looking for: "' + email + '"');
  Logger.log('findUserRow_ result: ' + row);
  if (row > 0) {
    const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
    Logger.log('Found at row ' + row + ' — email in sheet: "' + values[2] + '"');
  } else {
    Logger.log('❌ NOT FOUND — this is why OTP is not sent');
  }
}

function cleanAllEmails() {
  const sheet = getSheet_(USERS_SHEET, USERS_HEADERS);
  const last = sheet.getLastRow();
  if (last < 2) { Logger.log('No users to clean'); return; }
  const range = sheet.getRange(2, 3, last - 1, 1);
  const emails = range.getValues();
  let changed = 0;
  for (let i = 0; i < emails.length; i++) {
    const original = String(emails[i][0]);
    const cleaned = original.trim().toLowerCase();
    if (original !== cleaned) {
      emails[i][0] = cleaned;
      changed++;
      Logger.log('Row ' + (i + 2) + ': "' + original + '" → "' + cleaned + '"');
    }
  }
  if (changed > 0) {
    range.setValues(emails);
    Logger.log('✅ Cleaned ' + changed + ' email(s)');
  } else {
    Logger.log('✅ All emails already clean');
  }
}


/* ---------- Customer Notifications ---------- */
const CUSTOMER_NOTIFICATIONS_SHEET = 'CustomerNotifications';
const CUSTOMER_NOTIFICATIONS_HEADERS = ['NotificationId', 'CreatedAt', 'WebsiteEmail', 'Title', 'Message', 'ReadAt'];

function adminGetNotificationCustomers(adminToken) {
  try {
    if (!requireAdmin_(adminToken)) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const sheet = ensureHeaders_(USERS_SHEET, USERS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    const customers = [];
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      rows.forEach(function (row) {
        const email = String(row[idx.Email] || '').trim().toLowerCase();
        if (!validEmail_(email)) return;
        customers.push({ email: email, name: String(row[idx.Name] || email) });
      });
    }
    customers.sort(function (x, y) { return x.email.localeCompare(y.email); });
    return { ok: true, customers: customers };
  } catch (err) {
    console.error('adminGetNotificationCustomers error: ' + err.message);
    return { ok: false, error: err.message || 'Could not load customers.' };
  }
}

function adminSendCustomerNotification(data) {
  try {
    data = data || {};
    if (!requireAdmin_(data.adminToken)) return { ok: false, sessionExpired: true, error: 'Admin session expired.' };
    const email = String(data.websiteEmail || '').trim().toLowerCase();
    const title = String(data.title || '').trim().slice(0, 100);
    const message = String(data.message || '').trim().slice(0, 2000);
    if (!validEmail_(email)) return { ok: false, error: 'Choose a valid customer account.' };
    if (!message) return { ok: false, error: 'Enter a notification message.' };

    const users = ensureHeaders_(USERS_SHEET, USERS_HEADERS);
    const uidx = headerIndexMap_(users);
    const last = users.getLastRow();
    let customerExists = false;
    if (last > 1) {
      const rows = users.getRange(2, 1, last - 1, users.getLastColumn()).getValues();
      customerExists = rows.some(function (row) {
        return String(row[uidx.Email] || '').trim().toLowerCase() === email;
      });
    }
    if (!customerExists) return { ok: false, error: 'That customer account was not found.' };

    const sheet = ensureHeaders_(CUSTOMER_NOTIFICATIONS_SHEET, CUSTOMER_NOTIFICATIONS_HEADERS);
    const id = Utilities.getUuid();
    sheet.appendRow([id, new Date(), email, title, message, '']);
    return { ok: true, message: 'Notification sent to ' + email + '.' };
  } catch (err) {
    console.error('adminSendCustomerNotification error: ' + err.message);
    return { ok: false, error: err.message || 'Could not send notification.' };
  }
}

function getCustomerNotifications(sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const sheet = ensureHeaders_(CUSTOMER_NOTIFICATIONS_SHEET, CUSTOMER_NOTIFICATIONS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    const notifications = [];
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== session.email) continue;
        notifications.push({
          notificationId: String(row[idx.NotificationId] || ''),
          createdAt: row[idx.CreatedAt] instanceof Date ? row[idx.CreatedAt].toISOString() : String(row[idx.CreatedAt] || ''),
          title: String(row[idx.Title] || ''),
          message: String(row[idx.Message] || ''),
          read: !!row[idx.ReadAt]
        });
        if (notifications.length >= 100) break;
      }
    }
    return { ok: true, notifications: notifications, unreadCount: notifications.filter(function (n) { return !n.read; }).length };
  } catch (err) {
    console.error('getCustomerNotifications error: ' + err.message);
    return { ok: false, error: err.message || 'Could not load notifications.' };
  }
}

function markCustomerNotificationsRead(sessionToken) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    const sheet = ensureHeaders_(CUSTOMER_NOTIFICATIONS_SHEET, CUSTOMER_NOTIFICATIONS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, markedCount: 0 };
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    const now = new Date();
    let markedCount = 0;
    rows.forEach(function (row, i) {
      if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== session.email || row[idx.ReadAt]) return;
      sheet.getRange(i + 2, idx.ReadAt + 1).setValue(now);
      markedCount++;
    });
    return { ok: true, markedCount: markedCount };
  } catch (err) {
    console.error('markCustomerNotificationsRead error: ' + err.message);
    return { ok: false, error: err.message || 'Could not update notifications.' };
  }
}

function markCustomerNotificationRead(sessionToken, notificationId) {
  try {
    const session = getCustomerSession_(sessionToken);
    if (!session) return { ok: false, sessionExpired: true, error: 'Your session has expired. Please sign in again.' };
    notificationId = String(notificationId || '').trim();
    if (!notificationId) return { ok: false, error: 'Invalid notification.' };
    const sheet = ensureHeaders_(CUSTOMER_NOTIFICATIONS_SHEET, CUSTOMER_NOTIFICATIONS_HEADERS);
    const idx = headerIndexMap_(sheet);
    const last = sheet.getLastRow();
    if (last < 2) return { ok: false, error: 'Notification not found.' };
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (String(row[idx.NotificationId] || '') !== notificationId) continue;
      if (String(row[idx.WebsiteEmail] || '').trim().toLowerCase() !== session.email) return { ok: false, error: 'Notification not found.' };
      if (!row[idx.ReadAt]) sheet.getRange(i + 2, idx.ReadAt + 1).setValue(new Date());
      return { ok: true };
    }
    return { ok: false, error: 'Notification not found.' };
  } catch (err) {
    console.error('markCustomerNotificationRead error: ' + err.message);
    return { ok: false, error: err.message || 'Could not update notification.' };
  }
}

/* ---------- Helpers ---------- */

function getSheet_(name, headers) {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findUserRow_(sheet, email) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const target = String(email).trim().toLowerCase();
  const emails = sheet.getRange(2, 3, last - 1, 1).getValues();
  for (let i = 0; i < emails.length; i++) {
    const cell = String(emails[i][0]).trim().toLowerCase();
    if (cell === target) return i + 2;
  }
  return -1;
}

function validEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function genOtp_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let otp = '';
  for (let i = 0; i < 6; i++) otp += parseInt(hex.substr(i * 4, 4), 16) % 10;
  return otp;
}

function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

function clean_(value, max) {
  let v = String(value == null ? '' : value).trim().slice(0, max);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}
