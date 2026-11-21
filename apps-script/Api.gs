/**
 * Solara Nexus - Vercel API bridge
 * Add this as a NEW file (Api.gs) inside the same Apps Script project as Code.gs.
 * It lets the website hosted on Vercel call your backend functions with fetch().
 * Only the functions listed below can be called from the internet.
 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = String(req.fn || '');
    var args = Array.isArray(req.args) ? req.args : [];
    var api = apiFunctions_();
    if (!Object.prototype.hasOwnProperty.call(api, fn)) throw new Error('Unknown function: ' + fn);
    var result = api[fn].apply(null, args);
    out = { result: result === undefined ? null : result };
  } catch (err) {
    console.error('doPost error: ' + (err && err.message));
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function apiFunctions_() {
  return {
    // public / customer
    getPlans: getPlans,
    getOrderServices: getOrderServices,
    signUp: signUp,
    signIn: signIn,
    requestReset: requestReset,
    verifyOtp: verifyOtp,
    resetPassword: resetPassword,
    signOutCustomer: signOutCustomer,
    getCustomerDashboard: getCustomerDashboard,
    getCustomerClientTraffic: getCustomerClientTraffic,
    getCustomerSubscriptionData: getCustomerSubscriptionData,
    getCustomerWalletBalance: getCustomerWalletBalance,
    submitPaymentRequest: submitPaymentRequest,
    getWalletTopupInfo: getWalletTopupInfo,
    submitWalletTopup: submitWalletTopup,
    purchaseWithWallet: purchaseWithWallet,
    deleteExpiredCustomerClient: deleteExpiredCustomerClient,
    deleteCustomerOrder: deleteCustomerOrder,
    getCustomerOrders: getCustomerOrders,
    getCustomerNotifications: getCustomerNotifications,
    markCustomerNotificationsRead: markCustomerNotificationsRead,
    markCustomerNotificationRead: markCustomerNotificationRead,
    // admin (each one still checks the admin session token)
    adminLogin: adminLogin,
    adminLogout: adminLogout,
    adminGetPortalData: adminGetPortalData,
    getAdminNewOrders: getAdminNewOrders,
    getAdminNewOrderCount: getAdminNewOrderCount,
    adminDeleteNewOrder: adminDeleteNewOrder,
    adminSavePackage: adminSavePackage,
    adminDisablePackage: adminDisablePackage,
    adminSaveService: adminSaveService,
    adminDisableService: adminDisableService,
    adminDeleteService: adminDeleteService,
    adminSaveWalletPaymentSettings: adminSaveWalletPaymentSettings,
    adminReviewWalletTopup: adminReviewWalletTopup,
    adminCreditWallet: adminCreditWallet,
    adminReviewPayment: adminReviewPayment,
    adminSaveOrderDelivery: adminSaveOrderDelivery,
    adminGetNotificationCustomers: adminGetNotificationCustomers,
    adminSendCustomerNotification: adminSendCustomerNotification
  };
}
